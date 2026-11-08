import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { fixture, binding } from './fixture.js';
import { buildCommit, createArchive, hash, headKey, restore, SolveRuntime, IndexedDbCache, archiveProof } from '../src/index.js';
import { VerifiedHistory } from '../src/verified-history.js';
import { captureRestorePath, pathProof } from '../src/history-restore.js';
import { setup } from './host-fixture.js';
import { SillyTavern119Adapter } from '../src/host/sillytavern.js';
import type { Archive } from '../src/types.js';

async function chain(length = 5) {
  const { core } = await fixture(), { archive, headId } = await createArchive(core, binding);
  let head = headId, state = await restore(archive, headId);
  const ids = [head];
  for (let i = 0; i < length; i++) {
    const result = await core.execute({ $inc: { '@alice.hp': -1 } }, state);
    const commit = await buildCommit(archive, head, archive.commits[head]!.genesisId, state, result.state,
      { ...binding, messageId: 'm' + i }, [{ actionId: 'a' + i, kind: 'operations', source: 'user', operations: { $inc: { '@alice.hp': -1 } } }], [], {}, '');
    archive.commits[commit.id] = commit; archive.heads[headKey(commit.binding)] = commit.id;
    head = commit.id; state = result.state; ids.push(head);
  }
  return { core, archive, head, state, ids };
}

test('验证证明与旧 proof 字节一致，命中结果和调用方互不影响', async () => {
  const { archive, head, state } = await chain();
  assert.equal(await pathProof(captureRestorePath(archive, head)), await archiveProof(archive, head));
  const history = new VerifiedHistory();
  const first = await history.restore(archive, head); (first.data.characters as any).alice.hp = 0;
  assert.deepEqual(await history.restore(structuredClone(archive), head), state);
  assert.equal(history.getStats().fullRestores, 1); assert.equal(history.getStats().memoryHits, 1);
});

test('最近已验证祖先只恢复后缀，同一父链的旧状态和分支仍可独立寻址', async () => {
  const { archive, ids, head } = await chain(8), history = new VerifiedHistory();
  await history.restore(archive, ids[6]!); const before = history.getStats();
  assert.deepEqual(await history.restore(archive, head), await restore(archive, head));
  assert.equal(history.getStats().verifiedCommits - before.verifiedCommits, 2);
  assert.equal(history.getStats().checkpointRestores, 1);
  const copy = structuredClone(archive); copy.heads = {};
  copy.commits['unrelated'] = { ...structuredClone(archive.commits[head]!), id: 'unrelated', parentId: 'missing-in-unrelated-branch' };
  assert.deepEqual(await history.restore(copy, head), await restore(archive, head));
  assert.equal(history.getStats().memoryHits, 1);
});

test('同 ID 和最终 stateHash 不能掩盖祖先、开局或定义变更', async () => {
  const { archive, head, ids } = await chain(), history = new VerifiedHistory(); await history.restore(archive, head);
  const corruptions: ((a: Archive) => void)[] = [
    a => { a.commits[ids[2]!]!.opsDigest = 'bad'; },
    a => { a.commits[ids[2]!]!.actions[0]!.actionId = 'edited'; },
    a => { a.commits[ids[2]!]!.dataPatch.push({ op: 'remove', path: '/missing' }); },
    a => { a.commits[ids[2]!]!.baseHash = 'bad'; },
    a => { a.commits[ids[2]!]!.stateHash = 'bad'; },
    a => { a.commits[ids[2]!]!.id = 'different'; },
    a => { a.commits[ids[2]!]!.parentId = head; },
    a => { a.geneses[a.commits[head]!.genesisId]!.stateHash = 'bad'; },
    a => { (a.geneses[a.commits[head]!.genesisId]!.state.data.characters as any).alice.hp = 0; },
    a => { a.definitionHash = 'bad'; },
    a => { (a as any).version = 'bad'; },
  ];
  for (const corrupt of corruptions) {
    const broken = structuredClone(archive); corrupt(broken);
    await assert.rejects(history.restore(broken, head));
  }
  assert.equal(history.getStats().memoryHits, 0);
  assert.deepEqual(await history.restore(archive, head), await restore(archive, head));
});

