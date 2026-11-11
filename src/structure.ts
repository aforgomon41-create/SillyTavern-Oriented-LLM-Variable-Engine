import { z } from 'zod';
import { assertJson, clone, fail, safeKey } from './json.js';
import { EntityGraph } from './entities.js';
import { checkActions, checkCond, checkCreate, checkEdit, type ActionSpec, type Cond, type CreateSpec, type EditSpec } from './interact.js';
import type { BgmSpec, CompiledDefinition, ComputedRule, Definition, DisplaySpec, EntitySpec, GuideRule, Json, ListLimit, ModuleSpec, NumericRule, ProjectionRule, RefSpec, StampRule } from './types.js';

/**
 * Declarative, JSON-serialisable structure description. It is the "standard" that the
 * status bar renders and the structure editor edits; it compiles to an ordinary Definition.
 */
export type FieldType = 'object' | 'record' | 'array' | 'string' | 'int' | 'number' | 'bool' | 'enum' | 'ladder' | 'ref' | 'refs' | 'oneOf';
export type SpoilerLevel = 'public' | 'spoiler' | 'hidden';
export interface FieldNode {
  type: FieldType;
  label?: string;
  desc?: string;
  /** object */
  fields?: Record<string, FieldNode>;
  /** record value / array element */
  of?: FieldNode;
  /** oneOf: the accepted forms, e.g. a number gauge or a natural-language description */
  variants?: FieldNode[];
  /** record: entity collection of this type */
  entity?: string;
  /** record: keys are references to entities of this type (removed when the target is deleted) */
  keys?: string;
  /** record with `keys`: a target whose field of this name is true can sit under one such record only (e.g. a unique item has one holder) */
  uniqueBy?: string;
  /** enum / ladder: allowed values (ladder is ordered, low → high) */
  values?: string[];
  /** ref / refs: entity type of the target */
  to?: string | string[];
  onDelete?: RefSpec['onDelete'];
  min?: number;
  max?: number;
  maxDelta?: number;
  required?: boolean;
  optional?: boolean;
  nullable?: boolean;
  default?: Json;
  /** Module(s) this field belongs to; with several, all must be on. */
  module?: string | string[];
  list?: ListLimit;
  computed?: ComputedRule[];
  /** array of `{round, text}` entries; the engine fills `round` */
  stamp?: boolean;
  spoiler?: SpoilerLevel;
  /** record with a spoiler level: entries matching this condition are public anyway (e.g. equipped items can be seen). Conditions as in src/interact.ts. */
  reveal?: Cond;
  /** widget override from the fixed renderer list */
  as?: string;
  /** object: presentation-only grouping of the children, e.g. WOD 身体 / 心智 / 社交 (every key at most once) */
  sections?: { label: string; keys: string[] }[];
  readonly?: boolean;
  internal?: boolean;
  /** The player may change this value from the status bar (see src/interact.ts). */
  edit?: true | EditSpec;
  /** Buttons on each entry (record / array) or on this object (see src/interact.ts). */
  actions?: Record<string, ActionSpec>;
  /** record of objects: a form to add an entry from the status bar (see src/interact.ts). */
  create?: CreateSpec;
}
export interface StructureModule { label?: string; enabled?: boolean; parent?: string; exclusive?: string; guide?: string }
export interface StructureDescription {
  id: string;
  version: string;
  label?: string;
  fields: Record<string, FieldNode>;
  modules?: Record<string, StructureModule>;
  groups?: Record<string, { label?: string; migrate?: boolean }>;
  round?: string;
  projection?: ProjectionRule[];
  guide?: string;
  guides?: (Omit<GuideRule, 'when'> & { when?: string })[];
  initialData?: Json;
  /** Ready-made entities: a prefab appears once under its own ID; a template is a base for any number of new entities. */
  prefabs?: Definition['prefabs'];
  templates?: Definition['templates'];
  /** Presentation only: layout, render switch, spoiler exemptions, etc. */
  display?: Omit<DisplaySpec, 'labels' | 'spoiler' | 'as' | 'fields'>;
  bgm?: BgmSpec;
}

