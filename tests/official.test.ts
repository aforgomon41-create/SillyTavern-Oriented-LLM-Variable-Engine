import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, SolveCore, compileStructure, officialStructure, project, guide, toJson, applyAction, computeAll, selectBgm, nextRound } from '../src/index.js';
import { exampleData, exampleState } from '../examples/official/example.js';
import type { Action, LogicalState } from '../src/types.js';

async function official() {
  const def = await compile(compileStructure(officialStructure));
  const core = new SolveCore(def);
  return { def, core, state: await exampleState(core) };
}
const model = (operations: any, round?: number): Action => ({ actionId: 'm' + Math.random(), kind: 'operations', source: 'model', operations, ...(round !== undefined ? { authorInputs: { solveRound: round } } : {}) });
const data = (state: LogicalState) => state.data as any;

test('官方结构可编译，示例数据通过校验，指纹稳定且不含展示信息', async () => {
  const { def, state } = await official();
  assert.equal(data(state).characters.erin.rp.attributes.wod.str, 23);
  assert.equal(data(state).characters.ash.rp.attributes.wod.sta, null);
  const again = await compile(compileStructure({ ...officialStructure, display: { layout: [] } }));
  assert.equal(again.fingerprint, def.fingerprint, '布局变化不改变定义指纹');
  assert.equal(def.display?.labels?.['characters.*.rp.attributes.wod.str'], '力量');
  assert.equal(def.display?.spoiler?.['items.*.truth'], 'hidden');
});

test('轮次：模型动作写入楼层号且不回退，模型不能直接改，关键事件自动盖轮次', async () => {
  const { core, state, def } = await official();
  assert.equal(nextRound(def, state, 44), 44);
  assert.equal(nextRound(def, state, 30), 43, '楼层号回退时仍递增');
  const result = await applyAction(core, model({ $push: { '@erin.relations.mira.keyEvents': '一起喝了一杯' }, $set: { 'meta.round': 999 } }, 44), state);
  assert.equal(data(result.state).meta.round, 44);
  assert.ok(result.feedback.some(f => f.code === 'SYSTEM_FIELD'));
  assert.deepEqual(data(result.state).characters.erin.relations.mira.keyEvents.at(-1), { round: 44, text: '一起喝了一杯' });
  const user = await applyAction(core, { actionId: 'u', kind: 'operations', source: 'user', operations: { $set: { 'meta.round': 50 } } }, result.state);
  assert.equal(data(user.state).meta.round, 50, '玩家可手动修正');
});

test('单次变化上限：普通操作截断，原子组内失败，玩家设置可调整或关闭', async () => {
  const { core, state } = await official();
  const clamped = await core.execute({ $inc: { '@erin.relations.mira.affection': 30 } }, state);
  assert.equal(data(clamped.state).characters.erin.relations.mira.affection, 45);
  assert.ok(clamped.feedback.some(f => f.code === 'DELTA_CLAMPED'));
  const set = await core.execute({ $set: { '@erin.relations.mira.affection': 0 } }, state);
  assert.equal(data(set.state).characters.erin.relations.mira.affection, 25);
  const group = await core.execute({ $group: [{ $inc: { '@erin.relations.mira.affection': 30 } }] }, state);
  assert.equal(data(group.state).characters.erin.relations.mira.affection, 35);
  assert.ok(group.feedback.some(f => f.code === 'GROUP_ROLLED_BACK'));
  const off = await core.setSettings({ maxDelta: { 'characters.*.relations.*.affection': 0 } }, state);
  const free = await core.execute({ $inc: { '@erin.relations.mira.affection': 30 } }, off.state);
  assert.equal(data(free.state).characters.erin.relations.mira.affection, 65);
  const restored = await core.setSettings({ maxDelta: { 'characters.*.relations.*.affection': null } }, off.state);
  assert.equal(restored.state.engineState.settings, undefined, '恢复默认后不留设置键');
  await assert.rejects(core.setSettings({ maxDelta: { 'characters.*.age': 3 } }, state), /未声明/);
});