test('不同会话、作者快照和 Genesis 不能只凭相同末端状态复用认证', async () => {
  const { archive, head } = await chain(), history = new VerifiedHistory(); await history.restore(archive, head);
  const copy = structuredClone(archive); copy.sessionId = 'other-session';
  await history.restore(copy, head); assert.equal(history.getStats().fullRestores, 2);
  const edited = structuredClone(archive); edited.authoring = { changed: true } as any;
  await history.restore(edited, head); assert.equal(history.getStats().fullRestores, 3);
});

test('认证在第一次 await 前固定输入，异步清理后不重新填入旧检查点', async () => {
  const { archive, head, state, ids } = await chain(), history = new VerifiedHistory();
  const pending = history.restore(archive, head);
  archive.commits[ids[2]!]!.opsDigest = 'bad';
  assert.deepEqual(await pending, state); await assert.rejects(history.restore(archive, head));
  const other = await chain(); history.clear();
  const inFlight = history.restore(other.archive, other.head); history.clear(); await inFlight;
  assert.equal(history.getStats().checkpoints, 0);
  await history.restore(other.archive, other.head);
  const hit = history.restore(other.archive, other.head); history.clear(); await hit;
  assert.equal(history.getStats().checkpoints, 0);
  await history.restore(other.archive, other.ids.at(-2)!);
  const suffix = history.restore(other.archive, other.head); history.clear(); await suffix;
  assert.equal(history.getStats().checkpoints, 0);
});

test('检查点按数量和字节预算淘汰，禁用或不足时完整恢复', async () => {
  const { archive, ids } = await chain(); const history = new VerifiedHistory({ maxEntries: 1 });
  await history.restore(archive, ids[2]!); await history.restore(archive, ids[3]!);
  assert.equal(history.getStats().checkpoints, 1);
  await history.restore(archive, ids[2]!); assert.equal(history.getStats().fullRestores, 2);
  await Promise.all(Array.from({ length: 18 }, (_, index) => history.restore(archive, ids[index % ids.length]!).then(() => {
    assert.ok(history.getStats().checkpoints <= 1);
    assert.ok(history.getStats().estimatedBytes <= history.limits.maxBytes);
  })));
  for (const limits of [{ maxBytes: 1 }, { maxEntries: 0 }]) {
    const small = new VerifiedHistory(limits); await small.restore(archive, ids[2]!); await small.restore(archive, ids[2]!);
    assert.equal(small.getStats().checkpoints, 0); assert.equal(small.getStats().fullRestores, 2);
  }
  assert.throws(() => new VerifiedHistory({ maxBytes: -1 }), /容量/u);
});

test('公开恢复始终检查全链，共享快照认证拒绝只有结果摘要相符的伪造状态', async () => {
  const { archive, head, state } = await chain(), history = new VerifiedHistory(); await history.restore(archive, head);
  const forged = structuredClone(archive), candidate = structuredClone(state); (candidate.data.characters as any).alice.hp = 1;
  forged.commits[head]!.stateHash = await hash(candidate);
  const cache = new IndexedDbCache(indexedDB, 'forged-' + crypto.randomUUID());
  try { await assert.rejects(cache.put(forged, head, candidate, history), /提交结果/u); }
  finally { cache.close(); }
  archive.commits[head]!.opsDigest = 'bad'; await assert.rejects(restore(archive, head), /操作记录/u);
});

test('外部伪造认证器、重写认证方法或注入计时器不能跳过真实验证', async () => {
  const { archive, head, state } = await chain();
  const broken = structuredClone(archive); broken.commits[head]!.opsDigest = 'bad';
  const cache = new IndexedDbCache(indexedDB, 'verifier-brand-' + crypto.randomUUID());
  class Override extends VerifiedHistory { override async restore() { return state; } }
  try {
    let invoked = 0;
    const foreign = { restore: async () => { invoked++; return state; } } as any;
    await assert.rejects(cache.put(broken, head, state, foreign), /操作记录/u);
    await cache.put(archive, head, state, foreign); assert.equal(invoked, 0);
    await assert.rejects(cache.put(broken, head, state, new Override()), /操作记录/u);
    const observer = { sync: () => ({}), measure: async () => state } as any;
    const verified = new VerifiedHistory({}, observer);
    await assert.rejects(cache.put(broken, head, state, verified), /操作记录/u);
    assert.deepEqual(await VerifiedHistory.recover(verified, archive, head), state);
    assert.throws(() => { (verified as any).restore = async () => state; });
  } finally { cache.close(); }
});

