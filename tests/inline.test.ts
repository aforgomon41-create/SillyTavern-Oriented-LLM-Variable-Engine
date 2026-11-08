import test from 'node:test';
import assert from 'node:assert/strict';
import { author, compile, compileAuthorDefinition, captureDefinitionSnapshot, restoreDefinitionSnapshot, guide, hash, project, SolveCore, z } from '../src/index.js';
import type { Definition, SolveFacet } from '../src/index.js';
import { createArchive, restore } from '../src/index.js';

function example(): Definition {
  const a = author();
  const item = z.object({ name: z.string(), count: a.field(z.number().int().min(0).default(1), { numeric: { destroyOnZero: true } }) });
  return { id: 'inline-card', version: '1', schema: z.object({
    player: a.singleton(z.object({
      hp: a.field(z.number().min(0).max(100).default(100), { module: 'combat', guide: '受伤减少hp。' }),
      bio: a.field(z.string().default('静态描述'), { readonly: true }),
      secret: a.field(z.string().default('内部'), { internal: true }),
      friend: a.ref(z.string().nullable().default(null), { kind: 'single', onDelete: 'null' }),
      inventory: a.collection(z.record(z.string(), item).default({}), { type: 'item' }),
    }), { id: 'player', type: 'person' }),
    shop: a.collection(z.record(z.string(), item).default({}), { type: 'item' }),
  }), initialData: { player: { inventory: { potion: { name: '药水' } } }, shop: { sword: { name: '剑' } } },
    ...a.useModules({ combat: { enabled: true } }) };
}

test('Tuple与交叉结构收集位置，存储恢复不重复变换，结构身份不遗漏分支', async () => {
  const a = author(); let transforms = 0;
  const make = (right: z.ZodType) => ({ id: 'complex-inline', version: '1', schema: z.object({
    tuple: z.tuple([a.field(z.number(), { internal: true }), z.string().transform(v => { transforms++; return v + '!'; })]),
    joined: z.intersection(z.object({ hp: a.field(z.number(), { readonly: true }) }), right),
  }), initialData: { tuple: [1, 'x'], joined: { hp: 2, note: 'memo' } } });
  const def = await compile(make(z.object({ note: a.field(z.string(), { internal: true }) })));
  assert.deepEqual(def.internal, ['tuple.0', 'joined.note']); assert.deepEqual(def.readonly, ['joined.hp']);
  const core = new SolveCore(def), { archive, headId } = await createArchive(core, { chatId: 'c', messageId: 'm', swipeId: 's' });
  const state = await restore(archive, headId); assert.equal(transforms, 1); assert.deepEqual(state.data.tuple, [1,'x!']);
  assert.deepEqual((project(def, state, { view: 'narrative' }) as any).tuple, [null,'x!']);
  const changed = await compile(make(z.object({ note: a.field(z.number(), { internal: true }) })));
  assert.notEqual(def.fingerprint, changed.fingerprint);
  await assert.rejects(compile({ id: 'tuple-rest', version: '1', schema: z.object({ rows: z.tuple([z.string()]).rest(a.field(z.number(), { internal: true })) }), initialData: { rows: ['x', 1] } }), /Tuple尾部/u);
});

