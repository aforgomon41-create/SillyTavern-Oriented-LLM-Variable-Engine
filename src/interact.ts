/**
 * Declared player interactions (status bar). A structure field may carry
 *   · `edit`    — the player may change this value in place (widget from the field type);
 *   · `actions` — buttons on each entry of a collection / on an entity (use, give, go …).
 * Actions are templates over ordinary SOLVE operations: the status bar fills in the placeholders,
 * submits the batch as a `source: 'user'` action and the engine validates it like any other write.
 *
 * Placeholders: `{self}` path of the entry, `{id}` its key, `{name}`, `{holder}` / `{holderId}`
 * (the entity it sits under), `{user}` / `{userId}`, any field of the entry (`{count}`), and the
 * answers of `ask` (`{to}`, `{to.name}`, `{n}`). A string that is exactly `{x}` or `-{x}` keeps the
 * value's type (numbers stay numbers). `{ $if: cond, then: [...], else: [...] }` picks operations.
 */
import { fail } from './json.js';
import type { Json } from './types.js';

export type Compare = { eq?: Json; ne?: Json; gt?: Json; gte?: Json; lt?: Json; lte?: Json; in?: Json[]; exists?: boolean; empty?: boolean };
/** Field of the entry (`count`), or an absolute path prefixed with `@` (`@meta.location`); a plain value means equality. */
export type Cond = Record<string, Json | Compare>;
export interface AskSpec {
  label: string;
  /** Choose a key of the record at this path (placeholders allowed): an entity collection (`characters`) or a keyed record (`{self}.stored`). */
  pick?: string;
  /** Keep only candidates (entities) matching any of these conditions, e.g. `[{ owner: '{holderId}' }, { vault: true }]`. */
  filter?: Cond[];
  /** Limit the choice to the IDs listed at this path (e.g. `meta.present`); falls back to the whole collection when empty. */
  within?: string;
  /** Leave this ID out (e.g. `{holderId}`). */
  not?: string;
  /** Ask for a number. */
  number?: { min?: Json; max?: Json; default?: Json };
  /** Ask for a sentence (how, why …); `optional` lets it stay empty. */
  text?: { placeholder?: string; optional?: boolean };
  /** Only ask when this holds; otherwise the answer is `default` (or 1). */
  when?: Cond;
}
export interface ActionSpec {
  /** Button text; a pair for toggles: [turn on, turn off]. */
  label: string | [string, string];
  /** Shorthand: flip this bool field of the entry. */
  toggle?: string;
  ops?: Json[];
  /** Shown only when this holds. */
  when?: Cond;
  /** `user`: only on entries under the player's character. */
  owner?: 'user';
  /** Shown only while this module is on (e.g. storage needs `buildings`). */
  module?: string;
  ask?: Record<string, AskSpec>;
  /** Ask for confirmation first (destructive actions). */
  confirm?: string;
  /** Told to the model on the next turn; a pair for toggles. */
  narrate?: string | [string, string];
  tone?: 'danger';
}
export interface EditSpec {
  owner?: 'user';
  /** Editable only while the surrounding object matches (e.g. lore the player wrote: `{ source: '玩家' }`). */
  when?: Cond;
  narrate?: string | [string, string];
}
/** A form above a record to add an entry (lore the player establishes …). */
export interface CreateSpec {
  label: string;
  /** Fields asked in the form, in order (text, paragraph, enum, bool, number). */
  fields: string[];
  /** Fixed values written with every new entry, e.g. `{ source: '玩家' }`. */
  set?: Record<string, Json>;
  narrate?: string;
}

const COMPARE = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'exists', 'empty']);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const pairOrString = (v: unknown) => typeof v === 'string' || (Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'string'));

