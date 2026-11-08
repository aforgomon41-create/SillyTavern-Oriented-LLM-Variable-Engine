import { assertJson, clone, fail, safeKey } from './json.js';
import type { Json } from './types.js';
import { readQuoted } from './guides.js';

/** A snapshot supplied by the author or host; this module never reads a global world book. */
export interface WorldInfoEntry {
  uid?: string | number;
  source?: string;
  comment: string;
  content: string;
  disable?: boolean;
}
export interface ParsedWorldInfoEntry {
  source: string;
  tag: string;
  module?: string;
  when?: string;
  id?: string;
  content: string;
  entry: Readonly<WorldInfoEntry>;
}
export type WorldInfoRenderer = (content: string, entry: Readonly<WorldInfoEntry>) => string | Promise<string>;

export async function parseWorldInfoEntry(entry: WorldInfoEntry, index = 0, render?: WorldInfoRenderer): Promise<ParsedWorldInfoEntry | undefined> {
  if (!entry || typeof entry.comment !== 'string' || typeof entry.content !== 'string')
    fail('WORLD_INFO_ENTRY', '世界书条目必须包含 comment 和 content', 'worldInfo[' + index + ']');
  const source = entry.source || 'worldInfo[' + String(entry.uid ?? index) + ']';
  if (entry.disable) return undefined;
  const comment = entry.comment.trim();
  if (!/^\[SOLVE:/iu.test(comment)) return undefined;
  const match = /^\[SOLVE:([A-Z][A-Z0-9_-]*)/iu.exec(comment);
  if (!match) fail('WORLD_INFO_TAG', source + '：SOLVE 标签格式不正确', source);
  const tag = match[1]!.toUpperCase(), attributes: Record<string, string> = {};
  let cursor = match[0].length;
  while (comment[cursor] !== ']') {
    const attribute = /^\s+([a-z]+)=/iu.exec(comment.slice(cursor));
    if (!attribute) fail('WORLD_INFO_TAG', source + '：SOLVE 标签参数格式不正确或缺少右方括号', source);
    const name = attribute[1]!.toLowerCase(); cursor += attribute[0].length;
    if (!['module','id','when'].includes(name) || Object.hasOwn(attributes, name)) fail('WORLD_INFO_TAG', source + '：未知或重复参数：' + name, source);
    if (name !== 'module' && tag !== 'GUIDE') fail('WORLD_INFO_TAG', source + '：只有 GUIDE 支持 id/when 参数', source);
    if (comment[cursor] === '"' || comment[cursor] === "'") { const result = readQuoted(comment, cursor, source); attributes[name] = result.value; cursor = result.end; }
    else { const value = /^[^\s\]]+/u.exec(comment.slice(cursor))?.[0]; if (!value) fail('WORLD_INFO_TAG', source + '：参数值不能为空', source); attributes[name] = value; cursor += value.length; }
  }
  const { module, when, id } = attributes;
  if (module) safeKey(module);
  if (id) safeKey(id);
  if (module === '' || id === '' || when === '') fail('WORLD_INFO_TAG', source + '：参数值不能为空', source);
  const snapshot = Object.freeze({ ...entry });
  let content: string;
  try { content = render ? await render(entry.content, snapshot) : entry.content; }
  catch (error) { fail('WORLD_INFO_RENDER', source + '：' + (error instanceof Error ? error.message : String(error)), source); }
  if (typeof content !== 'string') fail('WORLD_INFO_CONTENT', source + '：宏替换必须返回文本', source);
  return { source, tag, ...(module ? { module } : {}), ...(when !== undefined ? { when } : {}), ...(id !== undefined ? { id } : {}), content, entry: snapshot };
}

/** Strict JSON only: never eval author text or execute a schema from a world-book entry. */
export function worldInfoJson(entry: ParsedWorldInfoEntry): Json {
  let value: unknown;
  try { value = JSON.parse(entry.content); assertJson(value); }
  catch (error) { fail('WORLD_INFO_JSON', entry.source + '：需要有效 JSON；' + (error instanceof Error ? error.message : String(error)), entry.source); }
  return clone(value);
}
