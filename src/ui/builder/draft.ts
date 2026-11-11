/**
 * 结构制作：草稿的纯函数操作。地址是字段键的数组，`*` 表示字典值 / 数组元素（FieldNode.of），与编译器的路径写法一致。
 * 每个修改都返回新的结构描述（不改原对象），便于撤销 / 重做。改名、删除会同步开局数据和布局、指南里引用的路径。
 */
import type { FieldNode, FieldType, StructureDescription } from '../../structure.js';

export type Addr = string[];
export const addrKey = (a: Addr) => a.join('.');
export const fromKey = (k: string): Addr => (k ? k.split('.') : []);
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** The root as an object node, so the root and every object are handled alike. */
export const rootNode = (d: StructureDescription): FieldNode => ({ type: 'object', fields: d.fields });
export function nodeAt(d: StructureDescription, addr: Addr): FieldNode | undefined {
  let cur: FieldNode | undefined = rootNode(d);
  for (const seg of addr) { cur = seg === '*' ? cur?.of : cur?.fields?.[seg]; if (!cur) return undefined; }
  return cur;
}
export function childrenOf(node: FieldNode | undefined): [string, FieldNode][] {
  if (!node) return [];
  if (node.fields) return Object.entries(node.fields);
  if (node.of) return [['*', node.of]];
  return [];
}
/** Where new child fields go: the object itself, or the object each entry of a record / list is. */
export function fieldHost(d: StructureDescription, addr: Addr): Addr | undefined {
  const n = nodeAt(d, addr);
  if (!n) return undefined;
  if (n.type === 'object') return addr;
  if ((n.type === 'record' || n.type === 'array') && n.of?.type === 'object') return [...addr, '*'];
  return undefined;
}

function edit(d: StructureDescription, fn: (draft: StructureDescription, root: FieldNode) => void): StructureDescription {
  const out = clone(d), root = rootNode(out);
  fn(out, root);
  out.fields = root.fields ?? {};
  return out;
}
function parentOf(root: FieldNode, addr: Addr): FieldNode | undefined {
  let cur: FieldNode | undefined = root;
  for (const seg of addr.slice(0, -1)) cur = seg === '*' ? cur?.of : cur?.fields?.[seg];
  return cur;
}
function at(root: FieldNode, addr: Addr): FieldNode | undefined {
  let cur: FieldNode | undefined = root;
  for (const seg of addr) cur = seg === '*' ? cur?.of : cur?.fields?.[seg];
  return cur;
}

/** Properties that only make sense for some types (dropped when the type changes). */
const BY_TYPE: Record<string, FieldType[]> = {
  fields: ['object'], sections: ['object'], of: ['record', 'array'], entity: ['record'], keys: ['record'], uniqueBy: ['record'], list: ['record', 'array'],
  stamp: ['array'], values: ['enum', 'ladder'], to: ['ref', 'refs'], onDelete: ['ref', 'refs'], min: ['int', 'number'], max: ['int', 'number'],
  maxDelta: ['int', 'number'], computed: ['int', 'number'], variants: ['oneOf'], create: ['record'], reveal: ['record'],
};
export function update(d: StructureDescription, addr: Addr, patch: Partial<FieldNode>): StructureDescription {
  return edit(d, (_, root) => {
    const n = at(root, addr); if (!n) return;
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete (n as any)[k]; else (n as any)[k] = v; }
  });
}
/** Change the type; returns the properties that had to go. */
export function retype(d: StructureDescription, addr: Addr, type: FieldType): { next: StructureDescription; dropped: string[] } {
  const dropped: string[] = [];
  const next = edit(d, (_, root) => {
    const n = at(root, addr); if (!n) return;
    n.type = type;
    for (const [prop, types] of Object.entries(BY_TYPE)) if (prop in n && !types.includes(type)) { dropped.push(prop); delete (n as any)[prop]; }
    if ('default' in n) { dropped.push('default'); delete n.default; }
    if (type === 'object' && !n.fields) n.fields = {};
    if ((type === 'record' || type === 'array') && !n.of) n.of = { type: 'string' };
    if ((type === 'enum' || type === 'ladder') && !n.values) n.values = ['选项一', '选项二'];
    if (type === 'oneOf' && !n.variants) n.variants = [{ type: 'string' }, { type: 'object', fields: { value: { type: 'number', label: '当前' }, max: { type: 'number', label: '上限' } } }];
  });
  return { next, dropped };
}

