import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBObjectStore } from 'fake-indexeddb';
import { IndexedDbCache, SolveCore, compile, createArchive, buildCommit, restore, z } from '../src/index.js';
const name = () => 'capacity-' + crypto.randomUUID();
async function fixture() {
  const core = new SolveCore(await compile({ id: 'cache-capacity', version: '1', schema: z.object({ hp: z.number() }), initialData: { hp: 100 } }));
  const { archive, headId } = await createArchive(core, { chatId: 'cache', messageId: 'root', swipeId: '0' });
  return { archive, headId, state: await restore(archive, headId) };
}
const req = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

test('容量按最近使用淘汰，淘汰后从事实恢复，草稿保留', async () => {
  const first = await fixture(), second = await fixture(), third = await fixture();
  const cache = new IndexedDbCache(indexedDB, name(), { maxSnapshots: 2 });
  await cache.savePending('draft-only', [{ needsSave: true }]);
  await cache.put(first.archive, first.headId, first.state); await cache.put(second.archive, second.headId, second.state);
  await cache.restore(first.archive, first.headId); assert.equal(cache.lastRestoreSource, 'snapshot');
  await cache.put(third.archive, third.headId, third.state);
  await cache.restore(second.archive, second.headId); assert.equal(cache.lastRestoreSource, 'archive');
  await cache.restore(first.archive, first.headId); assert.equal(cache.lastRestoreSource, 'snapshot');
  assert.equal((await cache.getStats()).snapshots, 2);
  assert.deepEqual(await cache.loadPending('draft-only'), [{ needsSave: true }]); cache.close();
});
test('单聊天限额不挤占其他聊天，字节上限与超大快照跳过有效', async () => {
  const a = await fixture(), b = await fixture(), dbName = name();
  const cache = new IndexedDbCache(indexedDB, dbName, { maxSnapshotsPerSession: 1 });
  await cache.put(a.archive, a.headId, a.state); await cache.put(b.archive, b.headId, b.state);
  const after = structuredClone(a.state); after.data.hp = 99;
  const commit = await buildCommit(a.archive, a.headId, a.archive.commits[a.headId]!.genesisId, a.state, after, { chatId: 'cache', messageId: 'next', swipeId: '0' }, [], [], {}, '');
  a.archive.commits[commit.id] = commit; await cache.put(a.archive, commit.id, after);
  assert.equal((await cache.getStats()).snapshots, 2);
  await cache.restore(a.archive, a.headId); assert.equal(cache.lastRestoreSource, 'archive');
  await cache.restore(b.archive, b.headId); assert.equal(cache.lastRestoreSource, 'snapshot');
  const bytes = (await cache.getStats()).estimatedBytes; cache.close();
  const bounded = new IndexedDbCache(indexedDB, dbName, { maxBytes: Math.floor(bytes * .6) });
  await bounded.pruneSnapshots(); assert.equal((await bounded.getStats()).snapshots, 1);
  assert.ok((await bounded.getStats()).estimatedBytes <= bytes * .6); bounded.close();
  const tiny = new IndexedDbCache(indexedDB, name(), { maxBytes: 1 });
  await tiny.put(a.archive, commit.id, after); assert.equal((await tiny.getStats()).snapshots, 0);
  assert.equal((await tiny.restore(a.archive, commit.id)).data.hp, 99); tiny.close();
});
test('旧数据库升级只清快照，保留待保存草稿；空草稿删除占用', async () => {
  const dbName = name(), opening = indexedDB.open(dbName, 1);
  opening.onupgradeneeded = () => { opening.result.createObjectStore('snapshots'); opening.result.createObjectStore('pending'); };
  const old = await req(opening), tx = old.transaction(['pending', 'snapshots'], 'readwrite');
  await Promise.all([req(tx.objectStore('pending').put([{ action: 'unsaved' }], 'session')), req(tx.objectStore('snapshots').put({ legacy: true }, 'old'))]); old.close();
  const cache = new IndexedDbCache(indexedDB, dbName);
  assert.deepEqual(await cache.loadPending('session'), [{ action: 'unsaved' }]);
  assert.deepEqual({ ...await cache.getStats(), limits: undefined }, { snapshots: 0, estimatedBytes: 0, pendingSessions: 1, limits: undefined });
  await cache.savePending('session', []); assert.equal(await cache.loadPending('session'), undefined); cache.close();
});
test('两个连接并发写入共享原子限额，统计与实际快照一致', async () => {
  const dbName = name(), caches = [new IndexedDbCache(indexedDB, dbName, { maxSnapshots: 2 }), new IndexedDbCache(indexedDB, dbName, { maxSnapshots: 2 })];
  const fixtures = await Promise.all(Array.from({ length: 5 }, fixture));
  await Promise.all(fixtures.map((f, index) => caches[index % 2]!.put(f.archive, f.headId, f.state)));
  assert.equal((await caches[0]!.getStats()).snapshots, 2);
  let hits = 0;
  for (const f of fixtures) { await caches[1]!.restore(f.archive, f.headId); if (caches[1]!.lastRestoreSource === 'snapshot') hits++; }
  assert.equal(hits, 2); caches.forEach(cache => cache.close());
});
test('草稿空间不足只回收快照并重试一次，已有草稿不丢失', async () => {
  const f = await fixture(), cache = new IndexedDbCache(indexedDB, name());
  await cache.put(f.archive, f.headId, f.state); await cache.savePending('old', [{ savedLocally: true }]);
  const original = IDBObjectStore.prototype.put; let attempts = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
    if (this.name === 'pending' && ++attempts === 1) throw new DOMException('full', 'QuotaExceededError');
    return original.apply(this, args);
  };
  try { await cache.savePending('new', [{ unsaved: true }]); } finally { IDBObjectStore.prototype.put = original; }
  assert.equal(attempts, 2); assert.equal((await cache.getStats()).snapshots, 0);
  assert.deepEqual(await cache.loadPending('old'), [{ savedLocally: true }]);
  assert.deepEqual(await cache.loadPending('new'), [{ unsaved: true }]);
  attempts = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) { if (this.name === 'pending') { attempts++; throw new DOMException('full', 'QuotaExceededError'); } return original.apply(this, args); };
  try { await assert.rejects(cache.savePending('old', [{ replacement: true }]), { name: 'QuotaExceededError' }); } finally { IDBObjectStore.prototype.put = original; }
  assert.equal(attempts, 2); assert.deepEqual(await cache.loadPending('old'), [{ savedLocally: true }]); cache.close();
});
test('快照认证冻结入参，损坏的归档不能被旧快照掩盖', async () => {
  const f = await fixture(), cache = new IndexedDbCache(indexedDB, name());
  const saved = structuredClone(f.archive), putting = cache.put(f.archive, f.headId, f.state);
  f.state.data.hp = 0; f.archive.commits[f.headId]!.opsDigest = 'bad';
  await putting; assert.equal((await cache.restore(saved, f.headId)).data.hp, 100); assert.equal(cache.lastRestoreSource, 'snapshot');
  await assert.rejects(cache.restore(f.archive, f.headId), /操作记录/u); cache.close();
});
test('禁用快照仍可恢复和存草稿，非法容量明确拒绝', async () => {
  assert.throws(() => new IndexedDbCache(indexedDB, name(), { maxBytes: -1 }), /非负整数/u);
  const f = await fixture(), cache = new IndexedDbCache(indexedDB, name(), { maxSnapshots: 0 });
  await cache.put(f.archive, f.headId, f.state); await cache.savePending('session', [1]);
  assert.equal((await cache.getStats()).snapshots, 0); assert.equal((await cache.restore(f.archive, f.headId)).data.hp, 100);
  await cache.clearSnapshots(); assert.deepEqual(await cache.loadPending('session'), [1]); cache.close();
});
