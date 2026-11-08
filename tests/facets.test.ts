import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileAuthorDefinition, createArchive, captureDefinitionSnapshot, restoreDefinitionSnapshot, hash, project, restore, SolveCore, SolveRuntime, z } from '../src/index.js';
import type { SolveFacet } from '../src/index.js';
import { hostEnvironment } from './host-fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';
import { SolveSessionManager } from '../src/host/sessions.js';

test('视图Hook只得到过滤后副本，派生字段不改变正式状态', async () => {
  const facet: SolveFacet = { id: 'view', version: '1', runtimeHooks: { beforeProjection: ctx => {
    assert.equal(ctx.data.secret, undefined); ctx.data.n = 999; return { ...ctx.data, label: '派生' };
  } } };
  const def = await compile({ id: 'view', version: '1', schema: z.object({ n: z.number(), secret: z.string() }), initialData: { n: 1, secret: '内部' }, internal: ['secret'], facets: [facet] });
  const state = await new SolveCore(def).initialize(), before = await hash(state);
  assert.deepEqual(project(def, state, { view: 'narrative' }), { n: 999, label: '派生' }); assert.equal(await hash(state), before);
});
test('异步视图Hook与非法返回值明确报错，afterCompile异步错误保留扩展来源', async () => {
  for (const fn of [(async () => ({})) as any, (() => []) as any, () => { throw new Error('视图错误'); }]) {
    const def = await compile({ id: 'view-error', version: '1', schema: z.object({ n: z.number() }), initialData: { n: 1 }, facets: [{ id: 'bad-view', version: '1', runtimeHooks: { beforeProjection: fn } }] });
    assert.throws(() => project(def, awaitState), /bad-view/u);
    // Use a confirmed valid state so the error is specifically the projection hook.
  }
  await assert.rejects(compile({ id: 'after-error', version: '1', schema: z.object({}), initialData: {}, facets: [{ id: 'after', version: '1', runtimeHooks: { afterCompile: async () => { throw new Error('编译观察失败'); } } }] }), /after:afterCompile.*编译观察失败/u);
});
const awaitState = { data: { n: 1 }, engineState: { activeModules: {}, prefabLifecycle: {} } };
test('仅确认保存的新动作触发Hook：失败不触发、重试一次、重复action不重发', async () => {
  const env = await hostEnvironment(); let calls = 0;
  const facet: SolveFacet = { id: 'audit', version: '1', runtimeHooks: { onStateCommitted: ctx => { calls++; assert.equal((ctx.state.data.characters as any).alice.hp, 99); ctx.state.data.characters = {}; } } };
  const c = await attachSillyTavern({ ...env.def, facets: [facet] }, () => env.ctx, { cache: false }, env.fetcher);
  try {
    const batch = { $inc: { '@alice.hp': -1 } }; env.setFailBefore(true);
    await assert.rejects(c.submit(batch, { actionId: 'same' }), /断开/u); await c.runtime.settledHooks(); assert.equal(calls, 0);
    env.setFailBefore(false); await c.submit(batch, { actionId: 'same' }); await c.runtime.settledHooks(); assert.equal(calls, 1); assert.equal(c.getValue('@alice.hp'), 99);
    await c.submit(batch, { actionId: 'same' }); await c.runtime.settledHooks(); assert.equal(calls, 1);
    await c.replayMessage(0); await c.runtime.settledHooks(); assert.equal(calls, 1, 'Replay不重发通知');
    const { archive, headId } = c.runtime; await restore(archive, headId); assert.equal(calls, 1);
  } finally { c.dispose(); }
});
test('Hook继续提交不会死锁，来源链阻止自身与交叉循环', async () => {
  const env = await hostEnvironment(); let a = 0, b = 0;
  const facets: SolveFacet[] = [
    { id: 'A', version: '1', runtimeHooks: { onStateCommitted: async ctx => { a++; await ctx.submit({ $inc: { '@alice.hp': -1 } }); } } },
    { id: 'B', version: '1', runtimeHooks: { onStateCommitted: async ctx => {
      b++; if ((ctx.commit.actions.at(-1)?.authorInputs as any)?.solveFacetChain?.includes('A')) await ctx.submit({ $inc: { '@alice.hp': -1 } });
    } } },
  ];
  const c = await attachSillyTavern({ ...env.def, facets }, () => env.ctx, { cache: false }, env.fetcher);
  try {
    await c.submit({ $inc: { '@alice.hp': -1 } }); await c.runtime.settledHooks();
    assert.equal(c.getValue('@alice.hp'), 97); assert.equal(a, 1); assert.equal(b, 2); assert.equal(c.runtime.getHookErrors().length, 0);
    const action = c.runtime.getCommit()!.actions.at(-1)!; assert.deepEqual((action.authorInputs as any).solveFacetChain, ['A','B']);
    assert.ok((await c.validateArchive()).every(row => row.valid));
    await c.replayMessage(0); await c.runtime.settledHooks(); assert.equal(c.getValue('@alice.hp'), 97); assert.equal(a, 1); assert.equal(b, 2);
  } finally { c.dispose(); }
});
test('保存后Hook失败只报告诊断，不把成功提交变成失败或再次执行', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern({ ...env.def, facets: [{ id: 'broken', version: '1', runtimeHooks: { onStateCommitted: async () => { throw new Error('通知失败'); } } }] }, () => env.ctx, { cache: false }, env.fetcher);
  try {
    await c.submit({ $inc: { '@alice.hp': -2 } }); await c.runtime.settledHooks();
    assert.equal(c.getValue('@alice.hp'), 98); assert.equal(c.runtime.pendingCount, 0); assert.match(c.runtime.getHookErrors()[0]!, /通知失败/u);
  } finally { c.dispose(); }
});
test('切聊后的延迟Hook操作拒绝，不能写入其他聊天', async () => {
  const env = await hostEnvironment(); let release!: () => void, started!: () => void;
  const gate = new Promise<void>(r => { release = r; }), entered = new Promise<void>(r => { started = r; });
  const c = await attachSillyTavern({ ...env.def, facets: [{ id: 'late', version: '1', runtimeHooks: { onStateCommitted: async ctx => { started(); await gate; await ctx.submit({ $inc: { '@alice.hp': -10 } }); } } }] }, () => env.ctx, { cache: false }, env.fetcher);
  await c.submit({ $inc: { '@alice.hp': -1 } }); await entered; const runtime = c.runtime;
  c.dispose(); env.switchChat('another'); release(); await runtime.settledHooks();
  assert.equal(env.files.has('another'), false); assert.equal(runtime.getHookErrors().length, 1);
});

