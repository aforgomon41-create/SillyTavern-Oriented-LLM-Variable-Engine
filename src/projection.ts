import { encode } from '@toon-format/toon';
import { at, assertJson, clone, covered, expand, fail, matches, pointer, segments } from './json.js';
import { EntityGraph } from './entities.js';
import { dormant, isModuleEnabled } from './schema.js';
import { selectGuides } from './guides.js';
import { schemaText } from './schema-text.js';
import { projectFacets } from './facets.js';
import type { CompiledDefinition, Feedback, Json, LogicalState, View } from './types.js';
import { applyProjectionRules, computedFor, listWarnings, migrationText, presetText } from './features.js';

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
        for (const computed of computedFor(def, p, child)) {
          const computedKey = `${outputKey}(${computed.label})`;
          if (!Object.hasOwn(value, computedKey)) out[computedKey] = computed.value;
        }
      }
      return out;
    }
    return value;
  }
  // Declarative prompt rules only shape whole-state projections; explicit paths stay exact.
  const source = options.paths?.length ? state.data : applyProjectionRules(def.projection, state.data);
  const filtered = projectFacets(def, walk(source, []), view, options.paths);
  // Custom projectors only receive filtered state; they cannot recover dormant data.
  const custom = def.views?.[view];
  const result = custom ? custom(clone(filtered)) : filtered;
  assertJson(result);
  return result;
}
export function toJson(def: CompiledDefinition, state: LogicalState, options: ProjectionOptions = {}): string { return JSON.stringify(project(def, state, options)); }
export function toToon(def: CompiledDefinition, state: LogicalState, options: ProjectionOptions = {}): string { return encode(project(def, state, options)); }
export function guide(def: CompiledDefinition, state: LogicalState, tag?: string): string {
  const engine = tag ? [] : [
    ...(state.engineState.migration ? [migrationText(def, state.engineState.migration)] : []),
    ...listWarnings(def, state, parts => dormant(def, state, parts)),
    presetText(def, state),
  ];
  return [tag ? '' : def.guide ?? '', ...Object.entries(def.modules ?? {}).filter(([name]) => (!tag || tag === name) && isModuleEnabled(def, state, name)).map(([, m]) => m.guide ?? ''), ...selectGuides(def, state, tag), ...engine].filter(Boolean).join('\n');
}
/** How to write operations, for the model: every operator with its argument shape, the execution rules and an example. */
export function sop(): string {
  return [
    '## SOLVE 变量操作说明',
    '变量有变化时，在回复末尾输出唯一一个 <solve_operate>…</solve_operate>，里面是 JSON：一个操作对象，或按顺序执行的操作对象数组。只写本回合实际发生的变化；没有变化可以不输出。<solve_mutual_operate> 记录的是玩家在状态栏里的操作，不要自己写。',
    '',
    '### 路径',
    '- 键名用 . 连接。已有的实体用 @ID 开头，不管它放在哪里：@lena.condition、@lena.items.cowrie.count。不属于实体的数据从根写起：meta.weather。新建实体写集合路径：characters.lena。',
    '- 当前变量里带 @ 的键（如 @lena）是实体 ID，真实键名不带 @。字段名照「数据结构」写（没有数据结构时照当前变量里出现的写），不要翻译或自造。',
    '',
    '### 算子',
    '一个操作对象里可以放多个算子，每个算子的参数里可以写多条。',
    '- $set {路径: 值}：写入。值为对象时只合并写到的键，其余键保留；数组和其他值整体替换。同一个 $set 里不要同时写父路径和它的子路径。',
    '- $inc {路径: 数}：加减数值，负数为减。',
    '- $transfer {来源路径: {目标路径: 数, …}}：从来源扣除、加到各目标，总数守恒；数量不能为负，目标还没有时从 0 开始；来源扣到下限以下时整条失败。用于付钱、交易、存取。',
    '- $push {数组路径: 元素}：在数组末尾追加一个元素；引用列表里已有的 ID 不会重复添加。',
    '- $pull {数组路径: 元素}：删除数组里所有等于该元素的项。',
    '- $createEntity {"集合.新ID": {字段…}}：新建实体，没写的字段用默认值。加 "$from": "模板ID" 以模板或预制实体为底另建一个独立实体；预制实体用它自己的 ID 创建（如 {"characters.cassius": {}}），只能登场一次。新 ID 已被占用时引擎会改名为 ID_2，本回合后面再用原 ID 会失败，所以先确认 ID 没被用过。',
    '- $move {来源路径: 目标路径}：搬移。实体搬到另一个接受同类实体的容器（目标写容器路径，ID 不变）；普通值搬到目标路径，目标处不能已有值。',
    '- $swap {路径A: 路径B}：交换两处的值；交换实体时两边必须是同类实体。',
    '- $unset "路径" 或 ["路径", …]：删除字段；指向实体时等于删除该实体。',
    '- $deleteEntity "@ID" 或 ["@ID", …]：删除实体，连同它下面的实体。',
    '- $group [操作对象, …]：按顺序执行，全部成功才生效，有一条失败就整组撤回；组内越界或超过单次变化上限直接失败，不再自动修正。用于必须一起成立的变化（如交易的付钱和交货）。可嵌套，最多 8 层。',
    '- 取值：任何算子的值都可以写 {"$valueOf": "路径"}，读取这条操作开始前该路径的值；可加 "$mul": 系数。如把生命回满：{"$set": {"@lena.rp.gauges.生命.value": {"$valueOf": "@lena.rp.gauges.生命.max"}}}。',
    '',
    '### 执行规则',
    '- 数组里的操作对象按先后执行。同一个对象里的算子按固定顺序执行：$createEntity → $move → $swap → $set → $inc → $transfer → $push → $pull → $unset → $deleteEntity → $group。有先后依赖时（如先新建再修改），拆成数组里的两个对象。',
    '- 填实体 ID 的字段（所在地点、在场角色、相关条目等）只能指向已经存在的实体，或数组里更靠前的对象新建的实体；否则这条操作失败，依赖它的后续操作也会失败。',
    '- 每条操作单独生效，一条失败不影响其他条（$group 内除外）。',
    '- 数值超出上下限时截到边界；超过单次变化上限时截掉超出部分；要求整数的字段写小数会失败。',
    '- 轮次等系统字段由引擎维护，不能改；清单满了不能再加，先合并或删除旧条目。',
    '- 被修正或失败的操作会出现在下一轮的反馈里，照反馈改正。',
    '',
    '### 示例',
    '一个回复末尾的操作块：先新建地点、角色和货币，再在后面的对象里引用它们。ID 和名字只为说明写法，实际按「数据结构」和当前变量写。',
    '<solve_operate>',
    '[',
    '  {"$createEntity": {"places.harbor": {"name": "灰港"}, "characters.lena": {"name": "莉娜", "role": "主要配角"}, "items.cowrie": {"name": "贝币", "type": "货币"}}},',
    '  {"$set": {"meta.location": "harbor", "meta.weather": "暴雨", "@lena.condition": "左臂流血", "@lena.items.cowrie": {"count": 30}}, "$push": {"meta.present": "lena"}},',
    '  {"$inc": {"@lena.items.cowrie.count": -5}}',
    ']',
    '</solve_operate>',
  ].join('\n');
}
export interface MacroRegistry { registerMacro(name: string, options: Record<string, unknown>): unknown; unregisterMacro?(name: string): unknown }
export function registerMacros(registry: MacroRegistry, read: () => { definition: CompiledDefinition; state: LogicalState; feedback: Feedback[] }): () => void {
  const names = ['solve_toon', 'solve_json', 'solve_val', 'solve_SOP', 'solve_schema', 'solve_guide', 'solve_feedback'];
  for (const name of names) {
    const registered = registry.registerMacro(name, {
      category: 'solve', unnamedArgs: [{ name: 'selector', optional: true }],
      description: 'SOLVE 已归档状态',
      handler: (ctx: any) => {
        // The operation guide does not depend on the state.
        if (name === 'solve_SOP') return sop();
        // Not ready (history needs a replay, chat switching…): output nothing rather than stale state or a broken prompt.
        // The request still goes out; SOLVE tells the player this turn is not tracked.
        let snapshot: ReturnType<typeof read>;
        try { snapshot = read(); } catch { return ''; }
        const arg = String(ctx.unnamedArgs?.[0] ?? '').trim();
        if (name === 'solve_schema') return schemaText(snapshot.definition, snapshot.state);
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
