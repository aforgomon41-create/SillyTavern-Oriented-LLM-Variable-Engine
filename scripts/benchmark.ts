import { mkdir, writeFile } from 'node:fs/promises';
import { compile, SolveCore, createArchive, buildCommit, restore, toJson, toToon, z } from '../src/index.js';
import type { LogicalState } from '../src/types.js';

const report = { createdAt: new Date().toISOString(), environment: { runtime: process.version, platform: process.platform, arch: process.arch },
  variant: process.env.SOLVE_BENCH_VARIANT ?? 'current', scope: 'Node 中的正式 Core/历史/投影；不代表浏览器、IndexedDB 或服务端保存性能', cases: [] as Record<string, unknown>[] };
async function measure(task: () => unknown | Promise<unknown>, samples = 7) {
  await task(); const times: number[] = [];
  for (let i = 0; i < samples; i++) { const started = performance.now(); await task(); times.push(performance.now() - started); }
  times.sort((a, b) => a - b);
  return { samples, p50Ms: times[Math.ceil(samples * .5) - 1], p95Ms: times[Math.ceil(samples * .95) - 1], maxMs: times.at(-1) };
}
for (const tier of [{ name: 'S', count: 50, size: 10_000 }, { name: 'M', count: 500, size: 100_000 }]) {
  const definition = await compile({ id: `benchmark-${tier.name}`, version: '1',
    schema: z.object({ entities: z.record(z.string(), z.object({ count: z.number(), label: z.string(), description: z.string() })) }),
    initialData: { entities: Object.fromEntries(Array.from({ length: tier.count }, (_, i) => [`e${i}`, { count: 100, label: `实体${i}`, description: 'a'.repeat(Math.max(1, tier.size / tier.count - 70)) }])) },
    entities: [{ path: 'entities', type: 'item' }] });
  const core = new SolveCore(definition), state = await core.initialize();
  const single = await measure(() => core.execute({ $inc: { '@e0.count': 1 } }, state));
  const group = await measure(() => core.execute({ $group: Array.from({ length: 10 }, (_, i) => ({ $inc: { [`@e${i}.count`]: 1 } })) }, state), 5);
  const projection = await measure(() => toJson(definition, state, { paths: ['@e0'] }));
  const binding = { chatId: 'benchmark', messageId: 'root', swipeId: '0' };
  const { archive, headId } = await createArchive(core, binding); let head = headId, previous: LogicalState = state;
  for (let i = 0; i < 100; i++) {
    const action = { actionId: `step-${i}`, kind: 'operations' as const, source: 'model' as const, operations: { $inc: { '@e0.count': 1 } } };
    const next = await core.execute(action.operations, previous);
    const commit = await buildCommit(archive, head, archive.commits[head]!.genesisId, previous, next.state, { ...binding, messageId: `m${i}` }, [action], [], {}, 'benchmark');
    archive.commits[commit.id] = commit; head = commit.id; previous = next.state;
  }
  const coldRestore = await measure(() => restore(archive, head), 3);
  const json = toJson(definition, state), toon = toToon(definition, state), local = toJson(definition, state, { paths: ['@e0'] });
  const result = { tier: tier.name, entities: tier.count, stateBytes: Buffer.byteLength(JSON.stringify(state)), single, group10: group, partialProjection: projection,
    coldRestore100: coldRestore, archiveBytes: Buffer.byteLength(JSON.stringify(archive)), formatBytes: { json: Buffer.byteLength(json), toon: Buffer.byteLength(toon), projectedJson: Buffer.byteLength(local) } };
  report.cases.push(result); console.log(JSON.stringify(result));
}
const output = process.env.SOLVE_BENCH_OUTPUT ?? 'test-results/performance.json';
await mkdir('test-results', { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
console.log(`基准已写入 ${output}；格式记录为字节数，不是 token 数。`);
