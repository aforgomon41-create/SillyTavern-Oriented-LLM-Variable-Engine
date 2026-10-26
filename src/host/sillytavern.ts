import { canonical, clone, fail, hash, id } from '../json.js';
import { headKey, restore } from '../history.js';
import type { Archive, ArchiveAdapter, Binding, Commit, LogicalState, SaveDraft } from '../types.js';
import { activeVariableView, applyMessageVariableViews, variableViews, writeMessageVariableViews } from './variables.js';
import { readFloor, readGeneses, storeGeneses } from './storage.js';
import { readToken } from './storage-tokens.js';
import { compactPointers, expandPointers } from './storage-pointers.js';
import type { CompactStorage } from './storage.js';

export interface SwipeArchive {
  messageId?: string;
  swipeId?: string;
  nativeIndex?: number;
  headId?: string;
  commits?: Record<string, Commit>;
}
export interface HostMessage {
  mes: string;
  is_user?: boolean;
  is_system?: boolean;
  name?: string;
  swipe_id?: number;
  swipes?: string[];
  swipe_info?: { extra?: Record<string, any>; [key: string]: any }[];
  extra?: Record<string, any>;
  [key: string]: any;
}
export interface HostContext {
  chatId: string;
  characterId: string | number;
  groupId: string | null;
  characters: Record<string, any> | any[];
  chat: HostMessage[];
  chatMetadata: Record<string, any>;
  getRequestHeaders(): Record<string, string>;
  saveChat?(): Promise<void>;
  updateChatMetadata?(metadata: Record<string, any>, reset?: boolean): void;
  macros?: { registry: any };
  messageFormatter?: { addHook(fn: (text: string, ctx: any) => string, options: any): void; removeHook?(fn: unknown): void };
  eventSource?: { on(name: string, fn: (...args: any[]) => unknown): void; makeLast?(name: string, fn: (...args: any[]) => unknown): void; removeListener(name: string, fn: (...args: any[]) => unknown): void };
  eventTypes?: Record<string, string>;
  ConnectionManagerRequestService?: { sendRequest(...args: any[]): Promise<any> };
}
interface ChatHeader { chat_metadata: Record<string, any>; user_name?: string; character_name?: string }
type ChatFile = [ChatHeader, ...HostMessage[]];
type HeaderArchive = Omit<Archive, 'commits'>;

/** Keep ancestors of surviving revisions when a native deletion removes their original carrier. */
export function preserveOrphanAncestors(archive: Archive, messages: HostMessage[]): boolean {
  const extras = messages.flatMap(m => [m.extra, ...(m.swipe_info ?? []).map(s => s.extra)]).filter(e => e?.solve);
  const owners = new Set(extras.map(e => headKey(e!.solve)));
  let selectedGap = false;
  for (const extra of extras) {
    const saved = extra!.solve as SwipeArchive;
    if (!saved.messageId || !saved.swipeId) continue;
    const records = saved.commits ??= {};
    const starts = new Set([...Object.keys(records), ...Object.values(archive.commits)
      .filter(commit => headKey(commit.binding) === headKey({ messageId: saved.messageId!, swipeId: saved.swipeId! })).map(commit => commit.id), ...(saved.headId ? [saved.headId] : [])]);
    for (const start of starts) {
      const seen = new Set<string>(); let cursor: string | null = start;
      while (cursor) {
        if (seen.has(cursor)) fail('HISTORY_CYCLE', '历史父链循环'); seen.add(cursor);
        const commit: Commit | undefined = archive.commits[cursor]; if (!commit) break;
        if (!owners.has(headKey(commit.binding))) {
          records[commit.id] = clone(commit);
          if (start === saved.headId) selectedGap = true;
        }
        cursor = commit.parentId;
      }
    }
  }
  return selectedGap;
}

