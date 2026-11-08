import { z } from 'zod';
import { assertJson, canonical, clone, fail, hash, safeKey } from './json.js';
import { compilePrepared } from './schema.js';
import { collectInline, freezeAuthorValue, isAuthorPrepared, markAuthorPrepared, snapshotAuthorSchema } from './inline.js';
import type { InlineNode } from './inline.js';
import { copyFacets, sameFacet } from './facets.js';
import type { FacetRuntimeHooks } from './facets.js';
import type { ZodType } from 'zod';
import { parseWorldInfoEntry, worldInfoJson } from './world-info.js';
import type { ParsedWorldInfoEntry, WorldInfoEntry, WorldInfoRenderer } from './world-info.js';
import type { CompiledDefinition, Data, Definition, Json, RuntimeBinding } from './types.js';
import { copyGuideRules, describeGuideRules, sameGuideRule } from './guides.js';

/** Schema and executable binding identities stay in the base JS/TS definition. */
export type DefinitionFragment = Partial<Pick<Definition,
  'initialData' | 'entities' | 'refs' | 'modules' | 'numeric' | 'readonly' | 'internal' |
  'guide' | 'guides' | 'templates' | 'prefabs' | 'views' | 'validateState'>>;
export interface AuthorPart { source: string; definition: DefinitionFragment }
export interface AuthorSource { source: string; kind: 'base' | 'part' | 'world-info' | 'facet'; tag?: string; module?: string }
export interface SolveFacet extends RuntimeBinding {
  extendZod?: (schema: ZodType) => ZodType | Promise<ZodType>;
  collectInlineMeta?: (schema: ZodType, context: Readonly<Pick<InlineNode, 'path' | 'metadata'>>) => DefinitionFragment | undefined | Promise<DefinitionFragment | undefined>;
  registerDetached?: (source: Json) => DefinitionFragment | Promise<DefinitionFragment>;
  parseWorldInfo?: (entry: Readonly<ParsedWorldInfoEntry>) => DefinitionFragment | undefined | Promise<DefinitionFragment | undefined>;
  runtimeHooks?: FacetRuntimeHooks;
}
export interface AuthorOptions {
  parts?: AuthorPart[];
  worldInfo?: WorldInfoEntry[];
  renderWorldInfo?: WorldInfoRenderer;
  facets?: SolveFacet[];
  detached?: { source: string; facet: string; data: Json }[];
}
export interface SolveCompiledIR {
  irFormatVersion: '1';
  definition: { id: string; version: string; fingerprint: string };
  schemaHash: string;
  structure: Json;
  outputStructure: Json;
  numeric: NonNullable<Definition['numeric']>;
  customValidation: boolean;
  entities: NonNullable<Definition['entities']>;
  references: NonNullable<Definition['refs']>;
  modules: NonNullable<Definition['modules']>;
  views: { names: string[]; readonly: string[]; internal: string[] };
  guides: { base: string; modules: Record<string, string>; rules?: Json[] };
  presets: { initialData: Json; templates: NonNullable<Definition['templates']>; prefabs: NonNullable<Definition['prefabs']> };
  runtimeBindings: NonNullable<Definition['runtimeBindings']>;
}
export interface AuthorCompilation {
  definition: CompiledDefinition;
  ir: Readonly<SolveCompiledIR>;
  irHash: string;
  sources: readonly Readonly<AuthorSource>[];
}
const jsonObject = z.custom<Data>(value => {
  try { assertJson(value); return value !== null && typeof value === 'object' && !Array.isArray(value); } catch { return false; }
}, '需要普通 JSON 对象');
const entity = z.strictObject({ path: z.string().min(1), type: z.string().min(1), singletonId: z.string().min(1).optional(), nullable: z.boolean().optional() });
const ref = z.strictObject({ path: z.string().min(1), kind: z.enum(['single', 'array', 'record-key']), onDelete: z.enum(['remove', 'null', 'unset', 'restrict']) });
const moduleSpec = z.strictObject({ paths: z.array(z.string()), enabled: z.boolean().optional(), parent: z.string().optional(), guide: z.string().optional() });
const numeric = z.strictObject({ min: z.number().optional(), max: z.number().optional(), integer: z.boolean().optional(), destroyOnZero: z.boolean().optional() })
  .refine(rule => rule.min === undefined || rule.max === undefined || rule.min <= rule.max, '下限不能大于上限');
