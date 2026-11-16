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
  private adoptRefused = new Map<string, string>();
  private bindRetries = new Map<string, number>();
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
  private phase: 'idle' | 'loading' | 'ready' | 'unbound' | 'error' | 'choose' | 'off' = 'idle';
  /**
   * Ask before binding a chat that has no SOLVE archive yet (the page's 选择数据结构 dialog). Off by default: scripts and
   * tests that register a definition for a character get it bound at once, as before.
   */
  private gate?: { auto?: () => string | undefined };
  /** Per chat: the structure the player picked (a candidate key), for chats that have no archive yet. */
  private chosen = new Map<string, string>();
  private reason = '等待作者定义';
  private task: Promise<void> = Promise.resolve();
  readonly journal = new DiagnosticJournal();
  constructor(private context: () => HostContext, private fetcher: typeof fetch = fetch) {}
  get controller(): SillyTavernController | undefined { return this.active; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void { for (const listener of this.listeners) { try { listener(); } catch { /* observer only */ } } }
  getStatus() { return { chatId: this.context().chatId, phase: this.phase, reason: this.reason, registered: [...this.registrations.values(), ...this.worldRegistrations.values()].map(r => ({ id: r.definition.id, version: r.definition.version, fingerprint: r.definition.fingerprint, characters: [...r.characters] })), controller: this.active?.getStatus(),
    ...(this.phase === 'choose' || this.phase === 'off' ? { candidates: this.candidates() } : {}) }; }
  /** Ask before binding chats without an archive. `auto` may name a candidate to bind without asking (设置 › 直接使用). */
  setGate(gate: { auto?: () => string | undefined } | undefined): void { this.gate = gate; this.start(); void this.reconcile(); }
  /**
   * What the current chat can be bound to: the card's own structures first (a character script or its world book),
   * then the page's catalog (the official structure). One entry per definition.
   */
  candidates(): { key: string; id: string; label: string; version: string; fingerprint: string; own: boolean }[] {
    let avatar: string | undefined;
    try { const ctx = this.context(); avatar = (ctx.characters as Record<string, any>)[String(ctx.characterId)]?.avatar; } catch { return []; }
    const all: [string, Registration][] = [...[...this.registrations].map(([k, r]) => ['r:' + k, r] as [string, Registration]), ...[...this.worldRegistrations].map(([k, r]) => ['w:' + k, r] as [string, Registration])];
    const own = all.filter(([, r]) => avatar && r.characters.includes(avatar)).sort((a, b) => b[1].priority - a[1].priority);
    const catalog = all.filter(([, r]) => r.owner === 'catalog');
    const seen = new Set<string>(), out: ReturnType<SolveSessionManager['candidates']> = [];
    for (const [key, r] of [...own, ...catalog]) {
      const id = r.definition.fingerprint + ('selection' in r ? ':' + canonical((r as WorldRegistration).selection) : '');
      if (seen.has(id)) continue; seen.add(id);
      out.push({ key, id: r.definition.id, label: (r.definition as { label?: string }).label ?? r.definition.id, version: r.definition.version, fingerprint: r.definition.fingerprint, own: own.some(([k]) => k === key) });
    }
    return out;
  }
  /** Bind the current chat (no archive yet) to a candidate. Resolves once bound; throws why not. */
  async choose(key: string): Promise<SillyTavernController> {
    const ctx = this.context();
    if (!this.candidates().some(c => c.key === key)) fail('UNKNOWN_STRUCTURE', '这个数据结构已经不可用，请重新打开选择');
    if (ctx.chatMetadata.solve?.definitionHash) fail('ALREADY_BOUND', '这个聊天已经在用 SOLVE');
    this.chosen.set(ctx.chatId, key);
    if (ctx.chatMetadata.solve_off) { delete ctx.chatMetadata.solve_off; }
    await this.reconcile(true); await this.task;
    if (!this.active) fail(this.phase === 'error' ? 'BIND_FAILED' : 'STATE_NOT_READY', this.reason);
    return this.active;
  }
  /** 这个聊天不用 SOLVE: remembered in the chat (asked again only from the floating button). */
  async turnOff(): Promise<void> {
    const ctx = this.context();
    if (ctx.chatMetadata.solve?.definitionHash) fail('ALREADY_BOUND', '这个聊天已经在用 SOLVE，不能在这里关闭');
    ctx.chatMetadata.solve_off = true; this.chosen.delete(ctx.chatId);
    try { await (ctx as { saveMetadata?: () => Promise<void> }).saveMetadata?.(); } catch { /* remembered for this page at least */ }
    await this.reconcile(true);
  }
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
      let adopt = false;
      if (fingerprint) {
        registration = [...this.registrations.values()].filter(r => r.definition.fingerprint === fingerprint).sort((a, b) => b.priority - a.priority)[0];
        if (!registration && !ctx.chatMetadata.solve?.authoring) {
          // Started under another version (e.g. an older official structure): the definition bound to this character
          // may take it over, but only if the whole history replays identically under it (checked in the controller).
          let candidates = [...this.registrations.values()].filter(r => r.characters.includes(avatar)).sort((a, b) => b.priority - a.priority);
          // No card binding (SOLVE loaded globally): the page's catalog may take it over the same way.
          if (!candidates.length) candidates = [...this.registrations.values()].filter(r => r.owner === 'catalog');
          const top = candidates.filter(r => r.priority === candidates[0]?.priority);
          const refused = top[0] && this.adoptRefused.get(`${ctx.chatId}|${fingerprint}|${top[0].definition.fingerprint}`);
          if (refused) { this.detachActive(); this.phase = 'error'; this.reason = refused; this.notify(); return Promise.resolve(); }
          if (top.length && new Set(top.map(r => r.definition.fingerprint)).size === 1) { registration = top[0]; adopt = true; }
        }
        if (!registration && ctx.chatMetadata.solve?.authoring) {
          const candidates = [...this.worldRegistrations.values()].filter(r => r.definition.fingerprint === ctx.chatMetadata.solve.authoring.baseHash);
          const scoped = candidates.filter(r => r.characters.includes(avatar));
          worldRegistration = (scoped.length ? scoped : candidates).sort((a, b) => b.priority - a.priority)[0];
        }
      }
      else if (this.gate) {
        // A chat without an archive: bound only to what the player picked (or the 直接使用 default).
        let key = this.chosen.get(ctx.chatId);
        if (!key && !ctx.chatMetadata.solve_off) {
          const auto = this.gate.auto?.();
          if (auto && this.candidates().some(c => c.key === auto)) { key = auto; this.chosen.set(ctx.chatId, key); }
        }
        const picked = key?.startsWith('w:') ? this.worldRegistrations.get(key.slice(2)) : key ? this.registrations.get(key.slice(2)) : undefined;
        if (!picked) {
          this.detachActive();
          this.phase = ctx.chatMetadata.solve_off ? 'off' : 'choose';
          this.reason = ctx.chatMetadata.solve_off ? '这个聊天选了不用 SOLVE' : '这个聊天还没有选择数据结构';
          this.notify(); return Promise.resolve();
        }
        if (key!.startsWith('w:')) worldRegistration = picked as WorldRegistration; else registration = picked;
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
      return this.switchTo(registration, undefined, adopt);
    } catch (error) { this.setError(error); return Promise.resolve(); }
  }
  private switchTo(input: Registration | ((context: () => HostContext, signal: AbortSignal) => Promise<Registration>), worldRegistration?: WorldRegistration, adopt = false): Promise<void> {
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
        controller = await attachSillyTavern(registration.definition, scopedContext, adopt ? { ...registration.attach, adopt } : registration.attach, this.fetcher);
        if (epoch !== this.epoch) { controller.dispose(); return; }
        this.active = controller; this.activeRegistration = registration; this.activeWorldRegistration = worldRegistration; this.disposeController = controller.subscribe(() => this.notify());
        if (adopt) this.journal.add('info', 'ADOPTED', `聊天 ${chatId} 由另一版结构开局，历史在 ${registration.definition.id}@${registration.definition.version} 下逐条重算一致，已换用它继续`);
        if (this.bindRetries.delete(chatId)) this.journal.add('info', 'BIND_RETRY', '自动重试后绑定成功');
        this.phase = 'ready'; this.reason = ''; this.journal.add('info', 'SESSION_ATTACHED', `聊天 ${chatId} 已绑定 ${registration.definition.id}@${registration.definition.version}`); this.notify();
      } catch (error) {
        controller?.dispose();
        // A refused takeover is not retried on every chat event (it replays the whole history).
        if (adopt && typeof input !== 'function' && describeError(error).code === 'DEFINITION_MISMATCH') {
          const archived = this.context().chatMetadata.solve?.definitionHash;
          this.adoptRefused.set(`${chatId}|${archived}|${input.definition.fingerprint}`, `这个聊天是用另一版结构开的，不能换用当前结构继续：${describeError(error).message}`);
          if (epoch === this.epoch) { this.detachActive(); this.phase = 'error'; this.reason = this.adoptRefused.get(`${chatId}|${archived}|${input.definition.fingerprint}`)!; this.journal.add('error', 'ADOPT_REFUSED', this.reason); this.notify(); }
          return;
        }
        if (epoch !== this.epoch) return;
        // Opening a chat (a new one especially) can collide with the tavern's own save: retry quietly before reporting.
        const code = describeError(error).code, tries = this.bindRetries.get(chatId) ?? 0;
        // Only races with the tavern's own writes (or a dropped request) are retried; a broken archive or a missing book is reported at once.
        const transient = ['HOST_SAVE_FAILED', 'REMOTE_HEAD_CHANGED', 'SAVE_VERIFY_FAILED', 'VARIABLES_VERIFY_FAILED', 'COMMIT_COLLISION'].includes(code) || error instanceof TypeError && /fetch/iu.test(error.message);
        if (tries < 2 && transient) {
          this.bindRetries.set(chatId, tries + 1);
          this.journal.add('warning', 'BIND_RETRY', `绑定聊天没有成功（${describeError(error).message}），${tries ? 3 : 1} 秒后自动重试`);
          this.reason = '第一次没有绑定成功，正在重试'; this.notify();
          setTimeout(() => { if (epoch === this.epoch && this.context().chatId === chatId) void this.reconcile(true); }, tries ? 3000 : 1000);
          return;
        }
        this.setError(error);
      }
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