/** Rewrite a path pattern wherever display, guides and projection mention it (whole path segments only). */
function rewritePaths(value: unknown, from: string, to: string | undefined): unknown {
  if (typeof value === 'string') {
    if (value === from || value.startsWith(from + '.')) return to === undefined ? value : to + value.slice(from.length);
    // Inside expressions (guides' when): @x.from…, from.… as a whole segment.
    const re = new RegExp(`(^|[^A-Za-z0-9_.])${from.replace(/[.*]/gu, m => '\\' + m)}(?=$|[^A-Za-z0-9_])`, 'gu');
    return to === undefined ? value : value.replace(re, (_, pre: string) => pre + to);
  }
  if (Array.isArray(value)) return value.map(v => rewritePaths(v, from, to));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewritePaths(v, from, to)]));
  return value;
}
/** Apply fn to every data object at the parent of addr (`*` = every entry). */
function eachParent(data: any, addr: Addr, fn: (obj: any, key: string) => void): void {
  if (!addr.length || data === null || typeof data !== 'object') return;
  const [seg, ...rest] = addr;
  if (!rest.length) { if (seg !== '*' && Object.hasOwn(data, seg!)) fn(data, seg!); return; }
  if (seg === '*') { for (const v of Object.values(data)) eachParent(v, rest, fn); return; }
  eachParent(data[seg!], rest, fn);
}
function renameKey<T extends Record<string, unknown>>(obj: T, from: string, to: string): T {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v])) as T;
}
export function rename(d: StructureDescription, addr: Addr, key: string): StructureDescription {
  const old = addr.at(-1)!;
  if (old === key || old === '*') return d;
  const out = edit(d, (draft, root) => {
    const parent = parentOf(root, addr);
    if (parent?.fields) parent.fields = renameKey(parent.fields, old, key);
    const from = addrKey(addr), to = addrKey([...addr.slice(0, -1), key]);
    if (draft.display) draft.display = rewritePaths(draft.display, from, to) as any;
    if (draft.guides) draft.guides = rewritePaths(draft.guides, from, to) as any;
    if (draft.projection) draft.projection = rewritePaths(draft.projection, from, to) as any;
    if (draft.initialData) eachParent(draft.initialData, addr, (obj, k) => { const v = obj[k]; delete obj[k]; obj[key] = v; });
    for (const m of Object.values(draft.modules ?? {})) if (m.guide) m.guide = rewritePaths(m.guide, from, to) as string;
  });
  // Keep the key order of the data object too.
  return out;
}
export function remove(d: StructureDescription, addr: Addr): StructureDescription {
  return edit(d, (draft, root) => {
    const parent = parentOf(root, addr), key = addr.at(-1)!;
    if (parent?.fields) delete parent.fields[key];
    if (draft.initialData) eachParent(draft.initialData, addr, (obj, k) => { delete obj[k]; });
  });
}
export function addField(d: StructureDescription, host: Addr, key: string, node: FieldNode): StructureDescription {
  return edit(d, (_, root) => { const h = at(root, host); if (h) h.fields = { ...(h.fields ?? {}), [key]: node }; });
}
export function reorder(d: StructureDescription, host: Addr, from: string, to: string): StructureDescription {
  return edit(d, (_, root) => {
    const h = at(root, host); if (!h?.fields) return;
    const keys = Object.keys(h.fields), i = keys.indexOf(from), j = keys.indexOf(to);
    if (i < 0 || j < 0) return;
    keys.splice(j, 0, ...keys.splice(i, 1));
    h.fields = Object.fromEntries(keys.map(k => [k, h.fields![k]!]));
  });
}
export function freeKey(fields: Record<string, unknown> | undefined, base: string): string {
  let k = base, i = 2;
  while (fields && Object.hasOwn(fields, k)) k = `${base}${i++}`;
  return k;
}
export function duplicate(d: StructureDescription, addr: Addr): { next: StructureDescription; key: string } {
  const parent = nodeAt(d, addr.slice(0, -1)), node = nodeAt(d, addr), key = freeKey(parent?.fields, addr.at(-1)! + '_copy');
  if (!parent?.fields || !node) return { next: d, key: addr.at(-1)! };
  const copy = clone(node); if (copy.label) copy.label += '（副本）';
  return { next: edit(d, (_, root) => {
    const p = at(root, addr.slice(0, -1))!, keys = Object.keys(p.fields!), i = keys.indexOf(addr.at(-1)!);
    keys.splice(i + 1, 0, key);
    p.fields = Object.fromEntries(keys.map(k => [k, k === key ? copy : p.fields![k]!]));
  }), key };
}
export function moveTo(d: StructureDescription, addr: Addr, host: Addr): { next: StructureDescription; addr: Addr } {
  const node = nodeAt(d, addr), target = nodeAt(d, host);
  if (!node || !target?.fields) return { next: d, addr };
  const key = freeKey(target.fields, addr.at(-1)!);
  const next = addField(remove(d, addr), host, key, clone(node));
  return { next, addr: [...host, key] };
}

