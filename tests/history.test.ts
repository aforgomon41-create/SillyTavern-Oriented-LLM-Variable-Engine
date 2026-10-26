import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { fixture, binding } from './fixture.js';
import { createArchive, restore, replay, headKey, hash, SolveRuntime, IndexedDbCache, addGenesisVariant, serializeArchive, parseArchive } from '../src/index.js';
import type { Action, ArchiveAdapter, SaveDraft } from '../src/types.js';

const action = (actionId: string, delta = -10): Action => ({ actionId, kind: 'operations', source: 'model', operations: { $inc: { '@alice.hp': delta } } });
const noop: ArchiveAdapter = { assertCurrent: () => {}, save: async () => {} };
async function setup(adapter = noop) {
  const { core, state } = await fixture();
  const b = { ...binding, messageId: 'greeting' };
  const { archive, headId } = await createArchive(core, b);
  const runtime = new SolveRuntime(core, archive, headId, adapter); await runtime.ready();
  return { core, state, archive, headId, runtime };
}
test('仅JSON归档冷恢复，不重执行算子或作者校验', async () => {
  const { runtime } = await setup();
  const commit = await runtime.submit(action('model-1', -15), binding, '剧情');
  runtime.core.execute = async () => { throw new Error('Restore 禁止执行'); };
  runtime.core.definition.validateState = () => { throw new Error('Restore 禁止校验'); };
  const archive = parseArchive(serializeArchive(runtime.archive));
  const state = await restore(archive, commit.id);
  assert.equal((state.data.characters as any).alice.hp, 85);
  assert.equal(await hash(state), commit.stateHash);
});
test('同Swipe多次动作合成相对父提交的累计Patch，保留不可变旧修订', async () => {
  const { runtime, headId } = await setup();
  const first = await runtime.submit(action('model-1', -40), binding, '受伤');
  const second = await runtime.submit({ ...action('potion-1', 20), source: 'user' }, binding, '喝药');
  const third = await runtime.submit({ ...action('potion-2', 20), source: 'user' }, binding, '再喝');
  assert.equal(first.parentId, headId); assert.equal(second.parentId, headId); assert.equal(third.parentId, headId);
  assert.equal(third.actions.length, 3); assert.deepEqual(third.dataPatch, []);
  assert.equal((await restore(runtime.archive, first.id)).data.characters && ((await restore(runtime.archive, first.id)).data.characters as any).alice.hp, 60);
  assert.equal((await restore(runtime.archive, third.id)).data.characters && ((await restore(runtime.archive, third.id)).data.characters as any).alice.hp, 100);
});
test('重试同actionId只执行一次，同ID不同内容拒绝', async () => {
  let saves = 0;
  const { runtime } = await setup({ ...noop, save: async () => { saves++; } });
  const a = action('unique');
  const first = await runtime.submit(a, binding, '正文');
  const second = await runtime.submit(a, binding, '正文');
  assert.equal(first.id, second.id); assert.equal(saves, 1);
  assert.equal((runtime.getState().data.characters as any).alice.hp, 90);
  await assert.rejects(runtime.submit(action('unique', -20), binding, '正文'), /不同操作/u);
});
test('保存失败保留候选，重试复用Patch和作者结果', async () => {
  let failSave = true, executions = 0;
  const { runtime } = await setup({ ...noop, save: async () => { if (failSave) throw new Error('断网'); } });
  const original = runtime.core.execute.bind(runtime.core);
  runtime.core.execute = async (...args) => { executions++; return original(...args); };
  const a = action('retry');
  await assert.rejects(runtime.submit(a, binding, '正文'), /断网/u);
  assert.equal(runtime.pendingCount, 1); assert.equal((runtime.getState().data.characters as any).alice.hp, 100);
  const pendingId = runtime.exportPending()[0]!.commit.id;
  failSave = false;
  const commit = await runtime.submit(a, binding, '正文');
  assert.equal(commit.id, pendingId); assert.equal(executions, 1);
  assert.equal((runtime.getState().data.characters as any).alice.hp, 90);
});
test('刷新后可载入未保存草稿，不重执行', async () => {
  const { runtime, core, archive, headId } = await setup({ ...noop, save: async () => { throw new Error('断网'); } });
  await assert.rejects(runtime.submit(action('pending'), binding, '正文'));
  const loaded = new SolveRuntime(core, archive, headId, noop); await loaded.ready();
  loaded.importPending(runtime.exportPending());
  core.execute = async () => { throw new Error('不应重执行'); };
  await loaded.submit(action('pending'), binding, '正文');
  assert.equal((loaded.getState().data.characters as any).alice.hp, 90);
});
test('串行写入两个不同动作，调用方无法修改排队内容', async () => {
  const { runtime } = await setup();
  const a = action('one'), b = action('two');
  const p = runtime.submit(a, binding, '1');
  const q = runtime.submit(b, binding, '2');
  (b as any).operations.$inc['@alice.hp'] = -90;
  await Promise.all([p, q]);
  assert.equal((runtime.getState().data.characters as any).alice.hp, 80);
});
test('迟到异步任务在聊天切换后不写回', async () => {
  const { runtime } = await setup();
  let release!: () => void;
  const original = runtime.core.execute.bind(runtime.core);
  runtime.core.execute = async (...args) => { await new Promise<void>(r => { release = r; }); return original(...args); };
  const promise = runtime.submit(action('late'), binding, '正文');
  while (!release) await new Promise(r => setTimeout(r, 1));
  runtime.invalidate(); release();
  await assert.rejects(promise, /已经改变|已改变/u);
  assert.equal(runtime.archive.commits[runtime.headId]!.actions.length, 0);
});
test('下游引用的旧修订在上游再次修订后仍能独立恢复', async () => {
  const { runtime } = await setup();
  const first = await runtime.submit(action('floor1', -10), binding, '第一楼');
  const childBinding = { ...binding, messageId: 'message-2' };
  const child = await runtime.submit(action('floor2', -20), childBinding, '第二楼');
  await runtime.select(first.id);
  const revision = await runtime.submit({ ...action('edit-first', 5), source: 'user' }, binding, '第一楼加药');
  assert.notEqual(revision.id, first.id);
  assert.equal((await restore(runtime.archive, child.id)).data.characters && ((await restore(runtime.archive, child.id)).data.characters as any).alice.hp, 70);
  assert.equal((runtime.getState().data.characters as any).alice.hp, 95);
});
test('两个Swipe各自归属，切回恢复原状态', async () => {
  const { runtime, headId } = await setup();
  const a = await runtime.submit(action('a', -10), binding, '回复A');
  await runtime.select(headId);
  const bBinding = { ...binding, swipeId: 'swipe-1' };
  const b = await runtime.submit(action('b', -30), bBinding, '回复B');
  assert.equal(a.parentId, b.parentId);
  await runtime.select(a.id);
  assert.equal((runtime.getState().data.characters as any).alice.hp, 90);
});
test('Replay在新父状态重算，旧分支不变', async () => {
  const { runtime, core, headId } = await setup();
  const old = await runtime.submit(action('model', -15), binding, '正文');
  const result = await replay(core, runtime.archive, [old.id], headId, { [old.id]: [action('model', -25)] });
  assert.equal((await restore(result.archive, result.headId)).data.characters && ((await restore(result.archive, result.headId)).data.characters as any).alice.hp, 75);
  assert.equal((await restore(result.archive, old.id)).data.characters && ((await restore(result.archive, old.id)).data.characters as any).alice.hp, 85);
});
test('历史Patch、父链、操作摘要损坏均被定位', async () => {
  const { runtime } = await setup();
  const commit = await runtime.submit(action('model'), binding, '正文');
  const broken = runtime.archive;
  broken.commits[commit.id]!.stateHash = 'sha256:bad';
  await assert.rejects(restore(broken, commit.id), /结果不符/u);
  const missing = runtime.archive;
  delete missing.commits[commit.parentId!];
  await assert.rejects(restore(missing, commit.id), /缺少提交/u);
  const ops = runtime.archive;
  ops.commits[commit.id]!.actions = [];
  await assert.rejects(restore(ops, commit.id), /操作记录被修改/u);
});
test('Greeting变体有独立初始状态与根提交', async () => {
  const { archive, core, headId } = await setup();
  const variant = await addGenesisVariant(archive, core, { ...binding, messageId: 'greeting', swipeId: 'variant' }, { characters: { alice: { hp: 30 }, bob: {} } });
  assert.equal((await restore(archive, variant)).data.characters && ((await restore(archive, variant)).data.characters as any).alice.hp, 30);
  assert.equal((await restore(archive, headId)).data.characters && ((await restore(archive, headId)).data.characters as any).alice.hp, 100);
});
test('IndexedDB可以全清，恢复哈希仍相同', async () => {
  const { runtime } = await setup();
  const commit = await runtime.submit(action('model'), binding, '正文');
  const cache = new IndexedDbCache(indexedDB, `solve-test-${crypto.randomUUID()}`);
  await cache.put(runtime.archive, commit.id, runtime.getState());
  assert.equal(await hash(await cache.restore(runtime.archive, commit.id)), commit.stateHash);
  await cache.clear();
  assert.equal(await hash(await cache.restore(runtime.archive, commit.id)), commit.stateHash);
  await cache.savePending('test', [{ a: 1 }]);
  assert.deepEqual(await cache.loadPending('test'), [{ a: 1 }]);
  cache.close();
});
test('模块开关的enginePatch可冷恢复，Replay复用有序内部事件', async () => {
  const { runtime, core, headId } = await setup();
  const off: Action = { actionId: 'module-off', kind: 'module', module: 'combat', enabled: false, source: 'user' };
  const commit = await runtime.submit(off, binding, '关闭战斗');
  assert.equal((await restore(runtime.archive, commit.id)).engineState.activeModules.combat, false);
  const result = await replay(core, runtime.archive, [commit.id], headId);
  assert.equal((await restore(result.archive, result.headId)).engineState.activeModules.combat, false);
});
test('待保存草稿刷新后可重绑临时token，正文变化则拒绝覆盖', async () => {
  const { runtime, core, archive, headId } = await setup({ ...noop, save: async () => { throw new Error('断网'); } });
  const a = action('with-source');
  await assert.rejects(runtime.submit(a, { ...binding, generationToken: 'old' }, '候选正文', { sourceText: '原正文' }));
  const loaded = new SolveRuntime(core, archive, headId, { ...noop, assertCurrent: identity => { if (identity.generationToken !== 'new') throw new Error('过期token'); } });
  await loaded.ready(); loaded.importPending(runtime.exportPending());
  await assert.rejects(loaded.submit(a, { ...binding, generationToken: 'new' }, '候选正文', { sourceText: '新改正文' }), /原正文已变化/u);
  await loaded.submit(a, { ...binding, generationToken: 'new' }, '候选正文', { sourceText: '原正文' });
  assert.equal((loaded.getState().data.characters as any).alice.hp, 90);
});