test('Runtime 连续同楼累计修订复用原父状态，新增楼层仅验证一个新提交', async () => {
  const { core, archive, head, state } = await chain(20);
  const runtime = new SolveRuntime(core, archive, head, { assertCurrent() {}, async save() {} }); await runtime.ready();
  const initialFull = runtime.history.getStats().fullRestores;
  const action = (id: string) => ({ actionId: id, kind: 'operations' as const, source: 'user' as const, operations: { $inc: { '@alice.hp': -1 } } });
  const identity = archive.commits[head]!.binding;
  for (let i = 0; i < 5; i++) await runtime.submit(action('revision-' + i), identity, '');
  assert.equal(runtime.history.getStats().fullRestores, initialFull);
  const before = runtime.history.getStats();
  await runtime.submit(action('more'), identity, '');
  assert.equal(runtime.history.getStats().fullRestores, before.fullRestores);
  assert.equal(runtime.history.getStats().verifiedCommits - before.verifiedCommits, 1);
  const parent = runtime.headId;
  await runtime.submit(action('append'), { ...identity, messageId: 'append' }, '');
  assert.equal(runtime.getCommit()!.parentId, parent);
  assert.equal((runtime.getState().data.characters as any).alice.hp, (state.data.characters as any).alice.hp - 7);
  assert.deepEqual(runtime.getState(), await restore(runtime.archive, runtime.headId));
});

test('正式控制器的保存、确认和缓存共用认证，状态读取不复制整份归档', async () => {
  const cache = new IndexedDbCache(indexedDB, 'controller-shared-' + crypto.randomUUID());
  const { controller: c } = await setup({ cache });
  try {
    await c.submit({ $inc: { '@alice.hp': -1 } });
    const before = c.getVerificationStats();
    await c.submit({ $inc: { '@alice.hp': -1 } });
    const after = c.getVerificationStats();
    assert.equal(after.fullRestores, before.fullRestores);
    assert.equal(after.verifiedCommits - before.verifiedCommits, 1);
    assert.ok(after.memoryHits - before.memoryHits >= 3);
    await c.refresh(); assert.equal(c.getVerificationStats().fullRestores, after.fullRestores);
    Object.defineProperty(c.runtime, 'archive', { get() { throw new Error('整份复制不应被调用'); } });
    assert.equal(c.getStatus().ready, true); assert.equal(typeof c.getGuide(), 'string'); c.getContextPreview();
    assert.ok(c.getPerformance().some(row => row.phase === 'history.delta'));
    const samples = c.getPerformance(); samples[0]!.phase = 'changed'; assert.notEqual(c.getPerformance()[0]!.phase, 'changed');
  } finally { c.dispose(); cache.close(); }
});

test('保存适配器固定排队候选，提交副本不一致或历史损坏时仍拒绝', async () => {
  const { controller: c, ctx, fetcher, files } = await setup({ cache: false });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const adapter = new SillyTavern119Adapter(() => ctx, fetcher, async (_name, task) => { entered(); await gate; return task(); });
  try {
    await adapter.load();
    const draft = { archive: c.runtime.archive, commit: c.runtime.getCommit()!, binding: adapter.binding(0), text: ctx.chat[0]!.mes, expectedHead: c.runtime.headId };
    const pending = adapter.save(draft); await started;
    draft.commit.textDigest = 'bad'; draft.archive.commits[draft.commit.id]!.opsDigest = 'bad'; draft.text = 'changed';
    release(); await pending;
    assert.equal(files.get(ctx.chatId)![1].mes, ctx.chat[0]!.mes);
    await assert.rejects(adapter.save({ ...draft, commit: c.runtime.getCommit()! }), /候选提交/u);
    const missing = { ...draft, archive: c.runtime.archive, commit: c.runtime.getCommit()! };
    delete missing.archive.commits[missing.commit.id];
    await assert.rejects(adapter.save(missing), /候选提交/u);
  } finally { release?.(); c.dispose(); }
});