const preset = z.strictObject({ type: z.string().min(1), data: jsonObject });
const fragmentSchema = z.strictObject({
  initialData: jsonObject.optional(), entities: z.array(entity).optional(), refs: z.array(ref).optional(),
  modules: z.record(z.string(), moduleSpec).optional(), numeric: z.record(z.string(), numeric).optional(),
  readonly: z.array(z.string()).optional(), internal: z.array(z.string()).optional(), guide: z.string().optional(),
  guides: z.custom<NonNullable<Definition['guides']>>(value => { try { copyGuideRules(value); return Array.isArray(value); } catch { return false; } }, '需要合法指南数组').optional(),
  templates: z.record(z.string(), preset).optional(), prefabs: z.record(z.string(), preset).optional(),
  views: z.record(z.string(), z.custom<NonNullable<Definition['views']>[string]>(v => typeof v === 'function', '需要视图函数')).optional(),
  validateState: z.custom<NonNullable<Definition['validateState']>>(v => typeof v === 'function', '需要校验函数').optional(),
});
const jsonFields = ['initialData', 'entities', 'refs', 'modules', 'numeric', 'readonly', 'internal', 'guide', 'templates', 'prefabs'] as const;

function fragment(value: unknown, source: string): DefinitionFragment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('AUTHOR_FRAGMENT', source + '：定义片段必须是对象', source);
  try {
    for (const key of Object.keys(value)) safeKey(key);
    for (const key of jsonFields) if ((value as any)[key] !== undefined) assertJson((value as any)[key]);
    for (const key of Object.keys((value as any).views ?? {})) safeKey(key);
    if ((value as any).guides !== undefined) copyGuideRules((value as any).guides, source);
  } catch (error) { fail('AUTHOR_FRAGMENT', source + '：' + (error instanceof Error ? error.message : String(error)), source); }
  const parsed = fragmentSchema.safeParse(value);
  if (!parsed.success) fail('AUTHOR_FRAGMENT', source + '：' + parsed.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('; '), source);
  return { ...parsed.data, ...(parsed.data.guides !== undefined ? { guides: copyGuideRules(parsed.data.guides, source) } : {}) };
}
function conflict(source: string, path: string): never { fail('AUTHOR_CONFLICT', source + '：重复声明的内容不一致：' + path, source + ':' + path); }
function mergeJson(left: Json | undefined, right: Json, source: string, path: string): Json {
  if (left === undefined) return clone(right);
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    const result = clone(left);
    for (const [key, value] of Object.entries(right)) { safeKey(key); result[key] = mergeJson(result[key], value, source, path + '.' + key); }
    return result;
  }
  if (canonical(left) !== canonical(right)) conflict(source, path);
  return clone(left);
}
function appendGuide(left = '', right = ''): string { return [left, right].filter(Boolean).join('\n\n'); }
function copyDefinition(base: Definition): Definition {
  assertJson(base.initialData);
  const result = { ...base, schema: isAuthorPrepared(base) ? base.schema : snapshotAuthorSchema(base.schema),
    ...(base.outputSchema ? { outputSchema: isAuthorPrepared(base) ? base.outputSchema : snapshotAuthorSchema(base.outputSchema) } : {}),
    initialData: clone(base.initialData), ...(base.views ? { views: { ...base.views } } : {}) };
  if (base.guides !== undefined) result.guides = copyGuideRules(base.guides);
  if (base.facets !== undefined) result.facets = copyFacets(base.facets);
  for (const key of jsonFields) if (key !== 'initialData' && base[key] !== undefined) (result as any)[key] = clone(base[key]);
  if (base.runtimeBindings !== undefined) { assertJson(base.runtimeBindings); result.runtimeBindings = clone(base.runtimeBindings); }
  return result;
}

