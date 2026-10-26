import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { indexedDB } from 'fake-indexeddb';
import vm from 'node:vm';
import { fixture, binding } from './fixture.js';
import { compile, SolveCore, createArchive, SolveRuntime, IndexedDbCache, toJson, registerMacros, restore, replay } from '../src/index.js';

test('创建实体不能通过整个对象输入写入休眠字段', async () => {
  const { core, state } = await fixture();
  const off = await core.setModule('combat', false, state);
  const result = await core.execute({ $createEntity: { 'characters.@erin': { name: '艾琳', combat: { mp: 30 } } } }, off.state);
  assert.deepEqual(result.state, off.state); assert.equal(result.feedback[0]?.code, 'MODULE_DORMANT');
  const parentRead = await core.execute({ $set: { '@bob': { $valueOf: '@alice' } } }, off.state);
  assert.deepEqual(parentRead.state, off.state);
});
test('新实体整对象数字执行普通Clamp，组内超限失败', async () => {
  const { core, state } = await fixture();
  const normal = await core.execute({ $createEntity: { 'characters.@erin': { hp: 200 } } }, state);
  assert.equal((normal.state.data.characters as any).erin.hp, 100);
  const grouped = await core.execute({ $group: [{ $createEntity: { 'characters.@erin': { hp: 200 } } }] }, state);
  assert.deepEqual(grouped.state, state);
});
test('push遵循显式数值规则，未知字段不被静默剥离', async () => {
  const def = await compile({ id: 'array', version: '1', schema: z.object({ values: z.array(z.number()), objects: z.array(z.object({ x: z.number() })) }), initialData: { values: [], objects: [] }, numeric: { 'values.*': { min: 0 } } });
  const core = new SolveCore(def), state = await core.initialize();
  const result = await core.execute({ $push: { values: -5 } }, state);
  assert.deepEqual(result.state.data.values, [0]);
  const grouped = await core.execute({ $group: [{ $push: { values: -5 } }] }, state);
  assert.deepEqual(grouped.state, state);
  const extra = await core.execute({ $push: { objects: { x: 1, typo: 2 } } }, state);
  assert.deepEqual(extra.state, state);
});
test('销毁整个可选实体容器同样执行引用清理与生命周期', async () => {
  const def = await compile({ id: 'container', version: '1', schema: z.object({ items: z.record(z.string(), z.object({ name: z.string() })).optional(), friend: z.string().nullable() }), initialData: { items: {}, friend: null },
    entities: [{ path: 'items', type: 'item' }], refs: [{ path: 'friend', kind: 'single', onDelete: 'null' }], prefabs: { sword: { type: 'item', data: { name: '剑' } } } });
  const core = new SolveCore(def), state = await core.initialize();
  const created = await core.execute([{ $createEntity: { 'items.@sword': {} } }, { $set: { friend: '@sword' } }], state);
  const deleted = await core.execute({ $unset: ['items'] }, created.state);
  assert.equal(deleted.state.data.items, undefined); assert.equal(deleted.state.data.friend, null);
  assert.equal(deleted.state.engineState.prefabLifecycle.sword, 'destroyed');
});
test('不兼容引用删除策略在编译时拒绝', async () => {
  await assert.rejects(compile({ id: 'bad-ref', version: '1', schema: z.object({}), initialData: {}, refs: [{ path: 'list', kind: 'array', onDelete: 'null' }] }), /不支持/u);
});
test('缺失必需单例和跨实体类型交换被拒绝', async () => {
  const def = await compile({ id: 'singleton', version: '1', schema: z.object({ player: z.object({ hp: z.number() }).optional() }), initialData: {}, entities: [{ path: 'player', type: 'pc', singletonId: 'player' }] });
  await assert.rejects(new SolveCore(def).initialize(), /必需单例/u);
  const cross = await compile({ id: 'types', version: '1', schema: z.object({ pcs: z.record(z.string(), z.object({ hp: z.number() })), mobs: z.record(z.string(), z.object({ hp: z.number() })) }), initialData: { pcs: { p: { hp: 1 } }, mobs: { m: { hp: 2 } } }, entities: [{ path: 'pcs', type: 'pc' }, { path: 'mobs', type: 'mob' }] });
  const core = new SolveCore(cross), state = await core.initialize();
  const result = await core.execute({ $swap: { '@p': '@m' } }, state);
  assert.deepEqual(result.state, state);
});
test('休眠缺失字段不会让transform在失败重试解析中重复执行', async () => {
  let calls = 0;
  const def = await compile({ id: 'dormant-transform', version: '1', schema: z.object({ players: z.record(z.string(), z.object({ name: z.string().transform(v => { calls++; return v.toUpperCase(); }), secret: z.string() })) }),
    initialData: { players: {} }, entities: [{ path: 'players', type: 'pc' }], modules: { secret: { paths: ['players.*.secret'], enabled: false } } });
  const core = new SolveCore(def), state = await core.initialize();
  const result = await core.execute({ $createEntity: { 'players.@p': { name: 'a' } } }, state);
  assert.equal(calls, 1); assert.equal((result.state.data.players as any).p.name, 'A');
  assert.equal(result.feedback.length, 0);
});
test('无匹配路径的投影返回空值而非所有状态，数组保留原下标', async () => {
  const { def, state } = await fixture();
  assert.deepEqual(JSON.parse(toJson(def, state, { paths: ['missing.*'] })), {});
  (state.data.world as any).logs = ['a', 'b', 'c'];
  assert.deepEqual(JSON.parse(toJson(def, state, { paths: ['world.logs.2'] })), { world: { logs: [null, null, 'c'] } });
});
test('solve_val父对象读取不会泄漏休眠字段', async () => {
  const { def, core, state } = await fixture();
  const off = await core.setModule('combat', false, state);
  const macros = new Map<string, any>();
  registerMacros({ registerMacro: (name, opts) => { macros.set(name, opts); return opts; } }, () => ({ definition: def, state: off.state, feedback: [] }));
  assert.throws(() => macros.get('solve_val').handler({ unnamedArgs: ['@alice'] }), /休眠/u);
});
test('缓存命中也不能掩盖被破坏的归档', async () => {
  const { core } = await fixture(); const { archive, headId } = await createArchive(core, binding);
  const cache = new IndexedDbCache(indexedDB, `regression-${crypto.randomUUID()}`);
  await cache.put(archive, headId, await restore(archive, headId));
  archive.commits[headId]!.actions.push({ actionId: 'tamper', kind: 'operations', source: 'model', operations: {} });
  await assert.rejects(cache.restore(archive, headId), /操作记录/u); cache.close();
});
test('重试旧动作返回当前累计修订，不跳回旧分支', async () => {
  const { core } = await fixture(); const { archive, headId } = await createArchive(core, { ...binding, messageId: 'greeting' });
  const runtime = new SolveRuntime(core, archive, headId, { assertCurrent: () => {}, save: async () => {} }); await runtime.ready();
  const a = { actionId: 'a', kind: 'operations' as const, source: 'model' as const, operations: { $inc: { '@alice.hp': -10 } } };
  await runtime.submit(a, binding, 'a');
  const latest = await runtime.submit({ ...a, actionId: 'b' }, binding, 'b');
  assert.equal((await runtime.submit(a, binding, 'a')).id, latest.id);
  assert.equal(runtime.headId, latest.id);
});
test('同一Swipe累计修订不能叠加到自身上Replay', async () => {
  const { core } = await fixture(); const { archive, headId } = await createArchive(core, { ...binding, messageId: 'greeting' });
  const runtime = new SolveRuntime(core, archive, headId, { assertCurrent: () => {}, save: async () => {} }); await runtime.ready();
  const first = await runtime.submit({ actionId: 'a', kind: 'operations', source: 'model', operations: { $inc: { '@alice.hp': -10 } } }, binding, 'a');
  await assert.rejects(replay(core, runtime.archive, [first.id], first.id), /父状态/u);
});
test('显式创建中的点号ID可净化，净化碰撞不覆盖', async () => {
  const { core, state } = await fixture();
  const result = await core.execute({ $createEntity: { 'characters.@Dr.Brown': {} } }, state);
  assert.ok((result.state.data.characters as any).Dr_Brown);
  const bad = await core.execute({ $createEntity: { 'characters.@Dr.Brown': {} } }, result.state);
  assert.deepEqual(bad.state, result.state); assert.equal(bad.feedback[0]?.code, 'KEY_COLLISION');
});
test('实体交换保留ID，实体内容不能被换到另一ID名下', async () => {
  const { core, state, def } = await fixture();
  const created = await core.execute({ $createEntity: { 'characters.alice.items.@shield': { name: '盾' } } }, state);
  const swapped = await core.execute({ $swap: { '@shield': '@sword' } }, created.state);
  assert.equal((swapped.state.data.storage as any).shield.name, '盾');
  assert.equal((swapped.state.data.characters as any).alice.items.sword.name, '剑');
  assert.equal((swapped.state.data.storage as any).sword, undefined);
});
test('整体删除容器时内部restrict引用不阻止整片删除', async () => {
  const def = await compile({ id: 'delete-container', version: '1', schema: z.object({ people: z.record(z.string(), z.object({ friend: z.string().nullable() })).optional() }),
    initialData: { people: { a: { friend: '@b' }, b: { friend: '@a' } } }, entities: [{ path: 'people', type: 'pc' }], refs: [{ path: 'people.*.friend', kind: 'single', onDelete: 'restrict' }] });
  const core = new SolveCore(def), state = await core.initialize();
  const result = await core.execute({ $unset: ['people'] }, state);
  assert.equal(result.state.data.people, undefined); assert.equal(result.feedback.length, 0);
});
test('destroyOnZero对set及inc一致，失败组仍可撤回销毁', async () => {
  const { core, state } = await fixture({ numeric: { 'storage.*.count': { destroyOnZero: true } } });
  const result = await core.execute({ $set: { '@sword.count': 0 } }, state);
  assert.equal((result.state.data.storage as any).sword, undefined);
  const failed = await core.execute({ $group: [{ $set: { '@sword.count': 0 } }, { $inc: { '@sword.count': -1 } }] }, state);
  assert.deepEqual(failed.state, state);
});
test('Zod跨字段refine在group最终候选上校验', async () => {
  const def = await compile({ id: 'zod-refine', version: '1', schema: z.object({ a: z.number(), b: z.number() }).refine(s => s.a + s.b === 100, '总和必须100'), initialData: { a: 50, b: 50 } });
  const core = new SolveCore(def), state = await core.initialize();
  const grouped = await core.execute({ $group: [{ $inc: { a: -10 } }, { $inc: { b: 10 } }] }, state);
  assert.deepEqual(grouped.state.data, { a: 40, b: 60 }); assert.equal(grouped.feedback.length, 0);
  const independent = await core.execute({ $inc: { a: -10 } }, state);
  assert.deepEqual(independent.state, state);
});
test('编译不调用动态default函数，初始化只调用一次', async () => {
  let calls = 0;
  const def = await compile({ id: 'default-callback', version: '1', schema: z.object({ n: z.number().default(() => { calls++; return 5; }) }), initialData: {} });
  assert.equal(calls, 0);
  const core = new SolveCore(def), state = await core.initialize();
  assert.equal(calls, 1); assert.equal(state.data.n, 5);
  await core.execute({ $inc: { n: 1 } }, state); assert.equal(calls, 1);
});
test('编译后外部修改实体/模块元数据不会改变当前会话规则', async () => {
  const entities = [{ path: 'people', type: 'pc' }];
  const def = await compile({ id: 'immutable', version: '1', schema: z.object({ people: z.record(z.string(), z.object({ hp: z.number() })) }), initialData: { people: { p: { hp: 1 } } }, entities });
  entities[0]!.type = 'changed'; entities.push({ path: 'other', type: 'bad' });
  assert.equal(def.entities![0]!.type, 'pc'); assert.equal(def.entities!.length, 1);
});
test('来自iframe等其他JS上下文的普通JSON指令可执行，Date仍拒绝', async () => {
  const { core, state } = await fixture();
  const operations = vm.runInNewContext('({$inc:{"@alice.hp":-10}})');
  const result = await core.execute(operations, state);
  assert.equal((result.state.data.characters as any).alice.hp, 90);
  await assert.rejects(core.execute({ $set: { 'world.weather': new Date() } }, state));
});
