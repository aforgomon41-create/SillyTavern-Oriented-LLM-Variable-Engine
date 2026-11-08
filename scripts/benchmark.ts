import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { compile, SolveCore, createArchive, buildCommit, restore, toJson, toToon, z, VERSION } from '../src/index.js';

const tiers = [
  { name: 'S', count: 50, size: 10_000 }, { name: 'M', count: 500, size: 100_000 },
  { name: 'L', count: 5_000, size: 1_000_000 }, { name: 'XL', count: 25_000, size: 5_000_000 },
];
const positive = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + ' 必须是正整数');
  return value;
};
const selected = (process.env.SOLVE_BENCH_TIERS ?? 'S,M').toUpperCase().split(',').map(value => value.trim());
if (selected.some(name => !tiers.some(tier => tier.name === name))) throw new Error('SOLVE_BENCH_TIERS 仅接受 S,M,L,XL');
const historyInput = process.env.SOLVE_BENCH_HISTORY ?? '100';
const histories = historyInput === 'none' ? [] : [...new Set(historyInput.split(',').map(value => Number(value.trim())))].sort((a, b) => a - b);
if (histories.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('SOLVE_BENCH_HISTORY 需要正整数列表或 none');
const samples = positive('SOLVE_BENCH_SAMPLES', 5), historySamples = positive('SOLVE_BENCH_HISTORY_SAMPLES', 3);
const output = process.env.SOLVE_BENCH_OUTPUT ?? 'test-results/performance.json';
let observedHeapMax = process.memoryUsage().heapUsed;
const sampleMemory = () => { observedHeapMax = Math.max(observedHeapMax, process.memoryUsage().heapUsed); };
const report = { version: VERSION, createdAt: new Date().toISOString(), completed: false,
  environment: { runtime: process.version, platform: process.platform, arch: process.arch },
  config: { tiers: selected, histories, samples, historySamples, operationWarmup: 1, historyWarmup: 0 },
  variant: process.env.SOLVE_BENCH_VARIANT ?? 'current',
  scope: 'Node 正式 Core/投影/历史；无浏览器、IndexedDB、Controller 队列或服务端保存；堆内存为采样点最大值，不是真实峰值',
  cases: [] as Record<string, any>[], observedHeapUsedMaxBytes: 0 };
async function persist() {
  sampleMemory(); report.observedHeapUsedMaxBytes = observedHeapMax;
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
async function measure<T>(task: () => T | Promise<T>, count: number, verify: (value: T) => void, warmup = 1) {
  for (let i = 0; i < warmup; i++) verify(await task());
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const started = performance.now(), value = await task();
    times.push(performance.now() - started); verify(value); sampleMemory();
  }
  times.sort((a, b) => a - b);
  return { samples: count, warmup, p50Ms: times[Math.ceil(count * .5) - 1], p95Ms: times[Math.ceil(count * .95) - 1], maxMs: times.at(-1) };
}
for (const tier of tiers.filter(tier => selected.includes(tier.name))) {
  const started = performance.now();
  const item = z.object({ count: z.number().min(0), label: z.string(), description: z.string() });
  const definition = await compile({ id: 'benchmark-' + tier.name, version: '2',
    schema: z.object({ entities: z.record(z.string(), item), shelf: z.record(z.string(), item).default({}) }),
    initialData: { entities: Object.fromEntries(Array.from({ length: tier.count }, (_, i) => ['e' + i,
      { count: 100, label: '实体' + i, description: 'a'.repeat(Math.max(1, tier.size / tier.count - 70)) }])) },
    entities: [{ path: 'entities', type: 'item' }, { path: 'shelf', type: 'item' }] });
  const core = new SolveCore(definition), state = await core.initialize();
  const row: Record<string, any> = { tier: tier.name, entities: tier.count, stateBytes: Buffer.byteLength(JSON.stringify(state)),
    setupMs: performance.now() - started, completed: false, coldRestore: [] };
  report.cases.push(row);
  row.single = await measure(() => core.execute({ $inc: { '@e0.count': 1 } }, state), samples,
    value => assert.equal((value.state.data.entities as any).e0.count, 101));
  row.group10 = await measure(() => core.execute({ $group: Array.from({ length: 10 }, (_, i) => ({ $inc: { ['@e' + i + '.count']: 1 } })) }, state), samples,
    value => { assert.equal(value.feedback.length, 0); for (let i = 0; i < 10; i++) assert.equal((value.state.data.entities as any)['e' + i].count, 101); });
  row.groupRollback = await measure(() => core.execute({ $group: [{ $inc: { '@e0.count': -1_000 } }, { $inc: { '@e1.count': 1 } }] }, state), samples,
    value => { assert.equal((value.state.data.entities as any).e0.count, 100); assert.equal((value.state.data.entities as any).e1.count, 100); assert.ok(value.feedback.some(item => item.code === 'GROUP_ROLLED_BACK')); });
  row.move = await measure(() => core.execute({ $move: { '@e0': 'shelf' } }, state), samples,
    value => { assert.equal((value.state.data.shelf as any).e0.count, 100); assert.equal((value.state.data.entities as any).e0, undefined); });
  row.delete = await measure(() => core.execute({ $deleteEntity: ['@e0'] }, state), samples,
    value => { assert.equal(value.feedback.length, 0); assert.equal((value.state.data.entities as any).e0, undefined); });
  row.partialProjection = await measure(() => toJson(definition, state, { paths: ['@e0'] }), samples,
    value => assert.ok(value.includes('e0')));
  const json = toJson(definition, state), toon = toToon(definition, state), local = toJson(definition, state, { paths: ['@e0'] });
  row.formatBytes = { json: Buffer.byteLength(json), toon: Buffer.byteLength(toon), projectedJson: Buffer.byteLength(local) };
  await persist(); console.log(tier.name + ' 操作测量完成，' + row.stateBytes + ' 字节 / ' + tier.count + ' 实体');
  if (histories.length) {
    const binding = { chatId: 'benchmark', messageId: 'root', swipeId: '0' };
    const { archive, headId } = await createArchive(core, binding);
    let head = headId, previous = state;
    for (let i = 1; i <= histories.at(-1)!; i++) {
      const action = { actionId: 'step-' + i, kind: 'operations' as const, source: 'model' as const, operations: { $inc: { '@e0.count': 1 } } };
      const next = await core.execute(action.operations, previous);
      const commit = await buildCommit(archive, head, archive.commits[head]!.genesisId, previous, next.state, { ...binding, messageId: 'm' + i }, [action], [], {}, 'benchmark');
      archive.commits[commit.id] = commit; head = commit.id; previous = next.state;
      if (i % 100 === 0) sampleMemory();
      if (histories.includes(i)) {
        const timing = await measure(() => restore(archive, head), historySamples,
          value => assert.equal((value.data.entities as any).e0.count, 100 + i), 0);
        row.coldRestore.push({ historyLength: i, ...timing, archiveBytes: Buffer.byteLength(JSON.stringify(archive)) });
        if (i === 100) row.coldRestore100 = timing;
        await persist(); console.log(tier.name + ' ' + i + ' 楼无缓存恢复完成：' + timing.p50Ms!.toFixed(2) + ' ms');
      } else if (i % 1000 === 0) console.log(tier.name + ' 已生成 ' + i + ' 楼');
    }
  }
  row.completed = true; await persist();
}
report.completed = true; await persist();
console.log('基准已写入 ' + output + '；格式为字节数，非 token 数；没有连接真实聊天。');
