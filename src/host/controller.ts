import { compile } from '../schema.js';
import { SolveCore } from '../engine.js';
import { createArchive, headKey, restore, replay } from '../history.js';
import { SolveRuntime } from '../runtime.js';
import { IndexedDbCache } from '../cache.js';
import { assertJson, clone, fail, hash, id } from '../json.js';
import { extractRawBlocks, parseOperations, stripBlocks } from '../parser.js';
import { guide, registerMacros, sop, toJson, toToon } from '../projection.js';
import { archiveFromChat, browserWriteLock, preserveOrphanAncestors, SillyTavern119Adapter } from './sillytavern.js';
import { DiagnosticJournal, describeError, inspectCapabilities } from '../diagnostics.js';
import { EntityGraph } from '../entities.js';
import { at } from '../json.js';
import { project } from '../projection.js';
import type { ProjectionOptions } from '../projection.js';
import jsonpatch from 'fast-json-patch';
import { isModuleEnabled } from '../schema.js';
import type { HostContext } from './sillytavern.js';
import type { Action, Batch, Commit, Definition, Json } from '../types.js';

export interface AttachOptions {
  mode?: 'in-band' | 'out-of-band';
  operatorFormat?: 'json' | 'toon';
  operatorProfileId?: string;
  operatorRequest?: (prompt: string, signal: AbortSignal) => Promise<string>;
  operatorTimeoutMs?: number;
  allowRequestsDuringOperatorBusy?: boolean;
  cache?: IndexedDbCache | false;
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
  private disposed = false;
  private reason = '正在初始化';
  private hostVersion?: string;
  private cache?: IndexedDbCache;
  private ownsCache = false;
  private cacheError?: string;
  private pendingImportError?: string;
  private nativeHistoryChanged = false;
  private listeners = new Set<() => void>();
  readonly journal = new DiagnosticJournal();
  constructor(public readonly core: SolveCore, private context: () => HostContext, public readonly options: AttachOptions = {}, fetcher: typeof fetch = fetch) {
    this.chatId = context().chatId;
    this.adapter = new SillyTavern119Adapter(context, fetcher, browserWriteLock);
    if (options.cache) this.cache = options.cache;
    else if (options.cache !== false && typeof indexedDB !== 'undefined') { this.cache = new IndexedDbCache(); this.ownsCache = true; }
  }
  get busy(): boolean { return this.queued > 0 || Boolean(this.operator) || Boolean(this.runtime?.busy); }
  get boundChatId(): string { return this.chatId; }
  get ready(): boolean { return this.readyState && this.context().chatId === this.chatId; }
  assertReady(): void { if (!this.ready) fail('STATE_NOT_READY', `当前聊天尚未绑定并恢复SOLVE状态${this.reason ? `：${this.reason}` : ''}`); }
  private assertBound(): void { if (this.disposed || this.context().chatId !== this.chatId) fail('STALE_BINDING', '控制器已释放或聊天已经切换'); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void { for (const listener of this.listeners) { try { listener(); } catch { /* A debug view cannot break a commit. */ } } }
  private record(code: string, message: string, level: 'info' | 'warning' | 'error' = 'info', durationMs?: number): void { this.journal.add(level, code, message, durationMs); this.notify(); }
  private report(error: unknown): void {
    const e = describeError(error); this.record(e.code, e.message, 'error');
    try { this.options.onError?.(error); } catch { /* observer only */ }
  }
  private restoreState: typeof restore = (archive, commitId) => this.cache ? this.cache.restore(archive, commitId) : restore(archive, commitId);
  private createRuntime(archive: import('../types.js').Archive, head: string): SolveRuntime { return new SolveRuntime(this.core, archive, head, this.adapter, this.restoreState); }
  private async useCache(task: (cache: IndexedDbCache) => Promise<unknown>): Promise<void> {
    if (!this.cache) return;
    try { await task(this.cache); this.cacheError = undefined; }
    catch (error) { this.cacheError = describeError(error).message; this.record('CACHE_UNAVAILABLE', this.cacheError, 'warning'); }
    finally { if (this.disposed && this.ownsCache) this.cache.close(); }
  }
  async start(): Promise<this> {
    this.assertBound(); this.hostVersion = await this.adapter.verifyVersion(); this.assertBound();
    const ctx = this.context();
    const index = ctx.chat.findIndex(m => !m.is_user && !m.is_system);
    if (index < 0) fail('NO_GREETING', '请先建立一条角色开场消息');
    const initialBinding = this.adapter.binding(index);
    let archive = await this.adapter.load();
    this.assertBound();
    let head: string;
    if (!archive) {
      const created = await createArchive(this.core, initialBinding);
      archive = created.archive; head = created.headId;
      const root = archive.commits[head]!; root.textDigest = await hash(ctx.chat[index]!.mes);
      await this.adapter.save({ archive, commit: root, binding: initialBinding, text: ctx.chat[index]!.mes, expectedHead: null });
    } else {
      if (archive.definitionHash !== this.core.definition.fingerprint) fail('DEFINITION_MISMATCH', '此聊天使用不同版本的作者定义');
      try { head = this.findParent(ctx.chat.length, archive); }
      catch (error) {
        if (!['HISTORY_BRANCH_CONFLICT', 'GENESIS_SELECTION'].includes(describeError(error).code)) throw error;
        head = ctx.chat.map(m => m.extra?.solve?.headId).filter((id: string) => archive!.commits[id]).at(-1)
          ?? Object.values(archive.commits).find(c => c.parentId === null)?.id;
        if (!head) throw error;
        this.reason = describeError(error).message;
      }
    }
    this.runtime = this.createRuntime(archive, head);
    await this.runtime.ready(); this.assertBound();
    if (this.reason === '正在初始化') this.reason = '';
    for (const message of ctx.chat) {
      const commit = archive.commits[message.extra?.solve?.headId];
      if (commit && commit.textDigest !== await hash(message.mes)) { this.reason = '消息正文与归档不一致，请重放变更楼层及后续历史'; break; }
    }
    this.readyState = !this.reason;
    if (this.cache) {
      let drafts: import('../types.js').SaveDraft[] | undefined;
      await this.useCache(async cache => { drafts = await cache.loadPending(archive!.sessionId); });
      if (drafts && !Array.isArray(drafts)) { this.pendingImportError = '本地草稿格式无效，可在调试面板中放弃'; this.record('PENDING_INVALID', this.pendingImportError, 'warning'); }
      if (Array.isArray(drafts) && drafts.length) {
        // A lost response can leave a draft which is already part of the confirmed archive.
        const pending = drafts.filter(d => !archive!.commits[d.commit.id]);
        if (pending.length) {
          try { this.runtime.importPending(pending); }
          catch (error) { this.pendingImportError = describeError(error).message; this.record('PENDING_CONFLICT', `本地草稿无法导入：${this.pendingImportError}`, 'warning'); }
        }
      }
    }
    if (ctx.macros?.registry) this.disposers.push(registerMacros(ctx.macros.registry, () => {
      this.assertReady();
      if (this.findParent(this.context().chat.length) !== this.runtime.headId) fail('STATE_NOT_ALIGNED', '模型输入尚未对齐当前选中的历史');
      return { definition: this.core.definition, state: this.runtime.getState(), feedback: this.runtime.archive.commits[this.runtime.headId]!.feedback };
    }));
    this.installEvents();
    for (const capability of inspectCapabilities(ctx, this.hostVersion).filter(c => !c.available)) this.record('CAPABILITY_MISSING', `${capability.label}：${capability.detail}`, 'warning');
    this.record(this.readyState ? 'READY' : 'HISTORY_DIRTY', this.readyState ? '当前聊天状态已恢复' : this.reason, this.readyState ? 'info' : 'warning');
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
    const onError = (error: unknown) => this.report(error);
    this.listen('CHAT_CHANGED', () => { this.readyState = false; this.reason = '聊天已切换'; this.operator?.abort(); this.adapter.invalidate(); this.runtime.invalidate(); this.record('CHAT_CHANGED', this.reason); });
    this.listen('GENERATION_STARTED', (_type, _options, dryRun) => {
      if (dryRun || !this.ready) return;
      this.generated = true; this.adapter.invalidate(); this.record('GENERATION_STARTED', '宿主开始生成');
    });
    this.listen('GENERATION_STOPPED', () => { this.generated = false; this.operator?.abort(); this.adapter.invalidate(); this.record('GENERATION_STOPPED', '生成已停止，不执行未完成的回复'); });
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
    this.listen('MESSAGE_EDITED', (index: number) => {
      if (this.context().chat[index]?.extra?.solve?.headId) this.markDirty('消息已编辑，请重放变更楼层及后续历史');
      else this.record('MESSAGE_EDITED', '未归档楼层已编辑，变量历史保持原样');
    });
    const deleted = async () => {
      this.operator?.abort(); this.adapter.invalidate(); this.nativeHistoryChanged = true;
      const gap = preserveOrphanAncestors(this.runtime.archive, this.context().chat);
      if (this.runtime.pendingCount || this.pendingImportError) { this.markDirty('删除后仍有待保存草稿，请先处理草稿，再重新检查历史'); return; }
      if (gap) { this.markDirty('中间历史已删除；已保留所需旧修订，请重放剩余的后续楼层'); return; }
      try {
        const archive = this.adapter.loadMemory(); if (!archive) fail('BROKEN_HISTORY', '当前聊天缺少归档');
        const head = this.findParent(this.context().chat.length, archive);
        this.runtime.invalidate(); this.runtime = this.createRuntime(archive, head); await this.runtime.ready(); this.assertBound();
        this.readyState = true; this.reason = ''; this.record('HISTORY_TRIMMED', '已恢复删除后的剩余历史');
      } catch (error) { this.markDirty(describeError(error).message); onError(error); }
    };
    this.listen('MESSAGE_DELETED', deleted);
    this.listen('MESSAGE_SWIPE_DELETED', deleted);
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
      if (!this.ready || this.runtime.pendingCount || this.pendingImportError || (this.busy && !this.options.allowRequestsDuringOperatorBusy) || this.findParent(this.context().chat.length) !== this.runtime.headId) { this.record('REQUEST_BLOCKED', '状态未就绪、存在待保存操作或正在同步，请求已阻止', 'warning'); abort(true); return; }
    } catch { abort(true); return; }
    for (const message of chat) message.mes = stripBlocks(message.mes);
  }
  processMessage(index = this.context().chat.length - 1): Promise<Commit | undefined> {
    const candidate = this.context().chat[index];
    if (candidate?.is_user || candidate?.is_system) return Promise.resolve(undefined);
    const binding = this.adapter.binding(index), text = this.context().chat[index]?.mes;
    return this.enqueue(async () => {
      this.assertReady(); if (this.pendingImportError) fail('PENDING_CONFLICT', this.pendingImportError); this.adapter.assertCurrent(binding);
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
    this.queued++; this.notify();
    const promise = this.processing.catch(() => undefined).then(() => { this.assertBound(); return task(); }).catch(error => { this.report(error); throw error; });
    this.processing = promise;
    return promise.finally(() => { this.queued--; this.notify(); });
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
    const started = performance.now(); this.record('OPERATOR_STARTED', '独立操作模型请求开始');
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
      this.record('OPERATOR_COMPLETED', `操作模型返回 ${text.length} 字符`, 'info', performance.now() - started);
      return text;
    } finally { clearTimeout(timer); if (this.operator === controller) this.operator = undefined; }
  }
  private async persist<T>(task: () => Promise<T>, align = true): Promise<T> {
    try {
      if (this.nativeHistoryChanged) { await this.adapter.reconcileNativeSave(this.runtime.archive); this.nativeHistoryChanged = false; }
      const result = await task();
      await this.useCache(cache => cache.put(this.runtime.archive, this.runtime.headId, this.runtime.getState()));
      this.record('ARCHIVED', '状态已保存并通过回读核验');
      if (align) this.checkAlignment();
      return result;
    } finally {
      await this.useCache(cache => cache.savePending(this.runtime.sessionId, this.runtime.exportPending()));
    }
  }
  async submit(operations: Batch, options: { actionId?: string; index?: number; authorInputs?: Json; expectedHead?: string } = {}): Promise<Commit> {
    return this.submitUser({ actionId: options.actionId ?? id('action'), kind: 'operations', source: 'user', operations,
      ...(options.authorInputs !== undefined ? { authorInputs: options.authorInputs } : {}) }, options.index, options.expectedHead);
  }
  async setModule(module: string, enabled: boolean, options: { actionId?: string; index?: number } = {}): Promise<Commit> {
    return this.submitUser({ actionId: options.actionId ?? id('action'), kind: 'module', source: 'user', module, enabled }, options.index);
  }
  private lastAssistantIndex(): number { return this.context().chat.findLastIndex(m => !m.is_user && !m.is_system); }
  private async submitUser(action: Action, index = this.lastAssistantIndex(), expectedHead?: string): Promise<Commit> {
    this.assertReady();
    const binding = this.adapter.binding(index), input = clone(action);
    return this.enqueue(async () => {
      this.assertReady(); if (this.pendingImportError) fail('PENDING_CONFLICT', this.pendingImportError); this.adapter.assertCurrent(binding);
      this.findParent(this.context().chat.length);
      const message = this.context().chat.find(m => m.extra?.solve?.messageId === binding.messageId)!;
      const head = await this.adapter.selectedHead(binding);
      if (!head) fail('NO_SWIPE_STATE', '当前回复尚未完成变量同步');
      if (expectedHead !== undefined && (expectedHead !== head || expectedHead !== this.runtime.headId)) fail('HEAD_CHANGED', '状态已变化或目标楼层不一致，请重新预演；当前执行位置未改变');
      if (this.runtime.headId !== head) await this.runtime.select(head);
      const commit = this.runtime.archive.commits[head]!;
      const existing = commit.actions.filter(a => a.source === 'user');
      const prefix = message.mes.replace(/<solve_mutual_operate>[\s\S]*?<\/solve_mutual_operate>/gu, '').trimEnd();
      const actions = existing.some(a => a.actionId === input.actionId) ? existing : [...existing, input];
      const text = prefix + `\n<solve_mutual_operate>\n${JSON.stringify(actions)}\n</solve_mutual_operate>`;
      return this.persist(() => this.runtime.submit(input, binding, text, { sourceText: message.mes, expectedHead }));
    });
  }
  /** Explicitly reinterpret an edited selected message; unaffected old branches remain archived. */
  async replayMessage(index: number): Promise<Commit> {
    if (this.context().chatId !== this.chatId) return Promise.reject(new Error('请先绑定当前聊天'));
    const binding = this.adapter.binding(index);
    return this.enqueue(async () => { const commit = await this.replayOne(index, binding); this.checkAlignment(); return commit; });
  }
  private async replayOne(index: number, binding: import('../types.js').Binding): Promise<Commit> {
      this.adapter.assertCurrent(binding);
      if (this.runtime.pendingCount || this.pendingImportError) fail('PENDING_SAVE', '请先处理待保存草稿');
      const message = this.context().chat[index]!;
      const originalText = message.mes;
      const archive = this.nativeHistoryChanged ? this.adapter.loadMemory()! : this.runtime.archive;
      const old = archive?.commits[message.extra?.solve?.headId];
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
      if (this.nativeHistoryChanged) {
        await this.adapter.reconcileNativeSave(archive); this.nativeHistoryChanged = false;
        const sourceHead = archive.commits[this.runtime.headId] ? this.runtime.headId : parent;
        this.runtime.invalidate(); this.runtime = this.createRuntime(archive, sourceHead); await this.runtime.ready();
      }
      const result = await replay(this.core, archive, [old.id], parent, { [old.id]: actions });
      const commit = result.archive.commits[result.headId]!;
      commit.binding = binding; commit.textDigest = await hash(originalText);
      result.archive.heads[headKey(binding)] = commit.id;
      await this.persist(() => this.runtime.savePrepared({ archive: result.archive, commit, binding, text: originalText,
        sourceTextDigest: commit.textDigest, expectedHead: this.runtime.headId, prepared: true }, originalText), false);
      this.readyState = true; this.reason = '';
      this.record('REPLAY_COMPLETED', `楼层 ${index} 已重放，旧修订保留`);
      return commit;
  }
  replayFrom(index: number): Promise<void> {
    this.assertBound();
    if (!Number.isInteger(index) || index < 0 || index >= this.context().chat.length) return Promise.reject(new Error('请选择有效的起始楼层'));
    const targets = this.context().chat.flatMap((message, i) => i >= index && !message.is_user && !message.is_system && message.extra?.solve?.headId ? [{ index: i, binding: this.adapter.binding(i) }] : []);
    return this.enqueue(async () => {
      try { for (const target of targets) await this.replayOne(target.index, target.binding); this.checkAlignment(); }
      catch (error) { this.markDirty(`重放中断：${describeError(error).message}。请修正后从该楼层继续重放`); throw error; }
    });
  }
  private checkAlignment(): void {
    try { if (this.findParent(this.context().chat.length) !== this.runtime.headId) this.markDirty('后续历史尚未对齐，请重放后续楼层'); }
    catch (error) { this.markDirty(describeError(error).message); }
  }
  private markDirty(reason: string): void {
    this.readyState = false; this.reason = reason; this.operator?.abort(); this.adapter.invalidate(); this.runtime.invalidate(); this.record('HISTORY_DIRTY', reason, 'warning');
  }
  getStatus() {
    let aligned = this.ready, reason = this.ready ? '' : this.reason;
    if (aligned && this.runtime) {
      try { if (this.findParent(this.context().chat.length) !== this.runtime.headId) { aligned = false; reason = '选中历史尚未对齐，请重放后续楼层'; } }
      catch (error) { aligned = false; reason = describeError(error).message; }
    }
    return {
      ready: aligned, busy: this.busy, reason, chatId: this.context().chatId, boundChatId: this.chatId,
      definition: { id: this.core.definition.id, version: this.core.definition.version, fingerprint: this.core.definition.fingerprint },
      sessionId: this.runtime?.sessionId, headId: this.runtime?.headId, pendingCount: (this.runtime?.pendingCount ?? 0) + (this.pendingImportError ? 1 : 0), pendingImportError: this.pendingImportError,
      cache: { enabled: Boolean(this.cache), error: this.cacheError, source: this.cache?.lastRestoreSource ?? 'archive' },
      capabilities: inspectCapabilities(this.context(), this.hostVersion), mode: this.options.mode ?? 'in-band', operatorBusy: Boolean(this.operator),
    };
  }
  getState() { this.assertReady(); return this.runtime.getState(); }
  getValue(path: string) { const state = this.getState(); const graph = new EntityGraph(this.core.definition, state); return clone(at(state.data, graph.resolve(path))); }
  getProjectedState(options: ProjectionOptions = {}) { return project(this.core.definition, this.getState(), options); }
  getContextPreview(options: ProjectionOptions = {}) {
    const state = this.getState(), def = this.core.definition;
    return { json: toJson(def, state, options), toon: toToon(def, state, options), sop: sop(), guide: guide(def, state), feedback: this.runtime.getCommit()?.feedback ?? [], operatorPrompt: this.operatorPrompt(this.lastAssistantIndex()) };
  }
  getDefinitionInfo() {
    const def = this.core.definition;
    return clone({ id: def.id, version: def.version, fingerprint: def.fingerprint, schema: def.schemaShape, entities: def.entities ?? [], references: def.refs ?? [],
      modules: def.modules ?? {}, numeric: def.numeric ?? {}, readonly: def.readonly ?? [], internal: def.internal ?? [], templates: def.templates ?? {}, prefabs: def.prefabs ?? {}, customViews: Object.keys(def.views ?? {}), hasStateValidator: Boolean(def.validateState) });
  }
  getModules() {
    const state = this.getState(); return Object.entries(this.core.definition.modules ?? {}).map(([name, spec]) => ({ name, ...clone(spec), enabled: isModuleEnabled(this.core.definition, state, name), preference: state.engineState.activeModules[name] }));
  }
  clearDiagnostics(): void { this.journal.clear(); this.notify(); }
  getMessages() {
    return this.context().chat.map((message, index) => ({ index, role: message.is_user ? 'user' : message.is_system ? 'system' : 'assistant',
      swipeIndex: message.swipe_id ?? 0, swipeCount: message.swipes?.length ?? 1, messageId: message.extra?.solve?.messageId as string | undefined,
      swipeId: message.extra?.solve?.swipeId as string | undefined, headId: message.extra?.solve?.headId as string | undefined, text: message.mes }));
  }
  getHistory() {
    const archive = this.runtime.archive;
    return Object.values(archive.commits).map(commit => ({ ...commit, current: commit.id === this.runtime.headId, selected: archive.heads[headKey(commit.binding)] === commit.id }));
  }
  async inspectCommit(commitId = this.runtime.headId) {
    this.assertBound(); const archive = this.runtime.archive, commit = archive.commits[commitId];
    if (!commit) fail('BROKEN_HISTORY', '找不到指定提交');
    const state = await restore(archive, commitId), graph = new EntityGraph(this.core.definition, state);
    return { commit: clone(commit), state, entities: [...graph.entities.values()].map(clone), references: clone(graph.refs) };
  }
  async preview(operations: Batch, authorInputs?: Json) {
    this.assertReady(); const before = this.runtime.getState(), baseHeadId = this.runtime.headId;
    const result = await this.core.execute(clone(operations), before, { source: 'user', authorInputs });
    return { ...result, baseHeadId, dataPatch: jsonpatch.compare(before.data, result.state.data), enginePatch: jsonpatch.compare(before.engineState, result.state.engineState) };
  }
  async compareCommits(beforeId: string, afterId: string) {
    const archive = this.runtime.archive;
    const [before, after] = await Promise.all([restore(archive, beforeId), restore(archive, afterId)]);
    return { beforeId, afterId, dataPatch: jsonpatch.compare(before.data, after.data), enginePatch: jsonpatch.compare(before.engineState, after.engineState) };
  }
  getPending() { return this.runtime.exportPending(); }
  retryPending(): Promise<Commit> {
    return this.enqueue(async () => {
      const draft = this.runtime.exportPending()[0]; if (!draft) fail('NO_PENDING_SAVE', '没有待保存操作');
      const index = this.context().chat.findIndex(m => m.extra?.solve?.messageId === draft.binding.messageId);
      if (index < 0) fail('PENDING_CONFLICT', '待保存操作所属消息已不存在');
      const binding = this.adapter.binding(index);
      if (headKey(binding) !== headKey(draft.binding)) fail('PENDING_CONFLICT', '请切回待保存操作所属的回复版本');
      if (draft.prepared) {
        const commit = await this.persist(() => this.runtime.savePrepared({ ...draft, binding }, this.context().chat[index]!.mes), false);
        this.readyState = true; this.reason = ''; this.checkAlignment(); return commit;
      }
      return this.persist(() => this.runtime.submit(draft.commit.actions.at(-1)!, binding, draft.text, { sourceText: this.context().chat[index]!.mes }));
    });
  }
  discardPending(): Promise<void> {
    return this.enqueue(async () => {
      if (this.runtime.busy) fail('RUNTIME_BUSY', '请等待写入完成');
      const draft = this.runtime.exportPending()[0];
      if (draft) {
        const file = await this.adapter.readFile();
        const remote = file ? archiveFromChat(file[0].chat_metadata ?? {}, file.slice(1) as import('./sillytavern.js').HostMessage[]) : undefined;
        if (remote?.commits[draft.commit.id]) {
          const index = this.context().chat.findIndex(m => m.extra?.solve?.messageId === draft.binding.messageId);
          const binding = this.adapter.binding(index);
          if (draft.prepared) {
            await this.persist(() => this.runtime.savePrepared({ ...draft, binding }, this.context().chat[index]!.mes), false);
            this.readyState = true; this.reason = ''; this.checkAlignment();
          } else await this.persist(() => this.runtime.submit(draft.commit.actions.at(-1)!, binding, draft.text, { sourceText: this.context().chat[index]!.mes }));
          this.record('ALREADY_ARCHIVED', '该操作实际已保存，仅响应丢失；已恢复正式结果，不作为本地草稿放弃'); return;
        }
      }
      // Persist first: an unavailable database must not revive a discarded draft on refresh.
      if (this.cache) await this.cache.savePending(this.runtime.sessionId, []);
      this.runtime.discardPending(); this.pendingImportError = undefined; this.record('PENDING_DISCARDED', '已放弃本地待保存操作；正式聊天中的历史不受影响');
    });
  }
  cancelOperator(): void { this.operator?.abort(new Error('用户取消独立操作模型')); this.record('OPERATOR_CANCELLED', '已取消操作模型请求'); }
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      if (this.runtime.pendingCount) fail('PENDING_SAVE', '请先重试或放弃待保存操作');
      const archive = this.nativeHistoryChanged ? this.adapter.loadMemory() : await this.adapter.load(); this.assertBound();
      if (!archive || archive.definitionHash !== this.core.definition.fingerprint) fail('DEFINITION_MISMATCH', '无法用当前定义恢复此聊天');
      for (const message of this.context().chat) {
        const commit = archive.commits[message.extra?.solve?.headId];
        if (commit && commit.textDigest !== await hash(message.mes)) fail('REPLAY_REQUIRED', '消息正文已变化，请使用重放，重新读取不能代替重放');
      }
      const head = this.findParent(this.context().chat.length, archive);
      if (this.nativeHistoryChanged) { await this.adapter.reconcileNativeSave(archive); this.nativeHistoryChanged = false; }
      const next = this.createRuntime(archive, head); await next.ready(); this.assertBound();
      this.runtime.invalidate(); this.runtime = next; this.readyState = true; this.reason = '';
      this.record('RESTORE_COMPLETED', '当前选中历史已重新恢复');
    });
  }
  async validateArchive() {
    this.assertBound(); const archive = this.runtime.archive, results = [];
    for (const commitId of new Set(Object.values(archive.heads))) {
      const started = performance.now();
      try { await restore(archive, commitId); results.push({ commitId, valid: true, durationMs: performance.now() - started }); }
      catch (error) { results.push({ commitId, valid: false, durationMs: performance.now() - started, ...describeError(error) }); }
    }
    this.record('ARCHIVE_CHECKED', `已检查 ${results.length} 条历史链`, results.some(r => !r.valid) ? 'error' : 'info'); return results;
  }
  async rebuildCache(): Promise<void> {
    this.assertBound(); if (!this.cache) fail('CACHE_DISABLED', '当前未启用浏览器缓存');
    await this.cache.clearSnapshots(); await this.cache.put(this.runtime.archive, this.runtime.headId, await restore(this.runtime.archive, this.runtime.headId));
    this.cacheError = undefined; this.record('CACHE_REBUILT', '已重建快照缓存，待保存草稿保留');
  }
  exportDebugReport(options: { includeState?: boolean; includeText?: boolean } = {}) {
    const report: Record<string, unknown> = { exportedAt: new Date().toISOString(), status: this.getStatus(), logs: this.journal.read(),
      history: this.getHistory(), messages: this.getMessages().map(({ text, ...meta }) => options.includeText ? { ...meta, text } : meta) };
    if (options.includeState) { try { report.state = this.runtime.getState(); } catch { report.state = null; } }
    return report;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.readyState = false; this.reason = '控制器已释放'; this.operator?.abort(); this.adapter.invalidate(); this.runtime?.invalidate();
    this.disposers.splice(0).reverse().forEach(fn => fn()); if (this.ownsCache) this.cache?.close();
    this.record('DISPOSED', this.reason); this.listeners.clear();
  }
}
export async function attachSillyTavern(definition: Definition, context: () => HostContext, options: AttachOptions = {}, fetcher: typeof fetch = fetch): Promise<SillyTavernController> {
  const core = new SolveCore(await compile(definition));
  const controller = new SillyTavernController(core, context, options, fetcher);
  try { return await controller.start(); } catch (error) { controller.dispose(); throw error; }
}