/** Compose independent boards without an implicit last-file-wins override. */
export function compose(base: Definition, ...parts: AuthorPart[]): Definition {
  const result = copyDefinition(base);
  for (const part of parts) {
    const source = part.source || '未命名定义片段', input = fragment(part.definition, source);
    for (const key of ['initialData', 'modules', 'numeric', 'templates', 'prefabs'] as const) {
      if (input[key] !== undefined) (result as any)[key] = mergeJson(result[key] as Json | undefined, input[key] as Json, source, key);
    }
    for (const key of ['entities', 'refs'] as const) {
      if (!input[key]) continue;
      const entries = clone(result[key] ?? []) as { path: string }[];
      for (const value of input[key]!) {
        const existing = entries.find(item => item.path === value.path);
        if (existing && canonical(existing) !== canonical(value)) conflict(source, key + '.' + value.path);
        if (!existing) entries.push(clone(value));
      }
      (result as any)[key] = entries;
    }
    for (const key of ['readonly', 'internal'] as const) if (input[key]) result[key] = [...new Set([...(result[key] ?? []), ...input[key]!])];
    if (input.guide !== undefined) result.guide = appendGuide(result.guide, input.guide);
    if (input.guides) {
      const rules = [...result.guides ?? []];
      for (const rule of input.guides) {
        const existing = rules.find(value => value.id === rule.id);
        if (existing && !sameGuideRule(existing, rule)) conflict(source, 'guides.' + rule.id);
        if (!existing) rules.push(rule);
      }
      result.guides = rules;
    }
    if (input.views) {
      const views = { ...result.views };
      for (const [name, view] of Object.entries(input.views)) {
        if (Object.hasOwn(views, name) && views[name] !== view) conflict(source, 'views.' + name);
        views[name] = view;
      }
      result.views = views;
    }
    if (input.validateState) {
      const previous = result.validateState, next = input.validateState;
      result.validateState = async (state, context) => { await previous?.(state, context); await next(state, context); };
    }
  }
  fragment(Object.fromEntries([...jsonFields, 'guides', 'views', 'validateState'].filter(key => (result as any)[key] !== undefined).map(key => [key, (result as any)[key]])), '组合结果');
  return result;
}
const tags: Record<string, keyof DefinitionFragment> = {
  INIT: 'initialData', PREFABS: 'prefabs', TEMPLATES: 'templates', ENTITIES: 'entities', REFS: 'refs', MODULES: 'modules', NUMERIC: 'numeric',
};
function builtin(entry: ParsedWorldInfoEntry): DefinitionFragment | undefined {
  if (entry.tag === 'GUIDE') return entry.module ? undefined : { guide: entry.content };
  const key = Object.hasOwn(tags, entry.tag) ? tags[entry.tag] : undefined;
  if (!key && entry.tag !== 'VISIBILITY') return undefined;
  if (entry.module) fail('WORLD_INFO_MODULE', entry.source + '：内置标签只有 GUIDE 支持 module 参数', entry.source);
  const value = worldInfoJson(entry);
  if (entry.tag === 'VISIBILITY') {
    const parsed = z.strictObject({ readonly: z.array(z.string()).optional(), internal: z.array(z.string()).optional() }).safeParse(value);
    if (!parsed.success) fail('AUTHOR_FRAGMENT', entry.source + '：VISIBILITY 只接受 readonly/internal 路径数组', entry.source);
    return parsed.data;
  }
  return { [key!]: value };
}
function binding(facet: SolveFacet): RuntimeBinding {
  if (!facet.id || typeof facet.id !== 'string' || !facet.version || typeof facet.version !== 'string') fail('FACET_VERSION', 'Facet 必须有固定 id 与 version');
  safeKey(facet.id);
  const result: RuntimeBinding = { id: facet.id, version: facet.version,
    ...(facet.build !== undefined ? { build: facet.build } : {}), ...(facet.dependencies !== undefined ? { dependencies: facet.dependencies } : {}) };
  assertJson(result);
  if (facet.build !== undefined && typeof facet.build !== 'string') fail('FACET_VERSION', facet.id + '：build 必须是字符串');
  return clone(result);
}
function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const item of Object.values(value)) freezeJson(item); Object.freeze(value); }
  return value;
}

async function collect<T>(source: string, task: () => T | Promise<T>): Promise<T> {
  try { return await task(); }
  catch (error) { fail('FACET_COLLECTION', source + '：' + (error instanceof Error ? error.message : String(error)), source); }
}