export function checkCond(at: string, cond: unknown): void {
  if (!isObj(cond)) fail('STRUCTURE_INVALID', `${at}：条件必须是对象`, at);
  for (const [key, v] of Object.entries(cond)) {
    if (!key) fail('STRUCTURE_INVALID', `${at}：条件键不能为空`, at);
    if (isObj(v) && Object.keys(v).some(k => !COMPARE.has(k))) fail('STRUCTURE_INVALID', `${at}：条件 ${key} 只能用 ${[...COMPARE].join('/')}`, at);
  }
}
function checkOps(at: string, ops: unknown): void {
  if (!Array.isArray(ops)) fail('STRUCTURE_INVALID', `${at}：ops 必须是数组`, at);
  for (const op of ops) {
    if (isObj(op) && '$if' in op) {
      checkCond(at, op.$if);
      if (Object.keys(op).some(k => !['$if', 'then', 'else'].includes(k))) fail('STRUCTURE_INVALID', `${at}：$if 只能带 then / else`, at);
      checkOps(at, op.then ?? []); checkOps(at, op.else ?? []);
    } else if (!isObj(op)) fail('STRUCTURE_INVALID', `${at}：每条操作必须是对象`, at);
  }
}
/** Validate an `edit` declaration; returns its normalized form. */
export function checkEdit(at: string, edit: unknown, type: string): EditSpec {
  if (edit === true) return {};
  if (!isObj(edit)) fail('STRUCTURE_INVALID', `${at}：edit 只能是 true 或 {owner, narrate}`, at);
  const extra = Object.keys(edit).filter(k => !['owner', 'narrate', 'when'].includes(k));
  if (edit.when !== undefined) checkCond(at, edit.when);
  if (extra.length) fail('STRUCTURE_INVALID', `${at}：edit 未知属性 ${extra.join(', ')}`, at);
  if (edit.owner !== undefined && edit.owner !== 'user') fail('STRUCTURE_INVALID', `${at}：edit.owner 只能是 user`, at);
  if (edit.narrate !== undefined && !pairOrString(edit.narrate)) fail('STRUCTURE_INVALID', `${at}：narrate 是字符串或 [开, 关] 两句`, at);
  if (Array.isArray(edit.narrate) && type !== 'bool') fail('STRUCTURE_INVALID', `${at}：两句 narrate 只用于 bool`, at);
  return edit as EditSpec;
}
/** Validate a `create` declaration against the entry's fields. */
export function checkCreate(at: string, create: unknown, fields: Record<string, { type: string }> | undefined): CreateSpec {
  if (!isObj(create) || typeof create.label !== 'string' || !Array.isArray(create.fields) || !create.fields.length) fail('STRUCTURE_INVALID', `${at}：create 需要 label 与 fields`, at);
  const extra = Object.keys(create).filter(k => !['label', 'fields', 'set', 'narrate'].includes(k));
  if (extra.length) fail('STRUCTURE_INVALID', `${at}：create 未知属性 ${extra.join(', ')}`, at);
  for (const f of create.fields) if (typeof f !== 'string' || !fields?.[f] || !['string', 'enum', 'bool', 'int', 'number', 'ladder'].includes(fields[f]!.type)) fail('STRUCTURE_INVALID', `${at}：create.fields 中的 ${String(f)} 不存在或不是单个值`, at);
  if (create.set !== undefined && (!isObj(create.set) || Object.keys(create.set).some(k => !fields?.[k]))) fail('STRUCTURE_INVALID', `${at}：create.set 只能写已有字段`, at);
  if (create.narrate !== undefined && typeof create.narrate !== 'string') fail('STRUCTURE_INVALID', `${at}：narrate 是一句话`, at);
  return create as unknown as CreateSpec;
}
/** Validate an `actions` declaration. */
export function checkActions(at: string, actions: unknown): Record<string, ActionSpec> {
  if (!isObj(actions)) fail('STRUCTURE_INVALID', `${at}：actions 必须是对象`, at);
  const known = ['label', 'toggle', 'ops', 'when', 'owner', 'module', 'ask', 'confirm', 'narrate', 'tone'];
  for (const [name, a] of Object.entries(actions)) {
    const where = `${at} 动作 ${name}`;
    if (!isObj(a)) fail('STRUCTURE_INVALID', `${where}：必须是对象`, at);
    const extra = Object.keys(a).filter(k => !known.includes(k));
    if (extra.length) fail('STRUCTURE_INVALID', `${where}：未知属性 ${extra.join(', ')}`, at);
    if (!pairOrString(a.label)) fail('STRUCTURE_INVALID', `${where}：需要 label`, at);
    if ((a.toggle === undefined) === (a.ops === undefined)) fail('STRUCTURE_INVALID', `${where}：toggle 与 ops 二选一`, at);
    if (a.toggle !== undefined && typeof a.toggle !== 'string') fail('STRUCTURE_INVALID', `${where}：toggle 是字段名`, at);
    if (a.ops !== undefined) checkOps(where, a.ops);
    if (a.when !== undefined) checkCond(where, a.when);
    if (a.owner !== undefined && a.owner !== 'user') fail('STRUCTURE_INVALID', `${where}：owner 只能是 user`, at);
    if (a.confirm !== undefined && typeof a.confirm !== 'string') fail('STRUCTURE_INVALID', `${where}：confirm 是一句提示`, at);
    if (a.narrate !== undefined && !pairOrString(a.narrate)) fail('STRUCTURE_INVALID', `${where}：narrate 是字符串或两句`, at);
    if (a.module !== undefined && typeof a.module !== 'string') fail('STRUCTURE_INVALID', `${where}：module 是模块名`, at);
    if (a.tone !== undefined && a.tone !== 'danger') fail('STRUCTURE_INVALID', `${where}：tone 只能是 danger`, at);
    if (a.ask !== undefined) {
      if (!isObj(a.ask)) fail('STRUCTURE_INVALID', `${where}：ask 必须是对象`, at);
      for (const [key, q] of Object.entries(a.ask)) {
        if (!/^[A-Za-z_]\w*$/u.test(key)) fail('STRUCTURE_INVALID', `${where}：ask 键 ${key} 只能是字母数字`, at);
        if (!isObj(q) || typeof q.label !== 'string' || [q.pick, q.number, q.text].filter(x => x !== undefined).length !== 1) fail('STRUCTURE_INVALID', `${where}：ask.${key} 需要 label，并且 pick / number / text 三选一`, at);
        if (q.when !== undefined) checkCond(where, q.when);
        if (q.filter !== undefined) { if (!Array.isArray(q.filter) || !q.pick) fail('STRUCTURE_INVALID', `${where}：ask.${key}.filter 是条件数组，只用于 pick`, at); q.filter.forEach((c: unknown) => checkCond(where, c)); }
      }
    }
  }
  return actions as Record<string, ActionSpec>;
}

