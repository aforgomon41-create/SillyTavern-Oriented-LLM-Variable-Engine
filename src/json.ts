import type { Json } from './types.js';

export class SolveError extends Error {
  constructor(public code: string, message: string, public path?: string) { super(message); this.name = 'SolveError'; }
}
export function fail(code: string, message: string, path?: string): never { throw new SolveError(code, message, path); }
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
export function safeKey(key: string): void {
  if (unsafe.has(key)) fail('UNSAFE_PATH', `禁止访问危险键：${key}`);
}
export function assertJson(value: unknown, depth = 0, seen = new Set<object>()): asserts value is Json {
  if (depth > 128) fail('DEPTH_LIMIT', 'JSON 嵌套超过限制');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null) fail('NOT_JSON', '状态必须是有限、可序列化 JSON');
  if (seen.has(value)) fail('NOT_JSON', '不允许循环引用');
  const prototype = Object.getPrototypeOf(value);
  // Author scripts may run in a same-origin iframe. Its plain Object.prototype
  // has a different identity, but still directly inherits from null.
  if (!Array.isArray(value) && prototype !== null && Object.getPrototypeOf(prototype) !== null) fail('NOT_JSON', '状态不允许 Date/Map/类实例');
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) fail('NOT_JSON', '不允许稀疏数组');
      assertJson(value[i], depth + 1, seen);
    }
  } else for (const [key, item] of Object.entries(value)) { safeKey(key); assertJson(item, depth + 1, seen); }
  seen.delete(value);
}
export function clone<T>(value: T): T { return structuredClone(value); }
export function canonical(value: unknown): string {
  assertJson(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}
export const id = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`;
export function pointer(parts: string[]): string { return parts.length ? '/' + parts.map(s => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : ''; }
export function segments(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/') || /~(?![01])/u.test(path)) fail('INVALID_POINTER', '非法 JSON Pointer', path);
  return path.slice(1).split('/').map(s => { const k = s.replace(/~1/g, '/').replace(/~0/g, '~'); safeKey(k); return k; });
}
export function at(root: unknown, parts: string[], required = true): any {
  let current: any = root;
  for (const key of parts) {
    safeKey(key);
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      if (required) fail('PATH_NOT_FOUND', `路径不存在：${pointer(parts)}`, pointer(parts));
      return undefined;
    }
    current = current[key];
  }
  return current;
}
export function write(root: unknown, parts: string[], value: unknown, remove = false): void {
  if (!parts.length) fail('ROOT_WRITE', '禁止直接替换状态根');
  const key = parts.at(-1)!;
  safeKey(key);
  const parent = at(root, parts.slice(0, -1));
  if (!parent || typeof parent !== 'object') fail('INVALID_TARGET', '目标父路径不是对象');
  if (Array.isArray(parent)) {
    if (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= parent.length) fail('ARRAY_INDEX', '数组下标无效');
    if (remove) parent.splice(Number(key), 1); else parent[Number(key)] = value;
  } else if (remove) delete parent[key]; else parent[key] = value;
}
export function matches(pattern: string, parts: string[]): boolean {
  const p = pattern.startsWith('/') ? segments(pattern) : pattern.split('.');
  return p.length === parts.length && p.every((s, i) => s === '*' || s === parts[i]);
}
export function covered(pattern: string, parts: string[]): boolean {
  const p = pattern.startsWith('/') ? segments(pattern) : pattern.split('.');
  return p.length <= parts.length && p.every((s, i) => s === '*' || s === parts[i]);
}
export function expand(root: unknown, pattern: string): { parts: string[]; value: any }[] {
  const p = pattern.startsWith('/') ? segments(pattern) : pattern.split('.');
  p.forEach(k => { if (k !== '*') safeKey(k); });
  const out: { parts: string[]; value: any }[] = [];
  function walk(value: any, i: number, parts: string[]): void {
    if (i === p.length) { out.push({ parts, value }); return; }
    if (!value || typeof value !== 'object') return;
    for (const key of p[i] === '*' ? Object.keys(value) : [p[i]!]) {
      safeKey(key);
      if (Object.hasOwn(value, key)) walk(value[key], i + 1, [...parts, key]);
    }
  }
  walk(root, 0, []);
  return out;
}
export function merge(base: any, patch: any): any {
  if (base && patch && !Array.isArray(base) && !Array.isArray(patch) && typeof base === 'object' && typeof patch === 'object') {
    const next = clone(base);
    for (const [key, value] of Object.entries(patch)) { safeKey(key); next[key] = merge(next[key], value); }
    return next;
  }
  return clone(patch);
}