/** Collect once before registration. Restore continues to use archived patches, without collectors or hooks. */
export async function compileAuthorDefinition(base: Definition, options: AuthorOptions = {}): Promise<AuthorCompilation> {
  // Snapshot all declarative inputs before the first asynchronous collector runs.
  const fixedBase = copyDefinition(base), render = options.renderWorldInfo;
  const entries = (options.worldInfo ?? []).map(entry => Object.freeze({ ...entry }));
  const detached = (options.detached ?? []).map(item => { assertJson(item.data); return { ...item, data: clone(item.data) }; });
  const parts: AuthorPart[] = [], sources: AuthorSource[] = [{ source: base.id + '@' + base.version, kind: 'base' }];
  for (const part of options.parts ?? []) { parts.push({ source: part.source, definition: fragment(part.definition, part.source) }); sources.push({ source: part.source, kind: 'part' }); }
  const facets = new Map<string, SolveFacet>(), bindings: RuntimeBinding[] = [];
  const inheritedFacets = copyFacets(fixedBase.facets), extraFacets = copyFacets(options.facets);
  const inheritedIds = new Set(inheritedFacets.map(facet => facet.id)), extraIds = new Set<string>();
  for (const facet of [...inheritedFacets, ...extraFacets]) {
    const record = binding(facet);
    if (facets.has(facet.id)) {
      if (inheritedIds.has(facet.id) && !extraIds.has(facet.id) && extraFacets.includes(facet) && sameFacet(facets.get(facet.id)!, facet)) { extraIds.add(facet.id); continue; }
      fail('FACET_CONFLICT', '重复 Facet 或绑定不一致：' + facet.id);
    }
    if (extraFacets.includes(facet)) extraIds.add(facet.id);
    facets.set(facet.id, Object.freeze({ ...facet, ...freezeJson(record) })); bindings.push(record);
  }
  const freshFacets = [...facets.values()].filter(facet => !isAuthorPrepared(base) || !inheritedIds.has(facet.id));
  if (freshFacets.length) {
    for (const facet of freshFacets) if (facet.extendZod) {
      const next = await collect(facet.id + ':extendZod', () => facet.extendZod!(fixedBase.schema.clone()));
      if (!next || typeof next.safeParseAsync !== 'function') fail('FACET_SCHEMA', facet.id + '：extendZod需要返回Zod schema');
      fixedBase.schema = next;
    }
  }
  const inline = isAuthorPrepared(base) && !freshFacets.length ? { parts: [], memberships: [], nodes: [] } : collectInline(fixedBase.schema);
  if ((!isAuthorPrepared(base) || freshFacets.length) && fixedBase.outputSchema) {
    const output = collectInline(fixedBase.outputSchema);
    inline.parts.push(...output.parts); inline.memberships.push(...output.memberships); inline.nodes.push(...output.nodes);
  }
  parts.unshift(...inline.parts);
  for (const part of inline.parts) sources.push({ source: part.source, kind: 'part' });
  for (const node of inline.nodes) for (const facet of freshFacets) if (facet.collectInlineMeta) {
    const source = `${facet.id}:schema:${node.path || '<root>'}`;
    const found = await collect(source, () => facet.collectInlineMeta!(node.schema.clone(), Object.freeze({ path: node.path, metadata: node.metadata })));
    if (found !== undefined) { parts.push({ source, definition: fragment(found, source) }); sources.push({ source, kind: 'facet' }); }
  }
  for (const item of detached) {
    const facet = facets.get(item.facet);
    if (!facet?.registerDetached) fail('FACET_NOT_FOUND', item.source + '：没有可用的 Facet 收集器 ' + item.facet, item.source);
    assertJson(item.data);
    parts.push({ source: item.source, definition: fragment(await collect(item.source, () => facet.registerDetached!(clone(item.data))), item.source) });
    sources.push({ source: item.source, kind: 'facet' });
  }
  const moduleGuides: { source: string; module: string; content: string }[] = [];
  for (const [index, original] of entries.entries()) {
    const entry = await parseWorldInfoEntry(original, index, render);
    if (!entry) continue;
    sources.push({ source: entry.source, kind: 'world-info', tag: entry.tag, ...(entry.module ? { module: entry.module } : {}) });
    if (entry.tag === 'GUIDE' && (entry.when !== undefined || entry.id !== undefined)) {
      const rule = { text: entry.content, ...(entry.module ? { module: entry.module } : {}), ...(entry.when !== undefined ? { when: entry.when } : {}) };
      const id = entry.id ?? 'world-guide:' + await hash(rule);
      parts.push({ source: entry.source, definition: { guides: [{ id, ...rule, source: entry.source }] } }); continue;
    }
    if (entry.tag === 'GUIDE' && entry.module) { moduleGuides.push({ source: entry.source, module: entry.module, content: entry.content }); continue; }
    let contribution = builtin(entry);
    if (contribution === undefined) {
      const claims: { id: string; definition: DefinitionFragment }[] = [];
      for (const facet of facets.values()) {
        const found = facet.parseWorldInfo ? await collect(entry.source, () => facet.parseWorldInfo!(Object.freeze({ ...entry }))) : undefined;
        if (found !== undefined) claims.push({ id: facet.id, definition: fragment(found, entry.source) });
      }
      if (!claims.length) fail('WORLD_INFO_UNSUPPORTED', entry.source + '：没有处理标签 SOLVE:' + entry.tag + ' 的收集器', entry.source);
      if (claims.length > 1) fail('FACET_CONFLICT', entry.source + '：多个 Facet 处理了同一条目：' + claims.map(item => item.id).join(', '), entry.source);
      contribution = claims[0]!.definition;
    }
    parts.push({ source: entry.source, definition: fragment(contribution, entry.source) });
  }
  const definition = compose(fixedBase, ...parts);
  const ancestor = (parent: string, child: string): boolean => {
    const seen = new Set<string>();
    for (let next = definition.modules?.[child]?.parent; next && !seen.has(next); next = definition.modules?.[next]?.parent) { if (next === parent) return true; seen.add(next); }
    return false;
  };
  const overlap = (left: string, right: string): boolean => {
    const a = left.split('.'), b = right.split('.'); return a.slice(0, Math.min(a.length, b.length)).every((part, index) => part === '*' || b[index] === '*' || part === b[index]);
  };
  for (const member of inline.memberships) {
    const module = definition.modules?.[member.module];
    if (!module) fail('INLINE_MODULE', member.source + '：模块尚未声明：' + member.module, member.source);
    for (const [name, other] of Object.entries(definition.modules ?? {})) if (name !== member.module && !ancestor(name, member.module) && !ancestor(member.module, name)
      && other.paths.some(path => overlap(path, member.path))) fail('INLINE_CONFLICT', `${member.source}：${member.path}同时归属无父子关系的模块${member.module}/${name}`, member.source);
    module.paths = [...new Set([...module.paths, member.path])];
  }
  if (facets.size) definition.facets = [...facets.values()];
  for (const item of moduleGuides) {
    const module = definition.modules?.[item.module];
    if (!module) fail('WORLD_INFO_MODULE', item.source + '：模块尚未声明：' + item.module, item.source);
    module.guide = appendGuide(module.guide, item.content);
  }
  const inherited = definition.runtimeBindings?.authoring?.facets ?? [];
  for (const record of inherited) {
    const current = bindings.find(item => item.id === record.id);
    if (current && canonical(current) !== canonical(record)) fail('FACET_CONFLICT', 'Facet 绑定不一致：' + record.id);
    if (!current) bindings.push(clone(record));
  }
  definition.runtimeBindings = { ...definition.runtimeBindings,
    authoring: { version: '1', initialDataHash: await hash(definition.initialData), facets: bindings } };
  const compiled = await compilePrepared(markAuthorPrepared(definition));
  const ir: SolveCompiledIR = {
    irFormatVersion: '1', definition: { id: compiled.id, version: compiled.version, fingerprint: compiled.fingerprint },
    schemaHash: await hash(compiled.schemaShape), structure: clone(compiled.schemaShape),
    outputStructure: clone(compiled.outputShape ?? null), numeric: clone(compiled.numeric ?? {}), customValidation: Boolean(compiled.validateState),
    entities: clone(compiled.entities ?? []), references: clone(compiled.refs ?? []), modules: clone(compiled.modules ?? {}),
    views: { names: Object.keys(compiled.views ?? {}).sort(), readonly: clone(compiled.readonly ?? []), internal: clone(compiled.internal ?? []) },
    guides: { base: compiled.guide ?? '', modules: Object.fromEntries(Object.entries(compiled.modules ?? {}).map(([name, module]) => [name, module.guide ?? ''])), ...(compiled.guides?.length ? { rules: describeGuideRules(compiled.guides) } : {}) },
    presets: { initialData: clone(compiled.initialData) as Json, templates: clone(compiled.templates ?? {}), prefabs: clone(compiled.prefabs ?? {}) },
    runtimeBindings: clone(compiled.runtimeBindings!),
  };
  assertJson(ir);
  for (const facet of facets.values()) if (facet.runtimeHooks?.afterCompile) {
    await collect(facet.id + ':afterCompile', () => facet.runtimeHooks!.afterCompile!(freezeAuthorValue({ fingerprint: compiled.fingerprint, ir: clone(ir) as unknown as Json })));
  }
  return { definition: compiled, ir: freezeJson(ir), irHash: await hash(ir), sources: Object.freeze(sources.map(source => Object.freeze(source))) };
}
