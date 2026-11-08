import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const [beforePath, afterPath, output] = process.argv.slice(2);
if (!beforePath || !afterPath || !output) throw new Error('Usage: node scripts/compare-long-chat.mjs before.json after.json output.json');
const before = JSON.parse(await readFile(beforePath, 'utf8')), after = JSON.parse(await readFile(afterPath, 'utf8'));
assert.equal(before.completed, true); assert.equal(after.completed, true);
assert.deepEqual(before.config, after.config); assert.deepEqual(before.environment, after.environment); assert.equal(before.cases.length, after.cases.length);
const stages = ['coldRestore', 'runtimeAppend', 'cachePut', 'cacheHit', 'adapterSave'];
const comparisons = before.cases.map((old, index) => {
  const next = after.cases[index];
  for (const field of ['tier', 'historyLength', 'fixtureSha256', 'stateBytes', 'archiveBytes']) assert.equal(old[field], next[field], field);
  assert.equal(old.completed, true); assert.equal(next.completed, true);
  assert.deepEqual(old.adapterSave.requestTotals, next.adapterSave.requestTotals);
  return { tier: old.tier, historyLength: old.historyLength, fixtureSha256: old.fixtureSha256, stateBytes: old.stateBytes,
    stages: Object.fromEntries(stages.map(stage => {
      assert.equal(old[stage].samples, next[stage].samples); assert.equal(next[stage].rawMs.length, next[stage].samples);
      return [stage, { beforeMs: old[stage].p50Ms, afterMs: next[stage].p50Ms,
        reductionPercent: Math.round((1 - next[stage].p50Ms / old[stage].p50Ms) * 1000) / 10 }];
    })) };
});
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ before: beforePath, after: afterPath, beforeVersion: before.version, afterVersion: after.version,
  completed: true, fixturesIdentical: true, saveRequestCountsIdentical: true, environment: after.environment, config: after.config,
  scope: after.scope, comparisons }, null, 2) + '\n');
for (const row of comparisons) console.log(JSON.stringify(row));