const TYPES = new Set<FieldType>(['object', 'record', 'array', 'string', 'int', 'number', 'bool', 'enum', 'ladder', 'ref', 'refs', 'oneOf']);
const SPOILERS = new Set(['public', 'spoiler', 'hidden']);

interface Collected {
  entities: EntitySpec[];
  refs: RefSpec[];
  typedRefs: { path: string; kind: RefSpec['kind']; to: string[] }[];
  uniqueHolds: { path: string; flag: string }[];
  modulePaths: Record<string, string[]>;
  numeric: Record<string, NumericRule>;
  lists: Record<string, ListLimit & { label?: string }>;
  computed: Record<string, ComputedRule>;
  stamps: Record<string, StampRule>;
  readonly: string[];
  internal: string[];
  labels: Record<string, string>;
  spoiler: Record<string, SpoilerLevel>;
  as: Record<string, string>;
  fields: Record<string, Json>;
}

function problem(path: string, message: string): never { return fail('STRUCTURE_INVALID', `${path || '(根)'}：${message}`, path); }

function build(node: FieldNode, path: string[], out: Collected, modules: Set<string>, inModule: boolean): { schema: z.ZodType; hasDefault: boolean } {
  const at = path.join('.');
  if (!node || typeof node !== 'object' || !TYPES.has(node.type)) problem(at, '未知字段类型');
  const known = ['type','label','desc','fields','of','variants','entity','keys','uniqueBy','sections','values','to','onDelete','min','max','maxDelta','required','optional','nullable','default','module','list','computed','stamp','spoiler','as','readonly','internal','edit','actions','reveal','create'];
  const extra = Object.keys(node).filter(key => !known.includes(key));
  if (extra.length) problem(at, `未知属性：${extra.join(', ')}`);
  if (node.module !== undefined) {
    // Several modules: the field is active only while all of them are on (e.g. 状态 and the 数值 / 描述 mode).
    const names = Array.isArray(node.module) ? node.module : [node.module];
    if (!names.length) problem(at, 'module 不能为空数组');
    for (const name of names) {
      if (!modules.has(name)) problem(at, `未声明的模块：${name}`);
      (out.modulePaths[name] ??= []).push(at);
    }
    if (!path.length || path.at(-1) === '*') problem(at, '模块只能挂在具名字段上');
  }
  const moduled = inModule || node.module !== undefined;
  if (node.label !== undefined) out.labels[at] = node.label;
  if (node.spoiler !== undefined) { if (!SPOILERS.has(node.spoiler)) problem(at, '剧透等级只能是 public/spoiler/hidden'); out.spoiler[at] = node.spoiler; }
  if (node.as !== undefined) out.as[at] = node.as;
  if (node.readonly) out.readonly.push(at);
  if (node.internal) out.internal.push(at);
  const meta: Record<string, Json> = { type: node.type };
  if (node.desc !== undefined) meta.desc = node.desc;
  if (node.values) meta.values = [...node.values];
  if (node.min !== undefined) meta.min = node.min;
  if (node.max !== undefined) meta.max = node.max;
  if (node.to !== undefined) meta.to = clone(node.to) as Json;
  if (node.entity !== undefined) meta.entity = node.entity;
  if (node.keys !== undefined) meta.keys = node.keys;
  if (node.stamp) meta.stamp = true;
  if (node.sections !== undefined) {
    if (node.type !== 'object' || !Array.isArray(node.sections)) problem(at, 'sections 只能用于 object');
    const seen = new Set<string>();
    for (const s of node.sections) {
      if (!s || typeof s.label !== 'string' || !Array.isArray(s.keys)) problem(at, 'sections 每项需要 label 与 keys');
      for (const k of s.keys) { if (!node.fields?.[k] || seen.has(k)) problem(at, `sections 中的 ${k} 不存在或重复`); seen.add(k); }
    }
    meta.sections = clone(node.sections) as unknown as Json;
  }
  if (node.create !== undefined) {
    if (node.type !== 'record' || node.of?.type !== 'object') problem(at, 'create 只能用于值为对象的 record');
    meta.create = clone(checkCreate(at, node.create, node.of!.fields as Record<string, { type: string }>)) as unknown as Json;
  }
  if (node.reveal !== undefined) {
    if (node.type !== 'record' || !node.spoiler) problem(at, 'reveal 只能用于带剧透等级的 record');
    checkCond(at, node.reveal);
    meta.reveal = clone(node.reveal) as unknown as Json;
  }
  if (node.edit !== undefined) {
    if (['object', 'record', 'oneOf'].includes(node.type)) problem(at, 'edit 只能用于单个值（文字、数字、开关、枚举、引用、列表）');
    meta.edit = clone(checkEdit(at, node.edit, node.type)) as unknown as Json;
  }
  if (node.actions !== undefined) {
    if (!['object', 'record', 'array'].includes(node.type)) problem(at, 'actions 只能用于 object / record / array');
    meta.actions = clone(checkActions(at, node.actions)) as unknown as Json;
  }
  if (path.length) out.fields[at] = meta;

  let schema: z.ZodType, hasDefault = false, fallback: Json | undefined;
  switch (node.type) {
    case 'object': {
      if (!node.fields || typeof node.fields !== 'object') problem(at, 'object 需要 fields');
      const shape: Record<string, z.ZodType> = {};
      let all = true;
      for (const [key, child] of Object.entries(node.fields)) {
        safeKey(key);
        if (!key || key.includes('.') || key.includes('@') || key === '*') problem(at, `字段名不合法：${key}`);
        const built = build(child, [...path, key], out, modules, moduled);
        shape[key] = built.schema;
        if (!built.hasDefault) all = false;
      }
      schema = z.object(shape);
      if (all) fallback = {};
      break;
    }
    case 'record': {
      if (!node.of) problem(at, 'record 需要 of');
      if (node.entity !== undefined) out.entities.push({ path: at, type: node.entity });
      if (node.keys !== undefined) { out.refs.push({ path: at, kind: 'record-key', onDelete: 'unset' }); out.typedRefs.push({ path: at, kind: 'record-key', to: [node.keys] }); }
      if (node.uniqueBy !== undefined) {
        if (node.keys === undefined) problem(at, 'uniqueBy 只能用于带 keys 的字典');
        safeKey(node.uniqueBy); out.uniqueHolds.push({ path: at, flag: node.uniqueBy });
      }
      schema = z.record(z.string(), build(node.of, [...path, '*'], out, modules, moduled).schema);
      fallback = {};
      break;
    }
    case 'array': {
      if (node.stamp) {
        if (node.of) problem(at, 'stamp 数组的元素固定为 {round, text}');
        out.stamps[at] = { field: 'round', text: 'text' };
        schema = z.array(z.object({ round: z.number().int().min(0), text: z.string() }));
      } else {
        if (!node.of) problem(at, 'array 需要 of');
        schema = z.array(build(node.of, [...path, '*'], out, modules, moduled).schema);
      }
      fallback = [];
      break;
    }
    case 'oneOf': {
      // Each variant lives at the same path; nested fields (e.g. value/max) are collected as usual.
      if (!Array.isArray(node.variants) || node.variants.length < 2) problem(at, 'oneOf 需要至少两个 variants');
      const kinds = new Set<string>();
      const built = node.variants.map((variant, i) => {
        if (!variant || ['oneOf', 'ref', 'refs'].includes(variant.type)) problem(at, `oneOf 的第 ${i + 1} 种形式不支持 ${variant?.type}`);
        const kind = ['int', 'number'].includes(variant.type) ? 'number' : ['enum', 'ladder'].includes(variant.type) ? 'string' : variant.type === 'record' ? 'object' : variant.type;
        if (kinds.has(kind)) problem(at, 'oneOf 的各种形式必须是不同的 JSON 类型（数字 / 文字 / 对象 / 数组 / 布尔）');
        kinds.add(kind);
        return build({ ...variant, label: variant.label ?? node.label }, path, out, modules, moduled).schema;
      });
      schema = z.union(built as [z.ZodType, z.ZodType, ...z.ZodType[]]);
      meta.variants = node.variants.map(v => v.type);
      if (path.length) out.fields[at] = meta;
      if (node.label !== undefined) out.labels[at] = node.label;
      fallback = undefined;
      break;
    }
    case 'string': schema = z.string(); fallback = ''; break;
    case 'bool': schema = z.boolean(); fallback = false; break;
    case 'int': case 'number': {
      let n = z.number();
      if (node.type === 'int') n = n.int();
      if (node.min !== undefined) n = n.min(node.min);
      if (node.max !== undefined) n = n.max(node.max);
      schema = n;
      fallback = Math.min(node.max ?? Infinity, Math.max(node.min ?? -Infinity, 0));
      if (node.maxDelta !== undefined) {
        if (!(node.maxDelta > 0)) problem(at, 'maxDelta 必须为正数');
        out.numeric[at] = { maxDelta: node.maxDelta };
      }
      for (const rule of node.computed ?? []) {
        if (out.computed[at]) problem(at, '同一字段只支持一个计算值');
        out.computed[at] = { label: rule.label, formula: rule.formula };
      }
      break;
    }
    case 'enum': case 'ladder': {
      if (!Array.isArray(node.values) || !node.values.length || node.values.some(v => typeof v !== 'string')) problem(at, `${node.type} 需要非空字符串 values`);
      schema = z.enum(node.values as [string, ...string[]]);
      fallback = node.values[0]!;
      break;
    }
    case 'ref': case 'refs': {
      const targets = node.to === undefined ? [] : Array.isArray(node.to) ? node.to : [node.to];
      if (!targets.length) problem(at, `${node.type} 需要 to（目标实体类型）`);
      if (node.type === 'ref') {
        const onDelete = node.onDelete ?? (node.nullable ? 'null' : node.optional ? 'unset' : 'restrict');
        out.refs.push({ path: at, kind: 'single', onDelete });
        out.typedRefs.push({ path: at, kind: 'single', to: targets });
        schema = z.string();
        fallback = undefined;
      } else {
        out.refs.push({ path: at, kind: 'array', onDelete: node.onDelete ?? 'remove' });
        out.typedRefs.push({ path: at, kind: 'array', to: targets });
        schema = z.array(z.string());
        fallback = [];
      }
      break;
    }
  }
  if (node.list) {
    if (!['array', 'record', 'refs'].includes(node.type) && !node.stamp) problem(at, '清单上限只能用于数组或字典');
    out.lists[at] = { max: node.list.max, warn: node.list.warn, ...(node.label ? { label: node.label } : {}) };
  }
  if (node.nullable) { schema = schema.nullable(); fallback = null; }
  // Zod 4 returns .default() values as-is; containers use .prefault() so nested defaults are filled.
  const withDefault = (value: Json) => value !== null && typeof value === 'object' ? schema.prefault(clone(value) as never) : schema.default(clone(value) as never);
  if (node.default !== undefined) { assertJson(node.default); return { schema: withDefault(node.default), hasDefault: true }; }
  if (node.optional) return { schema: schema.optional(), hasDefault: true };
  if (node.required || fallback === undefined) return { schema, hasDefault: false };
  // Fields inside an optional module still need defaults so enabling the module can hydrate them.
  void moduled;
  hasDefault = true;
  return { schema: withDefault(fallback), hasDefault };
}

