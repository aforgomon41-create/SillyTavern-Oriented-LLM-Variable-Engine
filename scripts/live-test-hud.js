// Test instrumentation only: mounted on UUID-named test characters, never shipped in dist.
export function liveDefinition(SOLVE) {
  return { id: 'solve-live-distribution', version: '1.0.0',
    schema: SOLVE.z.object({ characters: SOLVE.z.record(SOLVE.z.string(), SOLVE.z.object({ name: SOLVE.z.string(), hp: SOLVE.z.number().min(0).max(100).default(100), gold: SOLVE.z.number().min(0).default(100) })) }),
    initialData: { characters: { player: { name: '验收玩家' } } }, entities: [{ path: 'characters', type: 'character' }],
    guide: '实机验收：每次回复只执行一次扣除5点HP的操作。' };
}
export function mountLiveHud(SOLVE, mode, host) {
  const doc = host.document, ctx = () => host.SillyTavern.getContext();
  const root = doc.createElement('details'); root.id = 'solve-live-acceptance'; root.open = true;
  root.style.cssText = 'position:fixed;top:52px;left:12px;z-index:2147483600;width:300px;max-height:46vh;overflow:auto;background:#f5f5ef;color:#173b2a;border:1px solid #94ab98;border-radius:12px;padding:12px;font:12px/1.5 system-ui;box-shadow:0 6px 24px #0003';
  const summary = doc.createElement('summary'); summary.textContent = `SOLVE 实机验收 · ${mode}`; root.append(summary);
  const output = doc.createElement('pre'); output.id = 'solve-live-result'; output.style.cssText = 'white-space:pre-wrap;margin:8px 0;font-size:11px';
  const results = []; let off, stopped = false;
  const render = () => {
    if (stopped) return;
    try {
      const c = SOLVE.controller, status = c?.getStatus();
      output.textContent = JSON.stringify({ mode, runtime: host.SOLVE.distribution(), phase: SOLVE.sessions.getStatus().phase,
        ready: status?.ready, pending: status?.pendingCount, head: status?.headId,
        data: status?.ready ? c.getState().data : undefined,
        commits: c?.getHistory().length, modelCommits: c?.getHistory().filter(h => h.actions.some(a => a.source === 'model')).length,
        reason: status?.reason ?? SOLVE.sessions.getStatus().reason, results }, null, 2);
    } catch (error) { output.textContent = String(error); }
  };
  const button = (label, action) => {
    const b = doc.createElement('button'); b.textContent = label; b.type = 'button';
    b.style.cssText = 'margin:4px;padding:6px 9px;background:#365c49;color:white;border:0;border-radius:6px;cursor:pointer';
    b.onclick = async () => { b.disabled = true; try { await action(); results.push(`${label}: PASS`); } catch(error) { results.push(`${label}: FAIL ${error.message}`); } finally { b.disabled = false; render(); } };
    root.append(b);
  };
  button('检查状态', async () => { if (!SOLVE.controller?.getStatus().ready) throw new Error('未就绪'); });
  button('扣钱与幂等', async () => {
    const c = SOLVE.controller, gold = c.getValue('@player.gold'), hp = c.getValue('@player.hp');
    const operations = { $group: [{ $inc: { '@player.gold': -30 } }, { $inc: { '@player.hp': 1 } }] };
    const actionId = `live-buy-${mode}-${crypto.randomUUID()}`;
    await c.submit(operations, { actionId }); const head = c.getStatus().headId;
    await c.submit(operations, { actionId });
    if (c.getValue('@player.gold') !== gold - 30 || c.getValue('@player.hp') !== Math.min(hp + 1, 100) || c.getStatus().headId !== head) throw new Error('扣钱或幂等不符');
  });
  button('失败整体回退', async () => {
    const c = SOLVE.controller, before = await SOLVE.hash(c.getState().data);
    const commit = await c.submit({ $group: [{ $inc: { '@player.gold': -99999 } }, { $inc: { '@player.hp': -10 } }] });
    if (!commit.feedback.some(f => f.code === 'GROUP_ROLLED_BACK') || await SOLVE.hash(c.getState().data) !== before) throw new Error('未完整回退');
  });
  button('重复处理回复', async () => {
    const c = SOLVE.controller, before = await SOLVE.hash(c.getState().data), head = c.getStatus().headId;
    await c.processMessage(); if (before !== await SOLVE.hash(c.getState().data) || head !== c.getStatus().headId) throw new Error('重复执行或改变选中历史');
  });
  button('检查磁盘归档', async () => {
    const c = SOLVE.controller, current = await SOLVE.hash(c.getState());
    const saved = await SOLVE.sessions.inspectArchive();
    if (await SOLVE.hash(saved.state) !== current || (await c.validateArchive()).some(r => !r.valid)) throw new Error('磁盘与内存不符');
  });
  button('调试面板', async () => { SOLVE.openDebugger(); });
  root.append(output); doc.body.append(root); off = SOLVE.sessions.subscribe(render); render();
  return () => { stopped = true; off?.(); root.remove(); };
}
