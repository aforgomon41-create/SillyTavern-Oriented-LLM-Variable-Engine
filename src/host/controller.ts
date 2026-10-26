import { compile } from '../schema.js';
import { SolveCore } from '../engine.js';
import { createArchive, headKey, restore, replay } from '../history.js';
import { SolveRuntime } from '../runtime.js';
import { IndexedDbCache } from '../cache.js';
import { assertJson, clone, fail, hash, id } from '../json.js';
import { extractRawBlocks, parseOperations, stripBlocks } from '../parser.js';
import { guide, registerMacros, sop, toJson, toToon } from '../projection.js';
import { browserWriteLock, SillyTavern119Adapter } from './sillytavern.js';
import type { HostContext } from './sillytavern.js';
import type { Action, Batch, Commit, Definition, Json } from '../types.js';

export interface AttachOptions {
  mode?: 'in-band' | 'out-of-band';
  operatorFormat?: 'json' | 'toon';
  operatorProfileId?: string;
  operatorRequest?: (prompt: string, signal: AbortSignal) => Promise<string>;
  operatorTimeoutMs?: number;
  allowRequestsDuringOperatorBusy?: boolean;
  cache?: IndexedDbCache;
  onError?: (error: unknown) => void;
}
const formatterRouters = new WeakMap<object, Set<SillyTavernController>>();
export class SillyTavernController {
  readonly adapter: SillyTavern119Adapter;
  runtime!: SolveRuntime;
  private disposers: (() => void)[] = [];
  private readyState = false;
  private operator?: AbortController;
  private processing: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private chatId: string;
  private generated = false;
  constructor(public readonly core: SolveCore, private context: () => HostContext, public readonly options: AttachOptions = {}, fetcher: typeof fetch = fetch) {
    this.chatId = context().chatId;
    this.adapter = new SillyTavern119Adapter(context, fetcher, browserWriteLock);
  }
  get busy(): boolean { return this.queued > 0 || Boolean(this.operator) || Boolean(this.runtime?.busy); }
  get ready(): boolean { return this.readyState && this.context().chatId === this.chatId; }
  assertReady(): void { if (!this.ready) fail('STATE_NOT_READY', '当前聊天尚未绑定并恢复SOLVE状态'); }
  async start(): Promise<this> {
    await this.adapter.verifyVersion();
    const ctx = this.context();
    const index = ctx.chat.findIndex(m => !m.is_user && !m.is_system);
    if (index < 0) fail('NO_GREETING', '请先建立一条角色开场消息');
    const initialBinding = this.adapter.binding(index);
    let archive = await this.adapter.load();
    let head: string;
    if (!archive) {
      const created = await createArchive(this.core, initialBinding);
      archive = created.archive; head = created.headId;
      const root = archive.commits[head]!; root.textDigest = await hash(ctx.chat[index]!.mes);
      await this.adapter.save({ archive, commit: root, binding: initialBinding, text: ctx.chat[index]!.mes, expectedHead: null });
    } else {
      if (archive.definitionHash !== this.core.definition.fingerprint) fail('DEFINITION_MISMATCH', '此聊天使用不同版本的作者定义');
      head = this.findParent(ctx.chat.length, archive);
    }
    this.runtime = new SolveRuntime(this.core, archive, head, this.adapter);
    await this.runtime.ready(); this.readyState = true;
    if (this.options.cache) {
      const drafts = await this.options.cache.loadPending<any[]>(archive.sessionId).catch(() => undefined);
      if (drafts?.length) {
        // A lost response can leave a draft which is already part of the confirmed archive.
        const pending = drafts.filter(d => !archive!.commits[d.commit.id]);
        if (pending.length) this.runtime.importPending(pending);
      }
    }
    if (ctx.macros?.registry) this.disposers.push(registerMacros(ctx.macros.registry, () => {
      this.assertReady();
      if (this.findParent(this.context().chat.length) !== this.runtime.headId) fail('STATE_NOT_ALIGNED', '模型输入尚未对齐当前选中的历史');
      return { definition: this.core.definition, state: this.runtime.getState(), feedback: this.runtime.archive.commits[this.runtime.headId]!.feedback };
    }));
    this.installEvents();
    return this;
  }
  private findParent(beforeIndex: number, archive = this.runtime.archive): string {
    const messages = this.context().chat;
    let selected: string | undefined;
    for (let i = 0; i < beforeIndex; i++) {
      const head = messages[i]?.extra?.solve?.headId;
      const commit = head ? archive.commits[head] : undefined;
      if (!commit) continue;
      if (selected && selected !== commit.id) {
        let cursor = commit.parentId;
        const seen = new Set<string>();
        while (cursor && cursor !== selected) {
          if (seen.has(cursor)) fail('HISTORY_CYCLE', '父链出现循环');
          seen.add(cursor); cursor = archive.commits[cursor]?.parentId ?? null;
        }
        if (cursor !== selected) fail('HISTORY_BRANCH_CONFLICT', '当前选中的回复版本与后续楼层不属于同一历史，请从变更处重放');
      }
      selected = head;
    }
    if (selected) return selected;
    const roots = Object.values(archive.commits).filter(c => c.parentId === null);
    if (roots.length !== 1) fail('GENESIS_SELECTION', '无法确定当前开场分支的初始状态');
    return roots[0]!.id;
  }
  private listen(event: string, fn: (...args: any[]) => unknown): void {
    const ctx = this.context(), name = ctx.eventTypes?.[event];
    if (!name || !ctx.eventSource) return;
    ctx.eventSource.on(name, fn);
    this.disposers.push(() => ctx.eventSource!.removeListener(name, fn));
  }
  private installEvents(): void {
    const onError = this.options.onError ?? ((error: unknown) => console.error('[SOLVE]', error));
    this.listen('CHAT_CHANGED', () => { this.readyState = false; this.operator?.abort(); this.adapter.invalidate(); this.runtime.invalidate(); });
    this.listen('GENERATION_STARTED', (_type, _options, dryRun) => {
      if (dryRun || !this.ready) return;
      this.generated = true; this.adapter.invalidate();
    });
    this.listen('GENERATION_STOPPED', () => { this.generated = false; this.operator?.abort(); this.adapter.invalidate(); });
    this.listen('GENERATION_ENDED', async () => {
      if (!this.ready || !this.generated) return;
      this.generated = false;
      try { await this.processMessage(); } catch (error) { onError(error); }
    });
    this.listen('MESSAGE_SWIPED', async (index: number) => {
      if (!this.ready) return;
      this.operator?.abort(); this.adapter.invalidate();
      try {
        const binding = this.adapter.binding(index);
        const head = await this.adapter.selectedHead(binding);
        await this.runtime.select(head ?? this.findParent(index));
      } catch (error) { this.readyState = false; onError(error); }
    });
    this.listen('MESSAGE_EDITED', () => { this.readyState = false; this.operator?.abort(); this.adapter.invalidate(); this.runtime.invalidate(); });
    this.listen('MESSAGE_DELETED', () => { this.readyState = false; this.operator?.abort(); this.adapter.invalidate(); this.runtime.invalidate(); });
    const formatter = this.context().messageFormatter;
    if (formatter) {
      let controllers = formatterRouters.get(formatter);
      if (!controllers) {
        controllers = new Set(); formatterRouters.set(formatter, controllers);
        const routes = controllers;
        formatter.addHook((text: string) => [...routes].some(c => c.ready) ? stripBlocks(text) : text, { stage: 'beforeRegex', order: 5 });
      }
      controllers.add(this);
      this.disposers.push(() => controllers!.delete(this));
    }
  }
  /** A native extension manifest invokes this before sending the native generation request. */
  intercept(chat: { mes: string }[], _contextSize: number, abort: (immediate: boolean) => void): void {
    if (this.context().chatId !== this.chatId) return;
    try {
      if (!this.ready || (this.busy && !this.options.allowRequestsDuringOperatorBusy) || this.findParent(this.context().chat.length) !== this.runtime.headId) { abort(true); return; }
    } catch { abort(true); return; }
    for (const message of chat) message.mes = stripBlocks(message.mes);
  }
  processMessage(index = this.context().chat.length - 1): Promise<Commit | undefined> {
    const binding = this.adapter.binding(index), text = this.context().chat[index]?.mes;
    return this.enqueue(async () => {
      this.assertReady(); this.adapter.assertCurrent(binding);
      const message = this.context().chat[index];
      if (!message || message.is_user || message.is_system || message.mes !== text) return undefined;
      const raw = extractRawBlocks(text!);
      const archive = this.runtime.archive;
      const existingId = message.extra?.solve?.headId, existing = existingId ? archive.commits[existingId] : undefined;
      if (existing?.binding.swipeId === binding.swipeId && existing.textDigest === await hash(text!) && existing.actions.some(a => a.source === 'model')) {
        await this.runtime.select(existing.id); return existing;
      }
      if (raw.mutual && (!existing || existing.binding.swipeId !== binding.swipeId || existing.textDigest !== await hash(text!))) fail('UNTRUSTED_MUTUAL_BLOCK', '模型输出不能自行伪造玩家操作块');
      const parent = existing?.binding.swipeId === binding.swipeId && existing.parentId ? existing.parentId : this.findParent(index);
      await this.runtime.select(parent);
      const pending = this.runtime.exportPending().find(d => headKey(d.binding) === headKey(binding));
      if (pending) {
        const priorAction = pending.commit.actions.at(-1)!;
        return this.persist(() => this.runtime.submit(priorAction, binding, pending.text, { sourceText: text! }));
      }
      let operations: Batch;
      let finalText = text!;
      if ((this.options.mode ?? 'in-band') === 'in-band') {
        if (!raw.model) return undefined;
        operations = parseOperations(raw.model);
      } else {
        const prompt = this.operatorPrompt(index);
        const output = await this.requestOperator(prompt);
        this.adapter.assertCurrent(binding);
        const returned = extractRawBlocks(output);
        operations = parseOperations(returned.model ?? output);
        finalText = stripBlocks(text!) + `\n<solve_operate>\n${JSON.stringify(operations)}\n</solve_operate>`;
      }
      const actionId = 'model:' + await hash({ messageId: binding.messageId, swipeId: binding.swipeId, parent, sourceText: text!, operations });
      return this.persist(() => this.runtime.submit({ actionId, kind: 'operations', source: 'model', operations }, binding, finalText, { sourceText: text! }));
    });
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.queued++;
    const promise = this.processing.catch(() => undefined).then(task);
    this.processing = promise;
    return promise.finally(() => { this.queued--; });
  }
  private operatorPrompt(index: number): string {
    const state = this.runtime.getState(), def = this.core.definition;
    const context = this.context().chat.slice(Math.max(0, index - 3), index + 1).map(m => stripBlocks(m.mes)).join('\n');
    const encoded = this.options.operatorFormat === 'toon' ? toToon(def, state, { view: 'operator' }) : toJson(def, state, { view: 'operator' });
    return [sop(), guide(def, state), encoded, JSON.stringify(this.runtime.archive.commits[this.runtime.headId]?.feedback ?? []), context].join('\n\n');
  }
  private async requestOperator(prompt: string): Promise<string> {
    if (this.operator) fail('OPERATOR_BUSY', '操作模型任务正在运行');
    const controller = new AbortController(); this.operator = controller;
    const timer = setTimeout(() => controller.abort(new Error('操作模型超时')), this.options.operatorTimeoutMs ?? 60_000);
    try {
      const request = async (): Promise<string> => {
        if (this.options.operatorRequest) return this.options.operatorRequest(prompt, controller.signal);
        const service = this.context().ConnectionManagerRequestService;
        if (!service || !this.options.operatorProfileId) fail('OPERATOR_NOT_CONFIGURED', '需要操作模型的独立连接预设或请求函数');
        const result = await service.sendRequest(this.options.operatorProfileId, prompt, 2048, { stream: false, signal: controller.signal, extractData: true, includePreset: true });
        return typeof result === 'string' ? result : result?.content;
      };
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('操作模型已取消')), { once: true });
      });
      const text = await Promise.race([request(), aborted]);
      controller.signal.throwIfAborted();
      if (typeof text !== 'string') fail('OPERATOR_RESPONSE', '操作模型没有返回文本');
      return text;
    } finally { clearTimeout(timer); if (this.operator === controller) this.operator = undefined; }
  }
  private async persist<T>(task: () => Promise<T>): Promise<T> {
    try {
      const result = await task();
      if (this.options.cache) await this.options.cache.put(this.runtime.archive, this.runtime.headId, this.runtime.getState()).catch(() => undefined);
      return result;
    } finally {
      if (this.options.cache) await this.options.cache.savePending(this.runtime.archive.sessionId, this.runtime.exportPending()).catch(() => undefined);
    }
  }
  async submit(operations: Batch, options: { actionId?: string; index?: number; authorInputs?: Json } = {}): Promise<Commit> {
    return this.submitUser({ actionId: options.actionId ?? id('action'), kind: 'operations', source: 'user', operations,
      ...(options.authorInputs !== undefined ? { authorInputs: options.authorInputs } : {}) }, options.index);
  }
  async setModule(module: string, enabled: boolean, options: { actionId?: string; index?: number } = {}): Promise<Commit> {
    return this.submitUser({ actionId: options.actionId ?? id('action'), kind: 'module', source: 'user', module, enabled }, options.index);
  }
  private async submitUser(action: Action, index = this.context().chat.length - 1): Promise<Commit> {
    this.assertReady();
    const binding = this.adapter.binding(index), input = clone(action);
    return this.enqueue(async () => {
      this.assertReady(); this.adapter.assertCurrent(binding);
      const message = this.context().chat.find(m => m.extra?.solve?.messageId === binding.messageId)!;
      const head = await this.adapter.selectedHead(binding);
      if (!head) fail('NO_SWIPE_STATE', '当前回复尚未完成变量同步');
      if (this.runtime.headId !== head) await this.runtime.select(head);
      const commit = this.runtime.archive.commits[head]!;
      const existing = commit.actions.filter(a => a.source === 'user');
      const prefix = message.mes.replace(/<solve_mutual_operate>[\s\S]*?<\/solve_mutual_operate>/gu, '').trimEnd();
      const actions = existing.some(a => a.actionId === input.actionId) ? existing : [...existing, input];
      const text = prefix + `\n<solve_mutual_operate>\n${JSON.stringify(actions)}\n</solve_mutual_operate>`;
      return this.persist(() => this.runtime.submit(input, binding, text, { sourceText: message.mes }));
    });
  }
  /** Explicitly reinterpret an edited selected message; unaffected old branches remain archived. */
  replayMessage(index: number): Promise<Commit> {
    if (this.context().chatId !== this.chatId) return Promise.reject(new Error('请先绑定当前聊天'));
    const binding = this.adapter.binding(index);
    return this.enqueue(async () => {
      this.adapter.assertCurrent(binding);
      if (this.runtime.pendingCount) fail('PENDING_SAVE', '请先处理待保存草稿');
      const message = this.context().chat[index]!;
      const originalText = message.mes;
      const archive = this.runtime.archive, old = archive.commits[message.extra?.solve?.headId];
      if (!old) fail('NO_SWIPE_STATE', '该回复没有可重放的归档');
      const raw = extractRawBlocks(originalText), actions: Action[] = [];
      if (raw.model) {
        const prior = old.actions.find(a => a.source === 'model');
        actions.push({ actionId: prior?.actionId ?? id('model-replay'), kind: 'operations', source: 'model', operations: parseOperations(raw.model),
          ...(prior?.authorInputs !== undefined ? { authorInputs: prior.authorInputs } : {}) });
      }
      if (raw.mutual) {
        const values = JSON.parse(raw.mutual); assertJson(values);
        if (!Array.isArray(values)) fail('MUTUAL_FORMAT', '玩家动作块必须为有序数组');
        for (let i = 0; i < values.length; i++) {
          const value: any = values[i];
          if (value?.kind === 'operations' || value?.kind === 'module') {
            if (value.source !== 'user' || typeof value.actionId !== 'string') fail('MUTUAL_FORMAT', '玩家动作身份无效');
            if (value.kind === 'operations') parseOperations(JSON.stringify(value.operations));
            else if (typeof value.module !== 'string' || typeof value.enabled !== 'boolean') fail('MUTUAL_FORMAT', '模块动作无效');
            actions.push(value as Action);
          } else actions.push({ actionId: `replay:${old.id}:${i}`, kind: 'operations', source: 'user', operations: parseOperations(JSON.stringify(value)) });
        }
      }
      const parent = this.findParent(index, archive);
      const result = await replay(this.core, archive, [old.id], parent, { [old.id]: actions });
      const commit = result.archive.commits[result.headId]!;
      commit.binding = binding; commit.textDigest = await hash(originalText);
      result.archive.heads[headKey(binding)] = commit.id;
      await this.adapter.save({ archive: result.archive, commit, binding, text: originalText, sourceTextDigest: await hash(originalText), expectedHead: this.runtime.headId });
      this.runtime.invalidate();
      this.runtime = new SolveRuntime(this.core, result.archive, commit.id, this.adapter); await this.runtime.ready();
      this.readyState = true;
      return commit;
    });
  }
  async replayFrom(index: number): Promise<void> {
    for (let i = index; i < this.context().chat.length; i++) {
      const message = this.context().chat[i]!;
      if (!message.is_user && !message.is_system && message.extra?.solve?.headId) await this.replayMessage(i);
    }
  }
  dispose(): void { this.readyState = false; this.operator?.abort(); this.adapter.invalidate(); this.runtime?.invalidate(); this.disposers.splice(0).reverse().forEach(fn => fn()); }
}
export async function attachSillyTavern(definition: Definition, context: () => HostContext, options: AttachOptions = {}, fetcher: typeof fetch = fetch): Promise<SillyTavernController> {
  const core = new SolveCore(await compile(definition));
  return new SillyTavernController(core, context, options, fetcher).start();
}