test('清单上限与整理预警：到预警线提示，到上限拒绝新增，玩家可改上限', async () => {
  const { core, state, def } = await official();
  let s = state;
  for (let i = 0; i < 7; i++) s = (await core.execute({ $push: { '@erin.tags': '标签' + i } }, s)).state;
  assert.equal(data(s).characters.erin.tags.length, 10);
  assert.match(guide(def, s), /【清单整理】身份（characters\.erin\.tags）已有 10\/10 条/);
  const full = await core.execute({ $push: { '@erin.tags': '再多一个' } }, s);
  assert.equal(data(full.state).characters.erin.tags.length, 10);
  assert.ok(full.feedback.some(f => f.code === 'LIST_FULL'));
  const raised = await core.setSettings({ lists: { 'characters.*.tags': { max: 12, warn: 11 } } }, s);
  const ok = await core.execute({ $push: { '@erin.tags': '再多一个' } }, raised.state);
  assert.equal(data(ok.state).characters.erin.tags.length, 11);
  assert.doesNotMatch(guide(def, raised.state), /characters\.erin\.tags/);
  const lowered = await core.setSettings({ lists: { 'characters.*.tags': { max: 5, warn: 4 } } }, ok.state);
  const shrink = await core.execute({ $pull: { '@erin.tags': '标签0' } }, lowered.state);
  assert.equal(shrink.feedback.length, 0, '降低上限后，减少条目仍然允许');
  await assert.rejects(core.setSettings({ lists: { 'characters.*.tags': { max: 3, warn: 5 } } }, s), /预警线/);
});