test('延迟Hook仍定位原楼层，新回复尚未同步时不误投到末楼', async () => {
  const env = await hostEnvironment(); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const c = await attachSillyTavern({ ...env.def, facets: [{ id: 'original-floor', version: '1', runtimeHooks: { onStateCommitted: async ctx => { entered(); await gate; await ctx.submit({ $inc: { '@alice.hp': -2 } }); } } }] }, () => env.ctx, { cache: false }, env.fetcher);
  try {
    await c.submit({ $inc: { '@alice.hp': -1 } }); await started;
    assert.equal(c.getStatus().facetHooksPending, 1);
    const next = env.addReply('{}'); release(); await c.runtime.settledHooks();
    assert.equal(c.getValue('@alice.hp'), 97); assert.equal(c.runtime.getHookErrors().length, 0); assert.equal(c.getStatus().facetHooksPending, 0);
    assert.match(env.ctx.chat[0]!.mes, /solveFacetChain/u); assert.doesNotMatch(env.ctx.chat[next]!.mes, /solve_mutual_operate/u);
  } finally { c.dispose(); }
});

test('延迟Hook遇到新的已确认提交会明确拒绝，保留新状态与诊断', async () => {
  const env = await hostEnvironment(); let release!: () => void, entered!: () => void, calls = 0;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const c = await attachSillyTavern({ ...env.def, facets: [{ id: 'head-guard', version: '1', runtimeHooks: { onStateCommitted: async ctx => {
    if (++calls !== 1) return; entered(); await gate; await ctx.submit({ $inc: { '@alice.hp': -10 } });
  } } }] }, () => env.ctx, { cache: false }, env.fetcher);
  try {
    await c.submit({ $inc: { '@alice.hp': -1 } }); await started;
    await c.submit({ $inc: { '@alice.hp': -2 } }); release(); await c.runtime.settledHooks();
    assert.equal(c.getValue('@alice.hp'), 97); assert.match(c.runtime.getHookErrors()[0]!, /状态已变化/u); assert.equal(calls, 2);
  } finally { c.dispose(); }
});
test('原生世界书自定义Facet条目在新聊天收集，旧聊天恢复不重跑收集或Hook', async () => {
  const env = await hostEnvironment(); let parses = 0, hooks = 0, compiled = 0;
  const facet: SolveFacet = { id: 'custom-book', version: '1', parseWorldInfo: entry => { parses++; return entry.tag === 'EXTRA' ? { guide: entry.content } : undefined; },
    runtimeHooks: { afterCompile: () => { compiled++; }, onStateCommitted: () => { hooks++; } } };
  const base = await compile({ ...env.def, facets: [facet] });
  (env.ctx.characters as any)[0].data = { extensions: { world: 'book' } };
  let exists = true;
  const fetcher = (async (url: any, init?: RequestInit) => {
    if (url === '/api/worldinfo/list') return Response.json(exists ? [{ file_id: 'book' }] : []);
    if (url === '/api/worldinfo/get') return Response.json({ entries: { 0: { comment: '[SOLVE:EXTRA]', content: '扩展指南' } } });
    return env.fetcher(url, init);
  }) as typeof fetch;
  const first = new SolveSessionManager(() => env.ctx, fetcher); await first.registerWorldInfo(base, { characters: ['test.png'], attach: { cache: false } });
  await first.controller!.submit({ $inc: { '@alice.hp': -1 } }); await first.controller!.runtime.settledHooks(); assert.equal(hooks, 1); assert.equal(parses, 1);
  first.dispose(); const before = compiled; exists = false;
  const second = new SolveSessionManager(() => env.ctx, fetcher);
  try { await second.registerWorldInfo(base, { characters: ['test.png'], attach: { cache: false } }); assert.equal(second.controller!.getValue('@alice.hp'), 99); assert.match(second.controller!.getGuide(), /扩展指南/u); assert.equal(parses, 1); assert.equal(compiled, before); assert.equal(hooks, 1); }
  finally { second.dispose(); }
});
test('Facet回调存在与版本进入身份，快照不能丢掉或增添基础包扩展', async () => {
  const base = { id: 'facet-binding', version: '1', schema: z.object({ n: z.number().default(0) }), initialData: {} };
  const facet: SolveFacet = { id: 'f', version: '1', runtimeHooks: { onStateCommitted: () => {} } };
  const prepared = await compile({ ...base, facets: [facet] }), authored = await compileAuthorDefinition(prepared);
  const snapshot = await captureDefinitionSnapshot(prepared, authored.definition, []);
  assert.equal((await restoreDefinitionSnapshot(prepared, snapshot, snapshot.fingerprint)).fingerprint, authored.definition.fingerprint);
  await assert.rejects(restoreDefinitionSnapshot(await compile({ ...base, facets: [{ ...facet, runtimeHooks: {} }] }), snapshot, snapshot.fingerprint), /原版本/u);
  await assert.rejects(captureDefinitionSnapshot(base, authored.definition, []), /Facet/u);
  await assert.rejects(compile({ ...prepared, facets: [{ ...facet, version: '2' }] }), /绑定/u);
});
test('纯Runtime可观察已保存结果，恢复与ready不触发保存后通知', async () => {
  let calls = 0;
  const def = await compile({ id: 'standalone-hook', version: '1', schema: z.object({ n: z.number() }), initialData: { n: 0 }, facets: [{ id: 'observe', version: '1', runtimeHooks: { onStateCommitted: () => { calls++; } } }] });
  const binding = { chatId: 'c', messageId: 'm', swipeId: 's' }, core = new SolveCore(def), { archive, headId } = await createArchive(core, binding);
  const runtime = new SolveRuntime(core, archive, headId, { assertCurrent() {}, async save() {} }); await runtime.ready(); assert.equal(calls, 0);
  await runtime.submit({ actionId: 'a', kind: 'operations', source: 'user', operations: { $inc: { n: 1 } } }, binding, 'one'); await runtime.settledHooks(); assert.equal(calls, 1);
  await runtime.select(runtime.headId); await runtime.ready(); await runtime.settledHooks(); assert.equal(calls, 1);
});
