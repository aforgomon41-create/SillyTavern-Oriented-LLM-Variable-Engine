import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, SolveCore, compileStructure, officialStructure, project, guide, toJson, applyAction, computeAll, selectBgm, nextRound, migrationText, schemaText } from '../src/index.js';
import { exampleData, exampleState, exampleStructure } from '../examples/official/example.js';
import type { Action, LogicalState } from '../src/types.js';

async function official() {
  const def = await compile(compileStructure(exampleStructure));
  const core = new SolveCore(def);
  return { def, core, state: await exampleState(core) };
}
const model = (operations: any, round?: number): Action => ({ actionId: 'm' + Math.random(), kind: 'operations', source: 'model', operations, ...(round !== undefined ? { authorInputs: { solveRound: round } } : {}) });
const data = (state: LogicalState) => state.data as any;

test('官方结构可编译，示例数据通过校验，指纹稳定且不含展示信息', async () => {
  const { def, state } = await official();
  assert.equal(data(state).characters.erin.rp.attributes.wod.str, 23);
  assert.equal(data(state).characters.ash.rp.attributes.wod.sta, null);
  const again = await compile(compileStructure({ ...exampleStructure, display: { layout: [] } }));
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
  const { core, state: example, def: exampleDef } = await official();
  assert.equal(selectBgm(exampleDef, example).track?.id, 'minstrel_guild', '示例：酒馆有自己的配乐');
  // The rules themselves, on the plain official structure with the example's place music removed.
  const def = await compile(compileStructure(officialStructure));
  const state = structuredClone(example);
  for (const p of Object.values(data(state).places) as any[]) delete p.bgm;
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

test('数值或文字（oneOf）：特殊属性两种写法都能存；数值量表照常增减与截断', async () => {
  const { core, state, def } = await official();
  assert.equal((def.display?.fields?.['characters.*.rp.special.*'] as any)?.type, 'oneOf');
  const inc = await core.execute({ $inc: { '@erin.rp.gauges.生命.value': 10 } }, state);
  assert.equal(data(inc.state).characters.erin.rp.gauges.生命.value, 82);
  const max = await core.execute({ $set: { '@erin.rp.gauges.生命.max': -5 } }, state);
  assert.equal(data(max.state).characters.erin.rp.gauges.生命.max, 0, '数值形式里的下限照常截断');
  const swap = await core.execute({ $set: { '@erin.rp.special.契约之力': { value: 3, max: 10 } } }, state);
  assert.deepEqual(data(swap.state).characters.erin.rp.special.契约之力, { value: 3, max: 10 });
  const text = await core.execute({ $set: { '@erin.rp.special.契约之力': '若隐若现' } }, state);
  assert.equal(data(text.state).characters.erin.rp.special.契约之力, '若隐若现');
  const bad = await core.execute({ $set: { '@erin.rp.special.契约之力': true } }, state);
  assert.ok(bad.feedback.some(f => f.code === 'SCHEMA_REJECTED'), '两种形式都不是时拒绝');
});

test('货币是物品：$transfer 付钱，对方没有该币种时自动新建；存放在建筑里', async () => {
  const { core, state } = await official();
  const pay = await core.execute({ $transfer: { '@erin.items.silver.count': { '@mira.items.silver.count': 7 } } }, state);
  assert.equal(data(pay.state).characters.mira.items.silver.count, 19);
  assert.equal(data(pay.state).characters.erin.items.silver.count, 30);
  const tip = await core.execute({ $transfer: { '@erin.items.gold.count': { '@ash.items.gold.count': 5 } } }, state);
  assert.ok(!tip.feedback.some(f => f.level === 'L3'), JSON.stringify(tip.feedback));
  assert.equal(data(tip.state).characters.ash.items.gold.count, 5, '对方没有金币时从 0 开始');
  const typo = await core.execute({ $transfer: { '@erin.items.gold.count': { '@ash.items.nope.count': 5 } } }, state);
  assert.ok(typo.feedback.some(f => f.level === 'L3'), '不存在的物品不会被凭空建出');
  assert.equal(data(state).characters.erin.items.gold.stored.royal_bank, 500);
  const gone = await core.execute({ $deleteEntity: ['@royal_bank'] }, state);
  assert.equal(data(gone.state).characters.erin.items.gold.stored.royal_bank, undefined, '建筑删除后存放条目随之移除');
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

test('能力按等级写效果：键为等级数字，示例的盾击有 5 级', async () => {
  const { def, state } = await official();
  const bash = data(state).abilities.shield_bash;
  assert.deepEqual(Object.keys(bash.levels), ['1', '2', '3', '4', '5']);
  assert.equal(def.display?.as?.['abilities.*.levels'], 'levels');
  assert.match(schemaText(def, state), /levels（等级效果）.*键是等级数字/u);
});

test('一次性敌人是角色定位的最低一级', async () => {
  const { core, state } = await official();
  const r = await core.execute({ $set: { 'characters.@goon': { name: '打手', role: '一次性敌人' } } }, state);
  assert.equal(data(r.state).characters.goon.role, '一次性敌人');
  const enumValues = (officialStructure.fields.characters as any).of.fields.role.values as string[];
  assert.equal(enumValues.at(-1), '一次性敌人');
});

test('预制角色：只能登场一次；可作为 $from 的来源生成独立角色；指南列出未登场的预制与模板', async () => {
  const { def, core, state } = await official();
  assert.equal(state.engineState.prefabLifecycle.cassius, 'active');
  assert.equal(state.engineState.prefabLifecycle.rat_king, 'destroyed');
  assert.equal(state.engineState.prefabLifecycle.grave_hound, 'dormant');
  assert.equal(data(state).characters.one_eye.origin, 'cult_zealot');
  assert.equal(data(state).characters.one_eye.role, '一次性敌人');
  const text = guide(def, state);
  assert.match(text, /预制实体（尚未登场.*grave_hound（墓园猎犬）/u);
  assert.doesNotMatch(text, /rat_king（/u);
  assert.match(text, /模板.*cult_zealot（教团狂信徒）/u);
  const appear = await core.execute({ $createEntity: { 'characters.@grave_hound': {} } }, state);
  assert.equal(data(appear.state).characters.grave_hound.name, '墓园猎犬');
  assert.equal(appear.state.engineState.prefabLifecycle.grave_hound, 'active');
  const again = await core.execute({ $createEntity: { 'characters.@grave_hound': {} } }, appear.state);
  assert.equal(again.feedback[0]?.code, 'PREFAB_LIFECYCLE');
  const copy = await core.execute({ $createEntity: { 'characters.@pup': { $from: '@grave_hound', name: '墓园幼犬', origin: 'grave_hound' } } }, appear.state);
  assert.equal(data(copy.state).characters.pup.intro, data(appear.state).characters.grave_hound.intro);
  assert.equal(data(copy.state).characters.pup.name, '墓园幼犬');
  assert.equal(copy.state.engineState.prefabLifecycle.pup, undefined);
  // A dormant prefab used as a base stays dormant.
  const base = await core.execute({ $createEntity: { 'characters.@pup': { $from: '@grave_hound' } } }, state);
  assert.equal(base.state.engineState.prefabLifecycle.grave_hound, 'dormant');
});

test('独一无二的物品只有一个持有者：交给新持有者时自动从原持有者移除，同时交给两人被拒绝', async () => {
  const { def, core, state } = await official();
  assert.deepEqual(def.uniqueHolds, [{ path: 'characters.*.items', flag: 'unique' }]);
  const given = await core.execute({ $set: { '@mira.items.grey_mare': { count: 1, equipped: false } } }, state);
  assert.equal(data(given.state).characters.erin.items.grey_mare, undefined, '原持有者自动移除');
  assert.ok(data(given.state).characters.mira.items.grey_mare, '新持有者得到');
  assert.ok(given.feedback.some(f => f.code === 'UNIQUE_MOVED' && /艾琳/u.test(f.message) && /米拉/u.test(f.message)));
  const moved = await core.execute({ $move: { '@erin.items.sealed_letter': '@ash.items.sealed_letter' } }, state);
  assert.equal(data(moved.state).characters.erin.items.sealed_letter, undefined);
  assert.ok(data(moved.state).characters.ash.items.sealed_letter, '$move 也可以转手');
  // Statements run in order: handing it to two people in a row leaves it with the last one.
  const both = await core.execute({ $set: { '@ash.items.lute': { count: 1, equipped: false }, '@cassius.items.lute': { count: 1, equipped: false } } }, state);
  const owners = ['erin', 'mira', 'ash', 'cassius'].filter(id => data(both.state).characters[id].items.lute);
  assert.deepEqual(owners, ['cassius'], '始终只有一个持有者');
  // One statement placing it under two holders at once is rejected.
  const twice = await core.execute({ $set: { 'characters.ash.items': { lute: { count: 1, equipped: false } }, 'characters.cassius.items': { lute: { count: 1, equipped: false } } } }, state);
  assert.equal(['erin', 'mira', 'ash', 'cassius'].filter(id => data(twice.state).characters[id].items?.lute).length, 1);
  const shared = await core.execute({ $set: { '@ash.items.healing_draught': { count: 1, equipped: false } } }, state);
  assert.ok(data(shared.state).characters.erin.items.healing_draught && data(shared.state).characters.ash.items.healing_draught, '普通物品可多人持有');
  const flag = await core.execute({ $set: { 'items.healing_draught.unique': true } }, state);
  assert.equal(data(flag.state).items.healing_draught.unique, false, '已被多人持有的物品不能改成独一无二');
  assert.ok(flag.feedback.some(f => f.code === 'UNIQUE_HELD'));
});


// ── declared player interactions (status bar edit / actions) ──
import { expand, holds } from '../src/interact.js';
async function act(name: string, holder: string, item: string, answers: Record<string, any> = {}) {
  const { def, core, state } = await official();
  const spec = (def.display as any).fields['characters.*.items'].actions[name];
  const view = { ...data(state).items[item], ...data(state).characters[holder].items[item] };
  const vars = { ...view, self: `characters.${holder}.items.${item}`, id: item, holderId: holder, n: 1, ...answers };
  const read = (p: string[]) => p.reduce((v: any, k) => v?.[k], data(state));
  const ops = expand(spec.ops, view, vars, read);
  const result = await core.execute([{ $group: ops }] as any, state, { source: 'user' });
  assert.ok(!result.feedback.some(f => f.level === 'L3'), JSON.stringify(result.feedback));
  return { state: result.state, visible: holds(spec.when, view, vars, read) };
}
test('交互：官方物品动作展开为普通操作，由引擎执行', async () => {
  const used = await act('use', 'erin', 'healing_draught');
  assert.equal(data(used.state).characters.erin.items.healing_draught.count, 1, '使用消耗品数量减一');
  assert.equal(data((await act('use', 'mira', 'healing_draught')).state).characters.mira.items.healing_draught, undefined, '用掉最后一个就移除');
  assert.equal((await act('use', 'erin', 'iron_sword')).visible, false, '非消耗品不显示「使用」');
  const letter = await act('give', 'erin', 'sealed_letter', { to: 'mira' });
  assert.equal(data(letter.state).characters.erin.items.sealed_letter, undefined);
  assert.equal(data(letter.state).characters.mira.items.sealed_letter.count, 1, '独一无二的物品整件转手');
  const potion = await act('give', 'erin', 'healing_draught', { to: 'mira', n: 1 });
  assert.equal(data(potion.state).characters.erin.items.healing_draught.count, 1);
  assert.equal(data(potion.state).characters.mira.items.healing_draught.count, 2, '对方已有时叠加数量');
  const all = await act('give', 'erin', 'healing_draught', { to: 'ash', n: 2 });
  assert.equal(data(all.state).characters.erin.items.healing_draught, undefined, '全部交出后从自己名下移除');
  assert.equal(data(all.state).characters.ash.items.healing_draught.count, 2, '对方没有时新建');
  const dropped = await act('drop', 'erin', 'grey_mare');
  assert.equal(data(dropped.state).characters.erin.items.grey_mare, undefined);
});
test('交互：声明写错时编译报错', () => {
  const bad = (node: any) => () => compileStructure({ id: 't', version: '1', fields: { x: node } });
  assert.throws(bad({ type: 'record', of: { type: 'int' }, actions: { a: { label: 'A' } } }), /toggle 与 ops 二选一/u);
  assert.throws(bad({ type: 'record', of: { type: 'int' }, actions: { a: { label: 'A', ops: [], oops: 1 } } }), /未知属性/u);
  assert.throws(bad({ type: 'object', fields: {}, edit: true }), /edit 只能用于单个值/u);
  assert.throws(bad({ type: 'string', edit: { narrate: ['a', 'b'] } }), /两句 narrate 只用于 bool/u);
  assert.throws(bad({ type: 'int', actions: {} }), /actions 只能用于/u);
});
test('交互：存入与取出建筑，货币与物品同样处理', async () => {
  const dep = await act('deposit', 'erin', 'gold', { at: 'royal_bank', n: 40 });
  assert.equal(data(dep.state).characters.erin.items.gold.count, 100);
  assert.equal(data(dep.state).characters.erin.items.gold.stored.royal_bank, 540);
  const home = await act('deposit', 'erin', 'iron_sword', { at: 'old_manor', n: 1 });
  assert.equal(data(home.state).characters.erin.items.iron_sword.count, 0);
  assert.equal(data(home.state).characters.erin.items.iron_sword.equipped, false, '全部存起来的装备自动卸下');
  assert.equal(data(home.state).characters.erin.items.iron_sword.stored.old_manor, 1, '没有存放记录时自动新建');
  const all = await act('withdraw', 'erin', 'gold', { from: 'royal_bank', n: 500 });
  assert.equal(data(all.state).characters.erin.items.gold.count, 640);
  assert.equal(data(all.state).characters.erin.items.gold.stored.royal_bank, undefined, '取空后删除存放条目');
  const armor = await act('withdraw', 'erin', 'father_armor', { from: 'old_manor', n: 1 });
  assert.equal(data(armor.state).characters.erin.items.father_armor.count, 1);
  assert.equal((await act('give', 'erin', 'father_armor', { to: 'mira' })).visible, false, '没带在身上的东西不能交给别人');
  const paid = await act('give', 'erin', 'gold', { to: 'ash', n: 40 });
  assert.equal(data(paid.state).characters.ash.items.gold.count, 40, '付钱给没有金币的人');
  assert.equal(data(paid.state).characters.erin.items.gold.stored.royal_bank, 500, '交出随身的钱不动存款');
});
test('量表与熟练度：数值 / 描述 互斥，切换时给迁移指令', async () => {
  const { def, core, state } = await official();
  const { exampleTextScales } = await import('../examples/official/example.js');
  const text = await exampleTextScales(core, state);
  assert.equal(text.engineState.activeModules.scale_num, false);
  assert.equal(text.engineState.migration?.group, 'scales');
  assert.match(migrationText(def, text.engineState.migration!), /生命/u, '迁移指令附上原来的数值');
  assert.equal(data(text).characters.erin.rp.gaugesText.饱腹, '一天没吃东西，肚子在叫');
  const num = await core.execute({ $set: { '@erin.rp.gauges.生命': { value: 1, max: 2 } } }, text);
  assert.ok(num.feedback.some(f => f.code === 'MODULE_DORMANT'), '描述模式下数值量表休眠');
  const bad = await core.execute({ $set: { '@erin.rp.gauges.生命': '重伤' } }, state);
  assert.ok(bad.feedback.some(f => f.level === 'L3'), '数值模式只收 {value, max}');
});
test('剧透：社交、能力、物品默认折叠，好感度与已装备物品公开', async () => {
  const { def, state } = await official();
  const { StatusModel } = await import('../src/ui/statusbar/model.js');
  const m = new StatusModel(def, state);
  assert.equal(m.spoiler(['characters', 'mira', 'relations', 'erin', 'impression']), 'spoiler');
  assert.equal(m.spoiler(['characters', 'mira', 'relations', 'erin', 'affection']), 'public');
  assert.equal(m.spoiler(['characters', 'mira', 'items', 'lute']), 'public', '已装备的物品看得见');
  assert.equal(m.spoiler(['characters', 'mira', 'items', 'healing_draught']), 'spoiler');
  assert.equal(m.spoiler(['characters', 'mira', 'rp', 'abilities']), 'spoiler');
  assert.equal(m.spoiler(['characters', 'erin', 'items', 'healing_draught']), 'public', '玩家自己的不遮');
  assert.equal(m.spoiler(['items', 'lute', 'truth']), 'hidden');
});
test('设定：玩家可新增、修改与撤回自己写的设定；主角不知道的设定在状态栏里是剧透', async () => {
  const { def, core, state } = await official();
  const meta = (def.display as any).fields;
  assert.deepEqual(meta['lore'].create.fields, ['title', 'kind', 'content']);
  const added = await core.execute([{ $group: [{ $set: { 'lore.p1': { title: '月亮有两个', kind: '世界观', content: '夜空里有一大一小两个月亮。', source: '玩家', known: true } } }] }] as any, state, { source: 'user' });
  assert.ok(!added.feedback.some(f => f.level === 'L3'), JSON.stringify(added.feedback));
  assert.equal(data(added.state).lore.p1.stage, null, '其他字段取默认值');
  const gone = await core.execute({ $deleteEntity: ['@magic_cost'] }, state, { source: 'user' });
  assert.equal(data(gone.state).lore.magic_cost, undefined);
  const { StatusModel } = await import('../src/ui/statusbar/model.js');
  const { editFor } = await import('../src/ui/statusbar/interact.js');
  const m = new StatusModel(def, state);
  assert.ok(editFor(m, ['lore', 'magic_cost', 'content']), '玩家写的设定可以改');
  assert.equal(editFor(m, ['lore', 'grey_rain', 'content']), undefined, '剧情确立的设定不能改');
  assert.equal(m.spoiler(['lore', 'forged_seal']), 'spoiler');
  assert.equal(m.spoiler(['lore', 'grey_rain']), 'public');
  assert.equal(m.spoiler(['lore', 'lost_score', 'truth']), 'hidden');
  assert.throws(() => compileStructure({ id: 't', version: '1', fields: { x: { type: 'record', of: { type: 'object', fields: { a: { type: 'string' } } }, create: { label: 'A', fields: ['b'] } } } }), /不存在/u);
});

test('操作说明：每个算子都有用法，自带的示例在官方结构上能原样执行', async () => {
  const { sop, OPERATORS, extractBlocks } = await import('../src/index.js');
  const text = sop();
  for (const op of OPERATORS) assert.match(text, new RegExp(`\\${op} `), `${op} 缺少说明`);
  const { core, state } = await official();
  const operations = extractBlocks(text.slice(text.indexOf('### 示例'))).model!;
  const result = await applyAction(core, model(operations), state);
  assert.deepEqual(result.feedback.filter(f => f.level === 'L3'), []);
  const d = data(result.state);
  assert.equal(d.meta.weather, '暴雨');
  assert.equal(d.places.harbor.name, '灰港');
  assert.equal(d.meta.location, 'harbor', '引用排在新建之后');
  assert.ok(d.meta.present.includes('lena'));
  assert.equal(d.characters.lena.condition, '左臂流血');
  assert.equal(d.characters.lena.items.cowrie.count, 25);
  // 示例自带它引用的一切：在空白开局上也能原样执行
  const blank = await compile(compileStructure(officialStructure)), fresh = new SolveCore(blank);
  const r2 = await applyAction(fresh, model(operations), await fresh.initialize());
  assert.deepEqual(r2.feedback.filter(f => f.level === 'L3'), []);
});

test('数据结构：列出可写字段与说明，跟随模块开关，说明不进指纹', async () => {
  const def = await compile(compileStructure(officialStructure));
  const state = await new SolveCore(def).initialize();
  const text = schemaText(def, state);
  assert.match(text, /^## 数据结构/u);
  assert.match(text, /characters（角色）\.<ID>/u);
  assert.match(text, /intro（简介）: 文字 — 一两句/u, 'hint 写在字段后');
  assert.match(text, /name（姓名）: 文字（必填）/u);
  assert.match(text, /location（地点）: 地点ID 或 null/u);
  assert.match(text, /affection（好感度）: 整数（-100～100，每次变化不超过 ±10）/u);
  assert.doesNotMatch(text, /thumb|image|bgm|round（轮次）/u, '模型不能写的字段不列');
  assert.doesNotMatch(text, /buildings|factions|wod（WOD）|nsfw/u, '关闭的模块不列');
  assert.match(text, /related（相关）: \[角色\/地点\/物品ID, …\]/u, '关闭模块的实体类型不作为引用目标');
  const noDrive = structuredClone(state) as LogicalState; noDrive.engineState.activeModules.drive = false;
  assert.doesNotMatch(schemaText(def, noDrive), /drive（驱动力）/u);
  // hint is presentation only: the fingerprint does not move.
  const plain = structuredClone(officialStructure) as any; delete plain.fields.characters.of.fields.intro.hint;
  assert.equal((await compile(compileStructure(plain))).fingerprint, def.fingerprint);
  // desc stands in when there is no hint.
  const tiny = await compile(compileStructure({ id: 't', version: '1', fields: { hp: { type: 'int', label: '生命', desc: '当前生命', min: 0 } } }));
  assert.equal(schemaText(tiny, await new SolveCore(tiny).initialize()).split('\n').at(-1), 'hp（生命）: 整数（≥0） — 当前生命');
  assert.throws(() => compileStructure({ id: 't', version: '1', fields: { hp: { type: 'int', hint: 3 as any } } }), /hint 必须是文字/u);
});
