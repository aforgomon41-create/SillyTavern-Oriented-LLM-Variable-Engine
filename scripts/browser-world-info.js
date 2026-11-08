// Test instrumentation only. Copy into an isolated native extension; never ship in dist.
import { benchmarkBrowserCache, checkBrowserCacheCapacity } from './browser-cache-benchmark.js';
export function mountWorldInfoAcceptance(SOLVE, host = window) {
  if (!['localhost', '127.0.0.1'].includes(host.location.hostname)) throw new Error('仅允许本机验收');
  const prefix = 'SOLVE_browser_world_', ctx = () => host.SillyTavern.getContext();
  const root = host.document.createElement('details'); root.open = true; root.id = 'solve-world-acceptance';
  root.style.cssText = 'position:fixed;top:50px;left:8px;z-index:2147483600;width:340px;max-height:70vh;overflow:auto;background:#fff;color:#173b2a;border:1px solid #94ab98;padding:12px;font:12px/1.5 system-ui';
  const summary = host.document.createElement('summary'); summary.textContent = 'SOLVE 世界书页面验收'; root.append(summary);
  const output = host.document.createElement('pre'); output.style.cssText = 'white-space:pre-wrap';
  let performanceReport, capacityReport, progress;
  const results = [], check = (condition, message) => { if (!condition) throw new Error(message); };
  const selected = () => { const context = ctx(), card = context.characters[context.characterId]; check(card?.name.startsWith(prefix), '仅允许验收角色'); return card; };
  const render = () => {
    const status = SOLVE.sessions.getStatus(), controller = SOLVE.controller;
    output.textContent = JSON.stringify({ version: SOLVE.version, phase: status.phase, reason: controller?.getStatus().reason || status.reason,
      chat: ctx().chatId, character: ctx().characters[ctx().characterId]?.name,
      ready: controller?.getStatus().ready, hp: controller?.getStatus().ready ? controller.getValue('hp') : undefined,
      definition: controller?.core.definition.fingerprint, cache: controller?.getStatus().cache, results, progress, performanceReport, capacityReport }, null, 2);
  };
  const button = (label, action) => {
    const element = host.document.createElement('button'); element.textContent = label; element.type = 'button'; element.style.cssText = 'margin:3px;padding:6px;color:#173b2a;background:#eef5ed';
    element.onclick = async () => { element.disabled = true; try { selected(); await action(); results.push(label + ': PASS'); } catch (error) { results.push(label + ': FAIL ' + error.message); } finally { element.disabled = false; render(); } };
    root.append(element);
  };
  button('扣除5HP', async () => { const c = SOLVE.controller, before = c.getValue('hp'); await c.submit({ $inc: { hp: -5 } }); check(c.getValue('hp') === before - 5, '扣除不符'); });
  button('检查磁盘与固定声明', async () => {
    const c = SOLVE.controller, disk = await SOLVE.sessions.inspectArchive(), metadata = ctx().chatMetadata.solve;
    check(await SOLVE.hash(disk.state) === await SOLVE.hash(c.getState()), '磁盘状态不符');
    check(metadata.authoring?.fingerprint === c.core.definition.fingerprint, '固定声明不符');
    check(!JSON.stringify(metadata.authoring).includes('普通条目不应进入声明'), '收集了普通条目');
    check((await c.validateArchive()).every(row => row.valid), '归档验证失败');
  });
  button('主世界书更新为60HP', async () => {
    const name = selected().data.extensions.world; check(name.startsWith(prefix), '仅允许验收书');
    const post = async (path, body) => { const response = await host.fetch(path, { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) }); check(response.ok, path + '请求失败'); return response; };
    const data = await (await post('/api/worldinfo/get', { name })).json();
    data.entries[0].content = '{"hp":60}'; await post('/api/worldinfo/edit', { name, data });
  });
  button('浏览器缓存1000楼测量', async () => { performanceReport = await benchmarkBrowserCache(SOLVE, text => { progress = text; render(); }); progress = undefined; });
  button('真实浏览器容量检查', async () => { capacityReport = await checkBrowserCacheCapacity(SOLVE); });
  root.append(output); host.document.body.append(root);
  const register = async () => {
    try {
      const characters = Object.values(ctx().characters).filter(card => card.name.startsWith(prefix)).map(card => card.avatar);
      if (characters.length) await SOLVE.registerWorldInfo({ id: 'solve-browser-world', version: '1', schema: SOLVE.z.object({ hp: SOLVE.z.number().min(0).max(100).default(100) }), initialData: {} }, { characters, worldInfo: { characterBook: true } });
    } catch (error) { results.push('注册失败: ' + error.message); } render();
  };
  SOLVE.sessions.subscribe(render);
  const context = ctx(); if (context.eventTypes?.APP_READY) context.eventSource.once(context.eventTypes.APP_READY, register);
  void register(); const timer = host.setInterval(render, 1000); host.addEventListener('pagehide', () => host.clearInterval(timer), { once: true });
}