test('互斥组：切换属性体系关闭其他成员，给下一次模型动作一次性迁移指令', async () => {
  const { core, state, def } = await official();
  const switched = await core.setModule('attr_fate', true, state);
  const modules = switched.state.engineState.activeModules;
  assert.equal(modules.attr_fate, true); assert.equal(modules.attr_wod, false); assert.equal(modules.attr_dnd, false);
  assert.equal(data(switched.state).characters.erin.rp.attributes.wod.str, 23, '休眠数据保留');
  const text = guide(def, switched.state);
  assert.match(text, /属性体系由「WOD」切换为「FATE」/);
  assert.match(text, /"characters\.erin\.rp\.attributes\.wod":\{"str":23/);
  assert.doesNotMatch(toJson(def, switched.state), /"wod"/, '休眠体系不进提示词');
  const again = await core.setModule('attr_fu', true, switched.state);
  assert.equal(again.state.engineState.migration?.from, 'attr_wod', '连续切换保留最初来源');
  const back = await core.setModule('attr_wod', true, again.state);
  assert.equal(back.state.engineState.migration, undefined, '切回原体系取消迁移');
  const filled = await applyAction(core, model({ $set: { '@erin.rp.attributes.fate.physique': 'B+' } }, 43), switched.state);
  assert.equal(filled.state.engineState.migration, undefined, '迁移指令只出现一次');
  assert.equal(data(filled.state).characters.erin.rp.attributes.fate.physique, 'B+');
});

test('计算字段：WOD 超凡与 DND 调整值进入投影，不能写入', async () => {
  const { core, state, def } = await official();
  const json = JSON.parse(toJson(def, state));
  assert.equal(json.characters['@erin'].rp.attributes.wod.str, 23);
  assert.equal(json.characters['@erin'].rp.attributes.wod['str(超凡)'], 4);
  assert.equal(json.characters['@ash'].rp.attributes.wod['str(超凡)'], 2);
  assert.equal(json.characters['@ash'].rp.attributes.wod.sta, null);
  assert.equal(json.characters['@ash'].rp.attributes.wod['sta(超凡)'], undefined);
  for (const [value, expected] of [[0, 0], [5, 0], [6, 1], [10, 1], [11, 2], [23, 4]] as const) {
    const s = (await core.execute({ $set: { '@erin.rp.attributes.wod.dex': value } }, state)).state;
    assert.equal(computeAll(def, s)['/characters/erin/rp/attributes/wod/dex']?.[0]?.value, expected, `${value} → ${expected}`);
  }
  const write = await core.execute({ $set: { '@erin.rp.attributes.wod.str(超凡)': 9 } }, state);
  assert.ok(write.feedback.some(f => f.level === 'L3'));
});

test('声明式投影：不在场角色只留核心字段，社交只留在场相关，地点只展开附近', async () => {
  const { state, def } = await official();
  const json = JSON.parse(toJson(def, state));
  assert.ok(json.characters['@erin'].rp, '在场角色完整');
  assert.deepEqual(Object.keys(json.characters['@cassius']).sort(), ['condition', 'intro', 'name', 'role', 'tags']);
  assert.deepEqual(Object.keys(json.characters['@erin'].relations), ['mira'], '不在场的卡修斯被过滤');
  assert.ok(json.places['@tavern'].desc, '当前地点完整');
  assert.ok(json.places['@capital'].desc, '上级区域完整');
  assert.ok(json.places['@lower_town'].desc, '相邻地点完整');
  assert.equal(json.places['@marsh_hut'].desc, undefined, '远处地点只留名称');
  const exact = project(def, state, { paths: ['@cassius.drive'] }) as any;
  assert.ok(exact.characters['@cassius'].drive, '指定路径查询不受规则影响');
  assert.equal(data(state).characters.cassius.rp.rank, '金阶', '原数据不变');
});

test('引用类型：地点字段不能指向角色；删除角色时在场名单与社交自动清理', async () => {
  const { core, state } = await official();
  const wrong = await core.execute({ $set: { 'meta.location': 'erin' } }, state);
  assert.ok(wrong.feedback.some(f => /需要 place/.test(f.message)));
  const gone = await core.execute({ $deleteEntity: ['@mira'] }, state);
  assert.deepEqual(data(gone.state).meta.present, ['erin', 'ash']);
  assert.equal(data(gone.state).characters.erin.relations.mira, undefined);
});

test('背景音乐：地点优先，其次上级区域，最后按场景情绪选曲', async () => {
  const { core, state, def } = await official();
  const library = [{ id: 'calm', url: 'https://example.com/calm.mp3', moods: ['日常'] }, { id: 'rain', url: 'https://example.com/rain.mp3', moods: ['悲伤'] }];
  assert.equal(selectBgm(def, state, library).source, 'mood');
  assert.equal(selectBgm(def, state, library).track?.id, 'calm');
  const region = (await core.execute({ $set: { '@capital.bgm': 'rain' } }, state)).state;
  assert.deepEqual([selectBgm(def, region, library).source, selectBgm(def, region, library).track?.id], ['region', 'rain']);
  const place = (await core.execute({ $set: { '@tavern.bgm': 'https://example.com/tavern.mp3' } }, region)).state;
  assert.deepEqual([selectBgm(def, place, library).source, selectBgm(def, place, library).url], ['place', 'https://example.com/tavern.mp3']);
  assert.equal(selectBgm(def, state, []).source, 'none');
});

test('空白新聊天：只靠模型操作就能建立角色和地点', async () => {
  const def = await compile(compileStructure(officialStructure));
  const core = new SolveCore(def), state = await core.initialize();
  const result = await applyAction(core, model([
    { $set: { 'places.inn': { name: '旅店' }, 'characters.me': { name: '我', role: '用户角色' } } },
    { $set: { 'meta.location': 'inn', 'meta.present': ['me'] }, $push: { '@me.tags': '旅人' } },
  ], 1), state);
  assert.equal(result.feedback.filter(f => f.level === 'L3').length, 0, JSON.stringify(result.feedback));
  assert.equal(data(result.state).characters.me.rp.attributes.dnd.str, null);
  assert.equal(data(result.state).meta.round, 1);
  void exampleData;
});

test('数值或文字（oneOf）：量表、资金、特殊属性两种写法都能存，数值形式仍可增减与截断', async () => {
  const { core, state, def } = await official();
  assert.equal((def.display?.fields?.['characters.*.rp.gauges.*'] as any)?.type, 'oneOf');
  assert.equal(data(state).characters.erin.rp.gauges.饥饿, '一天没吃东西，肚子在叫');
  const inc = await core.execute({ $inc: { '@erin.rp.gauges.生命.value': 10 } }, state);
  assert.equal(data(inc.state).characters.erin.rp.gauges.生命.value, 82);
  const max = await core.execute({ $set: { '@erin.rp.gauges.生命.max': -5 } }, state);
  assert.equal(data(max.state).characters.erin.rp.gauges.生命.max, 0, '数值形式里的下限照常截断');
  const swap = await core.execute({ $set: { '@erin.rp.gauges.生命': '重伤，失血不止', '@erin.funds.金币': '所剩无几', '@erin.rp.special.契约之力': { value: 3, max: 10 } } }, state);
  assert.equal(data(swap.state).characters.erin.rp.gauges.生命, '重伤，失血不止');
  assert.equal(data(swap.state).characters.erin.funds.金币, '所剩无几');
  assert.deepEqual(data(swap.state).characters.erin.rp.special.契约之力, { value: 3, max: 10 });
  const bad = await core.execute({ $set: { '@erin.rp.gauges.生命': true } }, state);
  assert.deepEqual(data(bad.state).characters.erin.rp.gauges.生命, { value: 72, max: 100 }, '两种形式都不是时拒绝');
  assert.ok(bad.feedback.some(f => f.code === 'SCHEMA_REJECTED'));
  const pay = await core.execute({ $transfer: { '@erin.funds.银币': { '@mira.funds.银币': 7 } } }, state);
  assert.equal(data(pay.state).characters.mira.funds.银币, 19);
});

test('oneOf 结构描述：至少两种且 JSON 类型不同', () => {
  const base = { id: 't', version: '1', fields: {} };
  assert.throws(() => compileStructure({ ...base, fields: { a: { type: 'oneOf', variants: [{ type: 'string' }] } } }), /至少两个/);
  assert.throws(() => compileStructure({ ...base, fields: { a: { type: 'oneOf', variants: [{ type: 'int' }, { type: 'number' }] } } }), /不同的 JSON 类型/);
  assert.throws(() => compileStructure({ ...base, fields: { a: { type: 'oneOf', variants: [{ type: 'string' }, { type: 'ref', to: 'x' }] } } }), /不支持 ref/);
});

test('物品与能力是根节点实例，角色只引用：引用须存在、删除自动清理、投影只展开被引用的', async () => {
  const { core, state, def } = await official();
  assert.equal(data(state).items.healing_draught.name, '治疗药剂');
  assert.deepEqual(data(state).characters.erin.items.healing_draught, { count: 2, equipped: false });
  assert.deepEqual(data(state).characters.mira.items.healing_draught, { count: 1, equipped: false }, '同类物品多人各自计数');
  const ghost = await core.execute({ $set: { '@erin.items.no_such_item': { count: 1, equipped: false } } }, state);
  assert.equal(data(ghost.state).characters.erin.items.no_such_item, undefined, '引用不存在的物品被拒绝');
  const bad = await core.execute({ $set: { '@erin.rp.abilities.iron_sword': {} } }, state);
  assert.equal(data(bad.state).characters.erin.rp.abilities.iron_sword, undefined, '能力引用不能指向物品');
  const gone = await core.execute({ $deleteEntity: ['@healing_draught'] }, state);
  assert.equal(data(gone.state).characters.erin.items.healing_draught, undefined, '删除物品后持有者的引用自动清理');
  assert.equal(data(gone.state).characters.mira.items.healing_draught, undefined);
  const more = await core.execute({ $createEntity: { 'items.@old_map': { name: '旧地图', type: '道具', desc: '标着一处废弃矿坑' }, 'abilities.@fireball': { name: '火球术', kind: '技能', desc: '投出一团火' } } }, state);
  const json = JSON.parse(toJson(def, more.state));
  assert.ok(json.items['@iron_sword'].desc, '在场角色持有的物品完整');
  assert.ok(json.abilities['@lullaby'].desc, '在场角色的能力完整');
  assert.deepEqual(Object.keys(json.items['@old_map']).sort(), ['name', 'type'], '无人持有的物品只留名称与类型');
  assert.deepEqual(Object.keys(json.abilities['@fireball']).sort(), ['kind', 'name'], '无人掌握的能力只留名称与类别');
});
