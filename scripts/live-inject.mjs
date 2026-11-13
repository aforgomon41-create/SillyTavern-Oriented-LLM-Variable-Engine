// 实机验收：随正文输出时的提示词注入（设置 › 变量更新 › 提示词注入）。
// 角色卡里不写任何 SOLVE 宏，发给模型的请求里也要有操作说明、数据结构、指南、当前变量；卡里写了的不重复注入；
// 「不注入」时不注入；改位置后按新位置注入。
//
// 前提：本机测试酒馆（SillyTavern 1.19 + 酒馆助手）+ 假模型（卡密仓库 test/mock-llm/server.mjs，默认 8787）。
// 用法：npm run build && node scripts/live-inject.mjs [--mobile]
// 会把 dist 复制成酒馆的 third-party/solve 扩展，创建随机命名的测试角色，结束时删除。
import { createRequire } from 'node:module';
import { cp, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/package.json');
const { chromium } = require('playwright');
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000/';
const ST_ROOT = process.env.ST_ROOT || '/workspace/st-test/SillyTavern';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:8787';
const mobile = process.argv.includes('--mobile');
const tag = mobile ? '390' : '1440';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };
const mock = async (path, body) => (await fetch(MOCK + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
const SOP = 'SOLVE 变量操作说明', SCHEMA = '## 数据结构', DATA = '当前变量（TOON）', GUIDE = '驱动力：剧情推进后及时更新';

const target = resolve(ST_ROOT, 'public/scripts/extensions/third-party/solve');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve('dist'), target, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
const errors = [];
let phase = 'start';
// 酒馆助手的提示词查看器拿到提示词后会停止那次伪造的生成，酒馆自己抛出 AbortError（没有 SOLVE 时也一样），不算 SOLVE 的报错。
page.on('pageerror', e => { if (/AbortError/u.test(String(e)) && /JS-Slash-Runner/u.test(String(e.stack))) return; errors.push(`[${phase}] ` + String(e).slice(0, 300)); });
page.on('console', m => { if (m.type() === 'error' && /SOLVE|solve/u.test(m.text())) errors.push(`[${phase}] console: ` + m.text().slice(0, 300)); });
const avatars = [];

async function makeChar(description) {
  const avatar = await page.evaluate(async description => {
    const ctx = SillyTavern.getContext(), headers = { ...ctx.getRequestHeaders() };
    delete headers['Content-Type'];
    const form = new FormData(), name = 'SOLVE注入验收_' + Math.random().toString(36).slice(2, 8);
    for (const [key, value] of Object.entries({ ch_name: name, first_mes: '夜雨中的王都。', description, personality: '', scenario: '', mes_example: '', talkativeness: '0.5', fav: 'false', tags: '' })) form.append(key, value);
    const response = await fetch('/api/characters/create', { method: 'POST', headers, body: form });
    return (await response.text()).trim();
  }, description);
  avatars.push(avatar);
  await page.evaluate(async a => {
    const ctx = SillyTavern.getContext();
    await SOLVE.register(SOLVE.compileStructure(SOLVE.officialStructure), { characters: [a] });
    await ctx.getCharacters();
    await ctx.selectCharacterById(ctx.characters.findIndex(c => c.avatar === a));
  }, avatar);
  await page.waitForFunction(a => { const c = SillyTavern.getContext(); return c.characters[c.characterId]?.avatar === a && SOLVE.controller?.getStatus()?.ready; }, avatar, { timeout: 90000 });
}
/** One turn; returns the messages the model received. */
async function turn(text) {
  await mock('/__mock/next', { content: '<content>\n雨还在下。\n</content>\n<solve_operate>\n' + JSON.stringify([{ $set: { 'meta.weather': '雨' } }]) + '\n</solve_operate>' });
  const head = await page.evaluate(() => SOLVE.controller.getStatus().headId);
  await page.fill('#send_textarea', text); await page.click('#send_but');
  await page.waitForFunction(h => { const s = SOLVE.controller.getStatus(); return s.ready && !s.busy && s.headId !== h; }, head, { timeout: 90000 });
  const req = await mock('/__mock/requests');
  return (req.requests ?? req).at(-1)?.body?.messages ?? [];
}
const count = (messages, needle) => messages.reduce((n, m) => n + String(m.content).split(needle).length - 1, 0);
const indexOf = (messages, needle) => messages.findIndex(m => String(m.content).includes(needle));
/** The player's message in the chat history (presets may repeat it later inside their own wrappers). */
const said = (messages, text) => messages.findIndex(m => m.role === 'user' && String(m.content).trim() === text);
const setPrefs = inject => page.evaluate(inject => {
  const p = JSON.parse(localStorage.getItem('solve.update.v1') || '{}');
  localStorage.setItem('solve.update.v1', JSON.stringify({ ...p, inject }));
}, inject);
const DEFAULT = { mode: 'auto', format: 'toon', items: { sop: { on: true, position: 'after', depth: 4, role: 'system' }, guide: { on: true, position: 'after', depth: 4, role: 'system' }, data: { on: true, position: 'chat', depth: 2, role: 'system' }, feedback: { on: true, position: 'chat', depth: 0, role: 'system' } } };

try {
  phase = 'navigation';
  await mock('/__mock/reset', {});
  await page.goto(ST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#send_textarea', { timeout: 90000 });
  await page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
  await page.evaluate(() => localStorage.removeItem('solve.update.v1'));

  phase = 'no-macros';
  await makeChar('一位在王都开酒馆的老板娘。');
  let m = await turn('我走进酒馆。');
  check('卡里没写宏：请求里有操作说明', count(m, SOP) === 1, `${count(m, SOP)} 处`);
  check('卡里没写宏：请求里有指南', count(m, GUIDE) >= 1);
  check('卡里没写宏：请求里有数据结构（字段与说明）', count(m, SCHEMA) === 1 && m.some(x => String(x.content).includes('intro（简介）: 文字 — ')), `${count(m, SCHEMA)} 处`);
  { const all = m.map(x => String(x.content)).join('\n'), a = all.indexOf(SOP), b = all.indexOf(SCHEMA), c = all.indexOf(GUIDE);
    check('顺序：操作说明 → 数据结构 → 指南', a >= 0 && a < b && b < c, `${a} / ${b} / ${c}`); }
  check('卡里没写宏：请求里有当前变量', count(m, DATA) === 1);
  let d = indexOf(m, DATA);
  check('变量数据在聊天记录里（深度 2，系统角色）', d > 0 && m[d].role === 'system' && said(m, '我走进酒馆。') - d === 2, `第 ${d + 1}/${m.length} 条 · ${m[d]?.role}（开场白和这一句之前）`);
  check('操作说明在聊天记录之前', indexOf(m, SOP) >= 0 && indexOf(m, SOP) < indexOf(m, '我走进酒馆'));
  m = await turn('我坐下。');
  d = indexOf(m, DATA);
  check('第二轮的变量是新状态（天气=雨）', /weather:\s*雨/u.test(m[d]?.content ?? ''));
  check('第二轮：变量在最后两条聊天消息之前（深度 2）', said(m, '我坐下。') - d === 2, `第 ${d + 1} 条，玩家这句在第 ${said(m, '我坐下。') + 1} 条`);

  phase = 'off';
  await setPrefs({ ...DEFAULT, mode: 'off' });
  m = await turn('我喝了一口酒。');
  check('「不注入」：请求里没有操作说明、数据结构和变量', count(m, SOP) === 0 && count(m, SCHEMA) === 0 && count(m, DATA) === 0);

  phase = 'move';
  await setPrefs({ ...DEFAULT, items: { ...DEFAULT.items, sop: { on: true, position: 'chat', depth: 0, role: 'user' }, guide: { ...DEFAULT.items.guide, on: false }, data: { ...DEFAULT.items.data, position: 'before' } } });
  m = await turn('我付了钱。');
  const s = indexOf(m, SOP);
  check('改位置：操作说明紧跟在玩家最后一句后面（深度 0，用户角色）', s === said(m, '我付了钱。') + 1 && m[s]?.role === 'user', `第 ${s + 1}/${m.length} 条 · ${m[s]?.role}`);
  check('关掉的指南不再注入', count(m, GUIDE) === 0);
  check('改位置：变量数据放到最前面（系统提示之前）', indexOf(m, DATA) === 0 && m[0].role === 'system', `第 ${indexOf(m, DATA) + 1} 条`);

  phase = 'viewer';
  // 酒馆助手的「提示词查看器」：它伪造一次请求拿到实际发送的提示词，SOLVE 的内容也要在里面。
  await setPrefs(DEFAULT);
  await page.evaluate(() => { const ctx = SillyTavern.getContext(); window.__solveReady = []; ctx.eventSource.makeLast(ctx.eventTypes.CHAT_COMPLETION_PROMPT_READY, d => { window.__solveReady.push(d.chat.map(m => String(m.content))); }); });
  await page.click('#extensionsMenuButton');
  const viewer = page.locator('#extensionsMenu .list-group-item').filter({ hasText: '提示词查看器' }).first();
  if (await viewer.count()) {
    await viewer.click();
    await page.waitForFunction(() => window.__solveReady.length > 0, null, { timeout: 30000 });
    const got = await page.evaluate(() => window.__solveReady.at(-1));
    const at = got.findIndex(c => c.includes(SOP));
    check('提示词查看器拿到的请求里有 SOLVE 的内容', at >= 0 && got.some(c => c.includes('当前变量（TOON）')));
    check('合并后的那条以操作说明开头', at >= 0 && got[at].trimStart().startsWith('## SOLVE 变量操作说明'));
    const report = await page.evaluate(() => SOLVE.injection());
    check('SOLVE.injection() 记下了这次注入', report && !report.skipped && report.items.filter(i => i.on).length >= 3, report ? report.items.map(i => `${i.label}:${i.on ? '注入' : i.why}`).join(' ') : '无');
    await page.keyboard.press('Escape').catch(() => undefined);
  } else check('魔法棒里有酒馆助手的提示词查看器', false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });

  phase = 'card-macros';
  await setPrefs(DEFAULT);
  await makeChar('{{solve_SOP}}\n{{solve_schema}}\n一位在王都开酒馆的老板娘。');
  m = await turn('我走进酒馆。');
  check('卡里写了 {{solve_SOP}}：操作说明只出现一次', count(m, SOP) === 1, `${count(m, SOP)} 处`);
  check('卡里写了 {{solve_schema}}：宏展开出数据结构，且只出现一次', count(m, SCHEMA) === 1, `${count(m, SCHEMA)} 处`);
  check('卡里没写的变量照常注入', count(m, DATA) === 1);

  phase = 'edited';
  // 改了一条带变量的回复：SOLVE 自动从这一楼重放，变量按改过的内容重算；生成照常、不弹警告。
  const target = await page.evaluate(() => { const chat = SillyTavern.getContext().chat; for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user && chat[i].extra?.solve?.headId && /<solve_operate>/u.test(chat[i].mes)) return i; return -1; });
  const mes = page.locator(`#chat .mes[mesid="${target}"]`);
  await mes.scrollIntoViewIfNeeded(); await mes.hover();
  await mes.locator('.mes_edit').first().click({ force: true });
  const area = page.locator(`#chat .mes[mesid="${target}"] .edit_textarea`).first();
  const original = await area.inputValue();
  await area.fill(original.replace('"meta.weather":"雨"', '"meta.weather":"雪"'));
  await page.locator(`#chat .mes[mesid="${target}"] .mes_edit_done`).first().click({ force: true });
  const replayed = await page.waitForFunction(() => { const s = SOLVE.controller.getStatus(); return s.ready && !s.busy && SOLVE.controller.getState().data.meta.weather === '雪'; }, null, { timeout: 30000 }).then(() => true, () => false);
  const st = await page.evaluate(() => SOLVE.controller.getStatus());
  check('改了回复里的操作后自动重放，变量按新内容重算（雨 → 雪）', replayed, `ready=${st.ready} · ${st.reason || '无待处理'}`);
  check('调试日志记下自动重放', await page.evaluate(() => SOLVE.controller.journal.read().some(l => l.code === 'AUTO_REPLAY')));
  await page.waitForTimeout(800);
  const barText = await page.evaluate(() => document.querySelector('solve-statusbar')?.shadowRoot?.textContent ?? '');
  check('状态栏显示新的天气', barText.includes('雪'));
  await page.evaluate(() => document.querySelectorAll('#toast-container .toast').forEach(t => t.remove()));
  const before = ((await mock('/__mock/requests')).requests ?? await mock('/__mock/requests')).length;
  await mock('/__mock/next', { content: '<content>\n巷子里很安静。\n</content>' });
  const n = await page.evaluate(() => SillyTavern.getContext().chat.length);
  await page.fill('#send_textarea', '我拐进小巷。'); await page.click('#send_but');
  await page.waitForFunction(n => SillyTavern.getContext().chat.length >= n + 2, n, { timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const all = (await mock('/__mock/requests')).requests ?? await mock('/__mock/requests');
  check('再发送：请求到达模型，没有警告提示', all.length === before + 1 && !(await page.evaluate(() => document.querySelector('#toast-container .toast-warning'))), `${all.length - before} 次`);
  const last = all.at(-1)?.body?.messages ?? [];
  check('再发送：注入的变量是重放后的（雪）', /weather:\s*雪/u.test(last[indexOf(last, DATA)]?.content ?? ''));
} catch (error) {
  check('流程未中断', false, `${phase}: ${String(error).slice(0, 400)}`);
} finally {
  check('页面无 SOLVE 相关报错', !errors.length, errors.slice(0, 5).join(' | '));
  await page.evaluate(() => localStorage.removeItem('solve.update.v1')).catch(() => undefined);
  for (const a of avatars) await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) }); }, a).catch(() => undefined);
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过（${tag}）`);
  process.exitCode = failed.length ? 1 : 0;
}
