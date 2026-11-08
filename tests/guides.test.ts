import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileAuthorDefinition, compose, captureDefinitionSnapshot, restoreDefinitionSnapshot, createArchive, guide, hash, restore, SolveCore, z } from '../src/index.js';
import type { Definition, GuideRule } from '../src/index.js';
import { hostEnvironment } from './host-fixture.js';
import { installRuntime } from '../src/host/install.js';
import { attachSillyTavern } from '../src/host/controller.js';
import { parseWorldInfoEntry } from '../src/world-info.js';

function base(guides: GuideRule[] = []): Definition {
  return { id: 'guide-card', version: '1', schema: z.object({ player: z.object({ hp: z.number(), maxHp: z.number() }),
    world: z.object({ inCombat: z.boolean(), phase: z.string(), safe: z.boolean() }), secret: z.object({ n: z.number() }) }),
  initialData: { player: { hp: 20, maxHp: 100 }, world: { inCombat: true, phase: '交易', safe: false }, secret: { n: 3 } },
  entities: [{ path: 'player', type: 'person', singletonId: 'player' }],
  modules: { combat: { paths: [], guide: '战斗基础' }, secret: { paths: ['secret'], enabled: false } }, guide: '全局', guides };
}
const rule = (when: string): GuideRule => ({ id: 'rule', when, text: '命中' });

