// 配图生成可行性实机验证：先运行 node scripts/fake-a1111.mjs（假的 A1111 后端，7861 端口），再 node scripts/live-imagegen-probe.mjs [--mobile]。
// 可行性实机验证：在真实酒馆页面里，像 SOLVE 那样调用酒馆自带生图（/sd quiet=true），拿回图片路径、确认没插进聊天、能删除。
import { createRequire } from 'node:module';
const require = createRequire('/workspace/tools/package.json');
const { chromium } = require('playwright');
const mobile = process.argv.includes('--mobile');
const b = await chromium.launch();
const page = await b.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? '✔' : '✖'} ${n}${d ? ' — ' + d : ''}`); };
const seen = async () => (await fetch('http://127.0.0.1:7861/__seen')).json();
try {
  await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.SillyTavern?.getContext()?.onlineStatus !== undefined && document.querySelector('#send_textarea'), null, { timeout: 120000 });
  await page.waitForFunction(() => !!SillyTavern.getContext().SlashCommandParser?.commands?.imagine, null, { timeout: 90000 });
  // 玩家已经配置好酒馆自带的生图（这里指向假的 A1111 后端）
  await page.evaluate(() => { const s = SillyTavern.getContext().extensionSettings.sd; s.source = 'auto'; s.auto_url = 'http://127.0.0.1:7861'; s.width = 512; s.height = 512; });
  const ctx = await page.evaluate(() => { const c = SillyTavern.getContext(); return { exec: typeof c.executeSlashCommandsWithOptions, chatLen: c.chat.length, chatId: c.getCurrentChatId?.(), cmd: !!c.SlashCommandParser?.commands?.imagine }; });
  check('酒馆上下文提供 executeSlashCommandsWithOptions，/sd 命令已注册', ctx.exec === 'function' && ctx.cmd, JSON.stringify(ctx));
  const before = (await seen()).length;
  const r = await page.evaluate(async () => {
    const c = SillyTavern.getContext(), n = c.chat.length;
    const out = await c.executeSlashCommandsWithOptions('/sd quiet=true gallery=false negative="lowres" 1girl, silver hair, knight, rain, tavern', { handleParserErrors: true, handleExecutionErrors: true });
    return { pipe: out?.pipe, isError: out?.isError, err: out?.errorMessage, added: c.chat.length - n };
  });
  const got = (await seen()).slice(before);
  check('/sd quiet=true 返回图片路径', typeof r.pipe === 'string' && /^\/?user\/images\/.+\.png$/u.test(r.pipe), JSON.stringify(r));
  check('提示词原样送到生图后端（加上了负面提示）', got.length === 1 && /silver hair, knight/u.test(got[0]?.prompt) && /lowres/u.test(got[0]?.negative ?? ''), JSON.stringify(got[0]));
  check('quiet=true 不往聊天里插消息', r.added === 0);
  const img = await page.evaluate(async p => { const res = await fetch(p.startsWith('/') ? p : '/' + p); return { ok: res.ok, type: res.headers.get('content-type'), size: (await res.arrayBuffer()).byteLength }; }, r.pipe);
  check('图片存在服务器上、可直接用作 <img src>', img.ok && /image\/png/u.test(img.type ?? ''), JSON.stringify(img));
  // 资产管理：列出与删除
  const del = await page.evaluate(async p => { const c = SillyTavern.getContext(); const res = await fetch('/api/images/delete', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ path: p }) }); const after = await fetch(p.startsWith('/') ? p : '/' + p); return { del: res.status, after: after.status }; }, r.pipe);
  check('可通过 /api/images/delete 删除（全生命周期的最后一步）', del.del === 200 && del.after === 404, JSON.stringify(del));
  // 上传：其他插件给的 data URL 也能存成服务器文件（智绘姬等返回 base64）
  const up = await page.evaluate(async () => { const c = SillyTavern.getContext(), h = c.getRequestHeaders();
    const tiny = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
    const res = await fetch('/api/images/upload', { method: 'POST', headers: h, body: JSON.stringify({ image: tiny, format: 'png', ch_name: 'solve-assets', filename: 'probe_' + Date.now() }) });
    const j = await res.json(); const back = await fetch(j.path.startsWith('/') ? j.path : '/' + j.path);
    const list = await (await fetch('/api/images/list', { method: 'POST', headers: h, body: JSON.stringify({ folder: 'solve-assets' }) })).json();
    await fetch('/api/images/delete', { method: 'POST', headers: h, body: JSON.stringify({ path: j.path }) });
    const after = await (await fetch('/api/images/list', { method: 'POST', headers: h, body: JSON.stringify({ folder: 'solve-assets' }) })).json();
    return { path: j.path, back: back.status, listed: list.some(f => j.path.endsWith(f)), gone: !after.some(f => j.path.endsWith(f)) }; });
  check('base64 图片可上传到 user/images/solve-assets/，能列出、能删除', /^\/?user\/images\/solve-assets\//u.test(up.path) && up.back === 200 && up.listed && up.gone, JSON.stringify(up));
  // 生图没配置时：返回空字符串而不是抛错
  await page.evaluate(() => { SillyTavern.getContext().extensionSettings.sd.auto_url = ''; });
  const off = await page.evaluate(async () => (await SillyTavern.getContext().executeSlashCommandsWithOptions('/sd quiet=true test', { handleExecutionErrors: true }))?.pipe);
  check('生图未配置时返回空（SOLVE 可据此提示玩家）', !off, JSON.stringify(off));
} catch (e) { check('流程未中断', false, String(e).slice(0, 300)); }
finally {
  check('页面无报错', !errs.length, errs.join(' | '));
  await b.close();
  console.log(`${results.filter(Boolean).length}/${results.length} 通过（${mobile ? 390 : 1440}）`);
}