export function archiveFromChat(header: Record<string, any>, messages: HostMessage[]): Archive | undefined {
  if (!header.solve) return undefined;
  const { storage, ...base } = clone(header.solve) as HeaderArchive & { storage?: CompactStorage };
  if (base.version !== '0.5' || !base.sessionId || !base.geneses || (!base.heads && storage?.version !== 3)) fail('ARCHIVE_INVALID', '聊天中的SOLVE元数据无效');
  if (storage && ![2, 3].includes(storage.version)) fail('STORAGE_VERSION', '不支持此楼层存储版本，请更新SOLVE');
  if (storage?.version === 3) {
    messages = clone(messages); expandPointers(messages);
    base.geneses = readGeneses(base.geneses, base.definitionHash); base.heads = {};
  }
  const archive: Archive = { ...base, commits: {}, heads: {} };
  const owners = new Set<string>();
  for (const message of messages) {
    const extras = [message.extra, ...(message.swipe_info ?? []).map(info => info.extra)];
    for (const extra of extras) {
      const saved: SwipeArchive | undefined = extra?.solve;
      if (!saved) continue;
      if (saved.messageId && saved.swipeId) owners.add(headKey({ messageId: saved.messageId, swipeId: saved.swipeId }));
      if (storage?.version === 3 && saved.headId && saved.messageId && saved.swipeId)
        base.heads[headKey({ messageId: saved.messageId, swipeId: saved.swipeId })] = saved.headId;
      for (const [commitId, commit] of Object.entries(saved.commits ?? {})) {
        if (archive.commits[commitId] && canonical(archive.commits[commitId]) !== canonical(commit)) fail('COMMIT_COLLISION', '同一提交ID存在不同内容');
        archive.commits[commitId] = clone(commit);
      }
    }
    if (storage && !message.is_user && !message.is_system) {
      const selected = message.swipe_id ?? 0;
      const count = Math.max(message.swipes?.length ?? 1, message.swipe_info?.length ?? 0, selected + 1);
      for (let index = 0; index < count; index++) {
        const floor = message.variables?.[index]?.solve;
        const saved: SwipeArchive | undefined = index === selected ? message.extra?.solve : message.swipe_info?.[index]?.extra?.solve;
        if (!saved?.headId || saved.nativeIndex !== index) continue;
        if (floor?.version !== storage.version) fail('STORAGE_MISSING', '楼层正式记录缺少或已丢失，无法从读取副本恢复');
        if ((floor.version === 3 ? readToken(floor.commit?.id) : floor.commit?.id) !== saved.headId || !saved.messageId || !saved.swipeId) fail('STORAGE_HEAD_MISMATCH', '楼层正式记录与回复指针不一致');
        for (const commit of readFloor(floor, { messageId: saved.messageId, swipeId: saved.swipeId }, storage)) {
          if (archive.commits[commit.id] && canonical(archive.commits[commit.id]) !== canonical(commit)) fail('COMMIT_COLLISION', '同一提交ID存在不同内容');
          archive.commits[commit.id] = commit;
        }
      }
    }
  }
  // Branch files may carry stale metadata heads for messages beyond the branch point.
  for (const [key, value] of Object.entries(base.heads)) if (archive.commits[value] && owners.has(key)) archive.heads[key] = value;
  return archive;
}
export class SillyTavern119Adapter implements ArchiveAdapter {
  private generation = id('generation');
  private baseline?: string | null;
  constructor(private context: () => HostContext, private fetcher: typeof fetch = fetch,
    private lock: <T>(name: string, fn: () => Promise<T>) => Promise<T> = async (_name, fn) => fn()) {}
  private ctx(): HostContext {
    const ctx = this.context();
    if (ctx.chatMetadata.solve?.storage?.version === 3) expandPointers(ctx.chat);
    if (ctx.groupId != null) fail('GROUP_CHAT_UNSUPPORTED', 'SOLVE首版只支持单角色聊天');
    if (!ctx.chatId || ctx.characterId === undefined || !(ctx.characters as Record<string, any>)[String(ctx.characterId)]) fail('NO_CHAT', '请先打开单角色聊天');
    return ctx;
  }
  async verifyVersion(): Promise<string> {
    const response = await this.fetcher('/version');
    if (!response.ok) fail('VERSION_UNAVAILABLE', '无法确认酒馆版本');
    const version = (await response.json()).pkgVersion;
    if (!/^1\.19\./u.test(String(version))) fail('HOST_VERSION', `需要SillyTavern 1.19，实际为${version}`);
    return version;
  }
  invalidate(): void { this.generation = id('generation'); }
  binding(index = this.ctx().chat.length - 1): Binding {
    const ctx = this.ctx(), message = ctx.chat[index];
    if (!message) fail('MESSAGE_NOT_FOUND', '当前消息不存在');
    if (message.is_user || message.is_system) fail('NOT_ASSISTANT_MESSAGE', 'SOLVE 操作只能绑定角色回复，不能写入用户或系统消息');
    const extra = message.extra ??= {};
    let saved = extra.solve as SwipeArchive | undefined;
    let messageId = saved?.messageId;
    if (!messageId || ctx.chat.slice(0, index).some(m => m.extra?.solve?.messageId === messageId)) messageId = id('message');
    const nativeIndex = message.swipe_id ?? 0;
    const info = message.swipe_info?.[nativeIndex];
    const infoSaved = info?.extra?.solve as SwipeArchive | undefined;
    let swipeId = infoSaved?.nativeIndex === nativeIndex ? infoSaved.swipeId : saved?.nativeIndex === nativeIndex ? saved.swipeId : undefined;
    if (!swipeId || message.swipe_info?.some((s, i) => i !== nativeIndex && s.extra?.solve?.swipeId === swipeId)) swipeId = id('swipe');
    extra.solve = { ...saved, messageId, swipeId, nativeIndex, ...(saved?.headId ? { headId: saved.headId } : {}) };
    delete extra.solve.ref; delete extra.solve.index;
    // A fresh overswipe must not inherit the previous reply's selected head.
    if (saved?.messageId !== messageId || saved?.swipeId !== swipeId) delete extra.solve.headId;
    return { chatId: ctx.chatId, messageId, swipeId, generationToken: this.generation };
  }
  assertCurrent(binding: Binding): void {
    const ctx = this.ctx();
    if (ctx.chatId !== binding.chatId || (binding.generationToken && binding.generationToken !== this.generation)) fail('STALE_BINDING', '请求已不属于当前聊天或生成任务');
    const message = ctx.chat.find(m => m.extra?.solve?.messageId === binding.messageId);
    if (!message || message.extra?.solve?.swipeId !== binding.swipeId || message.extra?.solve?.nativeIndex !== (message.swipe_id ?? 0)) fail('STALE_BINDING', '消息或Swipe已经切换');
  }
  loadMemory(): Archive | undefined {
    const ctx = this.ctx();
    return archiveFromChat(ctx.chatMetadata, ctx.chat);
  }
  private async post(path: string, body: unknown): Promise<any> {
    const ctx = this.ctx();
    const response = await this.fetcher(path, { method: 'POST', headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) fail('HOST_SAVE_FAILED', `酒馆请求失败（${response.status}）：${path}`);
    return response.json();
  }
  private address(): Record<string, string> {
    const ctx = this.ctx(), character = (ctx.characters as Record<string, any>)[String(ctx.characterId)];
    return { file_name: ctx.chatId, avatar_url: character.avatar, ch_name: character.name };
  }
  async readFile(): Promise<ChatFile | undefined> {
    const data = await this.post('/api/chats/get', this.address());
    if (!Array.isArray(data) || !data.length) return undefined;
    return data as ChatFile;
  }
  async load(): Promise<Archive | undefined> {
    const file = await this.readFile();
    const archive = file ? archiveFromChat(file[0].chat_metadata ?? {}, file.slice(1) as HostMessage[]) : undefined;
    this.baseline = archive ? await hash(archive) : null;
    return archive;
  }
  async reconcileNativeSave(expected: Archive): Promise<void> {
    const file = await this.readFile();
    const remote = file ? archiveFromChat(file[0].chat_metadata ?? {}, file.slice(1) as HostMessage[]) : undefined;
    const expectedHash = await hash(expected);
    if (!remote) fail('REMOTE_HEAD_CHANGED', '酒馆原生修改尚未保存，请等待保存后重新检查');
    const proof = clone(remote);
    const messages = this.ctx().chat;
    const owners = new Set(messages.flatMap(m => [m.extra, ...(m.swipe_info ?? []).map(s => s.extra)]).filter(e => e?.solve).map(e => headKey(e!.solve)));
    // The deletion event may arrive after the native save. Only restore known, now-carrierless ancestors.
    for (const [commitId, commit] of Object.entries(expected.commits)) if (!proof.commits[commitId] && !owners.has(headKey(commit.binding))) proof.commits[commitId] = clone(commit);
    if (await hash(proof) !== expectedHash) fail('REMOTE_HEAD_CHANGED', '酒馆原生修改尚未保存或远端历史已变化，请等待保存后重新检查');
    this.baseline = await hash(remote);
  }
  async selectedHead(binding: Binding): Promise<string | undefined> {
    this.assertCurrent(binding);
    const ctx = this.ctx(), message = ctx.chat.find(m => m.extra?.solve?.messageId === binding.messageId)!;
    const saved = message.extra?.solve as SwipeArchive;
    const archive = this.loadMemory();
    const commit = saved?.headId ? archive?.commits[saved.headId] : undefined;
    if (!commit || commit.binding.messageId !== binding.messageId || commit.binding.swipeId !== binding.swipeId) return undefined;
    if (commit.textDigest !== await hash(message.mes)) fail('REPLAY_REQUIRED', '消息正文已变化，请显式重放历史');
    return commit.id;
  }
  private pack(archive: Archive, binding: Binding, text: string, state: LogicalState, activeHead: string): ChatFile {
    if (archive.heads[headKey(binding)] !== activeHead) fail('STATE_NOT_ALIGNED', '页面选中的修订已过期，请在酒馆重新加载聊天后继续，拒绝用旧正文覆盖已保存操作');
    const ctx = this.ctx(), messages = clone(ctx.chat), metadata = clone(ctx.chatMetadata);
    expandPointers(messages);
    const { commits: _commits, heads: _heads, ...header } = archive;
    metadata.solve = { ...header, geneses: storeGeneses(archive) };
    for (const message of messages) {
      if (message.is_user || message.is_system) continue;
      if (!message.extra?.solve?.messageId) continue;
      const messageId = message.extra.solve.messageId;
      const currentIndex = message.swipe_id ?? 0;
      const current = message.extra.solve as SwipeArchive;
      if (messageId === binding.messageId) {
        message.mes = text;
        message.swipes ??= [message.mes];
        message.swipes[currentIndex] = text;
      }
      const saveSwipe = (extra: Record<string, any>, swipeId: string | undefined, nativeIndex: number): void => {
        if (!swipeId) return;
        const records = Object.fromEntries(Object.entries(archive.commits).filter(([, c]) => c.binding.messageId === messageId && c.binding.swipeId === swipeId));
        const headId = archive.heads[headKey({ messageId, swipeId })];
        extra.solve = { messageId, swipeId, nativeIndex, ...(headId ? { headId } : {}), commits: records } satisfies SwipeArchive;
      };
      message.extra ??= {};
      saveSwipe(message.extra, current.swipeId, currentIndex);
      message.swipe_info ??= [];
      message.swipe_info[currentIndex] ??= {};
      message.swipe_info[currentIndex]!.extra = clone(message.extra);
      for (let i = 0; i < message.swipe_info.length; i++) if (i !== currentIndex) {
        const info = message.swipe_info[i]!;
        if (info?.extra?.solve) saveSwipe(info.extra, info.extra.solve.swipeId, i);
      }
    }
    preserveOrphanAncestors(archive, messages);
    metadata.solve.storage = writeMessageVariableViews(messages, archive);
    metadata.variables = { ...metadata.variables, solve: activeVariableView(archive.commits[activeHead]!, state) };
    compactPointers(messages);
    // Reject a draft that cannot carry every referenced commit into the actual file.
    const packed = archiveFromChat(metadata, messages);
    if (!packed || canonical(packed) !== canonical(archive)) fail('ARCHIVE_OWNERSHIP', '部分历史找不到可归档的消息/Swipe，拒绝保存');
    return [{ chat_metadata: metadata, user_name: 'unused', character_name: 'unused' }, ...messages];
  }
  async save(draft: SaveDraft): Promise<void> {
    await this.lock(`solve:${draft.binding.chatId}`, async () => {
      this.assertCurrent(draft.binding);
      const sourceMessage = this.ctx().chat.find(m => m.extra?.solve?.messageId === draft.binding.messageId);
      if (draft.sourceTextDigest && (!sourceMessage || await hash(sourceMessage.mes) !== draft.sourceTextDigest)) fail('SOURCE_TEXT_CHANGED', '操作执行后原正文已变化，拒绝覆盖');
      const remote = await this.readFile();
      const remoteArchive = remote ? archiveFromChat(remote[0].chat_metadata ?? {}, remote.slice(1) as HostMessage[]) : undefined;
      const remoteHash = remoteArchive ? await hash(remoteArchive) : null;
      const draftHash = await hash(draft.archive);
      const alreadySaved = remoteHash === draftHash;
      if (this.baseline === undefined) this.baseline = remoteHash;
      if (remoteHash !== this.baseline && !alreadySaved) fail('REMOTE_HEAD_CHANGED', '磁盘上的SOLVE历史已被其他实例更新，请重新加载');
      const state = await restore(draft.archive, draft.commit.id);
      if (await hash(draft.text) !== draft.commit.textDigest) fail('SAVE_TEXT_MISMATCH', '候选正文与提交摘要不对应，拒绝保存');
      const chat = this.pack(draft.archive, draft.binding, draft.text, state, draft.commit.id);
      const views = variableViews(chat[0].chat_metadata, chat.slice(1) as HostMessage[]);
      const viewsMatch = remote && canonical(variableViews(remote[0].chat_metadata ?? {}, remote.slice(1) as HostMessage[])) === canonical(views)
        && canonical(remote[0].chat_metadata?.solve?.storage ?? null) === canonical(chat[0].chat_metadata.solve.storage);
      this.assertCurrent(draft.binding);
      if (!alreadySaved || !viewsMatch) {
        const result = await this.post('/api/chats/save', { ...this.address(), chat, force: false });
        if (result?.ok !== true) fail('HOST_SAVE_FAILED', '酒馆没有确认保存');
      }
      const readback = await this.readFile();
      const confirmed = readback ? archiveFromChat(readback[0].chat_metadata ?? {}, readback.slice(1) as HostMessage[]) : undefined;
      if (!confirmed || await hash(confirmed) !== await hash(draft.archive)) fail('SAVE_VERIFY_FAILED', '保存后回读的历史与候选不一致');
      expandPointers(readback!.slice(1) as HostMessage[]);
      const savedMessage = (readback!.slice(1) as HostMessage[]).find(m => m.extra?.solve?.messageId === draft.binding.messageId);
      if (!savedMessage || savedMessage.mes !== draft.text) fail('SAVE_TEXT_MISMATCH', '保存后的正文与操作结果不对应');
      if (canonical(variableViews(readback![0].chat_metadata ?? {}, readback!.slice(1) as HostMessage[])) !== canonical(views)) fail('VARIABLES_VERIFY_FAILED', '保存后楼层变量或聊天快照未完整回读');
      this.baseline = await hash(confirmed);
      this.assertCurrent(draft.binding);
      const ctx = this.ctx();
      expandPointers(chat.slice(1) as HostMessage[]);
      // Apply only SOLVE and target text fields, preserving unrelated live host changes.
      for (const saved of chat.slice(1) as HostMessage[]) {
        if (saved.is_user || saved.is_system || !saved.extra?.solve?.messageId) continue;
        const live = ctx.chat.find(m => m.extra?.solve?.messageId === saved.extra?.solve?.messageId);
        if (!live) continue;
        live.extra ??= {}; live.extra.solve = clone(saved.extra!.solve);
        applyMessageVariableViews(live, saved);
        if (saved.extra?.solve?.messageId === draft.binding.messageId) { live.mes = saved.mes; live.swipes = clone(saved.swipes); }
        live.swipe_info = clone(saved.swipe_info);
      }
      expandPointers(ctx.chat);
      const metadata = { ...ctx.chatMetadata, solve: clone(chat[0].chat_metadata.solve),
        variables: { ...ctx.chatMetadata.variables, solve: clone(chat[0].chat_metadata.variables.solve) } };
      if (ctx.updateChatMetadata) ctx.updateChatMetadata(metadata, true); else Object.assign(ctx.chatMetadata, metadata);
    });
  }
  /** Backfill old chats and persist a selected Swipe snapshot without executing or creating actions. */
  async syncVariables(archive: Archive, headId: string): Promise<void> {
    const commit = archive.commits[headId];
    if (!commit) fail('BROKEN_HISTORY', '当前快照缺少对应提交');
    const index = this.ctx().chat.findIndex(message => !message.is_user && !message.is_system
      && message.extra?.solve?.messageId === commit.binding.messageId && message.extra?.solve?.swipeId === commit.binding.swipeId);
    if (index < 0) fail('STALE_BINDING', '当前快照的消息或回复版本已切换');
    const text = this.ctx().chat[index]!.mes, binding = this.binding(index);
    await this.save({ archive, commit, binding, text, expectedHead: headId, sourceTextDigest: await hash(text) });
  }
}

export function browserWriteLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) return navigator.locks.request(name, fn) as Promise<T>;
  return fn();
}
