// 导出示例世界（examples/official）的数据，供 scripts/live-statusbar.mjs 在酒馆里写入。
// 关闭模块下的休眠字段会被剔掉（玩家写入时不允许碰休眠字段）。用法：npx tsx scripts/dump-example-state.ts [输出路径]
import { writeFileSync } from 'node:fs';
import { compile, compileStructure, SolveCore } from '../src/index.js';
import { dormant } from '../src/schema.js';
import { exampleState, exampleStructure } from '../examples/official/example.js';

const def = await compile(compileStructure(exampleStructure));
const state = await exampleState(new SolveCore(def));
const strip = (value: unknown, parts: string[]): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const at = [...parts, key];
    if (dormant(def, state, at)) continue;
    out[key] = strip(child, at);
  }
  return out;
};
/**
 * As player operations: each statement is checked on its own, so entities go in dependency order, and the references
 * that would form a cycle (items kept in a building owned by a character) are written last.
 */
const seedOps = (data: Record<string, any>) => {
  const { meta, ...rest } = data;
  const order = ['abilities', 'items', 'places', 'characters', 'buildings', 'factions', 'lore'];
  const roots: Record<string, any> = Object.fromEntries(order.filter(k => k in rest).map(k => [k, structuredClone(rest[k])]));
  const later: Record<string, unknown> = {};
  for (const [cid, c] of Object.entries<any>(roots.characters ?? {})) for (const [iid, it] of Object.entries<any>(c.items ?? {})) {
    if (it?.stored) { later[`characters.${cid}.items.${iid}.stored`] = it.stored; delete it.stored; }
  }
  const metaSet = Object.fromEntries(Object.entries<any>(meta ?? {}).filter(([k]) => k !== 'round').map(([k, v]) => ['meta.' + k, v]));
  return [{ $set: { ...roots, ...metaSet } }, ...(Object.keys(later).length ? [{ $set: later }] : [])];
};
const data = strip(state.data, []) as Record<string, any>;
const path = process.argv[2] ?? '/tmp/solve-example-state.json';
writeFileSync(path, JSON.stringify({ data, ops: seedOps(data), modules: state.engineState.activeModules }));
console.log('已导出示例数据：' + path);