/** Variables available to the templates; nested `{to.name}` reads use dotted keys. */
export type Vars = Record<string, Json | undefined>;
const TOKEN = /\{([\w.@]+)\}/gu;
/** Fill placeholders in strings, keys included. `"{x}"` / `"-{x}"` alone keep the value's type. */
export function fill(template: Json, vars: Vars): Json {
  if (typeof template === 'string') {
    const whole = /^(-?)\{([\w.@]+)\}$/u.exec(template);
    if (whole && whole[2]! in vars) {
      const v = vars[whole[2]!];
      if (whole[1]) return typeof v === 'number' ? -v : `-${String(v ?? '')}`;
      return v === undefined ? null : v;
    }
    return template.replace(TOKEN, (all, key: string) => key in vars ? String(vars[key] ?? '') : all);
  }
  if (Array.isArray(template)) return template.map(t => fill(t, vars));
  if (isObj(template)) return Object.fromEntries(Object.entries(template).map(([k, v]) => [String(fill(k, vars)), fill(v as Json, vars)]));
  return template;
}
/** Nothing there: missing, null, '', 0, [] or {}. */
function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || v === 0 || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
}
const num = (v: unknown) => typeof v === 'number' ? v : Number.NaN;
function compare(value: Json | undefined, c: Json | Compare): boolean {
  if (!isObj(c)) return JSON.stringify(value ?? null) === JSON.stringify(c);
  const same = (x: Json | undefined) => JSON.stringify(value ?? null) === JSON.stringify(x ?? null);
  if ('exists' in c && (value !== undefined && value !== null) !== c.exists) return false;
  if ('empty' in c && isEmptyValue(value) !== c.empty) return false;
  if ('eq' in c && !same(c.eq)) return false;
  if ('ne' in c && same(c.ne)) return false;
  if ('gt' in c && !(num(value) > num(c.gt))) return false;
  if ('gte' in c && !(num(value) >= num(c.gte))) return false;
  if ('lt' in c && !(num(value) < num(c.lt))) return false;
  if ('lte' in c && !(num(value) <= num(c.lte))) return false;
  if ('in' in c && !((c.in ?? []) as Json[]).some(x => same(x))) return false;
  return true;
}
/** Does the condition hold? `view` is the entry (merged with the entity it references); `read` reads absolute paths. */
export function holds(cond: Cond | undefined, view: Record<string, any>, vars: Vars, read: (path: string[]) => Json | undefined): boolean {
  if (!cond) return true;
  return Object.entries(cond).every(([key, raw]) => {
    const c = fill(raw as Json, vars) as Json | Compare;
    const value = key.startsWith('@') ? read(String(fill(key.slice(1), vars)).split('.')) : view[key];
    return compare(value, c);
  });
}
/** Resolve `$if` branches and fill placeholders: the batch to submit. */
export function expand(ops: Json[], view: Record<string, any>, vars: Vars, read: (path: string[]) => Json | undefined): Json[] {
  const out: Json[] = [];
  for (const op of ops) {
    if (isObj(op) && '$if' in op) out.push(...expand((holds(op.$if as Cond, view, vars, read) ? op.then : op.else) as Json[] ?? [], view, vars, read));
    else out.push(fill(op, vars));
  }
  return out;
}
/** Pick one of a [on, off] pair, or the single text. */
export function pick<T>(v: T | [T, T] | undefined, on: boolean): T | undefined { return Array.isArray(v) ? v[on ? 0 : 1] : v; }
