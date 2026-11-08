import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileAuthorDefinition, compose, createArchive, guide, restore, SolveCore, z } from '../src/index.js';
import type { Definition, SolveFacet } from '../src/index.js';
import { SolveSessionManager } from '../src/host/sessions.js';
import { hostEnvironment } from './host-fixture.js';

function base(): Definition {
  return { id: 'author-example', version: '1',
    schema: z.object({ hp: z.number().min(0).max(100).default(100), gold: z.number().min(0).default(0),
      combat: z.object({ mp: z.number().default(10) }).default({ mp: 10 }) }), initialData: {} };
}
const binding = { chatId: 'author-chat', messageId: 'first', swipeId: '0' };

test('六板块从独立文件或世界书收集，产生相同定义指纹和状态', async () => {
  const pieces = [{ source: 'initial.ts', definition: { initialData: { hp: 90, gold: 20 } } },
    { source: 'combat.ts', definition: { modules: { combat: { paths: ['combat'], guide: '战斗指南' } }, internal: ['combat.mp'], guide: '基础指南' } }];
  const direct = await compileAuthorDefinition(compose(base(), ...pieces));
  const world = await compileAuthorDefinition(base(), { worldInfo: [
    { uid: 1, comment: '[SOLVE:INIT] 开局', content: '{"hp":90,"gold":20}' },
    { uid: 2, comment: '[SOLVE:MODULES]', content: '{"combat":{"paths":["combat"],"guide":"战斗指南"}}' },
    { uid: 3, comment: '[SOLVE:VISIBILITY]', content: '{"internal":["combat.mp"]}' },
    { uid: 4, comment: '[SOLVE:GUIDE]', content: '基础指南' },
  ] });
  assert.equal(direct.definition.fingerprint, world.definition.fingerprint);
  assert.deepEqual(await new SolveCore(direct.definition).initialize(), await new SolveCore(world.definition).initialize());
  assert.equal(direct.irHash, world.irHash); assert.equal(world.sources[1]!.source, 'worldInfo[1]');
  assert.doesNotThrow(() => JSON.stringify(world.ir)); assert.ok(Object.isFrozen(world.ir.presets.initialData));
});
test('模块指南与条目顺序无关，停用和普通世界书条目不参与编译或宏替换', async () => {
  let renders = 0;
  const result = await compileAuthorDefinition(base(), { renderWorldInfo: text => { renders++; return text.replace('{{hp}}', '88'); }, worldInfo: [
    { comment: '普通设定', content: '不是 JSON' },
    { comment: '[SOLVE:INIT]', content: '损坏', disable: true },
    { comment: '[SOLVE:GUIDE module=combat]', content: '只在战斗时生效' },
    { comment: '[SOLVE:MODULES]', content: '{"combat":{"paths":["combat"],"enabled":false}}' },
    { comment: '[SOLVE:INIT]', content: '{"hp":{{hp}}}' },
  ] });
  const core = new SolveCore(result.definition), state = await core.initialize();
  assert.equal(state.data.hp, 88); assert.equal(renders, 3); assert.equal(guide(result.definition, state), '');
  const enabled = await core.setModule('combat', true, state);
  assert.equal(guide(result.definition, enabled.state), '只在战斗时生效');
});
test('定义冲突、未知字段和世界书错误带来源，不静默覆盖', async () => {
  assert.throws(() => compose({ ...base(), initialData: { hp: 90 } }, { source: 'hp.json', definition: { initialData: { hp: 10 } } }), /hp.json.*initialData.hp/u);
  assert.throws(() => compose(base(), { source: 'schema.json', definition: { schema: {} } as any }), /schema.json/u);
  await assert.rejects(compileAuthorDefinition(base(), { worldInfo: [{ source: 'book:12', comment: '[SOLVE:INIT]', content: '{bad}' }] }), /book:12/u);
  await assert.rejects(compileAuthorDefinition(base(), { worldInfo: [{ source: 'book:13', comment: '[SOLVE:SCHEMA]', content: 'throw new Error()' }] }), /book:13.*SCHEMA/u);
  await assert.rejects(compileAuthorDefinition(base(), { worldInfo: [{ source: 'book:14', comment: '[SOLVE:GUIDE module=missing]', content: '指南' }] }), /book:14.*missing/u);
  await assert.rejects(compileAuthorDefinition(base(), { worldInfo: [{ comment: '[SOLVE:INIT module=combat]', content: '{}' }] }), /只有 GUIDE/u);
});
test('世界书输入严格校验，危险键、非对象开局和错误模板都会拒绝', async () => {
  for (const [tag, content] of [['INIT', '{"__proto__":{"polluted":true}}'], ['INIT', '[]'], ['PREFABS', '{"sword":{"type":"item","data":3}}'], ['VISIBILITY', '{"views":{}}']]) {
    await assert.rejects(compileAuthorDefinition(base(), { worldInfo: [{ source: 'unsafe-book', comment: '[SOLVE:' + tag + ']', content: content! }] }), /unsafe-book/u);
  }
  assert.equal(({} as any).polluted, undefined);
});
test('新作者入口固定开局及构建依赖；再次普通编译保持同一指纹', async () => {
  const first = await compileAuthorDefinition(base(), { worldInfo: [{ comment: '[SOLVE:INIT]', content: '{"hp":90}' }] });
  const changed = await compileAuthorDefinition(base(), { worldInfo: [{ comment: '[SOLVE:INIT]', content: '{"hp":80}' }] });
  assert.notEqual(first.definition.fingerprint, changed.definition.fingerprint);
  assert.equal((await compile(first.definition)).fingerprint, first.definition.fingerprint);
  const built = { ...base(), runtimeBindings: { build: 'abc', dependencies: { rules: '1' } } };
  const a = await compile(built), b = await compile({ ...built, runtimeBindings: { build: 'def', dependencies: { rules: '1' } } });
  assert.notEqual(a.fingerprint, b.fingerprint);
  const c = await compile({ ...built, runtimeBindings: { build: 'abc', dependencies: { rules: '2' } } });
  assert.notEqual(a.fingerprint, c.fingerprint);
  built.runtimeBindings.dependencies.rules = 'mutated'; assert.equal(a.runtimeBindings!.dependencies!.rules, '1');
});
test('异步 Facet 收集独立声明与自定义世界书，版本和依赖进入指纹', async () => {
  let calls = 0;
  const facet: SolveFacet = { id: 'stats', version: '1', dependencies: { rules: 'stable' },
    registerDetached: async source => { calls++; return { initialData: { gold: (source as any).gold } }; },
    parseWorldInfo: async entry => entry.tag === 'HP' ? { initialData: { hp: Number(entry.content) } } : undefined };
  const options = { facets: [facet], detached: [{ source: 'stats.json', facet: 'stats', data: { gold: 12 } }], worldInfo: [{ comment: '[SOLVE:HP]', content: '75' }] };
  const result = await compileAuthorDefinition(base(), options);
  assert.deepEqual((await new SolveCore(result.definition).initialize()).data, { hp: 75, gold: 12, combat: { mp: 10 } });
  const { archive, headId } = await createArchive(new SolveCore(result.definition), binding);
  await restore(archive, headId); assert.equal(calls, 1, 'Restore 不重新调用作者收集器');
  const updated = await compileAuthorDefinition(base(), { ...options, facets: [{ ...facet, version: '2' }] });
  assert.notEqual(updated.definition.fingerprint, result.definition.fingerprint);
  assert.deepEqual(result.ir.runtimeBindings.authoring!.facets[0]!.dependencies, { rules: 'stable' });
});
test('Facet 重复、同一条目多个处理者和缺少处理者明确拒绝', async () => {
  const one: SolveFacet = { id: 'one', version: '1', parseWorldInfo: () => ({ initialData: { hp: 80 } }) };
  await assert.rejects(compileAuthorDefinition(base(), { facets: [one, one] }), /重复 Facet/u);
  await assert.rejects(compileAuthorDefinition(base(), { facets: [one, { ...one, id: 'two' }], worldInfo: [{ comment: '[SOLVE:CUSTOM]', content: '' }] }), /多个 Facet/u);
  await assert.rejects(compileAuthorDefinition(base(), { detached: [{ source: 'plugin.json', facet: 'missing', data: {} }] }), /plugin.json/u);
});
test('编译不执行作者默认函数，组合校验只在状态执行阶段调用', async () => {
  let defaults = 0, a = 0, b = 0;
  const definition = { ...base(), schema: z.object({ hp: z.number().default(() => { defaults++; return 90; }) }), validateState: () => { a++; } };
  const result = await compileAuthorDefinition(definition, { parts: [{ source: 'rule.ts', definition: { validateState: async () => { b++; } } }] });
  assert.equal(defaults, 0); assert.equal(a + b, 0);
  const core = new SolveCore(result.definition), state = await core.initialize();
  await core.execute({ $inc: { hp: -1 } }, state);
  assert.equal(defaults, 1); assert.ok(a > 0); assert.equal(a, b);
});
test('重新注册更新的世界书不会替换旧聊天固定的开局定义', async () => {
  const env = await hostEnvironment();
  const first = await compileAuthorDefinition(env.def, { worldInfo: [{ comment: '[SOLVE:INIT]', content: '{"characters":{"alice":{"hp":90}}}' }] });
  const updated = await compileAuthorDefinition(env.def, { worldInfo: [{ comment: '[SOLVE:INIT]', content: '{"characters":{"alice":{"hp":70}}}' }] });
  const manager = new SolveSessionManager(() => env.ctx, env.fetcher);
  try {
    await manager.register(first.definition, { characters: ['test.png'], attach: { cache: false } });
    assert.equal(manager.controller!.getValue('@alice.hp'), 90);
    await manager.register(updated.definition, { characters: ['test.png'], attach: { cache: false } });
    assert.equal(manager.controller!.getValue('@alice.hp'), 90);
    assert.equal(manager.controller!.core.definition.fingerprint, first.definition.fingerprint);
    const saved = env.files.get(env.ctx.chatId)!;
    env.ctx.chat = structuredClone(saved.slice(1)); env.ctx.chatMetadata = structuredClone(saved[0].chat_metadata);
    await manager.reconcile(); assert.equal(manager.controller!.getValue('@alice.hp'), 90);
  } finally { manager.dispose(); }
});
test('编译后修改原视图映射不会替换当前执行函数', async () => {
  const original = () => ({ hp: 1 }); const views = { sample: original };
  const definition = await compile({ ...base(), views });
  views.sample = () => ({ hp: 2 }); assert.equal(definition.views!.sample, original);
});

