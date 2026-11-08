import { z } from 'zod';
import { fail } from '../json.js';
import { compileAuthorDefinition } from '../authoring.js';
import { captureDefinitionSnapshot, restoreDefinitionSnapshot } from '../definition-snapshot.js';
import type { CompiledDefinition, Definition } from '../types.js';
import type { WorldInfoEntry } from '../world-info.js';
import type { HostContext } from './sillytavern.js';

export interface WorldInfoSelection {
  books?: string[];
  characterBook?: boolean;
  chatBook?: boolean;
  macros?: boolean;
}
const selectionShape = z.strictObject({ books: z.array(z.string().min(1)).optional(), characterBook: z.boolean().optional(),
  chatBook: z.boolean().optional(), macros: z.boolean().optional() });
export function normalizeWorldInfoSelection(selection: WorldInfoSelection = {}): WorldInfoSelection {
  const result = selectionShape.safeParse(selection);
  if (!result.success) fail('WORLD_INFO_SELECTION', '世界书选择必须包含有效的书名列表和布尔选项');
  const books = [...new Set(result.data.books ?? [])];
  return { books, characterBook: result.data.characterBook ?? !books.length, chatBook: result.data.chatBook ?? false, macros: result.data.macros ?? true };
}

/** Read full files, never the activation/budget-filtered prompt entries or host module cache. */
export async function readWorldInfoSelection(context: () => HostContext, input: WorldInfoSelection = {}, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<{ books: string[]; entries: WorldInfoEntry[] }> {
  const selection = normalizeWorldInfoSelection(input), ctx = context();
  const character = (value: HostContext) => (value.characters as Record<string, any>)[String(value.characterId)];
  const avatar = character(ctx)?.avatar, chatId = ctx.chatId, characterId = ctx.characterId;
  const current = () => {
    const live = context();
    if (signal?.aborted || live.chatId !== chatId || live.characterId !== characterId || character(live)?.avatar !== avatar)
      fail('STALE_BINDING', '读取世界书期间角色或聊天已切换');
    return live;
  };
  const books = [...selection.books ?? []];
  if (selection.characterBook ?? !books.length) {
    const name = character(ctx)?.data?.extensions?.world;
    if (typeof name === 'string' && name) books.push(name);
  }
  if (selection.chatBook && typeof ctx.chatMetadata.world_info === 'string' && ctx.chatMetadata.world_info) books.push(ctx.chatMetadata.world_info);
  const names = [...new Set(books)];
  if (!names.length) fail('WORLD_INFO_SELECTION', '没有选定世界书，请指定 books 或绑定角色主世界书');
  const post = async (path: string, body: unknown): Promise<any> => {
    const live = current();
    const response = await fetcher(path, { method: 'POST', headers: { ...live.getRequestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-cache', signal });
    current();
    if (!response.ok) fail('WORLD_INFO_READ', '读取世界书失败：' + path + ' HTTP ' + response.status);
    const data: unknown = await response.json(); current(); return data;
  };
  // /get returns an empty dummy even for a missing book: check actual file ids first.
  const list = await post('/api/worldinfo/list', {});
  if (!Array.isArray(list)) fail('WORLD_INFO_READ', '酒馆返回的世界书文件列表无效');
  const known = new Set(list.map(item => item?.file_id));
  for (const name of names) if (!known.has(name)) fail('WORLD_INFO_MISSING', '世界书文件不存在：' + name);
  const files = await Promise.all(names.map(name => post('/api/worldinfo/get', { name })));
  const entries: WorldInfoEntry[] = [];
  for (const [index, file] of files.entries()) {
    if (!file?.entries || typeof file.entries !== 'object' || Array.isArray(file.entries)) fail('WORLD_INFO_READ', '世界书 entries 无效：' + names[index]);
    for (const [uid, value] of Object.entries(file.entries) as [string, any][]) {
      if (typeof value?.comment !== 'string' || !/^\s*\[SOLVE:/iu.test(value.comment)) continue;
      const source = names[index] + '#' + uid;
      if (typeof value.content !== 'string' || value.disable !== undefined && typeof value.disable !== 'boolean') fail('WORLD_INFO_ENTRY', source + '：条目内容或停用字段无效', source);
      entries.push({ uid, source, comment: value.comment, content: value.content, ...(value.disable !== undefined ? { disable: value.disable } : {}) });
    }
  }
  current();
  if (!entries.some(entry => !entry.disable)) fail('WORLD_INFO_EMPTY', '选定世界书没有启用的 SOLVE 条目');
  return { books: names, entries };
}

export async function prepareWorldInfoDefinition(base: Definition, context: () => HostContext, selection: WorldInfoSelection,
  fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<CompiledDefinition> {
  const saved = context().chatMetadata.solve;
  if (saved?.authoring) return restoreDefinitionSnapshot(base, saved.authoring, saved.definitionHash);
  if (saved?.definitionHash) fail('DEFINITION_SNAPSHOT_MISSING', '旧聊天没有固定世界书声明，请先注册它的原作者定义');
  const snapshot = await readWorldInfoSelection(context, selection, fetcher, signal);
  const result = await compileAuthorDefinition(base, { worldInfo: snapshot.entries,
    renderWorldInfo: selection.macros === false ? undefined : text => {
      const ctx = context();
      if (!ctx.substituteParams && text.includes('{{')) fail('HOST_MACROS_MISSING', '宿主没有公开宏替换能力，可明确关闭 macros');
      return ctx.substituteParams ? ctx.substituteParams(text) : text;
    } });
  context();
  if (signal?.aborted) fail('STALE_BINDING', '世界书编译期间聊天已切换');
  result.definition.authoringSnapshot = await captureDefinitionSnapshot(base, result.definition, snapshot.books);
  context();
  return result.definition;
}
