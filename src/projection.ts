import { encode } from '@toon-format/toon';
import { at, assertJson, clone, covered, expand, fail, matches, pointer, segments } from './json.js';
import { EntityGraph } from './entities.js';
import { dormant, isModuleEnabled } from './schema.js';
import { OPERATORS } from './engine.js';
import type { CompiledDefinition, Feedback, Json, LogicalState, View } from './types.js';

export interface ProjectionOptions { view?: View; paths?: string[] }
export function project(def: CompiledDefinition, state: LogicalState, options: ProjectionOptions = {}): Json {
  const view = options.view ?? 'full';
  if (!['full', 'narrative', 'operator'].includes(view) && !Object.hasOwn(def.views ?? {}, view)) fail('VIEW_NOT_FOUND', `未知视图：${view}`);
  const graph = new EntityGraph(def, state);
  const allowed = new Set<string>();
  if (options.paths?.length) for (const requested of options.paths) {
    const parts = requested.includes('*') && !requested.startsWith('@') ? undefined : graph.resolve(requested);
    if (parts) allowed.add(pointer(parts));
    else for (const found of expand(state.data, requested)) allowed.add(pointer(found.parts));
  }
  if (options.paths?.length && !allowed.size) return {};
  function walk(value: any, parts: string[]): any {
    if (parts.length && dormant(def, state, parts)) return undefined;
    if (view === 'narrative' && def.internal?.some(p => covered(p, parts))) return undefined;
    if (view === 'operator' && def.readonly?.some(p => covered(p, parts))) return undefined;
    const path = pointer(parts);
    if (allowed.size && parts.length && ![...allowed].some(a => a === path || a.startsWith(path + '/') || path.startsWith(a + '/'))) return undefined;
    if (Array.isArray(value)) return value.map((v, i) => walk(v, [...parts, String(i)]) ?? null);
    if (value && typeof value === 'object') {
      const out: Record<string, Json> = {};
      for (const [key, child] of Object.entries(value)) {
        const p = [...parts, key], result = walk(child, p);
        if (result === undefined) continue;
        const entity = graph.entityAt(p);
        const outputKey = entity ? `@${entity.id}` : key;
        if (Object.hasOwn(out, outputKey)) fail('PROJECTION_KEY_COLLISION', `实体标记导致键冲突：${outputKey}`);
        out[outputKey] = result;
      }
      return out;
    }
    return value;
  }
  const filtered = walk(state.data, []);
  // Custom projectors only receive filtered state; they cannot recover dormant data.
  const custom = def.views?.[view];
  const result = custom ? custom(clone(filtered)) : filtered;
  assertJson(result);
  return result;
}
export function toJson(def: CompiledDefinition, state: LogicalState, options: ProjectionOptions = {}): string { return JSON.stringify(project(def, state, options)); }
export function toToon(def: CompiledDefinition, state: LogicalState, options: ProjectionOptions = {}): string { return encode(project(def, state, options)); }
export function guide(def: CompiledDefinition, state: LogicalState, tag?: string): string {
  return [tag ? '' : def.guide ?? '', ...Object.entries(def.modules ?? {}).filter(([name]) => (!tag || tag === name) && isModuleEnabled(def, state, name)).map(([, m]) => m.guide ?? '')].filter(Boolean).join('\n');
}
export function sop(): string {
  return `通过 <solve_operate> 输出 JSON。实体路径用 @ID.field；真实数据键不带 @。支持 ${OPERATORS.join(', ')}。普通算子按创建、移动/交换、数值、数组、销毁执行。$group 接收有序操作数组，全部成功才生效；组内越界直接失败。$valueOf 读取本条开始时状态，可选 $mul。示例：{"$group":[{"$inc":{"@player.gold":-50}},{"$move":{"@sword":"@player.items"}}]}。`;
}
export interface MacroRegistry { registerMacro(name: string, options: Record<string, unknown>): unknown; unregisterMacro?(name: string): unknown }
export function registerMacros(registry: MacroRegistry, read: () => { definition: CompiledDefinition; state: LogicalState; feedback: Feedback[] }): () => void {
  const names = ['solve_toon', 'solve_json', 'solve_val', 'solve_SOP', 'solve_guide', 'solve_feedback'];
  for (const name of names) {
    const registered = registry.registerMacro(name, {
      category: 'solve', unnamedArgs: [{ name: 'selector', optional: true }],
      description: 'SOLVE 已归档状态',
      handler: (ctx: any) => {
        const snapshot = read(); // throws clearly if state has not been restored
        const arg = String(ctx.unnamedArgs?.[0] ?? '').trim();
        if (name === 'solve_SOP') return sop();
        if (name === 'solve_guide') return guide(snapshot.definition, snapshot.state, arg || undefined);
        if (name === 'solve_feedback') return snapshot.feedback.length ? JSON.stringify(snapshot.feedback) : '';
        if (name === 'solve_val') {
          const graph = new EntityGraph(snapshot.definition, snapshot.state), parts = graph.resolve(arg);
          if (dormant(snapshot.definition, snapshot.state, parts)) fail('MODULE_DORMANT', '宏不能读取休眠字段');
          for (const [name, module] of Object.entries(snapshot.definition.modules ?? {})) {
            if (isModuleEnabled(snapshot.definition, snapshot.state, name)) continue;
            if (module.paths.some(pattern => expand(snapshot.state.data, pattern).some(found => covered(pointer(parts), found.parts)))) fail('MODULE_DORMANT', '宏不能整体读取包含休眠字段的父对象');
          }
          const value = at(snapshot.state.data, parts);
          return typeof value === 'string' ? value : JSON.stringify(value);
        }
        const options = ['full', 'narrative', 'operator', ...Object.keys(snapshot.definition.views ?? {})].includes(arg)
          ? { view: arg } : arg ? { paths: arg.split(',').map(p => p.trim()) } : {};
        return name === 'solve_json' ? toJson(snapshot.definition, snapshot.state, options) : toToon(snapshot.definition, snapshot.state, options);
      }
    });
    if (registered === null || registered === false) fail('MACRO_REGISTRATION', `宿主拒绝注册宏：${name}`);
  }
  return () => { for (const name of names) registry.unregisterMacro?.(name); };
}
