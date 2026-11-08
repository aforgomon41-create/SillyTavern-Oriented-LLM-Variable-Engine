import { compile } from '../schema.js';
import { canonical, fail } from '../json.js';
import { describeError, DiagnosticJournal } from '../diagnostics.js';
import { attachSillyTavern } from './controller.js';
import type { AttachOptions, SillyTavernController } from './controller.js';
import type { HostContext } from './sillytavern.js';
import { SillyTavern119Adapter } from './sillytavern.js';
import { restore } from '../history.js';
import type { CompiledDefinition, Definition } from '../types.js';
import { normalizeWorldInfoSelection, prepareWorldInfoDefinition } from './world-info.js';
import type { WorldInfoSelection } from './world-info.js';

export interface RegistrationOptions { characters?: string[]; attach?: AttachOptions; owner?: string; priority?: number }
export interface WorldInfoRegistrationOptions extends RegistrationOptions { worldInfo?: WorldInfoSelection }
export type PublicRegistrationOptions = Omit<RegistrationOptions, 'owner' | 'priority'>;
export type PublicWorldInfoRegistrationOptions = Omit<WorldInfoRegistrationOptions, 'owner' | 'priority'>;
interface Registration { definition: CompiledDefinition; characters: string[]; attach: AttachOptions; owner: string; priority: number }
interface WorldRegistration extends Registration { selection: WorldInfoSelection }