test('异步编译开始时固定来源和 Facet 方法，等待期间的外部编辑不串入当前定义', async () => {
  const definition = { ...base(), initialData: { gold: 20 } };
  const entries = [{ comment: '[SOLVE:GUIDE]', content: '原指南' }, { comment: '[SOLVE:HP]', content: '75' }];
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const facet: SolveFacet = { id: 'snapshot', version: '1', parseWorldInfo: entry => entry.tag === 'HP' ? { initialData: { hp: Number(entry.content) } } : undefined };
  const pending = compileAuthorDefinition(definition, { worldInfo: entries, facets: [facet], renderWorldInfo: async text => { await gate; return text; } });
  definition.initialData.gold = 99; entries[1]!.content = '10';
  facet.version = '2'; facet.parseWorldInfo = () => ({ initialData: { hp: 1 } });
  release(); const result = await pending;
  const state = await new SolveCore(result.definition).initialize();
  assert.equal(state.data.gold, 20); assert.equal(state.data.hp, 75);
  assert.equal(result.ir.runtimeBindings.authoring!.facets[0]!.version, '1');
});
test('宏替换和 Facet 异步失败保留条目来源', async () => {
  await assert.rejects(compileAuthorDefinition(base(), { worldInfo: [{ source: 'render-book', comment: '[SOLVE:INIT]', content: '{}' }], renderWorldInfo: async () => { throw new Error('替换失败'); } }), /render-book.*替换失败/u);
  await assert.rejects(compileAuthorDefinition(base(), { facets: [{ id: 'broken', version: '1', registerDetached: async () => { throw new Error('收集失败'); } }], detached: [{ source: 'broken.json', facet: 'broken', data: {} }] }), /broken.json.*收集失败/u);
});

test('IR 包含独立输出约束与显式数值规则，组合后冲突的上下限不能漏过', async () => {
  const result = await compileAuthorDefinition({ ...base(), outputSchema: z.object({ hp: z.number().max(90), gold: z.number(), combat: z.object({ mp: z.number() }) }), numeric: { hp: { min: 0, max: 90 } } });
  assert.deepEqual(result.ir.numeric, { hp: { min: 0, max: 90 } });
  assert.notEqual(result.ir.outputStructure, null);
  assert.throws(() => compose({ ...base(), numeric: { hp: { min: 10 } } }, { source: 'bounds.json', definition: { numeric: { hp: { max: 5 } } } }), /下限不能大于上限/u);
});
