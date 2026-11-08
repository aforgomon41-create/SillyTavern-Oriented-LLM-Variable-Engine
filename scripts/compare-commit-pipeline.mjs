import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const [beforePath, afterPath, output = 'test-results/commit-pipeline-comparison.json'] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('Usage: node scripts/compare-commit-pipeline.mjs before.json after.json [output.json]');
const before = JSON.parse(await readFile(beforePath, 'utf8')), after = JSON.parse(await readFile(afterPath, 'utf8'));
assert.equal(before.completed, true); assert.equal(after.completed, true);
assert.deepEqual(before.config, after.config); assert.deepEqual(before.environment, after.environment);
const cases = before.cases.map(old => {
  const next = after.cases.find(row => row.historyLength === old.historyLength);
  assert.ok(next); assert.equal(old.completed, true); assert.equal(next.completed, true);
  assert.equal(old.fixtureSha256, next.fixtureSha256); assert.equal(old.stateBytes, next.stateBytes);
  const row = { historyLength: old.historyLength, stateBytes: old.stateBytes, fixtureSha256: old.fixtureSha256 };
  for (const kind of ['revisions', 'appends']) {
    assert.equal(old[kind].length, next[kind].length);
    for (let i = 0; i < old[kind].length; i++) {
      assert.deepEqual(old[kind][i].requests, next[kind][i].requests);
      assert.deepEqual(old[kind][i].disk, next[kind][i].disk);
    }
    const b = old[kind + 'P50Ms'], a = next[kind + 'P50Ms'];
    row[kind] = { beforeMs: b, afterMs: a, reductionPercent: (b - a) / b * 100,
      beforeRawMs: old[kind].map(sample => sample.ms), afterRawMs: next[kind].map(sample => sample.ms) };
  }
  return row;
});
assert.equal(cases.length, after.cases.length);
const result = { completed: true, before: beforePath, after: afterPath, scope: before.scope, config: before.config,
  caveat: 'Single machine; one revision warmup and three sequential samples. JSON HTTP substitute and fake-indexeddb, not browser timings.', cases };
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(cases, null, 2));