/** Compile a structure description into a regular SOLVE Definition. */
export function compileStructure(description: StructureDescription): Definition {
  if (!description || typeof description !== 'object') fail('STRUCTURE_INVALID', '结构描述必须是对象');
  if (!description.id || !description.version) fail('STRUCTURE_INVALID', '结构描述需要 id 与 version');
  const modules = new Set(Object.keys(description.modules ?? {}));
  const out: Collected = { entities: [], refs: [], typedRefs: [], uniqueHolds: [], modulePaths: {}, numeric: {}, lists: {}, computed: {}, stamps: {}, readonly: [], internal: [], labels: {}, spoiler: {}, as: {}, fields: {} };
  const root = build({ type: 'object', fields: description.fields }, [], out, modules, false);
  const moduleSpecs: Record<string, ModuleSpec> = {};
  for (const [name, m] of Object.entries(description.modules ?? {})) {
    safeKey(name);
    const paths = out.modulePaths[name] ?? [];
    moduleSpecs[name] = { paths, ...(m.enabled !== undefined ? { enabled: m.enabled } : {}), ...(m.parent ? { parent: m.parent } : {}),
      ...(m.guide ? { guide: m.guide } : {}), ...(m.label ? { label: m.label } : {}), ...(m.exclusive ? { exclusive: m.exclusive } : {}) };
  }
  for (const [group, members] of Object.entries(groupMembers(moduleSpecs))) {
    if (members.filter(name => moduleSpecs[name]!.enabled !== false).length > 1) fail('STRUCTURE_INVALID', `互斥组 ${group} 初始只能开启一个成员`);
  }
  const typedRefs = out.typedRefs;
  const definition: Definition = {
    id: description.id, version: description.version,
    schema: root.schema,
    initialData: clone(description.initialData ?? {}),
    ...(out.entities.length ? { entities: out.entities } : {}),
    ...(out.refs.length ? { refs: out.refs } : {}),
    ...(Object.keys(moduleSpecs).length ? { modules: moduleSpecs } : {}),
    ...(Object.keys(out.numeric).length ? { numeric: out.numeric } : {}),
    ...(out.readonly.length ? { readonly: out.readonly } : {}),
    ...(out.internal.length ? { internal: out.internal } : {}),
    ...(description.guide ? { guide: description.guide } : {}),
    ...(description.guides?.length ? { guides: clone(description.guides) as GuideRule[] } : {}),
    ...(description.round ? { round: description.round } : {}),
    ...(Object.keys(out.stamps).length ? { stamps: out.stamps } : {}),
    ...(Object.keys(out.lists).length ? { lists: out.lists } : {}),
    ...(Object.keys(out.computed).length ? { computed: out.computed } : {}),
    ...(description.projection?.length ? { projection: clone(description.projection) } : {}),
    ...(description.groups ? { groups: clone(description.groups) } : {}),
    ...(description.bgm ? { bgm: clone(description.bgm) } : {}),
    ...(out.uniqueHolds.length ? { uniqueHolds: out.uniqueHolds } : {}),
    ...(description.prefabs && Object.keys(description.prefabs).length ? { prefabs: clone(description.prefabs) } : {}),
    ...(description.templates && Object.keys(description.templates).length ? { templates: clone(description.templates) } : {}),
    display: { ...(clone(description.display ?? {}) as DisplaySpec), labels: out.labels, spoiler: out.spoiler, as: out.as, fields: out.fields,
      ...(description.label ? { title: description.label } : {}) },
    runtimeBindings: { build: `structure:${description.id}@${description.version}`, dependencies: { typedRefs: typedRefs.length ? 'v1' : 'none' } },
    // References must point at entities of the declared type (entity IDs are global).
    ...(typedRefs.length ? { validateState: (state) => checkRefTypes(definition as CompiledDefinition, state as any, typedRefs) } : {}),
  };
  return definition;
}
function groupMembers(modules: Record<string, ModuleSpec>): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const [name, m] of Object.entries(modules)) if (m.exclusive) (groups[m.exclusive] ??= []).push(name);
  return groups;
}
function checkRefTypes(def: CompiledDefinition, state: Parameters<NonNullable<Definition['validateState']>>[0], typed: Collected['typedRefs']): void {
  const graph = new EntityGraph(def, state as any);
  for (const ref of graph.refs) {
    const rule = typed.find(t => t.kind === ref.spec.kind && t.path === ref.spec.path);
    if (!rule) continue;
    const type = graph.entities.get(ref.target)?.type;
    if (type && !rule.to.includes(type)) fail('REF_TARGET_TYPE', `引用 ${ref.target} 的类型是 ${type}，此处需要 ${rule.to.join('/')}`, ref.pointer);
  }
}