test('管道输出与显式outputSchema注解会收集，普通不同形状联合继续有效', async () => {
  const a = author();
  const piped = z.object({ value: z.string().transform(Number).pipe(a.field(z.number(), { internal: true })) });
  const def = await compile({ id: 'pipe-inline', version: '1', schema: piped, initialData: { value: '3' } });
  assert.deepEqual(def.internal, ['value']); assert.deepEqual(project(def, await new SolveCore(def).initialize(), { view: 'narrative' }), {});
  const output = await compile({ id: 'output-inline', version: '1', schema: z.object({ raw: z.string() }).transform(v => ({ n: Number(v.raw) })), outputSchema: z.object({ n: a.field(z.number(), { readonly: true }) }), initialData: { raw: '4' } });
  assert.deepEqual(output.readonly, ['n']); assert.deepEqual((await new SolveCore(output).initialize()).data, { n: 4 });
  const union = await compile({ id: 'ordinary-union', version: '1', schema: z.object({ value: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]) }), initialData: { value: { a: 'ok' } } });
  assert.deepEqual((await new SolveCore(union).initialize()).data, { value: { a: 'ok' } });
});
test('内联字段与嵌套实体自动收集通配路径，复用物品结构不串位置', async () => {
  const def = await compile(example());
  assert.deepEqual(def.entities, [{ path: 'player', type: 'person', singletonId: 'player' }, { path: 'player.inventory', type: 'item' }, { path: 'shop', type: 'item' }]);
  assert.deepEqual(def.refs, [{ path: 'player.friend', kind: 'single', onDelete: 'null' }]);
  assert.deepEqual(def.modules!.combat!.paths, ['player.hp']);
  assert.deepEqual(Object.keys(def.numeric!), ['player.inventory.*.count','shop.*.count']);
  const core = new SolveCore(def), state = await core.initialize();
  assert.match(guide(def, state), /player.hp：受伤减少hp/u);
  assert.equal((project(def, state, { view: 'operator' }) as any)['@player'].bio, undefined);
  assert.equal((project(def, state, { view: 'narrative' }) as any)['@player'].secret, undefined);
  const result = await core.execute({ $inc: { '@potion.count': -1 } }, state);
  assert.equal((result.state.data.player as any).inventory.potion, undefined);
});
test('内联与分离配置产生相同状态和定义身份，原schema未被改写', async () => {
  const native = await compile({ id: 'native-meta', version: '1', schema: z.object({ n: z.number().meta({ nativeDate: new Date(0) }) }), initialData: { n: 1 } });
  assert.deepEqual((await new SolveCore(native).initialize()).data, { n: 1 }, '没有SOLVE注解的普通Zod元信息不受作者采集约束');
  const a = author(), original = z.number().min(0).max(100).default(100);
  const annotated = a.field(original, { readonly: true }); assert.equal((original.meta() as any)?.solveInlineV1, undefined);
  const base = { id: 'equivalent', version: '1', schema: z.object({ hp: original }), initialData: {} };
  const inline = await compileAuthorDefinition({ ...base, schema: z.object({ hp: annotated }) });
  const detached = await compileAuthorDefinition({ ...base, readonly: ['hp'] });
  assert.equal(inline.definition.fingerprint, detached.definition.fingerprint); assert.equal(inline.irHash, detached.irHash);
  assert.deepEqual(await new SolveCore(inline.definition).initialize(), await new SolveCore(detached.definition).initialize());
});
test('注解跨default/optional/refine/nullable保留，默认函数不被编译执行', async () => {
  const a = author(); let calls = 0;
  const annotated = a.field(z.number(), { internal: true }).min(0).refine(value => value <= 100).optional().default(() => { calls++; return 90; });
  const def = await compile({ id: 'wrappers', version: '1', schema: z.object({ hp: annotated }), initialData: {} });
  assert.equal(calls, 0); assert.deepEqual(def.internal, ['hp']);
  const core = new SolveCore(def), state = await core.initialize(); assert.equal(calls, 1);
  assert.ok((await core.execute({ $set: { hp: -1 } }, state)).feedback.some(row => row.code === 'CLAMP_APPLIED'));
  assert.ok((await core.execute({ $set: { hp: 150 } }, state)).feedback.some(row => row.level === 'L3'));
});
test('内联冲突、未声明模块、错误实体及引用形状给出来源', async () => {
  const a = author();
  assert.throws(() => a.field(a.field(z.number(), { module: 'a' }), { module: 'b' }), /冲突/u);
  await assert.rejects(compile({ id: 'missing-module', version: '1', schema: z.object({ hp: a.field(z.number(), { module: 'missing', source: 'hp.ts:7' }) }), initialData: { hp: 1 } }), /hp.ts:7.*模块/u);
  for (const schema of [a.collection(z.array(z.number()), { type: 'item' }), a.singleton(z.string(), { id: 'x', type: 'item' }), a.ref(z.number(), { kind: 'single', onDelete: 'null' })]) {
    await assert.rejects(compile({ id: 'bad-node', version: '1', schema: z.object({ bad: schema }), initialData: {} }), /schema:bad/u);
  }
  assert.throws(() => a.field(z.number(), { guide: 123 as any }), /指南/u);
});
test('数组与Record路径收集、对象子树可见性和模块整体归属', async () => {
  const a = author(), child = a.field(z.number(), { internal: true });
  const def = await compile({ id: 'paths', version: '1', schema: z.object({
    rows: z.array(z.object({ n: child })), records: z.record(z.string(), z.object({ n: child })),
    dormant: a.field(z.object({ n: z.number() }), { module: 'off' }),
  }), ...a.useModules({ off: { enabled: false } }), initialData: { rows: [{ n: 1 }], records: { x: { n: 2 } }, dormant: { n: 3 } } });
  assert.deepEqual(def.internal, ['rows.*.n','records.*.n']);
  const state = await new SolveCore(def).initialize(); const view = project(def, state, { view: 'narrative' }) as any;
  assert.deepEqual(view, { rows: [{}], records: { x: {} } });
});
test('联合分支有歧义的注解拒绝，共同外层注解正常使用', async () => {
  const a = author();
  await assert.rejects(compile({ id: 'union', version: '1', schema: z.object({ value: z.union([a.field(z.string(), { internal: true }), z.number()]) }), initialData: { value: 'x' } }), /联合分支/u);
  const def = await compile({ id: 'union-common', version: '1', schema: z.object({ value: a.field(z.union([z.string(),z.number()]), { internal: true }) }), initialData: { value: 'x' } });
  assert.deepEqual(def.internal, ['value']);
  await assert.rejects(compile({ id: 'union-functions', version: '1', schema: z.object({ value: z.union([
    a.field(z.number(), { guide: { when: () => true, text: '指南' } }), a.field(z.string(), { guide: { when: () => false, text: '指南' } }),
  ]) }), initialData: { value: 1 } }), /联合分支/u);
});
test('字段指南对象保留条件函数与包装链，不把缺省id写成非法JSON', async () => {
  const a = author(); const schema = z.object({ hp: a.field(z.number().default(20), { guide: { when: ({ get }) => Number(get('hp')) < 30, text: '低血量' } }).optional() });
  const def = await compile({ id: 'field-guide', version: '1', schema, initialData: {} });
  assert.equal(guide(def, await new SolveCore(def).initialize()), 'hp：低血量');
});
test('字段模块归属冲突有位置诊断，显式父子模块允许嵌套归属', async () => {
  const a = author(), schema = z.object({ combat: a.field(z.object({ hp: a.field(z.number(), { module: 'child' }) }), { module: 'parent' }) });
  const input = { id: 'module-ownership', version: '1', schema, initialData: { combat: { hp: 20 } } };
  await assert.rejects(compile({ ...input, ...a.useModules({ parent: {}, child: {} }) }), /schema:combat.hp.*归属/u);
  const def = await compile({ ...input, ...a.useModules({ parent: {}, child: { parent: 'parent' } }) });
  assert.deepEqual(def.modules!.child!.paths, ['combat.hp']);
});
test('异步扩展等待时固定节点元信息及Facet方法，不串入外部修改', async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(r => { release = r; }), entered = new Promise<void>(r => { started = r; });
  const metadata = { label: { text: '原说明' } };
  const facet: SolveFacet = { id: 'snapshot', version: '1', extendZod: async schema => { started(); await gate; return schema; },
    collectInlineMeta: (_schema, ctx) => (ctx.metadata.label as any)?.text ? { guide: (ctx.metadata.label as any).text } : undefined };
  const task = compile({ id: 'metadata-snapshot', version: '1', schema: z.object({ hp: z.number().meta(metadata) }), initialData: { hp: 1 }, facets: [facet] });
  await entered; metadata.label.text = '修改后的说明'; facet.collectInlineMeta = () => ({ guide: '错误说明' }); release();
  assert.equal((await task).guide, '原说明');
});
test('已编译定义可增添新的Facet，不重复运行已有收集器', async () => {
  let oldCalls = 0, newCalls = 0;
  const old: SolveFacet = { id: 'old', version: '1', collectInlineMeta: () => { oldCalls++; return undefined; } };
  const base = await compile({ id: 'add-facet', version: '1', schema: z.object({ hp: z.number() }), initialData: { hp: 1 }, facets: [old] });
  const before = oldCalls;
  const next: SolveFacet = { id: 'new', version: '1', extendZod: schema => { newCalls++; return schema; }, collectInlineMeta: (_schema, ctx) => ctx.path === 'hp' ? { internal: ['hp'] } : undefined };
  const result = await compileAuthorDefinition(base, { facets: [old, next] });
  assert.equal(oldCalls, before); assert.equal(newCalls, 1); assert.deepEqual(result.definition.internal, ['hp']);
});
test('作者便利入口可组合六板块，来源冲突继续被统一检查', async () => {
  const a = author(), base: Definition = { id: 'helpers', version: '1', schema: z.object({ hp: z.number() }), initialData: {} };
  const def = await compileAuthorDefinition(a.compose(base, { source: 'start', definition: a.useInitial({ hp: 10 }) },
    { source: 'guides', definition: a.useGuides([{ id: 'g', when: 'hp < 20', text: 'low' }]) },
    { source: 'view', definition: a.useViews({ hpOnly: data => ({ hp: data.hp! }) }) }));
  const state = await new SolveCore(def.definition).initialize(); assert.equal(guide(def.definition, state), 'low');
  assert.deepEqual(project(def.definition, state, { view: 'hpOnly' }), { hp: 10 });
  assert.throws(() => a.compose(base, { source: 'one', definition: a.useInitial({ hp: 10 }) }, { source: 'two', definition: a.useInitial({ hp: 20 }) }), /two.*hp/u);
});
test('Facet扩展schema、收集自定义节点元信息与afterCompile，重新注册不重复收集', async () => {
  let extended = 0, collected = 0, after = 0;
  const facet: SolveFacet = { id: 'label', version: '1', extendZod: async schema => { extended++; return schema; },
    collectInlineMeta: async (_schema, ctx) => { collected++; return ctx.metadata.label ? { guide: `${ctx.path}：${ctx.metadata.label}` } : undefined; },
    runtimeHooks: { afterCompile: context => { after++; assert.ok(context.fingerprint); assert.ok(Object.isFrozen(context.ir)); } } };
  const def = await compile({ id: 'facet-inline', version: '1', facets: [facet], schema: z.object({ hp: z.number().meta({ label: '生命值' }) }), initialData: { hp: 2 } });
  assert.equal(extended, 1); assert.equal(after, 1); assert.equal(collected, 2); assert.equal(def.guide, 'hp：生命值');
  assert.equal((await compile(def)).fingerprint, def.fingerprint); assert.equal(extended, 1); assert.equal(after, 1);
  assert.equal((await compileAuthorDefinition(def, { worldInfo: [{ comment: '[SOLVE:GUIDE]', content: '书' }] })).definition.guide, 'hp：生命值\n\n书');
  assert.equal(extended, 1); assert.equal(collected, 2); assert.equal(after, 2);
});
test('内联声明与Facet运行时函数能从固定声明恢复，不重新运行收集器', async () => {
  let calls = 0;
  const a = author(), facet: SolveFacet = { id: 'projection', version: '1', collectInlineMeta: () => { calls++; return undefined; },
    runtimeHooks: { beforeProjection: ctx => ({ ...ctx.data, derived: true }) } };
  const base = await compile({ id: 'restore-inline', version: '1', facets: [facet], schema: z.object({ hp: a.field(z.number().default(5), { internal: true }) }), initialData: {} });
  const defined = await compileAuthorDefinition(base, { worldInfo: [{ comment: '[SOLVE:INIT]', content: '{"hp":6}' }] });
  const snapshot = await captureDefinitionSnapshot(base, defined.definition, ['book']), before = calls;
  const restored = await restoreDefinitionSnapshot(base, snapshot, snapshot.fingerprint);
  assert.equal(calls, before); assert.equal(restored.facets![0]!.runtimeHooks!.beforeProjection, base.facets![0]!.runtimeHooks!.beforeProjection);
  assert.deepEqual(project(restored, await new SolveCore(restored).initialize(), { view: 'narrative' }), { derived: true });
  assert.equal(await hash(snapshot), await hash(restored.authoringSnapshot));
});
