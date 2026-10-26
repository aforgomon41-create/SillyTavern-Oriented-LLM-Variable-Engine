import { z } from 'zod';
import { assertJson, at, canonical, clone, covered, fail, hash, matches, pointer, safeKey } from './json.js';
import type { CompiledDefinition, Definition, ExecutionContext, Feedback, Json, LogicalState, NumericRule } from './types.js';

export function unwrap(schema: any): any {
  for (let i = 0; i < 32; i++) {
    const d = schema?._zod?.def ?? schema?._def;
    if (d?.innerType) schema = d.innerType;
    else if (d?.type === 'lazy') schema = d.getter();
    else if (d?.type === 'pipe') schema = d.in;
    else return schema;
  }
  fail('SCHEMA_DEPTH', 'Schema 包装过深');
}
export function childSchema(schema: any, key: string): any {
  safeKey(key);
  const s = unwrap(schema);
  const d = s?._zod?.def ?? s?._def;
  if (d?.type === 'object') {
    const shape = s.shape ?? d.shape;
    if (!Object.hasOwn(shape, key)) return d.catchall;
    return shape[key];
  }
  if (d?.type === 'record') return d.valueType;
  if (d?.type === 'array') return d.element;
  if (d?.type === 'union') return undefined; // validate the enclosing union as a whole
  return undefined;
}
export function schemaAt(schema: any, parts: string[]): any {
  for (const key of parts) { schema = childSchema(schema, key); if (!schema) return undefined; }
  return schema;
}
function schemaDescription(schema: any, seen = new Set<any>()): Json {
  if (seen.size > 128) fail('SCHEMA_DEPTH', 'Schema 嵌套超过限制');
  if (seen.has(schema)) fail('SCHEMA_CYCLE', '递归 Schema 需要显式有限状态结构');
  seen.add(schema);
  const d = schema?._zod?.def ?? schema?._def;
  if (!d) fail('INVALID_SCHEMA', '需要有效 Zod Schema');
  const result: Record<string, Json> = { type: String(d.type) };
  if (d.type === 'object') {
    result.fields = Object.fromEntries(Object.entries(schema.shape).map(([k, s]) => { safeKey(k); if (k.includes('.')) fail('INVALID_KEY', '静态字段名禁止点号'); return [k, schemaDescription(s, seen)]; }));
  }
  if (d.type === 'record') { result.key = schemaDescription(d.keyType, seen); result.value = schemaDescription(d.valueType, seen); }
  if (d.type === 'array') result.element = schemaDescription(d.element, seen);
  if (d.innerType) result.inner = schemaDescription(d.innerType, seen);
  if (d.type === 'pipe') { result.input = schemaDescription(d.in, seen); result.output = schemaDescription(d.out, seen); }
  if (d.type === 'lazy') result.inner = schemaDescription(d.getter(), seen);
  if (d.options) result.options = d.options.map((s: any) => schemaDescription(s, seen));
  if (d.values) result.values = [...d.values];
  if (d.entries) result.entries = d.entries;
  if (d.checks) result.checks = d.checks.map((c: any) => {
    const def = c._zod?.def ?? {};
    return Object.fromEntries(Object.entries(def).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))) as Json;
  });
  // Function behavior/dependencies are identified by the author's immutable definition version.
  // Zod exposes defaultValue as a getter, including for callbacks. Never sample it
  // while fingerprinting: doing so would draw random values or run side effects.
  const defaultDescriptor = Object.getOwnPropertyDescriptor(d, 'defaultValue');
  if (defaultDescriptor?.get) result.default = 'runtime-bound-by-definition-version';
  else if (defaultDescriptor?.value !== undefined && typeof defaultDescriptor.value !== 'function') { assertJson(defaultDescriptor.value); result.default = defaultDescriptor.value; }
  seen.delete(schema);
  return result;
}
export async function compile(definition: Definition): Promise<CompiledDefinition> {
  if (!definition.id || !definition.version) fail('DEFINITION_VERSION', '作者定义必须有固定 id 与版本');
  const schemaShape = schemaDescription(definition.schema);
  for (const [name, m] of Object.entries(definition.modules ?? {})) {
    safeKey(name);
    let p: string | undefined = name;
    const seen = new Set<string>();
    while (p) {
      if (seen.has(p)) fail('MODULE_CYCLE', '模块父级不能循环');
      seen.add(p);
      if (!definition.modules?.[p]) fail('MODULE_PARENT', `未知父模块：${p}`);
      p = definition.modules[p]?.parent;
    }
    for (const path of m.paths) path.split('.').forEach(k => { if (k !== '*') safeKey(k); });
  }
  for (const ref of definition.refs ?? []) {
    const allowed = ref.kind === 'single' ? ['null', 'unset', 'restrict'] : ref.kind === 'array' ? ['remove', 'restrict'] : ['unset', 'restrict'];
    if (!allowed.includes(ref.onDelete)) fail('REF_DELETE_POLICY', `${ref.kind} 引用不支持 ${ref.onDelete} 清理策略`);
  }
  const metadata = { id: definition.id, version: definition.version, schemaShape,
    entities: definition.entities ?? [], refs: definition.refs ?? [], modules: definition.modules ?? {},
    numeric: definition.numeric ?? {}, readonly: definition.readonly ?? [], internal: definition.internal ?? [],
    templates: definition.templates ?? {}, prefabs: definition.prefabs ?? {} };
  const fingerprint = await hash({ ...metadata, outputShape: definition.outputSchema ? schemaDescription(definition.outputSchema) : null });
  const storedSchema = definition.outputSchema ?? storedProjection(definition.schema);
  const fixed = clone(metadata);
  const freeze = (value: any): void => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } };
  freeze(fixed);
  return { ...definition, initialData: clone(definition.initialData), entities: fixed.entities, refs: fixed.refs, modules: fixed.modules,
    numeric: fixed.numeric, readonly: fixed.readonly, internal: fixed.internal, templates: fixed.templates, prefabs: fixed.prefabs,
    fingerprint, schemaShape, storedSchema, structuralSchema: storedProjection(storedSchema, true) };
}
// Input effects are one-way and must never run on already stored output.
// A transform's output cannot be inferred from JS; use outputSchema for its constraints.
function storedProjection(schema: any, structuralOnly = false): any {
  const d = schema._zod.def;
  const checks = structuralOnly ? d.checks?.filter((c: any) => c._zod?.def?.check !== 'custom') : d.checks;
  if (d.type === 'transform') return z.unknown();
  if (d.type === 'lazy') return storedProjection(d.getter(), structuralOnly);
  if (d.type === 'pipe') return storedProjection(d.out, structuralOnly);
  if (['default', 'prefault', 'catch', 'readonly'].includes(d.type)) return storedProjection(d.innerType, structuralOnly);
  if (d.innerType) return schema.clone({ ...d, innerType: storedProjection(d.innerType, structuralOnly), ...(checks ? { checks } : {}) });
  if (d.type === 'object') return schema.clone({ ...d, shape: Object.fromEntries(Object.entries(schema.shape).map(([k, s]) => [k, storedProjection(s, structuralOnly)])), ...(checks ? { checks } : {}) });
  if (d.type === 'array') return schema.clone({ ...d, element: storedProjection(d.element, structuralOnly), ...(checks ? { checks } : {}) });
  if (d.type === 'record') return schema.clone({ ...d, valueType: storedProjection(d.valueType, structuralOnly), ...(checks ? { checks } : {}) });
  if (d.options) return schema.clone({ ...d, options: d.options.map((s: any) => storedProjection(s, structuralOnly)), ...(checks ? { checks } : {}) });
  return checks ? schema.clone({ ...d, checks }) : schema;
}
export function isModuleEnabled(def: CompiledDefinition, state: LogicalState, name: string): boolean {
  const m = def.modules?.[name];
  if (!m || !state.engineState.activeModules[name]) return false;
  return !m.parent || isModuleEnabled(def, state, m.parent);
}
export function dormant(def: CompiledDefinition, state: LogicalState, parts: string[]): boolean {
  return Object.entries(def.modules ?? {}).some(([name, m]) => !isModuleEnabled(def, state, name) && m.paths.some(p => covered(p, parts)));
}
export function numericRule(def: CompiledDefinition, parts: string[]): NumericRule | undefined {
  const schema = unwrap(schemaAt(def.schema, parts));
  const d = schema?._zod?.def;
  let rule: NumericRule | undefined;
  if (d?.type === 'number') {
    rule = {};
    for (const check of d.checks ?? []) {
      const c = check._zod?.def;
      if (c?.check === 'greater_than' && c.inclusive) rule.min = Math.max(rule.min ?? -Infinity, c.value);
      if (c?.check === 'less_than' && c.inclusive) rule.max = Math.min(rule.max ?? Infinity, c.value);
      if (c?.check === 'number_format' && String(c.format).includes('int')) rule.integer = true;
    }
  }
  for (const [pattern, extra] of Object.entries(def.numeric ?? {})) if (matches(pattern, parts)) rule = { ...rule, ...extra };
  return rule;
}
export function clamp(def: CompiledDefinition, parts: string[], value: unknown, strict: boolean, feedback: Feedback[]): unknown {
  const rule = numericRule(def, parts);
  if (!rule || typeof value !== 'number') return value;
  if (!Number.isFinite(value)) fail('INVALID_NUMBER', '数值必须有限', pointer(parts));
  const next = Math.min(rule.max ?? Infinity, Math.max(rule.min ?? -Infinity, value));
  if (rule.integer && !Number.isInteger(value)) fail('INTEGER_REQUIRED', '目标需要整数', pointer(parts));
  if (next !== value) {
    if (strict) fail('BOUND_VIOLATION', '原子操作数值超出上下限', pointer(parts));
    feedback.push({ level: 'L1', code: 'CLAMP_APPLIED', message: `${value} 调整为 ${next}`, path: pointer(parts) });
  }
  return next;
}
// Validate stored output without re-running input transforms/default generators.
// Zod's output projection keeps structural/refinement checks and removes transforms.
export async function validateStored(def: CompiledDefinition, state: LogicalState, context: ExecutionContext, structuralOnly = false): Promise<void> {
  assertJson(state);
  const output = structuralOnly ? def.structuralSchema : def.storedSchema;
  const result = await output.safeParseAsync(state.data);
  if (!result.success) {
    const activeIssues = result.error.issues.filter((issue: any) => !dormant(def, state, issue.path.map(String)));
    if (activeIssues.length) fail('SCHEMA_REJECTED', activeIssues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; '));
  } else if (canonical(result.data) !== canonical(state.data)) fail('STORED_STATE_CHANGED', '状态含未声明字段或需要再次转换的值');
  if (!structuralOnly) await def.validateState?.(clone(state), clone(context));
}
function normalizeInput(def: CompiledDefinition, state: LogicalState, parts: string[], input: any, strict: boolean, feedback: Feedback[], allowDormant: boolean): any {
  if (input === undefined) return undefined;
  if (!allowDormant && dormant(def, state, parts)) fail('MODULE_DORMANT', '操作中包含休眠字段', pointer(parts));
  if (typeof input === 'number') return clamp(def, parts, input, strict, feedback);
  if (!input || typeof input !== 'object') return input;
  const schema = unwrap(schemaAt(def.schema, parts));
  if (Array.isArray(input)) return input.map((v, i) => normalizeInput(def, state, [...parts, String(i)], v, strict, feedback, allowDormant));
  const result: any = {}, d = schema?._zod?.def;
  for (const [rawKey, value] of Object.entries(input)) {
    safeKey(rawKey);
    const key = d?.type === 'record' ? rawKey.replace(/\./gu, '_') : rawKey;
    if (key !== rawKey) feedback.push({ level: 'L1', code: 'KEY_SANITIZED', message: `${rawKey} → ${key}` });
    if (Object.hasOwn(result, key) || (key !== rawKey && Object.hasOwn(input, key))) fail('KEY_COLLISION', '动态键净化后重名', pointer([...parts, key]));
    if (d?.type === 'object' && !Object.hasOwn(schema.shape, key) && !d.catchall) fail('SCHEMA_PATH', '输入包含未声明字段', pointer([...parts, key]));
    result[key] = normalizeInput(def, state, [...parts, key], value, strict, feedback, allowDormant);
  }
  return result;
}
function missingDormant(def: CompiledDefinition, state: LogicalState, parts: string[], input: any): boolean {
  if (input === undefined) return dormant(def, state, parts);
  if (!input || typeof input !== 'object') return false;
  const schema = unwrap(schemaAt(def.schema, parts));
  const keys = new Set([...Object.keys(input), ...Object.keys(schema?.shape ?? {})]);
  return [...keys].some(key => missingDormant(def, state, [...parts, key], input[key]));
}
export async function parseInput(def: CompiledDefinition, state: LogicalState, parts: string[], input: unknown, strict: boolean, feedback: Feedback[], allowDormant = false): Promise<any> {
  const schema = schemaAt(def.schema, parts);
  if (!schema) fail('SCHEMA_PATH', '目标不在 Schema 中或需要修改完整联合类型字段', pointer(parts));
  const value = normalizeInput(def, state, parts, input, strict, feedback, allowDormant);
  // Avoid running transforms/default functions once in a failed whole-object parse
  // and a second time in a dormant-field fallback.
  if (value && typeof value === 'object' && !Array.isArray(value) && missingDormant(def, state, parts, value)) {
    const parsed: any = {};
    const shape = unwrap(schema)?.shape;
    for (const key of new Set([...Object.keys(value), ...Object.keys(shape ?? {})])) {
      const path = [...parts, key];
      if (dormant(def, state, path) && !Object.hasOwn(value, key)) continue;
      const v = await parseInput(def, state, path, (value as any)[key], strict, feedback, allowDormant);
      if (v !== undefined) parsed[key] = v;
    }
    return parsed;
  }
  const result = await schema.safeParseAsync(value);
  if (!result.success) {
    const activeIssues = result.error.issues.filter((issue: any) => !dormant(def, state, [...parts, ...issue.path.map(String)]));
    if (activeIssues.length) fail('SCHEMA_REJECTED', activeIssues.map((i: any) => i.message).join('; '), pointer(parts));
    // A module can omit inactive required fields. Parse present active children separately.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const parsed: any = {};
      const shape = unwrap(schema)?.shape;
      for (const key of new Set([...Object.keys(value), ...Object.keys(shape ?? {})])) {
        const path = [...parts, key];
        if (dormant(def, state, path) && !Object.hasOwn(value, key)) continue;
        const v = await parseInput(def, state, path, (value as any)[key], strict, feedback, allowDormant);
        if (v !== undefined) parsed[key] = v;
      }
      return parsed;
    }
    fail('SCHEMA_REJECTED', result.error.message, pointer(parts));
  }
  if (result.data !== undefined) assertJson(result.data);
  return result.data;
}
export async function initialState(def: CompiledDefinition, initial: unknown = def.initialData): Promise<LogicalState> {
  const state: LogicalState = { data: {}, engineState: {
    activeModules: Object.fromEntries(Object.entries(def.modules ?? {}).map(([k, m]) => [k, m.enabled !== false])),
    prefabLifecycle: Object.fromEntries(Object.keys(def.prefabs ?? {}).map(k => [k, 'dormant' as const]))
  } };
  const parsed = await parseInput(def, state, [], initial, false, [], true);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail('STATE_ROOT', '状态根必须是对象');
  state.data = parsed;
  await validateStored(def, state, {});
  return state;
}
