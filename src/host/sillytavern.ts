import { canonical, clone, fail, hash, id } from '../json.js';
import { headKey, restore } from '../history.js';
import type { Archive, ArchiveAdapter, Binding, Commit, SaveDraft } from '../types.js';

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
  updateChatMetadata?(metadata: Record<string, any>, reset?: boolean): void;
  macros?: { registry: any };
  messageFormatter?: { addHook(fn: (text: string, ctx: any) => string, options: any): void; removeHook?(fn: unknown): void };
  eventSource?: { on(name: string, fn: (...args: any[]) => unknown): void; removeListener(name: string, fn: (...args: any[]) => unknown): void };
  eventTypes?: Record<string, string>;
  ConnectionManagerRequestService?: { sendRequest(...args: any[]): Promise<any> };
}
interface ChatHeader { chat_metadata: Record<string, any>; user_name?: string; character_name?: string }
type ChatFile = [ChatHeader, ...HostMessage[]];
type HeaderArchive = Omit<Archive, 'commits'>;

export function archiveFromChat(header: Record<string, any>, messages: HostMessage[]): Archive | undefined {
  if (!header.solve) return undefined;
  const base = clone(header.solve) as HeaderArchive;
  if (base.version !== '0.5' || !base.sessionId || !base.geneses || !base.heads) fail('ARCHIVE_INVALID', '聊天中的SOLVE元数据无效');
  const archive: Archive = { ...base, commits: {}, heads: {} };
  for (const message of messages) {
    const extras = [message.extra, ...(message.swipe_info ?? []).map(info => info.extra)];
    for (const extra of extras) {
      const saved: SwipeArchive | undefined = extra?.solve;
      if (!saved) continue;
      for (const [commitId, commit] of Object.entries(saved.commits ?? {})) {
        if (archive.commits[commitId] && canonical(archive.commits[commitId]) !== canonical(commit)) fail('COMMIT_COLLISION', '同一提交ID存在不同内容');
        archive.commits[commitId] = clone(commit);
      }
    }
  }
  // Branch files may carry stale metadata heads for messages beyond the branch point.
  for (const [key, value] of Object.entries(base.heads)) if (archive.commits[value]) archive.heads[key] = value;
  return archive;
}
export class SillyTavern119Adapter implements ArchiveAdapter {
  private generation = id('generation');
  private baseline?: string | null;
  constructor(private context: () => HostContext, private fetcher: typeof fetch = fetch,
    private lock: <T>(name: string, fn: () => Promise<T>) => Promise<T> = async (_name, fn) => fn()) {}
  private ctx(): HostContext {
    const ctx = this.context();
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
    const extra = message.extra ??= {};
    let saved = extra.solve as SwipeArchive | undefined;
    let messageId = saved?.messageId;
    if (!messageId || ctx.chat.slice(0, index).some(m => m.extra?.solve?.messageId === messageId)) messageId = id('message');
    const nativeIndex = message.swipe_id ?? 0;
    const info = message.swipe_info?.[nativeIndex];
    const infoSaved = info?.extra?.solve as SwipeArchive | undefined;
    let swipeId = infoSaved?.nativeIndex === nativeIndex ? infoSaved.swipeId : saved?.nativeIndex === nativeIndex ? saved.swipeId : undefined;
    if (!swipeId || message.swipe_info?.some((s, i) => i !== nativeIndex && s.extra?.solve?.swipeId === swipeId)) swipeId = id('swipe');
    extra.solve = { ...saved, messageId, swipeId, nativeIndex };
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
  private pack(archive: Archive, binding: Binding, text: string): ChatFile {
    const ctx = this.ctx(), messages = clone(ctx.chat), metadata = clone(ctx.chatMetadata);
    const { commits: _commits, ...header } = archive;
    metadata.solve = header;
    for (const message of messages) {
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
      const chat = this.pack(draft.archive, draft.binding, draft.text);
      this.assertCurrent(draft.binding);
      if (!alreadySaved) {
        const result = await this.post('/api/chats/save', { ...this.address(), chat, force: false });
        if (result?.ok !== true) fail('HOST_SAVE_FAILED', '酒馆没有确认保存');
      }
      const readback = await this.readFile();
      const confirmed = readback ? archiveFromChat(readback[0].chat_metadata ?? {}, readback.slice(1) as HostMessage[]) : undefined;
      if (!confirmed || await hash(confirmed) !== await hash(draft.archive)) fail('SAVE_VERIFY_FAILED', '保存后回读的历史与候选不一致');
      const savedMessage = (readback!.slice(1) as HostMessage[]).find(m => m.extra?.solve?.messageId === draft.binding.messageId);
      if (!savedMessage || savedMessage.mes !== draft.text) fail('SAVE_TEXT_MISMATCH', '保存后的正文与操作结果不对应');
      this.baseline = await hash(confirmed);
      this.assertCurrent(draft.binding);
      const ctx = this.ctx();
      // Apply only SOLVE and target text fields, preserving unrelated live host changes.
      for (const saved of chat.slice(1) as HostMessage[]) {
        const live = ctx.chat.find(m => m.extra?.solve?.messageId === saved.extra?.solve?.messageId);
        if (!live) continue;
        live.extra ??= {}; live.extra.solve = clone(saved.extra!.solve);
        if (saved.extra?.solve?.messageId === draft.binding.messageId) { live.mes = saved.mes; live.swipes = clone(saved.swipes); }
        live.swipe_info = clone(saved.swipe_info);
      }
      const metadata = { ...ctx.chatMetadata, solve: clone(chat[0].chat_metadata.solve) };
      if (ctx.updateChatMetadata) ctx.updateChatMetadata(metadata, true); else ctx.chatMetadata.solve = metadata.solve;
    });
  }
}

export function browserWriteLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) return navigator.locks.request(name, fn) as Promise<T>;
  return fn();
}
