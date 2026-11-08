// Browser-only synthetic restore/cache benchmark. No model requests or chat writes.
export async function benchmarkBrowserCache(SOLVE, progress = () => {}) {
  const report = { version: SOLVE.version, environment: navigator.userAgent, createdAt: new Date().toISOString(),
    scope: '真实浏览器 IndexedDB；人工生成的约100KB状态/1000提交链；单样本，无预热；不含Controller与服务端保存，不代表低端设备', completed: false, cleanup: false };
  const name = 'solve-benchmark-' + crypto.randomUUID(), cache = new SOLVE.IndexedDbCache(indexedDB, name);
  const measure = async task => { const started = performance.now(); const value = await task(); return { ms: performance.now() - started, value }; };
  try {
    const { z } = SOLVE;
    const definition = await SOLVE.compile({ id: 'browser-cache-benchmark', version: '1',
      schema: z.object({ entities: z.record(z.string(), z.object({ count: z.number(), label: z.string(), description: z.string() })), shelf: z.record(z.string(), z.object({ count: z.number(), label: z.string(), description: z.string() })).default({}) }),
      initialData: { entities: Object.fromEntries(Array.from({ length: 500 }, (_, index) => ['e' + index, { count: 100, label: '实体' + index, description: 'a'.repeat(130) }])) } });
    const core = new SOLVE.SolveCore(definition), binding = { chatId: name, messageId: 'root', swipeId: '0' };
    const { archive, headId } = await SOLVE.createArchive(core, binding); let head = headId, state = await SOLVE.restore(archive, head);
    report.stateBytes = new TextEncoder().encode(JSON.stringify(state)).byteLength; report.historyLength = 1000;
    progress('正在生成1000个提交');
    for (let index = 1; index <= 1000; index++) {
      const before = state; state = structuredClone(before); state.data.entities.e0.count++;
      const action = { actionId: 'step-' + index, kind: 'operations', source: 'model', operations: { $inc: { 'entities.e0.count': 1 } } };
      const commit = await SOLVE.buildCommit(archive, head, archive.commits[head].genesisId, before, state, { ...binding, messageId: 'm' + index }, [action], [], {}, 'benchmark');
      archive.commits[commit.id] = commit; head = commit.id;
      if (index % 100 === 0) progress('已生成' + index + '个提交');
    }
    const verify = result => { if (result.data.entities.e0.count !== 1100) throw new Error('恢复结果不符'); };
    progress('无缓存恢复'); const cold = await measure(() => SOLVE.restore(archive, head)); verify(cold.value); report.coldRestoreMs = cold.ms;
    progress('认证并写入快照'); report.certifyAndPutMs = (await measure(() => cache.put(archive, head, state))).ms;
    progress('缓存恢复'); const hit = await measure(() => cache.restore(archive, head)); verify(hit.value); report.cachedRestoreMs = hit.ms; report.restoreSource = cache.lastRestoreSource;
    if (cache.lastRestoreSource !== 'snapshot') throw new Error('未命中快照');
    report.stats = await cache.getStats(); await cache.clearSnapshots();
    const fallback = await measure(() => cache.restore(archive, head)); verify(fallback.value); report.afterClearRestoreMs = fallback.ms; report.afterClearSource = cache.lastRestoreSource;
    if (cache.lastRestoreSource !== 'archive') throw new Error('清缓存后未回到事实'); report.completed = true;
  } finally {
    cache.close(); await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); report.cleanup = true;
  }
  return report;
}

export async function checkBrowserCacheCapacity(SOLVE) {
  const name = 'solve-capacity-' + crypto.randomUUID();
  const cache = new SOLVE.IndexedDbCache(indexedDB, name, { maxSnapshots: 2, maxSnapshotsPerSession: 1, maxBytes: 10000 });
  const report = { completed: false, cleanup: false };
  try {
    const core = new SOLVE.SolveCore(await SOLVE.compile({ id: 'browser-capacity', version: '1', schema: SOLVE.z.object({ hp: SOLVE.z.number() }), initialData: { hp: 100 } }));
    const fixtures = [];
    await cache.savePending('draft', [{ mustSurvive: true }]);
    for (let index = 0; index < 3; index++) {
      const fixture = await SOLVE.createArchive(core, { chatId: name, messageId: 'm' + index, swipeId: '0' }); fixtures.push(fixture);
      await cache.put(fixture.archive, fixture.headId, await SOLVE.restore(fixture.archive, fixture.headId));
    }
    report.beforeClear = await cache.getStats();
    await cache.restore(fixtures[0].archive, fixtures[0].headId); report.evictedSource = cache.lastRestoreSource;
    await cache.restore(fixtures[2].archive, fixtures[2].headId); report.latestSource = cache.lastRestoreSource;
    await cache.clearSnapshots(); report.afterClear = await cache.getStats();
    report.draftPreserved = JSON.stringify(await cache.loadPending('draft')) === '[{"mustSurvive":true}]';
    if (report.beforeClear.snapshots !== 2 || report.evictedSource !== 'archive' || report.latestSource !== 'snapshot' || report.afterClear.snapshots !== 0 || !report.draftPreserved) throw new Error('容量/草稿保护不符');
    report.completed = true;
  } finally {
    cache.close(); await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); report.cleanup = true;
  }
  return report;
}
