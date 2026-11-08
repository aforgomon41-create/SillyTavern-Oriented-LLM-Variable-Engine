import type { ZodType } from 'zod';
import { assertJson, canonical, clone, fail, safeKey } from './json.js';
import { compose } from './authoring.js';
import { copyGuideRules, sameGuideRule } from './guides.js';
import type { AuthorPart, DefinitionFragment } from './authoring.js';
import type { Definition, EntitySpec, GuideRule, ModuleSpec, NumericRule, RefSpec } from './types.js';

export const preparedAuthoring = Symbol.for('SOLVE.prepared-authoring.v1');
const metadataKey = 'solveInlineV1';
export interface InlineFieldOptions {
  module?: string;
  guide?: string | Omit<GuideRule, 'id' | 'module'> & { id?: string };
  readonly?: boolean;
  internal?: boolean;
  numeric?: NumericRule;
  source?: string;
}
interface InlineMeta extends InlineFieldOptions { entity?: Omit<EntitySpec, 'path'>; ref?: Omit<RefSpec, 'path'> }
export interface InlineNode { schema: ZodType; path: string; metadata: Readonly<Record<string, unknown>>; inline: Readonly<InlineMeta> }
export interface InlineCollection { parts: AuthorPart[]; memberships: { path: string; module: string; source: string }[]; nodes: InlineNode[] }