/** Every object a field can be moved into (not into itself or its own children). */
export function hosts(d: StructureDescription, except?: Addr): { addr: Addr; label: string }[] {
  const out: { addr: Addr; label: string }[] = [{ addr: [], label: '（根）' }];
  const walk = (node: FieldNode, addr: Addr, label: string) => {
    for (const [k, child] of childrenOf(node)) {
      const a = [...addr, k];
      if (except && addrKey(a).startsWith(addrKey(except)) && a.length >= except.length && addrKey(a.slice(0, except.length)) === addrKey(except)) continue;
      const name = label + (label ? ' › ' : '') + (k === '*' ? '每一项' : child.label || k);
      if (child.type === 'object') out.push({ addr: a, label: name });
      walk(child, a, name);
    }
  };
  walk(rootNode(d), [], '');
  return out;
}
/** Entity types declared by record collections. */
export function entityTypes(d: StructureDescription): string[] {
  const out = new Set<string>();
  const walk = (node: FieldNode) => { if (node.entity) out.add(node.entity); for (const [, c] of childrenOf(node)) walk(c); };
  walk(rootNode(d));
  return [...out];
}
/** How many times a path is mentioned outside the field tree (layout, guides, projection). */
export function mentions(d: StructureDescription, addr: Addr): string[] {
  const path = addrKey(addr), out: string[] = [];
  const scan = (value: unknown, where: string) => { const t = JSON.stringify(value ?? null); if (t.includes(`"${path}"`) || t.includes(`"${path}.`) || t.includes(path + ' ') || t.includes('@' + path)) out.push(where); };
  scan(d.display, '状态栏布局'); scan(d.guides, '条件指南'); scan(d.projection, '投影规则');
  return out;
}
export function fieldCount(node: FieldNode): number { return childrenOf(node).reduce((n, [, c]) => n + 1 + fieldCount(c), 0); }

/** Undo / redo history of whole descriptions. */
export interface History { past: StructureDescription[]; present: StructureDescription; future: StructureDescription[] }
export const history = (d: StructureDescription): History => ({ past: [], present: d, future: [] });
export function commit(h: History, next: StructureDescription): History {
  if (next === h.present) return h;
  return { past: [...h.past.slice(-99), h.present], present: next, future: [] };
}
export const undo = (h: History): History => h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h;
export const redo = (h: History): History => h.future.length ? { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) } : h;