test('条件表达式比较、括号和逻辑优先级，字段与实体路径读取相同事实', async () => {
  const definition = await compile(base()), state = await new SolveCore(definition).initialize();
  const cases: [string, boolean][] = [
    ['@player.hp < 30', true], ['player.hp >= 30', false], ['@player.hp <= 20 && world.inCombat', true],
    ['@player.hp > 20 || world.safe', false], ['!world.safe', true], ['world.phase == "交易"', true],
    ["world.phase != '交易'", false], ['20 === 20', true], ['20 !== "20"', true], ['20 == "20"', false],
    ['false || true && false', false], ['(false || true) && !false', true], ['-1 < 1e2', true], ['null == null', true],
    ['missing.flag != true', false], ['!missing.flag', false], ['@missing.hp < 30', false],
    ['missing.flag || true', true], ['missing.flag && false', false], ['false && player', false], ['true || player', true],
  ];
  for (const [expression, expected] of cases) {
    const def = await compile(base([rule(expression)])); assert.equal(guide(def, state).includes('命中'), expected, expression);
  }
});
test('状态变化重新选择，模块与父模块关闭不运行条件，标签不会包含全局指南', async () => {
  let calls = 0;
  const def = await compile({ ...base([{ id: 'critical', module: 'combat', when: ({ get }) => { calls++; return Number(get('@player.hp')) < 30; }, text: '重伤' },
    { id: 'global', when: 'true', text: '条件全局' }]),
    modules: { root: { paths: [] }, combat: { paths: [], parent: 'root', guide: '战斗基础' }, secret: { paths: ['secret'], enabled: false } } });
  const core = new SolveCore(def), initial = await core.initialize();
  assert.equal(guide(def, initial), '全局\n战斗基础\n重伤\n条件全局'); assert.equal(calls, 1);
  const healthy = await core.execute({ $set: { '@player.hp': 80 } }, initial);
  assert.equal(guide(def, healthy.state, 'combat'), '战斗基础');
  const off = await core.setModule('root', false, initial); const before = calls;
  assert.equal(guide(def, off.state, 'combat'), ''); assert.equal(calls, before);
  assert.equal(guide(def, off.state), '全局\n条件全局'); assert.equal(calls, before);
  assert.equal(guide(def, initial, 'missing'), '');
});
test('JS条件只获得独立读取副本，休眠字段和包含它的父对象不可读取', async () => {
  const rules: GuideRule[] = [{ id: 'copy', when: ({ get }) => { const p = get('@player') as any; p.hp = 999; return true; }, text: '副本' },
    { id: 'secret', when: 'secret.n < 10', text: '不能出现' },
    { id: 'secret-parent', when: ({ get }) => get('secret') === undefined, text: '已遮罩' }];
  const def = await compile(base(rules)), state = await new SolveCore(def).initialize(), before = await hash(state);
  assert.equal(guide(def, state), '全局\n战斗基础\n副本\n已遮罩'); assert.equal(await hash(state), before);
});
test('条件不执行任意表达式，错误包含指南身份与来源，嵌套和长度有限制', async () => {
  for (const expression of ['player.hp = 0', 'get("player.hp")', 'Math.random()', 'player["hp"] < 30',
    'player.__proto__.x', 'world.constructor', 'true || globalThis.fetch("x")', 'true true', '1 / 2', '(', '"unterminated',
    '('.repeat(34) + 'true' + ')'.repeat(34), ' '.repeat(4097), '1e999 > 0']) {
    await assert.rejects(compile(base([{ ...rule(expression), source: 'rules-book#7' }])), /rules-book#7|危险键/u, expression);
  }
  const state = await new SolveCore(await compile(base())).initialize();
  for (const when of ['player.hp && true', 'player.hp < "30"', 'player == player', 'player.hp']) {
    const def = await compile(base([rule(when)])); assert.throws(() => guide(def, state), /rule/u);
  }
  for (const when of [(() => 'true') as any, (async () => true) as any, (() => { throw new Error('业务条件失败'); })]) {
    const def = await compile(base([{ id: 'bad-function', when, text: '错误' }])); assert.throws(() => guide(def, state), /bad-function/u);
  }
});
test('编译前固定指南数组和函数引用，不采样作者函数', async () => {
  let calls = 0, release!: () => void, entered!: () => void;
  const original = ({ get }: any) => { calls++; return get('@player.hp') < 30; };
  const input = base([{ id: 'fixed', when: original, text: '原文' }]);
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const compiling = compileAuthorDefinition(input, { worldInfo: [{ comment: '[SOLVE:GUIDE]', content: '书' }], renderWorldInfo: async text => { entered(); await gate; return text; } });
  await started; input.guides![0]!.when = () => false; input.guides![0]!.text = '被修改'; input.guides!.push(rule('false')); release();
  const result = await compiling; assert.equal(calls, 0); assert.equal(result.definition.guides![0]!.when, original);
  assert.match(guide(result.definition, await new SolveCore(result.definition).initialize()), /原文/u); assert.equal(calls, 1);
  assert.doesNotThrow(() => JSON.stringify(result.ir)); assert.deepEqual((result.ir.guides.rules![0] as any).when, { binding: 'fixed' });
});
test('世界书条件标题支持参数顺序、单双引号、字符串内右括号和来源诊断', async () => {
  const result = await compileAuthorDefinition(base(), { worldInfo: [
    { source: 'book#1', comment: '[SOLVE:GUIDE module=combat when="@player.hp < 30"] 重伤', content: '低血量' },
    { source: 'book#2', comment: `[SOLVE:GUIDE when='world.phase == "交易"' id=trade]`, content: '交易指南' },
    { comment: '[SOLVE:GUIDE when="false"]', content: '不出现' },
    { comment: '[SOLVE:GUIDE]', content: '普通书指南' },
    { comment: '[SOLVE:GUIDE module=combat]', content: '普通模块指南' },
  ] });
  const state = await new SolveCore(result.definition).initialize();
  assert.equal(guide(result.definition, state), '全局\n\n普通书指南\n战斗基础\n\n普通模块指南\n低血量\n交易指南');
  assert.equal(guide(result.definition, state, 'combat'), '战斗基础\n\n普通模块指南\n低血量');
  const parsed = await parseWorldInfoEntry({ comment: `[SOLVE:GUIDE when='world.phase == "城镇]中心"']`, content: '文字' });
  assert.equal(parsed!.when, 'world.phase == "城镇]中心"');
  for (const header of ['[SOLVE:GUIDE when="true" when="false"]','[SOLVE:GUIDE unknown=x]', '[SOLVE:INIT when="true"]', '[SOLVE:GUIDE when=""]', '[SOLVE:GUIDE when="true"']) {
    await assert.rejects(parseWorldInfoEntry({ source: 'bad-book', comment: header, content: '' }), /bad-book/u);
  }
});
test('指南组合按id去重、冲突报来源，未知模块与重复id拒绝', async () => {
  const first = rule('@player.hp < 30'); const joined = compose(base([first]), { source: 'same.ts', definition: { guides: [first] } });
  assert.equal(joined.guides!.length, 1);
  assert.throws(() => compose(base([first]), { source: 'conflict.ts', definition: { guides: [{ ...first, text: '不同' }] } }), /conflict.ts.*guides.rule/u);
  await assert.rejects(compile(base([first, first])), /重复/u);
  await assert.rejects(compile(base([{ ...first, module: 'missing' }])), /未知模块/u);
  const fn = () => true;
  assert.throws(() => compose(base([{ ...first, when: fn }]), { source: 'function.ts', definition: { guides: [{ ...first, when: () => true }] } }), /function.ts/u);
});
test('条件指南进入定义身份，函数身份绑定作者版本，来源位置不改变指纹', async () => {
  const a = await compile(base([rule('true')]));
  assert.notEqual(a.fingerprint, (await compile(base([rule('false')]))).fingerprint);
  assert.notEqual(a.fingerprint, (await compile(base([{ ...rule('true'), text: '新文字' }]))).fingerprint);
  assert.equal(a.fingerprint, (await compile(base([{ ...rule('true'), source: 'other-file' }]))).fingerprint);
  assert.notEqual((await compile(base([{ id: 'fn', text: 'fn', when: () => true }]))).fingerprint,
    (await compile({ ...base([{ id: 'fn', text: 'fn', when: () => true }]), version: '2' })).fingerprint);
});
test('字符串条件与JS函数经JSON快照恢复，原包缺失或换版拒绝', async () => {
  let calls = 0;
  const input = base([{ id: 'js', when: ({ get }) => { calls++; return Number(get('@player.hp')) < 30; }, text: 'JS指南' }]);
  const authored = await compileAuthorDefinition(input, { worldInfo: [{ comment: '[SOLVE:GUIDE when="@player.hp < 30"]', content: '书指南' }] });
  const snapshot = await captureDefinitionSnapshot(input, authored.definition, ['book']);
  assert.equal(calls, 0); assert.doesNotThrow(() => JSON.stringify(snapshot));
  const restored = await restoreDefinitionSnapshot(input, JSON.parse(JSON.stringify(snapshot)), authored.definition.fingerprint);
  assert.equal(restored.guides![0]!.when, input.guides![0]!.when);
  assert.equal(guide(restored, await new SolveCore(restored).initialize()), '全局\n战斗基础\nJS指南\n书指南');
  assert.equal((await captureDefinitionSnapshot(input, restored, ['book'])).digest, snapshot.digest);
  await assert.rejects(restoreDefinitionSnapshot({ ...input, version: '2' }, snapshot, snapshot.fingerprint), /原版本/u);
  await assert.rejects(restoreDefinitionSnapshot({ ...input, runtimeBindings: { build: 'new-build' } }, snapshot, snapshot.fingerprint), /原版本/u);
  await assert.rejects(restoreDefinitionSnapshot({ ...input, guides: [{ ...input.guides![0]!, when: 'true' }] }, snapshot, snapshot.fingerprint), /原版本/u);
  await assert.rejects(restoreDefinitionSnapshot(base(), snapshot, snapshot.fingerprint), /原版本/u);
  const extra = await compileAuthorDefinition(base(), { parts: [{ source: 'extra.ts', definition: { guides: [{ id: 'extra', when: () => true, text: 'x' }] } }] });
  await assert.rejects(captureDefinitionSnapshot(base(), extra.definition, []), /基础作者包/u);
});
test('带id但无when的世界书指南按规则顺序输出，同id去重且冲突诊断', async () => {
  const first = { source: 'one#1', comment: '[SOLVE:GUIDE id=always]', content: '带标识的全局指南' };
  const result = await compileAuthorDefinition(base(), { worldInfo: [first, { ...first, source: 'two#2' }] });
  assert.equal(result.definition.guides!.length, 1);
  assert.equal(guide(result.definition, await new SolveCore(result.definition).initialize()), '全局\n战斗基础\n带标识的全局指南');
  await assert.rejects(compileAuthorDefinition(base(), { worldInfo: [first, { ...first, source: 'conflict#3', content: '不同' }] }), /conflict#3.*guides.always/u);
});
test('即使重算快照自身摘要，损坏的指南数组或函数绑定仍拒绝恢复', async () => {
  const input = base([{ id: 'fn', when: () => true, text: 'fn' }]), authored = await compileAuthorDefinition(input);
  const snapshot = await captureDefinitionSnapshot(input, authored.definition, []);
  for (const guides of [{ invalid: true }, [{ id: 'fn', text: 'fn', when: { binding: 'other' } }], [{ id: 'fn', text: 'fn', when: { binding: 'fn', extra: true } }]]) {
    const changed = structuredClone(snapshot); changed.declaration.guides = guides;
    const { digest: _digest, ...body } = changed; changed.digest = await hash(body);
    await assert.rejects(restoreDefinitionSnapshot(input, changed, snapshot.fingerprint), /固定指南|绑定格式/u);
  }
});
test('无指南定义保留dev.3指纹、IR与旧快照摘要，旧快照仍可恢复', async () => {
  // Constants captured from the untouched 0.9.0-dev.3 distribution, not recomputed by the new compiler.
  const input: Definition = { id: 'guide-legacy', version: '1', schema: z.object({ hp: z.number().default(50) }), initialData: {}, guide: '原指南' };
  assert.equal((await compile(input)).fingerprint, 'sha256:0cadea2251f4ab48d8639209a317943772fb8dbdb0f1180fa37eebe1492cfa89');
  const result = await compileAuthorDefinition(input); assert.equal(result.irHash, 'sha256:309ef42039df562f46692a200bb8c7068b7a7caa0ab4fb4c5a86b18908384e03');
  const snapshot = await captureDefinitionSnapshot(input, result.definition, ['old-book']);
  assert.equal(snapshot.digest, 'sha256:d947125d07774dbaa8a216394096e37aa2d13c93068ca8a0639b33ccdf1d8ebe');
  assert.equal((await restoreDefinitionSnapshot(input, snapshot, snapshot.fingerprint)).fingerprint, result.definition.fingerprint);
});
test('Patch恢复不执行条件函数，读取指南也不产生历史提交', async () => {
  let calls = 0;
  const def = await compile(base([{ id: 'fn', when: () => { calls++; return true; }, text: 'fn' }]));
  const { archive, headId } = await createArchive(new SolveCore(def), { chatId: 'g', messageId: 'g', swipeId: '0' });
  const before = await hash(archive), state = await restore(archive, headId); assert.equal(calls, 0);
  guide(def, state); assert.equal(calls, 1); assert.equal(await hash(archive), before);
});
test('宏、控制器、公共API和载体API返回同一筛选结果，未绑定与停用明确拒绝', async () => {
  const env = await hostEnvironment();
  const scope: any = { crypto, SillyTavern: { getContext: () => env.ctx }, fetch: env.fetcher };
  const api = installRuntime({ scope }), lease = api.use({ kind: 'embedded' });
  assert.throws(() => api.getGuide(), /尚未绑定/u);
  await lease.register({ ...env.def, guide: '常规', guides: [{ id: 'high', when: '@alice.hp >= 90', text: '高血量' }, { id: 'low', when: '@alice.hp < 90', text: '低血量' }] }, { characters: ['test.png'], attach: { cache: false } });
  try {
    const macro = () => env.macros.get('solve_guide').handler({ unnamedArgs: [] });
    assert.equal(api.getGuide(), macro()); assert.match(api.getGuide(), /高血量/u);
    await api.controller!.submit({ $inc: { '@alice.hp': -15 } });
    assert.equal(api.getGuide(), macro()); assert.equal(lease.getGuide(), api.controller!.getGuide()); assert.match(api.getGuide(), /低血量/u);
    assert.equal(api.controller!.getContextPreview().guide, api.getGuide());
    const archived = await hash(api.controller!.runtime.archive); api.getGuide(); macro(); assert.equal(await hash(api.controller!.runtime.archive), archived);
  } finally { await lease.dispose(); }
  assert.throws(() => lease.getGuide(), /停用/u);
});
test('独立操作模型接收按父状态筛选的指南，下次请求采用新状态', async () => {
  const env = await hostEnvironment(), prompts: string[] = [];
  const controller = await attachSillyTavern({ ...env.def, guides: [
    { id: 'high', when: '@alice.hp >= 90', text: 'ONLY_HIGH_GUIDE' },
    { id: 'low', when: '@alice.hp < 90', text: 'ONLY_LOW_GUIDE' },
  ] }, () => env.ctx, { cache: false, mode: 'out-of-band', operatorRequest: async prompt => { prompts.push(prompt); return '{"$inc":{"@alice.hp":-15}}'; } }, env.fetcher);
  try {
    env.ctx.chat.push({ mes: '第一轮受伤', extra: {} }); await controller.processMessage(1);
    env.ctx.chat.push({ mes: '第二轮受伤', extra: {} }); await controller.processMessage(2);
    assert.match(prompts[0]!, /ONLY_HIGH_GUIDE/u); assert.doesNotMatch(prompts[0]!, /ONLY_LOW_GUIDE/u);
    assert.match(prompts[1]!, /ONLY_LOW_GUIDE/u); assert.doesNotMatch(prompts[1]!, /ONLY_HIGH_GUIDE/u);
    assert.equal(controller.getValue('@alice.hp'), 70);
  } finally { controller.dispose(); }
});