export function freezeAuthorValue<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freezeAuthorValue(item); Object.freeze(value); }
  return value;
}
function copyMeta(value: InlineMeta): InlineMeta {
  const { guide, ...json } = value; assertJson(json);
  const fixed: InlineMeta = clone(json) as InlineMeta;
  if (guide !== undefined) {
    if (typeof guide === 'string') fixed.guide = guide;
    else {
      if (!guide || typeof guide !== 'object' || Array.isArray(guide) || Object.keys(guide).some(key => !['id','text','when','source'].includes(key))) fail('INLINE_GUIDE', '字段指南需要文本或{id?,text,when?}');
      const normalized = copyGuideRules([{ ...guide, id: guide.id ?? 'inline' }])[0]!;
      const { id: _id, ...body } = normalized;
      fixed.guide = guide.id === undefined ? body : normalized;
    }
  }
  return freezeAuthorValue(fixed);
}
function equalAuthorValue(left: any, right: any): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left); return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalAuthorValue(left[key], right[key]));
}
function snapshotMetadata(value: any, seen = new Set<any>()): any {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) fail('AUTHOR_METADATA', '作者元信息不能循环引用');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== null && Object.getPrototypeOf(prototype) !== null) fail('AUTHOR_METADATA', '作者元信息需要普通对象、数组或函数');
  const next = new Set(seen); next.add(value);
  const result: any = Array.isArray(value) ? [] : {};
  for (const [key, child] of Object.entries(value)) { safeKey(key); result[key] = snapshotMetadata(child, next); }
  return freezeAuthorValue(result);
}
/** Copy the schema graph without evaluating default-value getters or executable checks. */
export function snapshotAuthorSchema<S extends ZodType>(schema: S): S {
  function copy(current: any, ancestors: Set<any>): any {
    if (!current?._zod) return current;
    if (ancestors.has(current) || ancestors.size > 128) fail('SCHEMA_CYCLE', '作者结构不能递归或无限嵌套');
    const next = new Set(ancestors); next.add(current);
    const d = current._zod.def, descriptors = Object.getOwnPropertyDescriptors(d);
    const set = (key: string, value: unknown) => { descriptors[key] = { value, writable: true, configurable: true, enumerable: true }; };
    if (d.type === 'object') set('shape', Object.fromEntries(Object.entries(current.shape).map(([key, child]) => [key, copy(child, next)])));
    for (const key of ['innerType','in','out','left','right','element','keyType','valueType','rest']) if (d[key]) set(key, copy(d[key], next));
    for (const key of ['options','items']) if (Array.isArray(d[key])) set(key, d[key].map((child: any) => copy(child, next)));
    if (d.type === 'lazy') { const inner = copy(d.getter(), next); set('getter', () => inner); }
    if (d.checks) set('checks', [...d.checks]);
    const cloned = current.clone(Object.defineProperties({}, descriptors)), metadata = current.meta?.();
    return metadata ? cloned.meta(snapshotMetadata(metadata)) : cloned;
  }
  return copy(schema, new Set());
}
function mergeMeta(left: InlineMeta, right: InlineMeta, source: string): InlineMeta {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (Object.hasOwn(result, key)) {
      const old = (result as any)[key];
      const same = key === 'guide' && typeof old === 'object' && typeof value === 'object'
        ? sameGuideRule({ id: 'inline', ...old }, { id: 'inline', ...value }) : canonical(old) === canonical(value);
      if (!same) fail('INLINE_CONFLICT', `${source}：内联声明冲突：${key}`, source);
    }
    (result as any)[key] = value;
  }
  return result;
}
function annotate<S extends ZodType>(schema: S, options: InlineMeta): S {
  if (!schema || typeof (schema as any).meta !== 'function') fail('INLINE_SCHEMA', '内联注解需要Zod schema');
  if (Object.keys(options).some(key => !['module','guide','readonly','internal','numeric','source','entity','ref'].includes(key))) fail('INLINE_OPTIONS', '内联注解包含未知选项');
  if (options.module !== undefined) { if (typeof options.module !== 'string' || !options.module) fail('INLINE_MODULE', 'module必须是非空名称'); safeKey(options.module); }
  if (options.source !== undefined && typeof options.source !== 'string') fail('INLINE_OPTIONS', 'source必须是文本');
  for (const key of ['readonly','internal'] as const) if (options[key] !== undefined && typeof options[key] !== 'boolean') fail('INLINE_OPTIONS', key + '必须是boolean');
  const previous = (schema as any).meta() ?? {};
  return (schema as any).meta({ ...previous, [metadataKey]: copyMeta(mergeMeta(previous[metadataKey] ?? {}, options, options.source ?? '字段注解')) });
}
/** Local helpers return new Zod nodes. They never patch Zod prototypes or the original schema. */
export function author() {
  return Object.freeze({
    field<S extends ZodType>(schema: S, options: InlineFieldOptions): S { return annotate(schema, options); },
    singleton<S extends ZodType>(schema: S, options: { id: string; type: string; nullable?: boolean }): S {
      return annotate(schema, { entity: { singletonId: options.id, type: options.type, ...(options.nullable !== undefined ? { nullable: options.nullable } : {}) } });
    },
    collection<S extends ZodType>(schema: S, options: { type: string }): S { return annotate(schema, { entity: { type: options.type } }); },
    ref<S extends ZodType>(schema: S, options: Omit<RefSpec, 'path'>): S { return annotate(schema, { ref: options }); },
    useEntities(entities: EntitySpec[]): DefinitionFragment { return { entities: clone(entities) }; },
    useRefs(refs: RefSpec[]): DefinitionFragment { return { refs: clone(refs) }; },
    useModules(modules: Record<string, Omit<ModuleSpec, 'paths'> & { paths?: string[] }>): DefinitionFragment {
      return { modules: Object.fromEntries(Object.entries(modules).map(([name, value]) => [name, { ...clone(value), paths: [...value.paths ?? []] }])) };
    },
    useGuides(guides: GuideRule[]): DefinitionFragment { return { guides: guides.map(rule => ({ ...rule })) }; },
    useInitial(initialData: Definition['initialData']): DefinitionFragment { assertJson(initialData); return { initialData: clone(initialData) }; },
    usePresets(presets: Pick<DefinitionFragment, 'templates' | 'prefabs'>): DefinitionFragment { return clone(presets); },
    useVisibility(visibility: Pick<DefinitionFragment, 'readonly' | 'internal'>): DefinitionFragment { return clone(visibility); },
    useViews(views: NonNullable<Definition['views']>): DefinitionFragment { return { views: { ...views } }; },
    compose,
  });
}

