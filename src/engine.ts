import { at, assertJson, canonical, clone, covered, expand, fail, matches, merge, pointer, safeKey, SolveError, write } from './json.js';
import { EntityGraph } from './entities.js';
import { clamp, dormant, initialState, isModuleEnabled, numericRule, parseInput, schemaAt, unwrap, validateStored } from './schema.js';
import type { Batch, CompiledDefinition, ExecutionContext, ExecutionResult, Feedback, LogicalState } from './types.js';

export const OPERATORS = ['$createEntity', '$move', '$swap', '$set', '$inc', '$transfer', '$push', '$pull', '$unset', '$deleteEntity', '$group'] as const;
const MAX_STATEMENTS = 2000;
type Statement = { op: string; path: string; value?: unknown };
function entries(value: unknown): [string, unknown][] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ARGUMENT', '算子参数必须是对象');
  return Object.entries(value);
}
function targets(value: unknown): string[] {
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || values.some(v => typeof v !== 'string')) fail('INVALID_ARGUMENT', '删除算子参数必须是一维路径数组');
  return values;
}
function number(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID_NUMBER', '需要有限数字'); return value; }
export class SolveCore {
  constructor(public readonly definition: CompiledDefinition) {}
  async initialize(initial?: unknown): Promise<LogicalState> {
    const state = await initialState(this.definition, initial);
    const graph = new EntityGraph(this.definition, state);
    for (const prefab of Object.keys(this.definition.prefabs ?? {})) if (graph.entities.has(prefab)) state.engineState.prefabLifecycle[prefab] = 'active';
    return state;
  }
  async execute(operations: Batch, state: LogicalState, context: ExecutionContext = {}): Promise<ExecutionResult> {
    assertJson(operations);
    if (JSON.stringify(operations).length > 1_000_000) fail('OPERATIONS_TOO_LARGE', '指令块超过 1 MB');
    const runner = new Runner(this.definition, clone(state), context);
    await runner.run(operations, false, 0);
    return { state: runner.state, feedback: runner.feedback, aliases: runner.aliases, applied: runner.applied };
  }
  async setModule(name: string, enabled: boolean, state: LogicalState, context: ExecutionContext = {}): Promise<ExecutionResult> {
    const def = this.definition;
    if (typeof enabled !== 'boolean') fail('MODULE_VALUE', '模块开关必须为布尔值');
    if (!Object.hasOwn(def.modules ?? {}, name)) fail('MODULE_NOT_FOUND', `未知模块：${name}`);
    const next = clone(state), feedback: Feedback[] = [];
    next.engineState.activeModules[name] = enabled;
    // Hydrate newly visible missing leaves only; never re-transform existing state.
    if (enabled) for (const [moduleName, spec] of Object.entries(def.modules ?? {})) {
      if (!isModuleEnabled(def, next, moduleName)) continue;
      for (const pattern of spec.paths) {
        const parts = pattern.split('.');
        const leaf = parts.pop()!;
        if (leaf === '*') fail('MODULE_PATTERN', '模块路径末段不能是通配符');
        const parents = parts.length ? expand(next.data, parts.join('.')) : [{ parts: [], value: next.data }];
        for (const parent of parents) {
          if (Object.hasOwn(parent.value, leaf)) continue;
          const path = [...parent.parts, leaf];
          const value = await parseInput(def, next, path, undefined, true, feedback);
          if (value === undefined) fail('MODULE_DEFAULT_REQUIRED', '模块启用缺少默认值', pointer(path));
          write(next.data, path, value);
        }
      }
    }
    await validateStored(def, next, context); new EntityGraph(def, next);
    feedback.push({ level: 'L2', code: 'MODULE_CHANGED', message: `${name}: ${enabled ? '开启' : '关闭'}` });
    return { state: next, feedback, aliases: {}, applied: 1 };
  }
}

class Runner {
  feedback: Feedback[] = [];
  aliases: Record<string, string> = {};
  applied = 0;
  count = 0;
  constructor(private def: CompiledDefinition, public state: LogicalState, private context: ExecutionContext) {}
  private graph(state = this.state): EntityGraph { return new EntityGraph(this.def, state); }
  private issue(error: unknown): void {
    const e = error instanceof SolveError ? error : new SolveError('AUTHOR_OR_EXECUTION_ERROR', error instanceof Error ? error.message : String(error));
    this.feedback.push({ level: 'L3', code: e.code, message: e.message, ...(e.path ? { path: e.path } : {}), statement: this.count });
  }
  async run(batch: Batch, strict: boolean, depth: number): Promise<boolean> {
    if (depth > 8) { this.issue(new SolveError('GROUP_DEPTH', '原子组最多嵌套 8 层')); return false; }
    const list = Array.isArray(batch) ? batch : [batch];
    let success = true;
    for (const object of list) {
      try {
        if (!object || typeof object !== 'object' || Array.isArray(object)) fail('INVALID_BATCH', '操作数组成员必须是对象');
        const keys = Object.keys(object);
        if (keys.some(k => !OPERATORS.includes(k as any))) fail('UNKNOWN_OPERATOR', '存在不支持的算子');
        const plan: Statement[] = [];
        const g = this.graph();
        for (const op of OPERATORS.filter(o => o !== '$group')) {
          if (!Object.hasOwn(object, op)) continue;
          const value = object[op];
          if (op === '$unset' || op === '$deleteEntity') for (const path of targets(value)) plan.push({ op, path });
          else for (const [path, v] of entries(value)) plan.push({ op, path, value: v });
        }
        // Normalize entity upgrades before assigning phase, not during execution.
        for (const s of plan) {
          if (s.op === '$set' && !s.path.startsWith('@')) {
            const p = s.path.split('.');
            const key = p.pop()!;
            if (g.container(p) && at(this.state.data, [...p, key.replace(/^@/u, '')], false) === undefined) s.op = '$createEntity';
          }
          if (s.op === '$unset') {
            try { if (g.entityAt(g.resolve(s.path, this.aliases))) s.op = '$deleteEntity'; } catch { /* report at execution */ }
          }
        }
        plan.sort((a, b) => OPERATORS.indexOf(a.op as any) - OPERATORS.indexOf(b.op as any));
        // Parent/child writes by one $set object have no implicit ordering contract.
        const sets = plan.filter(s => s.op === '$set');
        const conflicts = new Set<Statement>();
        for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
          let a: string, b: string;
          try { a = pointer(g.resolve(sets[i]!.path)); b = pointer(g.resolve(sets[j]!.path)); } catch { continue; }
          if (a === b || a.startsWith(b + '/') || b.startsWith(a + '/')) { conflicts.add(sets[i]!); conflicts.add(sets[j]!); }
        }
        for (const s of plan) {
          if (++this.count > MAX_STATEMENTS) fail('STATEMENT_LIMIT', '一次执行最多 2000 条操作');
          if (conflicts.has(s)) { this.issue(new SolveError('CONFLICTING_PATHS', '同一 $set 中父子路径冲突', s.path)); success = false; if (strict) return false; continue; }
          const next = clone(this.state), notes: Feedback[] = [], aliases = { ...this.aliases };
          try {
            await this.statement(s, next, strict, notes, aliases);
            const beforeGraph = this.graph(this.state), afterGraph = this.graph(next);
            for (const [entityId, old] of beforeGraph.entities) {
              const current = afterGraph.entities.get(entityId);
              if (current && current.type !== old.type) fail('ENTITY_TYPE', '结构搬移不能改变已有实体类型');
            }
            this.destroyZero(next, this.state);
            await validateStored(this.def, next, this.context, strict); this.graph(next);
            this.state = next; this.aliases = aliases; this.feedback.push(...notes); this.applied++;
          } catch (error) { this.issue(error); success = false; if (strict) return false; }
        }
        if (Object.hasOwn(object, '$group')) {
          if (!Array.isArray(object.$group) || object.$group.length === 0) fail('INVALID_GROUP', '$group 需要非空有序操作数组');
          const child = new Runner(this.def, clone(this.state), this.context);
          child.count = this.count; child.aliases = { ...this.aliases };
          let ok = await child.run(object.$group as Batch, true, depth + 1);
          if (ok && !strict) {
            try { await validateStored(this.def, child.state, this.context); this.graph(child.state); }
            catch (error) { child.issue(error); ok = false; }
          }
          this.count = child.count;
          if (ok) { this.state = child.state; this.aliases = child.aliases; this.applied += child.applied; this.feedback.push(...child.feedback); }
          else {
            this.feedback.push({ level: 'L3', code: 'GROUP_ROLLED_BACK', message: `整组撤回：${child.feedback.filter(f => f.level === 'L3').map(f => f.message).join('; ')}`, statement: this.count });
            success = false; if (strict) return false;
          }
        }
      } catch (error) { this.issue(error); success = false; if (strict) return false; }
    }
    return success;
  }
  private writable(state: LogicalState, parts: string[]): void {
    if (dormant(this.def, state, parts)) fail('MODULE_DORMANT', '目标模块已休眠', pointer(parts));
    if (!parts.length) fail('ROOT_WRITE', '禁止修改根节点');
  }
  private destroyZero(next: LogicalState, previous: LogicalState): void {
    const graph = this.graph(next), before = this.graph(previous), doomed = new Set<string>();
    for (const [pattern, rule] of Object.entries(this.def.numeric ?? {})) {
      if (!rule.destroyOnZero) continue;
      for (const found of expand(next.data, pattern)) {
        if (found.value !== 0) continue;
        const owner = [...graph.entities.values()].filter(e => pointer(found.parts).startsWith(e.pointer + '/')).sort((a, b) => b.pointer.length - a.pointer.length)[0];
        if (!owner) fail('DESTROY_TARGET', 'destroyOnZero 字段不属于实体');
        const oldOwner = before.entities.get(owner.id);
        const oldPath = oldOwner ? [...before.resolve('@' + owner.id), ...found.parts.slice(graph.resolve('@' + owner.id).length)] : found.parts;
        if (at(previous.data, oldPath, false) !== 0) doomed.add(owner.id);
      }
    }
    const roots = [...doomed].filter(entityId => ![...doomed].some(other => other !== entityId && graph.entities.get(entityId)!.pointer.startsWith(graph.entities.get(other)!.pointer + '/')));
    graph.deleteMany(roots);
  }
  private value(value: unknown, state: LogicalState, graph: EntityGraph): any {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, '$valueOf')) {
      const v = value as Record<string, unknown>;
      if (Object.keys(v).some(k => !['$valueOf', '$mul'].includes(k))) fail('INVALID_VALUE_OF', '$valueOf 参数不合法');
      const parts = graph.resolve(String(v.$valueOf), this.aliases);
      if (dormant(this.def, state, parts)) fail('MODULE_DORMANT', '不能读取休眠字段');
      for (const [name, module] of Object.entries(this.def.modules ?? {})) {
        if (isModuleEnabled(this.def, state, name)) continue;
        for (const pattern of module.paths) if (expand(state.data, pattern).some(found => covered(pointer(parts), found.parts))) fail('MODULE_DORMANT', '父对象中含有休眠字段，不能整体读取');
      }
      const result = clone(at(state.data, parts));
      return v.$mul === undefined ? result : number(result) * number(v.$mul);
    }
    return clone(value);
  }
  private async patchSet(state: LogicalState, parts: string[], value: unknown, strict: boolean, notes: Feedback[]): Promise<void> {
    this.writable(state, parts);
    const current = at(state.data, parts, false);
    if (value && current && typeof value === 'object' && typeof current === 'object' && !Array.isArray(value) && !Array.isArray(current)) {
      for (const [key, v] of Object.entries(value)) await this.patchSet(state, [...parts, key], v, strict, notes);
    } else {
      const parsed = await parseInput(this.def, state, parts, value, strict, notes);
      if (parsed === undefined) fail('UNDEFINED_STATE', '不能写入 undefined');
      write(state.data, parts, parsed);
    }
  }
  private async statement(s: Statement, state: LogicalState, strict: boolean, notes: Feedback[], aliases: Record<string, string>): Promise<void> {
    const graph = this.graph(state);
    if (s.op === '$createEntity') {
      const marker = s.path.lastIndexOf('.@');
      const raw = s.path.split('.');
      const requested = marker >= 0 ? s.path.slice(marker + 2) : raw.pop()!;
      const parent = graph.resolve(marker >= 0 ? s.path.slice(0, marker) : raw.join('.'), aliases);
      this.writable(state, [...parent, requested]);
      const spec = graph.container(parent);
      if (!spec) fail('NOT_ENTITY_CONTAINER', '创建目标必须是实体容器');
      let entityId = requested.replace(/\./g, '_'); safeKey(entityId);
      if (!entityId || entityId.includes('@')) fail('INVALID_ENTITY_ID', '非法实体 ID');
      if (entityId !== requested && graph.entities.has(entityId)) fail('KEY_COLLISION', '实体ID净化后与已有ID冲突');
      const prefab = this.def.prefabs?.[entityId];
      if (prefab && state.engineState.prefabLifecycle[entityId] !== 'dormant') fail('PREFAB_LIFECYCLE', '预制对象不能重复唤醒或复活');
      const baseId = entityId;
      for (let n = 2; graph.entities.has(entityId); n++) entityId = `${baseId}_${n}`;
      if (entityId !== requested) notes.push({ level: 'L1', code: 'ID_RENAMED', message: `${requested} → ${entityId}` });
      aliases[requested] = entityId;
      const input = Object.fromEntries(entries(s.value));
      const from = input.$from;
      delete input.$from;
      const template = from === undefined ? undefined : this.def.templates?.[String(from).replace(/^@/u, '')];
      if (from !== undefined && !template) fail('TEMPLATE_NOT_FOUND', '模板不存在');
      if ((template && template.type !== spec.type) || (prefab && prefab.type !== spec.type)) fail('ENTITY_TYPE', '模板或预制类型与目标不匹配');
      const value = merge(prefab?.data ?? template?.data ?? {}, input);
      const parts = [...parent, entityId];
      if (at(state.data, parts, false) !== undefined) fail('TARGET_OCCUPIED', '目标 Key 已存在');
      const parsed = await parseInput(this.def, state, parts, value, strict, notes);
      write(state.data, parts, parsed);
      if (prefab) state.engineState.prefabLifecycle[entityId] = 'active';
      return;
    }
    if (s.op === '$move' && s.path.startsWith('@') && !graph.entities.has(s.path.slice(1)) && this.def.prefabs?.[s.path.slice(1)]) {
      await this.statement({ op: '$createEntity', path: `${String(s.value)}.${s.path}`, value: {} }, state, strict, notes, aliases);
      return;
    }
    const parts = graph.resolve(s.path, aliases);
    this.writable(state, parts);
    if (s.op === '$deleteEntity') {
      const entity = graph.entityAt(parts);
      if (!entity) fail('NOT_ENTITY', '删除目标不是注册实体');
      graph.delete(entity.id); return;
    }
    if (s.op === '$move' || s.op === '$swap') {
      if (typeof s.value !== 'string') fail('INVALID_TARGET', '目标路径必须为字符串');
      const target = graph.resolve(s.value, aliases);
      this.writable(state, target);
      const a = pointer(parts), b = pointer(target);
      if (a === b || a.startsWith(b + '/') || b.startsWith(a + '/')) fail('CYCLIC_MOVE', '不允许相同路径或父子包含');
      const source = clone(at(state.data, parts));
      if (s.op === '$swap') {
        const other = clone(at(state.data, target));
        const left = graph.entityAt(parts), right = graph.entityAt(target);
        if (Boolean(left) !== Boolean(right) || (left && right && left.type !== right.type)) fail('ENTITY_TYPE', '交换实体必须具有相同类型');
        if (left && right) {
          const aParent = parts.slice(0, -1), bParent = target.slice(0, -1);
          if (!graph.container(aParent) || !graph.container(bParent)) fail('SINGLETON_SWAP', '固定单例身份不能直接搬移交换');
          if (pointer(aParent) === pointer(bParent)) return; // ID-keyed records have no positional slots.
          write(state.data, parts, null, true); write(state.data, target, null, true);
          write(state.data, [...aParent, right.id], other); write(state.data, [...bParent, left.id], source);
          return;
        }
        // Values are already canonical output; do not apply input transforms a second time.
        write(state.data, parts, other); write(state.data, target, source);
      } else {
        const entity = graph.entityAt(parts);
        const destination = entity ? [...target, entity.id] : target;
        if (entity && graph.container(target)?.type !== entity.type) fail('ENTITY_TYPE', '目标容器不接受此实体类型');
        if (at(state.data, destination, false) !== undefined) fail('TARGET_OCCUPIED', '移动不覆盖已有位置');
        at(state.data, destination.slice(0, -1));
        write(state.data, parts, null, true); write(state.data, destination, source);
      }
      return;
    }
    if (s.op === '$unset') {
      at(state.data, parts);
      const nested = [...graph.entities.values()].filter(e => e.pointer.startsWith(pointer(parts) + '/'));
      const roots = nested.filter(e => !nested.some(parent => e !== parent && e.pointer.startsWith(parent.pointer + '/')));
      graph.deleteMany(roots.map(root => root.id));
      write(state.data, parts, null, true); return;
    }
    const old = at(state.data, parts, s.op !== '$set');
    if (s.op === '$set') { await this.patchSet(state, parts, this.value(s.value, state, graph), strict, notes); return; }
    if (s.op === '$inc') {
      const amount = number(this.value(s.value, state, graph));
      const next = clamp(this.def, parts, number(old) + amount, strict, notes);
      write(state.data, parts, next);
      return;
    }
    if (s.op === '$transfer') {
      const source = number(old), destinations = entries(s.value), changes: [string[], number][] = [];
      let total = 0;
      const seen = new Set<string>();
      for (const [path, raw] of destinations) {
        const destination = graph.resolve(path, aliases); this.writable(state, destination);
        const key = pointer(destination);
        if (key === pointer(parts) || seen.has(key)) fail('TRANSFER_TARGET', '转移目标不能重复或等于来源');
        seen.add(key);
        const amount = number(this.value(raw, state, graph));
        if (amount < 0) fail('TRANSFER_AMOUNT', '转移数量必须非负');
        total += amount;
        changes.push([destination, number(at(state.data, destination)) + amount]);
      }
      if (!Number.isFinite(total)) fail('INVALID_NUMBER', '转移总额溢出');
      changes.unshift([parts, source - total]);
      for (const [p, value] of changes) write(state.data, p, clamp(this.def, p, value, true, notes));
      return;
    }
    if (!Array.isArray(old)) fail('NOT_ARRAY', '目标必须为数组');
    const value = this.value(s.value, state, graph);
    if (s.op === '$push') {
      const isRef = this.def.refs?.some(r => r.kind === 'array' && matches(r.path, parts));
      if (!isRef || !old.some(v => String(v).replace(/^@/u, '') === String(value).replace(/^@/u, ''))) {
        const schema = unwrap(schemaAt(this.def.schema, parts))?._zod?.def?.element;
        if (!schema) fail('NOT_ARRAY', '目标 Schema 不是数组');
        const parsed = await parseInput(this.def, state, [...parts, String(old.length)], value, strict, notes); assertJson(parsed); old.push(parsed);
      }
    } else if (s.op === '$pull') write(state.data, parts, old.filter(v => canonical(v) !== canonical(value)));
  }
}
