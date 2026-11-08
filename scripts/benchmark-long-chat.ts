import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { indexedDB } from 'fake-indexeddb';
import { compile, SolveCore, SolveRuntime, IndexedDbCache, createArchive, buildCommit, restore, headKey, hash, z, VERSION } from '../src/index.js';
import { SillyTavern119Adapter, archiveFromChat } from '../src/host/sillytavern.js';
import type { HostContext, HostMessage } from '../src/host/sillytavern.js';
import type { Archive, LogicalState, SaveDraft } from '../src/types.js';

const tiers = { S: 50, M: 500 };
const selected = (process.env.SOLVE_LONG_BENCH_TIERS ?? 'S,M').split(',');
if (selected.some(tier => !Object.hasOwn(tiers, tier))) throw new Error('SOLVE_LONG_BENCH_TIERS only accepts S,M');
const lengths = (process.env.SOLVE_LONG_BENCH_HISTORY ?? '100,1000').split(',').map(Number);
const samples = Number(process.env.SOLVE_LONG_BENCH_SAMPLES ?? 3);
if ([...lengths, samples].some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('Positive integer histories/samples required');
const output = process.env.SOLVE_LONG_BENCH_OUTPUT ?? 'test-results/long-chat-current.json';
const fixtureRoot = process.env.SOLVE_LONG_BENCH_FIXTURES ?? 'test-results/long-chat-fixtures';
const report = { version: VERSION, variant: process.env.SOLVE_LONG_BENCH_VARIANT ?? 'current', completed: false,
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  config: { tiers: selected, histories: lengths, samples, warmup: 0 },
  scope: 'Node formal Restore/Runtime/IndexedDbCache and 1.19 adapter; fake-indexeddb, in-memory JSON HTTP substitute. No browser, real server, network latency or model.',
  cases: [] as Record<string, any>[] };
async function persist() { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
async function measure(task: () => Promise<() => Promise<void> | void>) {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now(), verify = await task(); times.push(performance.now() - start); await verify?.();
  }
  times.sort((a, b) => a - b);
  return { samples, p50Ms: times[Math.ceil(samples / 2) - 1], minMs: times[0], maxMs: times.at(-1), rawMs: times };
}
for (const tier of selected) {
  const count = tiers[tier as keyof typeof tiers];
  const def = await compile({ id: 'long-chat-' + tier, version: '1',
    schema: z.object({ items: z.record(z.string(), z.object({ count: z.number(), label: z.string(), description: z.string() })) }),
    initialData: { items: Object.fromEntries(Array.from({ length: count }, (_, i) => ['e' + i, { count: 100, label: '实体' + i, description: 'a'.repeat(130) }])) },
    entities: [{ path: 'items', type: 'item' }] });
  const core = new SolveCore(def);
  for (const length of lengths) {
    const path = resolve(fixtureRoot, `${tier}-${length}.json`);
    let fixture: { archive: Archive; headId: string; state: LogicalState };
    try { fixture = JSON.parse(await readFile(path, 'utf8')); }
    catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      const { archive, headId } = await createArchive(core, { chatId: 'long-chat', messageId: 'root', swipeId: 's0' });
      let head = headId, state = await restore(archive, head);
      for (let i = 1; i <= length; i++) {
        const binding = { chatId: 'long-chat', messageId: 'm' + i, swipeId: 's0' };
        const action = { actionId: 'a' + i, kind: 'operations' as const, source: 'model' as const, operations: { $inc: { '@e0.count': 1 } } };
        const result = await core.execute(action.operations, state);
        const commit = await buildCommit(archive, head, archive.commits[head]!.genesisId, state, result.state, binding, [action], [], {}, 'benchmark');
        archive.commits[commit.id] = commit; archive.heads[headKey(binding)] = commit.id; head = commit.id; state = result.state;
      }
      fixture = { archive, headId: head, state }; await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(fixture));
    }
    const { archive, headId, state } = fixture, target = archive.commits[headId]!;
    assert.equal(archive.definitionHash, def.fingerprint); assert.equal(await hash(state), target.stateHash);
    const fixtureBytes = await readFile(path), row: Record<string, any> = { tier, historyLength: length,
      fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'), stateBytes: Buffer.byteLength(JSON.stringify(state)), archiveBytes: Buffer.byteLength(JSON.stringify(archive)) };
    report.cases.push(row);
    row.coldRestore = await measure(async () => {
      const result = await restore(archive, headId);
      return async () => { assert.equal(await hash(result), target.stateHash); };
    });
    // Setup and correctness verification stay outside each timed sample.
    const runtimeTimes: number[] = [];
    for (let i = 0; i < samples; i++) {
      const runtime = new SolveRuntime(core, structuredClone(archive), headId, { assertCurrent() {}, async save() {} }); await runtime.ready();
      const start = performance.now();
      const commit = await runtime.submit({ actionId: 'append', kind: 'operations', source: 'user', operations: { $inc: { '@e0.count': 1 } } }, { ...target.binding, messageId: 'append' }, 'append');
      runtimeTimes.push(performance.now() - start); assert.equal((runtime.getState().data.items as any).e0.count, 101 + length);
      assert.equal(await hash(await restore(runtime.archive, commit.id)), commit.stateHash);
    }
    runtimeTimes.sort((a, b) => a - b); row.runtimeAppend = { samples, p50Ms: runtimeTimes[Math.ceil(samples / 2) - 1], rawMs: runtimeTimes };
    const cache = new IndexedDbCache(indexedDB, 'long-chat-' + crypto.randomUUID()); await cache.open();
    row.cachePut = await measure(async () => { await cache.put(archive, headId, state); return async () => { assert.equal(await hash(await cache.restore(archive, headId)), target.stateHash); }; });
    row.cacheHit = await measure(async () => { const result = await cache.restore(archive, headId); return async () => { assert.equal(cache.lastRestoreSource, 'snapshot'); assert.equal(await hash(result), target.stateHash); }; });
    cache.close();
    const messages: HostMessage[] = Object.values(archive.commits).map(commit => ({ mes: commit.parentId ? 'benchmark' : '', extra: { solve: {
      messageId: commit.binding.messageId, swipeId: commit.binding.swipeId, nativeIndex: 0, headId: commit.id, commits: { [commit.id]: commit },
    } } }));
    const { commits: _commits, ...header } = archive;
    const parent = await restore(archive, target.parentId!), after = structuredClone(state); (after.data.items as any).e0.count++;
    const added = { actionId: 'adapter-revision', kind: 'operations' as const, source: 'user' as const, operations: { $inc: { '@e0.count': 1 } } };
    const revision = await buildCommit(archive, target.parentId, target.genesisId, parent, after, target.binding, [...target.actions, added], [], {}, 'revised');
    const next = structuredClone(archive); next.commits[revision.id] = revision; next.heads[headKey(target.binding)] = revision.id;
    const saveTimes: number[] = [], requestTotals: Record<string, number>[] = [];
    for (let i = 0; i < samples; i++) {
      const ctx: HostContext = { chatId: 'long-chat', characterId: 0, groupId: null, characters: [{ name: 'bench', avatar: 'bench.png' }], chat: structuredClone(messages), chatMetadata: { solve: structuredClone(header) }, getRequestHeaders: () => ({}) };
      let file: any[] = [{ chat_metadata: structuredClone(ctx.chatMetadata) }, ...structuredClone(ctx.chat)]; const requests: Record<string, number> = {};
      const adapter = new SillyTavern119Adapter(() => ctx, (async (url: any, options: any) => {
        requests[url] = (requests[url] ?? 0) + 1;
        if (url === '/api/chats/get') return Response.json(file);
        if (url === '/api/chats/save') { file = JSON.parse(options.body).chat; return Response.json({ ok: true }); }
        throw new Error('Unexpected benchmark request');
      }) as typeof fetch);
      await adapter.load(); requests['/api/chats/get'] = 0;
      const draft: SaveDraft = { archive: structuredClone(next), commit: revision, binding: adapter.binding(messages.length - 1), text: 'revised', expectedHead: headId };
      const start = performance.now(); await adapter.save(draft); saveTimes.push(performance.now() - start); requestTotals.push(requests);
      const saved = archiveFromChat(file[0].chat_metadata, file.slice(1))!;
      assert.equal(await hash(saved), await hash(next)); assert.equal(await hash(await restore(saved, revision.id)), revision.stateHash);
      assert.equal(file.at(-1).mes, 'revised');
    }
    saveTimes.sort((a, b) => a - b); row.adapterSave = { samples, p50Ms: saveTimes[Math.ceil(samples / 2) - 1], rawMs: saveTimes, requestTotals };
    row.completed = true; await persist(); console.log(`${tier} ${length}: restore ${row.coldRestore.p50Ms.toFixed(1)}ms, append ${row.runtimeAppend.p50Ms.toFixed(1)}ms, save ${row.adapterSave.p50Ms.toFixed(1)}ms`);
  }
}
report.completed = true; await persist(); console.log('Long-chat benchmark completed: ' + output);