export function collectInline(schema: ZodType, collectNodes = true): InlineCollection {
  const parts: AuthorPart[] = [], memberships: InlineCollection['memberships'] = [], nodes: InlineNode[] = [];
  function walk(outer: any, path: string[], ancestors: Set<any>): void {
    if (!outer?._zod) return;
    if (ancestors.has(outer) || ancestors.size > 128) fail('SCHEMA_CYCLE', '内联结构不能递归或无限嵌套', path.join('.'));
    const seen = new Set(ancestors); seen.add(outer);
    let current = outer, inline: InlineMeta = {}, metadata: Record<string, unknown> = {};
    const outputs: any[] = [];
    for (let depth = 0; ; depth++) {
      if (depth > 32) fail('SCHEMA_DEPTH', '内联包装过深', path.join('.'));
      const meta = current.meta?.() ?? {}; metadata = { ...meta, ...metadata };
      inline = mergeMeta(inline, meta[metadataKey] ?? {}, path.join('.') || '根结构');
      const d = current._zod.def;
      if (d.innerType) current = d.innerType;
      else if (d.type === 'pipe') { outputs.push(d.out); current = d.in; }
      else if (d.type === 'lazy') current = d.getter();
      else break;
      if (seen.has(current)) fail('SCHEMA_CYCLE', '内联结构不能递归', path.join('.')); seen.add(current);
    }
    const d = current._zod.def, name = path.join('.'), source = inline.source ?? 'schema:' + (name || '<root>');
    if (!name && (inline.module || inline.readonly || inline.internal || inline.numeric)) fail('INLINE_ROOT', source + '：模块、可见性和数值注解需要具体字段路径', source);
    const contribution: DefinitionFragment = {};
    if (inline.entity) {
      if (!name || (inline.entity.singletonId ? d.type !== 'object' || path.includes('*') : d.type !== 'record')) fail('INLINE_ENTITY', source + '：单例需要固定对象路径，集合需要Record', source);
      contribution.entities = [{ path: name, ...inline.entity }];
    }
    if (inline.ref) {
      if (!name || (inline.ref.kind === 'single' ? d.type !== 'string' : inline.ref.kind === 'array' ? d.type !== 'array' : d.type !== 'record')) fail('INLINE_REF', source + '：引用类型与字段结构不一致', source);
      contribution.refs = [{ path: name, ...inline.ref }];
    }
    if (inline.module) memberships.push({ path: name, module: inline.module, source });
    if (inline.readonly) contribution.readonly = [name];
    if (inline.internal) contribution.internal = [name];
    if (inline.numeric) contribution.numeric = { [name]: clone(inline.numeric) };
    if (inline.guide !== undefined) {
      const rule = typeof inline.guide === 'string' ? { text: inline.guide } : inline.guide;
      contribution.guides = [{ ...rule, id: rule.id ?? 'inline-guide:' + (name || '<root>'), text: `${name || '<root>'}：${rule.text}`,
        ...(inline.module ? { module: inline.module } : {}), source }];
    }
    if (Object.keys(contribution).length) parts.push({ source, definition: contribution });
    if (collectNodes) nodes.push(Object.freeze({ schema: current.clone(), path: name, metadata: snapshotMetadata(metadata), inline: copyMeta(inline) }));
    if (d.type === 'object') for (const [key, child] of Object.entries(current.shape)) { safeKey(key); walk(child, [...path, key], seen); }
    else if (d.type === 'record') walk(d.valueType, [...path, '*'], seen);
    else if (d.type === 'array') walk(d.element, [...path, '*'], seen);
    else if (d.type === 'tuple') {
      d.items.forEach((child: any, index: number) => walk(child, [...path, String(index)], seen));
      if (d.rest) {
        const before = parts.length, members = memberships.length;
        walk(d.rest, [...path, '*'], seen);
        if (parts.length !== before || memberships.length !== members) fail('INLINE_TUPLE_REST', source + '：可变长Tuple尾部注解请使用明确分离路径，避免影响固定前缀', source);
      }
    }
    else if (d.type === 'intersection') { walk(d.left, path, seen); walk(d.right, path, seen); }
    else if (d.options) {
      let signature: unknown;
      for (const branch of d.options) {
        const partStart = parts.length, memberStart = memberships.length;
        walk(branch, path, seen);
        const current = { parts: parts.slice(partStart), memberships: memberships.slice(memberStart) };
        if (signature !== undefined && !equalAuthorValue(signature, current)) fail('INLINE_UNION', source + '：联合分支的内联规则不一致，请在共同外层或分离配置中声明', source);
        if (signature === undefined) signature = current;
        else { parts.splice(partStart); memberships.splice(memberStart); }
      }
    }
    for (const output of outputs) walk(output, path, seen);
  }
  walk(schema, [], new Set()); return { parts, memberships, nodes };
}
export function hasInline(schema: ZodType): boolean { const found = collectInline(schema, false); return Boolean(found.parts.length || found.memberships.length); }
export function isAuthorPrepared(value: Definition): boolean { return Boolean((value as any)[preparedAuthoring]); }
export function markAuthorPrepared<T extends Definition>(value: T): T { (value as any)[preparedAuthoring] = true; return value; }