/** Only explicitly registered character bindings initialize new chats. Archived chats resolve by fingerprint. */
export class SolveSessionManager {
  private registrations = new Map<string, Registration>();
  private worldRegistrations = new Map<string, WorldRegistration>();
  private active?: SillyTavernController;
  private activeRegistration?: Registration;
  private activeWorldRegistration?: WorldRegistration;
  private loadingWorldRegistration?: WorldRegistration;
  private loadingRegistration?: Registration;
  private loadingChatId?: string;
  private loadingAbort?: AbortController;
  private epoch = 0;
  private disposeEvents?: () => void;
  private disposeController?: () => void;
  private listeners = new Set<() => void>();
  private phase: 'idle' | 'loading' | 'ready' | 'unbound' | 'error' = 'idle';
  private reason = '等待作者定义';
  private task: Promise<void> = Promise.resolve();
  readonly journal = new DiagnosticJournal();
  constructor(private context: () => HostContext, private fetcher: typeof fetch = fetch) {}
  get controller(): SillyTavernController | undefined { return this.active; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void { for (const listener of this.listeners) { try { listener(); } catch { /* observer only */ } } }
  getStatus() { return { chatId: this.context().chatId, phase: this.phase, reason: this.reason, registered: [...this.registrations.values(), ...this.worldRegistrations.values()].map(r => ({ id: r.definition.id, version: r.definition.version, fingerprint: r.definition.fingerprint, characters: [...r.characters] })), controller: this.active?.getStatus() }; }
  private start(): void {
    if (this.disposeEvents) return;
    const ctx = this.context(), source = ctx.eventSource, event = ctx.eventTypes?.CHAT_CHANGED;
    if (source) {
      const disposers: (() => void)[] = [];
      const changed = () => { void this.reconcile(true); };
      if (event) { source.on(event, changed); disposers.push(() => source.removeListener(event, changed)); }
      // Native PNG import may emit CHAT_CHANGED before its embedded book is saved.
      // Retry only a failed, uninitialized chat. Fixed declarations never follow live edits.
      const worldSaved = () => {
        const pending = this.task;
        return pending.then(() => {
          if (this.task === pending && this.phase === 'error' && this.worldRegistrations.size && !this.context().chatMetadata.solve)
            return this.reconcile();
        });
      };
      for (const name of new Set([ctx.eventTypes?.WORLDINFO_UPDATED, ctx.eventTypes?.WORLDINFO_SETTINGS_UPDATED].filter((name): name is string => Boolean(name)))) {
        source.on(name, worldSaved); disposers.push(() => source.removeListener(name, worldSaved));
      }
      if (disposers.length) this.disposeEvents = () => disposers.forEach(dispose => dispose());
    }
  }
  async register(definition: Definition, options: RegistrationOptions = {}): Promise<string> {
    const compiled = await compile(definition);
    const owner = options.owner ?? 'native', key = `${owner}:${compiled.fingerprint}`;
    const previous = this.registrations.get(key);
    this.registrations.set(key, { definition: compiled, characters: [...new Set([...previous?.characters ?? [], ...options.characters ?? []])], attach: { ...options.attach }, owner, priority: options.priority ?? 0 });
    this.start(); await this.reconcile(); return compiled.fingerprint;
  }
  async attach(definition: Definition, options: AttachOptions = {}): Promise<SillyTavernController> {
    if (this.active || this.phase === 'loading') fail('ALREADY_ATTACHED', '当前已有 SOLVE 实例或正在绑定，请先解绑');
    const compiled = await compile(definition);
    const registration = { definition: compiled, characters: [], attach: { ...options }, owner: 'manual', priority: 0 };
    this.registrations.set(`manual:${compiled.fingerprint}`, registration);
    this.start(); await this.switchTo(registration);
    if (!this.active) fail('STATE_NOT_READY', this.reason);
    return this.active;
  }
  async registerWorldInfo(definition: Definition, options: WorldInfoRegistrationOptions = {}): Promise<string> {
    const compiled = await compile(definition), selection = normalizeWorldInfoSelection(options.worldInfo);
    const owner = options.owner ?? 'native', characters = [...new Set(options.characters ?? [])];
    for (const avatar of characters.length ? characters : ['']) {
      const key = JSON.stringify([owner, compiled.fingerprint, avatar]);
      this.worldRegistrations.set(key, { definition: compiled, selection,
        characters: avatar ? [avatar] : [], attach: { ...options.attach }, owner, priority: options.priority ?? 0 });
    }
    this.start(); await this.reconcile(); return compiled.fingerprint;
  }
  reconcile(reload = false): Promise<void> {
    let registration: Registration | undefined;
    let worldRegistration: WorldRegistration | undefined;
    try {
      const ctx = this.context();
      if (ctx.groupId != null || !ctx.chatId) { this.detachActive(); this.phase = 'unbound'; this.reason = ctx.groupId != null ? '不支持群聊' : '尚未打开单角色聊天'; this.notify(); return Promise.resolve(); }
      const fingerprint = ctx.chatMetadata.solve?.definitionHash;
      const avatar = (ctx.characters as Record<string, any>)[String(ctx.characterId)]?.avatar;
      if (fingerprint) {
        registration = [...this.registrations.values()].filter(r => r.definition.fingerprint === fingerprint).sort((a, b) => b.priority - a.priority)[0];
        if (!registration && ctx.chatMetadata.solve?.authoring) {
          const candidates = [...this.worldRegistrations.values()].filter(r => r.definition.fingerprint === ctx.chatMetadata.solve.authoring.baseHash);
          const scoped = candidates.filter(r => r.characters.includes(avatar));
          worldRegistration = (scoped.length ? scoped : candidates).sort((a, b) => b.priority - a.priority)[0];
        }
      }
      else {
        const candidates = [...this.registrations.values(), ...this.worldRegistrations.values()].filter(r => r.characters.includes(avatar)).sort((a, b) => b.priority - a.priority);
        const matches = candidates.filter(r => r.priority === candidates[0]?.priority);
        if (new Set(matches.map(r => r.definition.fingerprint + ('selection' in r ? ':world:' + canonical(r.selection) : ':definition'))).size > 1)
          fail('AMBIGUOUS_DEFINITION', '角色绑定了多个作者定义或不同世界书选择，请明确保留一个入口');
        const chosen = matches[0];
        if (chosen && 'selection' in chosen) worldRegistration = chosen as WorldRegistration;
        else registration = chosen;
      }
      if (worldRegistration) {
        if (!reload && this.active?.boundChatId === ctx.chatId && this.activeWorldRegistration === worldRegistration
          || this.loadingChatId === ctx.chatId && this.loadingWorldRegistration === worldRegistration) return this.task;
        const source = worldRegistration;
        return this.switchTo(async (context, signal) => ({ ...source,
          definition: await prepareWorldInfoDefinition(source.definition, context, source.selection, this.fetcher, signal) }), source);
      }
      if (!registration) {
        this.detachActive(); this.phase = 'unbound';
        this.reason = fingerprint ? this.worldRegistrations.size && !ctx.chatMetadata.solve?.authoring
          ? '当前聊天的原定义尚未注册或世界书声明快照缺失；请注册原包或只读检查归档，不能读取当前世界书替代'
          : '当前聊天的原定义尚未注册，不能用其他版本替代' : '当前角色尚未绑定 SOLVE 定义';
        this.notify(); return Promise.resolve();
      }
      if (!reload && this.active?.boundChatId === ctx.chatId && this.activeRegistration === registration
        || this.loadingChatId === ctx.chatId && this.loadingRegistration === registration) return this.task;
    } catch (error) { this.setError(error); return Promise.resolve(); }
    return this.switchTo(registration);
  }
  private switchTo(input: Registration | ((context: () => HostContext, signal: AbortSignal) => Promise<Registration>), worldRegistration?: WorldRegistration): Promise<void> {
    this.detachActive(); const epoch = this.epoch;
    const chatId = this.context().chatId;
    this.loadingChatId = chatId; this.loadingWorldRegistration = worldRegistration;
    this.loadingRegistration = typeof input === 'function' ? undefined : input;
    const abort = this.loadingAbort = new AbortController();
    this.phase = 'loading'; this.reason = '正在恢复当前聊天'; this.notify();
    const scopedContext = () => {
      const ctx = this.context();
      if (epoch !== this.epoch || ctx.chatId !== chatId) fail('STALE_BINDING', '绑定期间聊天已切换');
      return ctx;
    };
    const task = (async () => {
      let controller: SillyTavernController | undefined;
      try {
        const registration = typeof input === 'function' ? await input(scopedContext, abort.signal) : input;
        scopedContext();
        controller = await attachSillyTavern(registration.definition, scopedContext, registration.attach, this.fetcher);
        if (epoch !== this.epoch) { controller.dispose(); return; }
        this.active = controller; this.activeRegistration = registration; this.activeWorldRegistration = worldRegistration; this.disposeController = controller.subscribe(() => this.notify());
        this.phase = 'ready'; this.reason = ''; this.journal.add('info', 'SESSION_ATTACHED', `聊天 ${chatId} 已绑定 ${registration.definition.id}@${registration.definition.version}`); this.notify();
      } catch (error) { controller?.dispose(); if (epoch === this.epoch) this.setError(error); }
      finally { if (epoch === this.epoch) { this.loadingChatId = undefined; this.loadingWorldRegistration = undefined; this.loadingRegistration = undefined; this.loadingAbort = undefined; } }
    })();
    this.task = task; return task;
  }
  private setError(error: unknown): void { this.detachActive(); this.phase = 'error'; this.reason = describeError(error).message; this.journal.add('error', describeError(error).code, this.reason); this.notify(); }
  async unregister(owner: string): Promise<void> {
    for (const [key, registration] of this.registrations) if (registration.owner === owner) this.registrations.delete(key);
    for (const [key, registration] of this.worldRegistrations) if (registration.owner === owner) this.worldRegistrations.delete(key);
    await this.reconcile();
  }
  private detachActive(): void { this.epoch++; this.loadingAbort?.abort(); this.loadingAbort = undefined; this.loadingChatId = undefined; this.loadingWorldRegistration = undefined; this.loadingRegistration = undefined; this.disposeController?.(); this.disposeController = undefined; this.active?.dispose(); this.active = undefined; this.activeRegistration = undefined; this.activeWorldRegistration = undefined; }
  detach(): void { this.detachActive(); this.disposeEvents?.(); this.disposeEvents = undefined; this.phase = 'idle'; this.reason = '已手动解绑'; this.notify(); }
  async settled(): Promise<void> { await this.task; }
  async inspectArchive(commitId?: string) {
    const ctx = this.context(), chatId = ctx.chatId;
    const adapter = new SillyTavern119Adapter(() => {
      const current = this.context(); if (current.chatId !== chatId) fail('STALE_BINDING', '读取期间聊天已切换'); return current;
    }, this.fetcher);
    await adapter.verifyVersion(); const archive = await adapter.load();
    if (this.context().chatId !== chatId) fail('STALE_BINDING', '读取期间聊天已切换');
    if (!archive) fail('ARCHIVE_INVALID', '当前聊天没有 SOLVE 归档');
    const target = commitId ?? [...ctx.chat].reverse().map(m => m.extra?.solve?.headId).find(id => archive.commits[id]);
    const state = target ? await restore(archive, target) : undefined;
    if (this.context().chatId !== chatId) fail('STALE_BINDING', '恢复期间聊天已切换');
    return { archive, commitId: target as string | undefined, state, readonly: true as const };
  }
  dispose(): void { this.detach(); this.listeners.clear(); }
}
