import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { indexedDB } from 'fake-indexeddb';
import { compile, SolveCore, IndexedDbCache, hash, restore, VERSION, z } from '../src/index.js';
import { SillyTavernController } from '../src/host/controller.js';
import { archiveFromChat } from '../src/host/sillytavern.js';
import type { HostContext, HostMessage } from '../src/host/sillytavern.js';
import type { Archive, LogicalState } from '../src/types.js';

const lengths = (process.env.SOLVE_PIPE_HISTORY ?? '1000,5000').split(',').map(Number);
const samples = Number(process.env.SOLVE_PIPE_SAMPLES ?? 3);
if ([...lengths, samples].some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('Positive histories and samples required');
const output = process.env.SOLVE_PIPE_OUTPUT ?? 'test-results/commit-pipeline-current.json';
const report = { version: VERSION, completed: false, variant: process.env.SOLVE_PIPE_VARIANT ?? 'current',
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  scope: 'Formal Controller, 1.19 adapter and fake-indexeddb; JSON HTTP substitute. No real browser/server/model. Verification outside timed windows.',
  config: { histories: lengths, samples, warmupRevisions: 1, tier: 'M', entities: 500 }, cases: [] as Record<string, any>[] };
const definition = await compile({ id: 'long-chat-M', version: '1',
  schema: z.object({ items: z.record(z.string(), z.object({ count: z.number(), label: z.string(), description: z.string() })) }),
  initialData: { items: Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['e' + i, { count: 100, label: '实体' + i, description: 'a'.repeat(130) }])) },
  entities: [{ path: 'items', type: 'item' }] });
async function persist() { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
for (const length of lengths) {
  const bytes = await readFile(`test-results/long-chat-fixtures/M-${length}.json`);
  const fixture = JSON.parse(bytes.toString('utf8')) as { archive: Archive; headId: string; state: LogicalState };
  const { archive, headId } = fixture;
  assert.equal(archive.definitionHash, definition.fingerprint);
  const messages: HostMessage[] = Object.values(archive.commits).map(c => ({ mes: c.parentId ? 'benchmark' : '', extra: { solve: {
    messageId: c.binding.messageId, swipeId: c.binding.swipeId, nativeIndex: 0, headId: c.id, commits: { [c.id]: c },
  } } }));
  const { commits: _commits, ...header } = archive;
  const ctx: HostContext = { chatId: 'long-chat', characterId: 0, groupId: null, characters: [{ name: 'bench', avatar: 'bench.png' }],
    chat: structuredClone(messages), chatMetadata: { solve: structuredClone(header) }, getRequestHeaders: () => ({}) };
  let file: any[] = [{ chat_metadata: structuredClone(ctx.chatMetadata) }, ...structuredClone(ctx.chat)], requests: Record<string, number> = {};
  const fetcher = (async (url: any, options: any) => {
    requests[url] = (requests[url] ?? 0) + 1;
    if (url === '/version') return Response.json({ pkgVersion: '1.19.0' });
    if (url === '/api/chats/get') return Response.json(file);
    if (url === '/api/chats/save') { file = JSON.parse(options.body).chat; return Response.json({ ok: true }); }
    throw new Error('Unexpected request: ' + url);
  }) as typeof fetch;
  const cache = new IndexedDbCache(indexedDB, 'pipeline-' + crypto.randomUUID());
  const c = new SillyTavernController(new SolveCore(definition), () => ctx, { cache }, fetcher);
  const row: Record<string, any> = { historyLength: length, stateBytes: Buffer.byteLength(JSON.stringify(fixture.state)),
    fixtureSha256: createHash('sha256').update(bytes).digest('hex'), revisions: [], appends: [] };
  report.cases.push(row);
  let expected = 100 + length;
  const verify = async () => {
    const saved = archiveFromChat(file[0].chat_metadata, file.slice(1))!;
    const state = await restore(saved, c.runtime.headId);
    assert.equal((state.data.items as any).e0.count, expected);
    assert.equal(await hash(state), await hash(c.runtime.getState()));
    assert.equal(saved.heads[JSON.stringify([c.runtime.getCommit()!.binding.messageId, c.runtime.getCommit()!.binding.swipeId])], c.runtime.headId);
    return { stateHash: await hash(state), commits: Object.keys(saved.commits).length };
  };
  try {
    const start = performance.now(); await c.start(); row.startMs = performance.now() - start;
    assert.equal(c.runtime.headId, headId);
    await c.submit({ $inc: { '@e0.count': 1 } }, { actionId: 'warmup' }); expected++; await verify();
    for (const kind of ['revisions', 'appends'] as const) {
      for (let sample = 0; sample < samples; sample++) {
        if (kind === 'appends') ctx.chat.push({ mes: 'benchmark\n<solve_operate>{"$inc":{"@e0.count":1}}</solve_operate>', extra: {} });
        requests = {}; c.clearPerformance();
        const started = performance.now();
        if (kind === 'revisions') await c.submit({ $inc: { '@e0.count': 1 } }, { actionId: 'revision-' + sample });
        else await c.processMessage(ctx.chat.length - 1);
        const ms = performance.now() - started; expected++;
        const timings = c.getPerformance(), counts = { ...requests }, disk = await verify();
        row[kind].push({ ms, timings, requests: counts, disk, verification: c.getVerificationStats?.() });
        await persist();
      }
      const sorted = row[kind].map((r: any) => r.ms).sort((a: number, b: number) => a - b);
      row[kind + 'P50Ms'] = sorted[Math.ceil(samples / 2) - 1];
    }
    row.completed = true;
    console.log(`${length}: revision ${row.revisionsP50Ms.toFixed(1)}ms, append ${row.appendsP50Ms.toFixed(1)}ms`);
  } finally { c.dispose(); cache.close(); }
  await persist();
}
report.completed = true; await persist(); console.log('Commit pipeline benchmark completed: ' + output);
