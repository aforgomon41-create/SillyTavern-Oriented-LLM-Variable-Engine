import test from 'node:test';
import assert from 'node:assert/strict';
import { assertJson, canonical, hash } from '../src/json.js';
import { fixture, binding } from './fixture.js';
import { buildCommit, createArchive, headKey, restore, SolveRuntime } from '../src/index.js';
import { preserveOrphanAncestors } from '../src/host/sillytavern.js';
import { compactStorage, createFloorWriter, readFloor } from '../src/host/storage.js';
import type { Archive, Commit } from '../src/types.js';
import type { HostMessage } from '../src/host/sillytavern.js';

// Frozen reference for the pre-optimization representation, not the new encoder.
function oldCanonical(value: any): string {
  assertJson(value);
  if (Array.isArray(value)) return '[' + value.map(oldCanonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + oldCanonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
test('一次遍历的规范JSON与原字节一致，保留全部合法性边界', async () => {
  const shared = { escaped: '\n"\\', n: -0 }, plain = Object.assign(Object.create(null), { b: false, a: 1 });
  const values = [null, true, -0, 1e30, '中文', [1, false, null], { z: shared, a: shared, obj: plain }];
  for (const value of values) { assert.equal(canonical(value), oldCanonical(value)); assert.equal(await hash(value), await hash(JSON.parse(oldCanonical(value)))); }
  const cycle: any = {}; cycle.self = cycle;
  const invalid = [undefined, NaN, Infinity, 1n, () => {}, new Date(0), new Map(), new Set(), cycle, Array(2), { x: undefined }, JSON.parse('{"constructor":1}')];
  for (const value of invalid) assert.throws(() => canonical(value));
  let deep: any = 0; for (let i = 0; i < 128; i++) deep = [deep]; assert.equal(canonical(deep), oldCanonical(deep));
  assert.throws(() => canonical([deep]), (error: any) => error.code === 'DEPTH_LIMIT');
});

test('规范JSON每条值边只读取一次，读取到的非法值仍拒绝', () => {
  let reads = 0;
  const data = { nested: { get value() { reads++; return 4; } } };
  assert.equal(canonical(data), '{"nested":{"value":4}}'); assert.equal(reads, 1);
  assert.throws(() => canonical({ get bad() { return undefined; } }), (error: any) => error.code === 'NOT_JSON');
});

test('恢复自有状态不会修改开局或Patch插入对象，失败也不污染归档', async () => {
  const { core } = await fixture(), { archive, headId } = await createArchive(core, binding), base = await restore(archive, headId);
  const inserted = structuredClone(base); (inserted.data as any).extra = { values: [1,2], nested: { n: 1 } };
  const first = await buildCommit(archive, headId, archive.commits[headId]!.genesisId, base, inserted, { ...binding, messageId: 'insert' }, [], [], {}, ''); archive.commits[first.id] = first;
  const final = structuredClone(inserted); (final.data as any).extra.values.splice(0, 1); (final.data as any).extra.nested.n = 9;
  const second = await buildCommit(archive, first.id, first.genesisId, inserted, final, { ...binding, messageId: 'mutate' }, [], [], {}, ''); archive.commits[second.id] = second;
  const original = structuredClone(archive); assert.deepEqual(await restore(archive, second.id), final); assert.deepEqual(archive, original);
  const broken = structuredClone(archive); broken.commits[second.id]!.dataPatch.push({ op: 'remove', path: '/missing' });
  const untouched = structuredClone(broken); await assert.rejects(restore(broken, second.id), /补丁无效/u); assert.deepEqual(broken, untouched);
});

test('内存归档两根共享对象时仍与JSON往返一致，数据Patch不串改engineState', async () => {
  const { core } = await fixture(), { archive, headId } = await createArchive(core, binding), root = archive.commits[headId]!;
  const genesis = archive.geneses[root.genesisId]!;
  genesis.state.engineState.activeModules = { shared: true };
  genesis.state.data.flags = genesis.state.engineState.activeModules;
  genesis.stateHash = await hash(genesis.state); root.baseHash = genesis.stateHash; root.stateHash = genesis.stateHash;
  const after = JSON.parse(JSON.stringify(genesis.state)); after.data.flags.shared = false;
  const commit = await buildCommit(archive, headId, genesis.id, genesis.state, after, { ...binding, messageId: 'shared' }, [], [], {}, ''); archive.commits[commit.id] = commit;
  assert.deepEqual(await restore(archive, commit.id), await restore(JSON.parse(JSON.stringify(archive)), commit.id));
  assert.equal(genesis.state.engineState.activeModules.shared, true);
});

test('Runtime固定归档入参，追加复用确认状态，同楼累计修订仍相对原父状态', async () => {
  const { core } = await fixture(), { archive, headId } = await createArchive(core, binding);
  const runtime = new SolveRuntime(core, archive, headId, { assertCurrent() {}, async save() {} });
  archive.geneses[archive.commits[headId]!.genesisId]!.stateHash = 'bad'; await runtime.ready();
  const action = (id: string) => ({ actionId: id, kind: 'operations' as const, source: 'user' as const, operations: { $inc: { '@alice.hp': -1 } } });
  const nextBinding = { ...binding, messageId: 'next' }, first = await runtime.submit(action('one'), nextBinding, 'one');
  const second = await runtime.submit(action('two'), nextBinding, 'two');
  assert.equal(first.parentId, headId); assert.equal(second.parentId, headId); assert.equal(second.actions.length, 2);
  assert.equal(((await restore(runtime.archive, second.id)).data.characters as any).alice.hp, 98);
});

// Reference behavior for the old carrier algorithm; generated branches compare complete output.
function oldPreserve(archive: Archive, messages: HostMessage[]): boolean {
  const extras = messages.flatMap(m => [m.extra, ...(m.swipe_info ?? []).map(s => s.extra)]).filter(e => e?.solve);
  const owners = new Set(extras.map(e => headKey(e!.solve))); let gap = false;
  for (const extra of extras) {
    const saved = extra!.solve; if (!saved.messageId || !saved.swipeId) continue;
    const records = saved.commits ??= {};
    const starts = new Set([...Object.keys(records), ...Object.values(archive.commits).filter(c => headKey(c.binding) === headKey(saved)).map(c => c.id), ...(saved.headId ? [saved.headId] : [])]);
    for (const start of starts) {
      let cursor: string | null = start; const seen = new Set<string>();
      while (cursor) {
        if (seen.has(cursor)) throw new Error('cycle'); seen.add(cursor); const commit: Commit | undefined = archive.commits[cursor]; if (!commit) break;
        if (!owners.has(headKey(commit.binding))) { records[commit.id] = structuredClone(commit); if (start === saved.headId) gap = true; }
        cursor = commit.parentId;
      }
    }
  }
  return gap;
}

test('按归属和祖先索引打包与原算法逐项一致，保留分支、修订和多处孤立祖先', async () => {
  const { core } = await fixture(), { archive, headId } = await createArchive(core, binding), state = await restore(archive, headId);
  const ids = [headId];
  for (let i = 1; i < 16; i++) {
    const parent = ids[Math.floor((i - 1) / 2)]!, commit = await buildCommit(archive, parent, archive.commits[parent]!.genesisId, state, state, { ...binding, messageId: 'm' + (i % 7), swipeId: 's' + (i % 2) }, [], [], {}, '');
    archive.commits[commit.id] = commit; ids.push(commit.id);
  }
  for (let mask = 1; mask < 16; mask++) {
    const messages = ids.slice(4).filter((_id, i) => (mask >> (i % 4)) & 1).map(id => { const commit = archive.commits[id]!; return { mes: '', extra: { solve: { ...commit.binding, headId: id } } }; });
    const expected = structuredClone(messages), actual = structuredClone(messages);
    assert.equal(preserveOrphanAncestors(archive, actual), oldPreserve(archive, expected)); assert.deepEqual(actual, expected);
  }
  const broken = structuredClone(archive); broken.commits[headId]!.parentId = ids[1]!;
  const message = { mes: '', extra: { solve: { ...archive.commits[ids[1]!]!.binding, headId: ids[1] } } };
  assert.throws(() => preserveOrphanAncestors(broken, [message]), /循环/u);
});

test('打包索引保持首个上下文/摘要位置，不跨批次沿用被修改的查找表', async () => {
  const { core } = await fixture(), { archive, headId } = await createArchive(core, binding), head = archive.commits[headId]!;
  const storage = compactStorage([head]); storage.contexts.push(storage.contexts[0]!); storage.hashes.push(storage.hashes[0]!);
  const write = createFloorWriter(storage), floor = write(head, [head]);
  assert.deepEqual(readFloor(floor, binding, storage), [head]); assert.equal(floor.commit.context, undefined); assert.equal(floor.commit.checks![0], 0);
  storage.hashes[0] = 'changed'; assert.throws(() => write(head, [head]), /校验上下文/u);
});