/** Changes between two descriptions, by field path; a key rename (same parent, same type) is reported as one. */
export function diffFields(a: StructureDescription, b: StructureDescription): { added: string[]; removed: string[]; changed: string[]; renamed: [string, string][] } {
  const flat = (d: StructureDescription) => {
    const out = new Map<string, { own: string; type: string; whole: string }>();
    const walk = (node: FieldNode, addr: Addr) => {
      for (const [k, c] of childrenOf(node)) {
        const at = [...addr, k], { fields: _f, of: _o, ...own } = c;
        out.set(addrKey(at), { own: JSON.stringify(own), type: c.type, whole: JSON.stringify({ ...c, label: undefined }) }); walk(c, at);
      }
    };
    walk(rootNode(d), []); return out;
  };
  const fa = flat(a), fb = flat(b);
  let added = [...fb.keys()].filter(k => !fa.has(k)), removed = [...fa.keys()].filter(k => !fb.has(k));
  const renamed: [string, string][] = [];
  const parent = (p: string) => p.split('.').slice(0, -1).join('.');
  for (const r of removed.filter(x => !removed.includes(parent(x)))) {
    const match = added.find(x => !added.includes(parent(x)) && parent(x) === parent(r) && fb.get(x)!.type === fa.get(r)!.type && (fb.get(x)!.whole === fa.get(r)!.whole || !renamed.some(([, y]) => y === x)));
    if (match && !renamed.some(([, y]) => y === match)) renamed.push([r, match]);
  }
  const under = (p: string, roots: string[]) => roots.some(r => p === r || p.startsWith(r + '.'));
  added = added.filter(x => !under(x, renamed.map(([, y]) => y)));
  removed = removed.filter(x => !under(x, renamed.map(([y]) => y)));
  return { added, removed, changed: [...fb.keys()].filter(k => fa.has(k) && fa.get(k)!.own !== fb.get(k)!.own), renamed };
}
/** A minimal description to start from scratch. */
export function blankStructure(): StructureDescription {
  return {
    id: 'my-structure', version: '1.0.0', label: '我的结构',
    fields: { meta: { type: 'object', label: '当前状态', fields: { round: { type: 'int', label: '轮次', readonly: true }, location: { type: 'string', label: '地点' } } } },
    round: 'meta.round',
    display: { bar: ['meta.location'], layout: [] } as any,
  };
}
/** Replace a node wholesale (JSON editing); keeps its place among its siblings. */
export function replaceNode(d: StructureDescription, addr: Addr, node: FieldNode): StructureDescription {
  return edit(d, (_, root) => {
    const parent = parentOf(root, addr), key = addr.at(-1)!;
    if (!parent) return;
    if (key === '*') parent.of = node; else if (parent.fields) parent.fields = Object.fromEntries(Object.entries(parent.fields).map(([k, v]) => [k, k === key ? node : v]));
  });
}

/** Inserts (or re-inserts) a field at a position among its siblings. */
export function insertAt(d: StructureDescription, host: Addr, key: string, node: FieldNode, index?: number): StructureDescription {
  return edit(d, (_, root) => {
    const h = at(root, host); if (!h) return;
    const entries = Object.entries(h.fields ?? {}).filter(([k]) => k !== key);
    entries.splice(index === undefined ? entries.length : Math.max(0, Math.min(index, entries.length)), 0, [key, node]);
    h.fields = Object.fromEntries(entries);
  });
}
/** a is b or inside b. */
export const within = (a: Addr, b: Addr) => a.length >= b.length && b.every((s, i) => a[i] === s);
/** Moves a field to a host object at a position (same host = reorder). index counts siblings before the move. */
export function relocate(d: StructureDescription, addr: Addr, host: Addr, index?: number): { next: StructureDescription; addr: Addr } {
  const node = nodeAt(d, addr), target = nodeAt(d, host), key = addr.at(-1)!;
  if (!node || !target || key === '*' || target.type !== 'object' || within(host, addr)) return { next: d, addr };
  if (addrKey(host) === addrKey(addr.slice(0, -1))) {
    const keys = Object.keys(target.fields ?? {}), from = keys.indexOf(key);
    const i = index === undefined ? keys.length - 1 : from < index ? index - 1 : index;
    return { next: i === from ? d : insertAt(d, host, key, node, i), addr };
  }
  const k = freeKey(target.fields, key);
  return { next: insertAt(remove(d, addr), host, k, clone(node), index), addr: [...host, k] };
}
