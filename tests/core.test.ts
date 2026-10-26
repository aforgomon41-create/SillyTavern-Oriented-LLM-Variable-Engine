import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { fixture } from './fixture.js';
import { EntityGraph, parseOperations, extractBlocks, stripBlocks, toJson, toToon, project, registerMacros, compile, SolveCore } from '../src/index.js';

test('初始化默认值，@寻址与普通相同名字不混淆', async () => {
  const { core, state, def } = await fixture();
  assert.equal((state.data.characters as any).alice.hp, 100);
  const result = await core.execute({ $inc: { '@alice.hp': -15 } }, state);
  assert.equal((result.state.data.characters as any).alice.hp, 85);
  assert.equal((state.data.characters as any).alice.hp, 100);
  assert.equal(new EntityGraph(def, result.state).entities.size, 3);
  assert.equal(result.feedback.length, 0);
});
test('普通数值Clamp；不合法路径局部失败', async () => {
  const { core, state } = await fixture();
  const result = await core.execute({ $inc: { '@alice.hp': -200, '@ghost.hp': -1 }, $set: { 'world.weather': '雨' } }, state);
  assert.equal((result.state.data.characters as any).alice.hp, 0);
  assert.equal((result.state.data.world as any).weather, '雨');
  assert.ok(result.feedback.some(f => f.code === 'CLAMP_APPLIED'));
  assert.ok(result.feedback.some(f => f.level === 'L3'));
});
test('group成功扣钱并移动实体，索引指向新位置', async () => {
  const { core, state, def } = await fixture();
  const result = await core.execute({ $group: [{ $inc: { '@alice.gold': -30 } }, { $move: { '@sword': '@alice.items' } }] }, state);
  assert.equal(result.feedback.length, 0);
  assert.equal((result.state.data.characters as any).alice.gold, 20);
  assert.equal(new EntityGraph(def, result.state).entities.get('sword')?.pointer, '/characters/alice/items/sword');
});
test('group余额不足整体失败，组外操作成功', async () => {
  const { core, state } = await fixture();
  const result = await core.execute({ $set: { 'world.weather': '雨' }, $group: [{ $inc: { '@alice.gold': -100 } }, { $move: { '@sword': '@alice.items' } }] }, state);
  assert.equal((result.state.data.characters as any).alice.gold, 50);
  assert.ok((result.state.data.storage as any).sword);
  assert.equal((result.state.data.world as any).weather, '雨');
  assert.deepEqual(result.feedback.map(f => f.code), ['GROUP_ROLLED_BACK']);
});
test('group后续失败回退创建、ID映射及预制生命周期', async () => {
  const { core, state } = await fixture();
  const result = await core.execute({ $group: [{ $createEntity: { 'storage.@key': {} } }, { $inc: { '@alice.hp': '不是数字' } }] }, state);
  assert.deepEqual(result.state, state);
  assert.deepEqual(result.aliases, {});
  assert.equal(result.applied, 0);
});
test('嵌套group成功后外层失败撤回全部', async () => {
  const { core, state } = await fixture();
  const result = await core.execute({ $group: [{ $group: [{ $inc: { '@alice.hp': -10 } }] }, { $unset: ['world.weather'] }] }, state);
  assert.deepEqual(result.state, state);
});
test('group跨字段规则在最终状态校验', async () => {
  const { core, state } = await fixture({ validateState: s => {
    const c = s.data.characters as any;
    if (c.alice.gold + c.bob.gold !== 100) throw new Error('总额必须100');
  } });
  const result = await core.execute({ $group: [{ $inc: { '@alice.gold': -10 } }, { $inc: { '@bob.gold': 10 } }] }, state);
  assert.equal(result.feedback.length, 0);
  assert.equal((result.state.data.characters as any).bob.gold, 60);
});
test('group异步校验失败无半成品', async () => {
  const { core, state } = await fixture({ validateState: async s => {
    await Promise.resolve();
    if ((s.data.characters as any).alice.gold < 40) throw new Error('异步拒绝');
  } });
  const result = await core.execute({ $group: [{ $inc: { '@alice.gold': -20 } }, { $createEntity: { 'storage.@new': {} } }] }, state);
  assert.deepEqual(result.state, state);
});
test('转移守恒、余额不足及目的地上限整笔拒绝', async () => {
  const { core, state } = await fixture();
  const good = await core.execute({ $transfer: { '@alice.gold': { '@bob.gold': 30 } } }, state);
  assert.equal((good.state.data.characters as any).alice.gold, 20);
  assert.equal((good.state.data.characters as any).bob.gold, 80);
  const bad = await core.execute({ $transfer: { '@alice.hp': { '@bob.hp': 30 } } }, state);
  assert.deepEqual(bad.state, state);
  const insufficient = await core.execute({ $transfer: { '@alice.gold': { '@bob.gold': 80 } } }, state);
  assert.deepEqual(insufficient.state, state);
});
test('固定阶段先set后inc，valueOf读取当前Statement开始前状态', async () => {
  const { core, state } = await fixture();
  const result = await core.execute({ $inc: { '@alice.hp': -10 }, $set: { '@alice.hp': 70, '@bob.hp': { $valueOf: '@alice.hp', $mul: 0.5 } } }, state);
  assert.equal((result.state.data.characters as any).alice.hp, 60);
  assert.equal((result.state.data.characters as any).bob.hp, 35);
});
test('实体删除清理单值/数组/字典引用，拥有子树一起删除', async () => {
  const { core, state, def } = await fixture();
  (state.data.characters as any).bob.friend = '@alice';
  (state.data.characters as any).bob.friends = ['@alice', '@sword'];
  (state.data.characters as any).bob.relations = { alice: 20 };
  const moved = await core.execute({ $move: { '@sword': '@alice.items' } }, state);
  const result = await core.execute({ $deleteEntity: ['@alice'] }, moved.state);
  assert.equal((result.state.data.characters as any).alice, undefined);
  assert.equal((result.state.data.characters as any).bob.friend, null);
  assert.deepEqual((result.state.data.characters as any).bob.friends, []);
  assert.deepEqual((result.state.data.characters as any).bob.relations, {});
  assert.equal(new EntityGraph(def, result.state).entities.size, 1);
});
test('restrict引用令删除及整个group失败', async () => {
  const { core, state } = await fixture({ refs: [{ path: 'characters.*.friend', kind: 'single', onDelete: 'restrict' }] });
  (state.data.characters as any).bob.friend = '@alice';
  const result = await core.execute({ $group: [{ $inc: { '@bob.hp': -10 } }, { $deleteEntity: ['@alice'] }] }, state);
  assert.deepEqual(result.state, state);
});
test('父子移动与覆盖拒绝；交换保持类型约束', async () => {
  const { core, state } = await fixture();
  const move = await core.execute({ $move: { '@alice': '@alice.items' } }, state);
  assert.deepEqual(move.state, state);
  const swap = await core.execute({ $swap: { '@alice.hp': '@bob.hp' } }, state);
  assert.equal((swap.state.data.characters as any).alice.hp, 80);
  const bad = await core.execute({ $swap: { '@alice.hp': '@alice.name' } }, state);
  assert.deepEqual(bad.state, state);
});
test('set合并不丢同级字段，新增实体自动升级并补默认', async () => {
  const { core, state, def } = await fixture();
  const result = await core.execute({ $set: { 'world': { weather: '雪' }, 'characters.erin': { name: '艾琳' } }, $inc: { '@erin.hp': -10 } }, state);
  assert.deepEqual((result.state.data.world as any).logs, []);
  assert.equal((result.state.data.characters as any).erin.hp, 90);
  assert.ok(new EntityGraph(def, result.state).entities.has('erin'));
});
test('引用push去重，pull移除所有结构相等元素', async () => {
  const { core, state } = await fixture();
  const result = await core.execute([{ $push: { '@alice.friends': '@bob', '@alice.tags': '毒' } }, { $push: { '@alice.friends': '@bob', '@alice.tags': '毒' } }, { $pull: { '@alice.tags': '毒' } }], state);
  assert.deepEqual((result.state.data.characters as any).alice.friends, ['@bob']);
  assert.deepEqual((result.state.data.characters as any).alice.tags, []);
});
test('模板创建，预制只唤醒一次', async () => {
  const { core, state } = await fixture();
  const created = await core.execute({ $createEntity: { 'storage.@potion1': { $from: '@potion' }, 'storage.@key': {} } }, state);
  assert.equal((created.state.data.storage as any).potion1.name, '药水');
  const deleted = await core.execute({ $deleteEntity: ['@key'] }, created.state);
  const twice = await core.execute({ $createEntity: { 'storage.@key': {} } }, deleted.state);
  assert.equal(twice.state.engineState.prefabLifecycle.key, 'destroyed');
  assert.equal(twice.feedback[0]?.code, 'PREFAB_LIFECYCLE');
});
test('冲突实体稳定改名，后续含糊ID拒绝', async () => {
  const { core, state } = await fixture();
  const result = await core.execute([{ $createEntity: { 'characters.@alice': { name: '另一人' } } }, { $inc: { '@alice.hp': -5 } }], state);
  assert.equal((result.state.data.characters as any).alice.hp, 100);
  assert.equal((result.state.data.characters as any).alice_2.name, '另一人');
  assert.ok(result.feedback.some(f => f.code === 'AMBIGUOUS_ALIAS'));
});
test('模块关闭保留真实值，禁止读取与写入，启用后恢复', async () => {
  const { core, state, def } = await fixture();
  const off = await core.setModule('combat', false, state);
  assert.equal((off.state.data.characters as any).alice.combat.mp, 20);
  const result = await core.execute({ $set: { '@alice.hp': { $valueOf: '@alice.combat.mp' } }, $inc: { '@alice.combat.mp': -1 } }, off.state);
  assert.deepEqual(result.state, off.state);
  assert.equal((JSON.parse(toJson(def, result.state)).characters['@alice']).combat, undefined);
  const on = await core.setModule('combat', true, result.state);
  assert.equal((on.state.data.characters as any).alice.combat.mp, 20);
});
test('TOON和紧凑JSON采用相同实体标记与视图过滤', async () => {
  const { def, state } = await fixture();
  const text = toJson(def, state, { view: 'narrative' });
  assert.equal(text.includes('\n'), false);
  assert.equal(JSON.parse(text).characters['@alice'].secret, undefined);
  assert.equal(JSON.parse(text).settings.alice, '普通键');
  assert.ok(toToon(def, state, { view: 'narrative' }).includes('@alice'));
  const selected = JSON.parse(toJson(def, state, { paths: ['@alice.hp'] }));
  assert.deepEqual(selected, { characters: { '@alice': { hp: 100 } } });
});
test('宏注册两个格式，读取同一状态，支持选择器', async () => {
  const { def, state } = await fixture();
  const macros = new Map<string, any>();
  registerMacros({ registerMacro: (name, opts) => { macros.set(name, opts); return opts; } }, () => ({ definition: def, state, feedback: [] }));
  assert.equal(macros.size, 6);
  assert.equal(JSON.parse(macros.get('solve_json').handler({ unnamedArgs: ['operator'] })).characters['@alice'].bio, undefined);
  assert.ok(macros.get('solve_toon').handler({ unnamedArgs: ['@alice.hp'] }).includes('100'));
  assert.equal(macros.get('solve_val').handler({ unnamedArgs: ['@alice.hp'] }), '100');
});
test('危险路径、非法JSON值、重复与不完整操作块拒绝', async () => {
  const { core, state } = await fixture();
  const result = await core.execute({ $set: { 'world.__proto__.polluted': true } }, state);
  assert.ok(result.feedback.some(f => f.code === 'UNSAFE_PATH'));
  assert.equal(({} as any).polluted, undefined);
  assert.throws(() => parseOperations('{"$eval":"alert(1)"}'));
  assert.throws(() => extractBlocks('<solve_operate>{}'));
  assert.throws(() => extractBlocks('<solve_operate>{}</solve_operate><solve_operate>{}</solve_operate>'));
  assert.equal(stripBlocks('剧情<solve_operate>{"$inc":{}}</solve_operate>'), '剧情');
  assert.deepEqual(extractBlocks('<solve_operate>{"$set":{"world.weather":"雨"}}</solve_operate>').model, { $set: { 'world.weather': '雨' } });
  await assert.rejects(core.execute({ $set: { 'world.weather': NaN } }, state));
});
test('transform仅在输入边界运行；数值计算和已存状态校验不再运行', async () => {
  let calls = 0;
  const def = await compile({ id: 'transform-card', version: '1', schema: z.object({ x: z.number().transform(v => { calls++; return v + 1; }), y: z.number() }),
    outputSchema: z.object({ x: z.number(), y: z.number() }), initialData: { x: 1, y: 1 } });
  const core = new SolveCore(def), state = await core.initialize();
  assert.equal(calls, 1); assert.equal(state.data.x, 2);
  const result = await core.execute({ $inc: { y: 1 } }, state);
  assert.equal(calls, 1); assert.equal(result.state.data.x, 2);
  const set = await core.execute({ $set: { x: 3 } }, result.state);
  assert.equal(calls, 2); assert.equal(set.state.data.x, 4);
});
