// 实机验收：快捷按钮（重新处理变量 / 重放 / 重建 / 单独生成变量 / 重试保存、显示开关）与保存失败后的静默重试。准备流程同 live-statusbar。
// 原注释：酒馆里的状态栏（官方结构的声明式布局、玩家交互、撤销、旁白进入下一轮提示词、设置页、生成时锁定）。
//
// 前提：本机测试酒馆（SillyTavern 1.19 + 酒馆助手）+ 假模型（卡密仓库 test/mock-llm/server.mjs，默认 8787）。
// 用法：npm run build && node scripts/live-statusbar.mjs [--mobile] [--keep] [--shots=目录]
//   ST_URL（默认 http://127.0.0.1:8000/）、ST_ROOT（默认 /workspace/st-test/SillyTavern）、
//   MOCK_URL（默认 http://127.0.0.1:8787）、PLAYWRIGHT_PKG（默认 /workspace/tools/package.json）、
//   EXAMPLE_STATE（默认 /tmp/solve-example-state.json：示例世界的数据，由 scripts/dump-example-state.ts 生成）
// 会把 dist 复制成酒馆的 third-party/solve 扩展，创建一个随机命名的测试角色；结束时删除角色（--keep 保留）。
import { createRequire } from 'node:module';
import { cp, rm, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/package.json');
const { chromium } = require('playwright');
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000/';
const ST_ROOT = process.env.ST_ROOT || '/workspace/st-test/SillyTavern';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:8787';
const mobile = process.argv.includes('--mobile'), keep = process.argv.includes('--keep');
const shots = process.argv.find(a => a.startsWith('--shots='))?.slice(8) || '/tmp/solve-live-buttons';
// --skin=solve：即使页面上有卡密预设，也让状态栏用 SOLVE 自带皮肤（玩家在「显示」里的同名开关）
const forceSolve = process.argv.includes('--skin=solve');
const tag = mobile ? '390' : '1440';
const example = JSON.parse(await readFile(process.env.EXAMPLE_STATE || '/tmp/solve-example-state.json', 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };
const mock = async (path, body) => (await fetch(MOCK + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
const op = (ops, prose = '雨还在下。') => `<content>\n${prose}\n</content>\n<solve_operate>\n${JSON.stringify(ops)}\n</solve_operate>`;

const target = resolve(ST_ROOT, 'public/scripts/extensions/third-party/solve');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve(process.env.DIST || 'dist'), target, { recursive: true });
await mkdir(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
if (forceSolve) await page.addInitScript(() => { try { localStorage.setItem('solve.statusbar.prefs.v1', JSON.stringify({ skin: 'solve' })); } catch { /* ignore */ } });
const errors = [];
let phase = 'start';
page.on('pageerror', e => errors.push(`[${phase}] ` + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' && /SOLVE|solve|React|状态栏/u.test(m.text())) errors.push(`[${phase}] console: ` + m.text().slice(0, 300)); });
const status = () => page.evaluate(() => window.SOLVE.controller?.getStatus());
const waitReady = (headNot) => page.waitForFunction(h => { const s = window.SOLVE.controller?.getStatus(); return s?.ready && !s.busy && s.headId && s.headId !== h; }, headNot ?? null, { timeout: 90000 });
const state = () => page.evaluate(() => window.SOLVE.controller.getState());
const shot = name => page.screenshot({ path: `${shots}/${tag}-${name}.png` });
const bar = page.locator('solve-statusbar');
const $ = sel => bar.locator(sel);
const settle = (ms = 400) => page.waitForTimeout(ms);
let avatar;

async function send(text, reply) {
  // The open panel covers the input on both widths: fold it first, as a player would.
  if (await bar.count() && await $('[data-k="panel"]').count()) { await $('[data-k="panel"] [data-k-part="close"]').first().click(); await settle(); }
  await mock('/__mock/next', { content: reply });
  const before = (await status()).headId;
  await page.fill('#send_textarea', text);
  await page.click('#send_but');
  await waitReady(before);
  await settle(300);
}
async function lastRequestText() {
  const requests = await mock('/__mock/requests');
  const last = (requests.requests ?? requests).at(-1);
  return JSON.stringify(last?.body?.messages ?? last?.messages ?? last ?? '');
}
/** Opens the panel from the bar (or dot) if it is not open yet. */
async function openPanel() {
  if (await $('[data-k="panel"]').count()) return;
  await $('[data-solve="launcher"] [data-solve-part="open"], [data-solve="launcher"] button').first().click();
  await $('[data-k="panel"]').waitFor({ timeout: 10000 });
  await settle();
}
async function goTab(name) {
  const nav = $('[data-k="nav"] [data-k-part="item"]').filter({ hasText: name });
  if (await nav.count()) await nav.first().click(); else await $('[data-k="tabs"] [role="tab"]').filter({ hasText: name }).first().click();
  await settle();
}

try {
  phase = 'navigation';
  await mock('/__mock/reset', {});
  await page.goto(ST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#send_textarea', { timeout: 90000 });
  await page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
  phase = 'setup';
  avatar = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext(), headers = { ...ctx.getRequestHeaders() };
    delete headers['Content-Type'];
    const form = new FormData(), name = 'SOLVE状态栏验收_' + Math.random().toString(36).slice(2, 8);
    for (const [key, value] of Object.entries({ ch_name: name, first_mes: '夜雨中的王都，醉橡木酒馆的门被推开了。', description: '{{solve_SOP}}\n{{solve_guide}}\n当前变量：{{solve_json}}', personality: '', scenario: '', mes_example: '', talkativeness: '0.5', fav: 'false', tags: '' })) form.append(key, value);
    const response = await fetch('/api/characters/create', { method: 'POST', headers, body: form });
    if (!response.ok) throw new Error('创建测试角色失败：' + response.status);
    return (await response.text()).trim();
  });
  await page.evaluate(async a => {
    const ctx = SillyTavern.getContext();
    await SOLVE.register(SOLVE.compileStructure(SOLVE.officialStructure), { characters: [a] });
    await ctx.getCharacters();
    await ctx.selectCharacterById(ctx.characters.findIndex(c => c.avatar === a));
  }, avatar);
  await waitReady();
  check('状态栏宿主节点已挂到酒馆页面', await bar.count() === 1);

  // 示例世界：一轮模型回复，再由玩家动作写入示例数据（图片等字段模型不可写）并打开示例用到的模块
  await send('我走进酒馆。', op([{ $set: { 'meta.weather': '雨' } }], '炉火噼啪作响。'));
  for (const [name, on] of Object.entries(example.modules)) {
    const now = await page.evaluate(n => SOLVE.controller.getModules().find(m => m.name === n)?.preference, name);
    if (now !== on) await page.evaluate(([n, v]) => SOLVE.controller.setModule(n, v), [name, on]);
  }
  await page.evaluate(ops => SOLVE.controller.submit(ops, { actionId: 'seed' }), example.ops);
  const seeded = await state();
  check('示例数据写入（角色 / 物品 / 地点 / 设定）', Object.keys(seeded.data.characters ?? {}).length >= 5 && seeded.data.items?.healing_draught && seeded.data.places?.tavern,
    `${Object.keys(seeded.data.characters ?? {}).length} 个角色`);




  phase = 'bar';
  const btns = page.locator('#solve_buttons [data-solve-button]');
  await page.locator('#solve_buttons').waitFor({ timeout: 10000 });
  const labels = (await btns.allInnerTexts()).map(s => s.trim());
  check('输入框上方出现快捷按钮（默认四个，没有待保存时不显示重试保存）', labels.join('|') === '重新处理变量|重放|重建|单独生成变量', labels.join('|'));
  await shot('bar');
  const toasts = async () => (await page.locator('#toast-container .toast').allInnerTexts()).join(' / ').replace(/\s+/g, ' ');
  const clearToasts = () => page.evaluate(() => { try { toastr.clear(); document.querySelectorAll('#toast-container .toast').forEach(t => t.remove()); } catch { /* */ } });
  const waitToast = async re => { for (let i = 0; i < 60; i++) { const t = await toasts(); if (re.test(t)) return t; await page.waitForTimeout(500); } return await toasts(); };

  phase = 'generate';
  // 正文模型忘了写操作块
  await send('我坐下来，点了一杯麦酒。', '<content>\n米拉把麦酒推到你面前，顺手收走了三枚铜币。\n</content>');
  const before = await state();
  check('没有操作块的回复不改变量', before.data.meta.weather === '雨');
  await mock('/__mock/next', { content: '<solve_operate>\n[{"$set":{"meta.weather":"阴"}},{"$set":{"meta.mood":"欢快"}}]\n</solve_operate>' });
  await clearToasts();
  await btns.filter({ hasText: '单独生成变量' }).click();
  const t1 = await waitToast(/已生成并写入|没有完成/u);
  const after = await state();
  check('单独生成变量：模型返回的操作写进变量', after.data.meta.weather === '阴' && after.data.meta.mood === '欢快', t1);
  const mes = await page.evaluate(() => SillyTavern.getContext().chat.at(-1).mes);
  check('生成的操作块写进了这条回复', /<solve_operate>[\s\S]*阴[\s\S]*<\/solve_operate>/u.test(mes) && /米拉把麦酒推到你面前/u.test(mes));
  const req = await lastRequestText();
  check('单独生成的请求带上了变量说明和这条回复', /SOLVE 变量操作说明/u.test(req) && /米拉把麦酒推到你面前/u.test(req));
  await shot('generated');

  phase = 'reprocess';
  await clearToasts();
  await btns.filter({ hasText: '重新处理变量' }).click();
  const t2 = await waitToast(/已重新处理|没有完成/u);
  check('重新处理变量：成功且变量不变', /已重新处理/u.test(t2) && (await state()).data.meta.weather === '阴', t2);

  phase = 'replay';
  await clearToasts();
  page.once('dialog', d => d.accept('1'));
  await btns.filter({ hasText: /^重放$/u }).click();
  const t3 = await waitToast(/已从第 1 楼重放|没有完成/u);
  const st3 = await page.evaluate(() => SOLVE.controller.getStatus());
  check('重放：输入楼层号后从那一楼往后重算', /已从第 1 楼重放/u.test(t3) && st3.ready && (await state()).data.meta.weather === '阴', t3);

  phase = 'rebuild';
  await clearToasts();
  await btns.filter({ hasText: '重建' }).click();
  const t4 = await waitToast(/重建|没有完成/u);
  check('重建：按聊天记录重建，状态就绪、变量不变', /已按聊天记录重建变量/u.test(t4) && (await page.evaluate(() => SOLVE.controller.getStatus().ready)) && (await state()).data.meta.weather === '阴', t4);

  phase = 'silent-retry';
  // SOLVE's own save: the reply carrying these operations already has its SOLVE head (the tavern's save right after the reply does not).
  // (the new value shows up in SOLVE's variable records — the reply text itself is left out of the check).
  const solveSave = (route, word) => { try { const body = JSON.parse(route.request().postData() ?? '{}'); for (const m of body.chat ?? []) { delete m.mes; delete m.swipes; delete m.swipe_info; } return JSON.stringify(body).includes(`"${word}"`); } catch { return false; } };
  // 一次保存失败（模拟和酒馆自己的保存撞车）：SOLVE 应该静默重试成功，不弹报错
  // SOLVE's own write fails once (as when it collides with the tavern's save around a swipe).
  await page.evaluate(() => { const a = SOLVE.controller.adapter, post = a.post.bind(a); window.__failed = 0;
    a.post = async (url, body) => { if (url === '/api/chats/save' && window.__failed < 1) { window.__failed++; throw new Error('酒馆请求失败（500）：/api/chats/save'); } return post(url, body); }; });
  await clearToasts();
  await mock('/__mock/next', { content: op([{ $set: { 'meta.weather': '晴' } }], '云散开了。') });
  await page.fill('#send_textarea', '雨停了吗？'); await page.click('#send_but');
  await page.waitForTimeout(6000);
  const st5 = await page.evaluate(() => SOLVE.controller.getStatus());
  const log5 = await page.evaluate(() => SOLVE.controller.journal.read().slice(-15).map(d => d.code).join(','));
  check('保存失败过一次', await page.evaluate(() => window.__failed) === 1);
  check('静默重试后已保存、变量已更新、没有待保存', !st5.pendingCount && st5.ready && (await state()).data.meta.weather === '晴', JSON.stringify({ pending: st5.pendingCount, ready: st5.ready, reason: st5.reason }));
  check('没有弹出报错', !/没有处理|SOLVE/u.test(await toasts()), await toasts());
  if (log5) check('日志记了自动重试成功', /AUTO_RETRY_SAVED/u.test(log5), log5);
  await page.evaluate(() => { const a = SOLVE.controller.adapter; delete a.post; });

  phase = 'retry-button';
  // 一直保存失败：静默重试也不行时才报错，并出现「重试保存」按钮
  let blocked = true;
  await page.route('**/api/chats/save', async route => { if (blocked && solveSave(route, '雾')) await route.fulfill({ status: 500, body: 'simulated' }); else await route.continue(); });
  await clearToasts();
  await mock('/__mock/next', { content: op([{ $set: { 'meta.weather': '雾' } }], '天边有云。') });
  await page.fill('#send_textarea', '再看看天。'); await page.click('#send_but');
  for (let i = 0; i < 40 && !/SOLVE/u.test(await toasts()); i++) await page.waitForTimeout(500);
  const st6 = await page.evaluate(() => SOLVE.controller.getStatus());
  check('一直失败：留下待保存，才提示玩家', st6.pendingCount > 0 && /SOLVE/u.test(await toasts()), `${st6.pendingCount} / ${await toasts()}`);
  await page.waitForFunction(() => !!document.querySelector('#solve_buttons [data-solve-button="retry"]'), null, { timeout: 5000 }).catch(() => {});
  check('出现「重试保存」按钮，排在最前', await page.locator('#solve_buttons [data-solve-button="retry"]').count() === 1 && await page.locator('#solve_buttons [data-solve-button]').first().getAttribute('data-solve-button') === 'retry');
  await shot('retry');
  blocked = false;
  await clearToasts();
  await page.locator('#solve_buttons [data-solve-button="retry"]').click();
  const t6 = await waitToast(/已保存|没有完成/u);
  await page.waitForTimeout(800);
  check('点「重试保存」后保存成功，按钮消失', /已保存/u.test(t6) && !(await page.evaluate(() => SOLVE.controller.getStatus().pendingCount)) && await page.locator('#solve_buttons [data-solve-button="retry"]').count() === 0 && (await state()).data.meta.weather === '雾', t6);
  await page.unroute('**/api/chats/save');

  phase = 'prefs';
  await openPanel();
  await $('[data-solve="settings-trigger"]').click(); await settle();
  await bar.getByRole('button', { name: /^快捷按钮/ }).or(bar.getByRole('tab', { name: /^快捷按钮/ })).first().click(); await settle();
  const rows = (await $('[data-solve="settings-section"][data-section="buttons"] [data-solve="pref"]').allInnerTexts()).length;
  check('设置里「快捷按钮」列出全部按钮', rows === 6, String(rows));
  await shot('settings-buttons');
  await bar.getByRole('switch', { name: '显示「重建」按钮' }).click(); await settle();
  await bar.getByRole('switch', { name: '显示「SOLVE 调试」按钮' }).click(); await settle(2500);
  const labels2 = (await btns.allInnerTexts()).map(s => s.trim());
  check('关掉「重建」、打开「SOLVE 调试」后按钮栏跟着变', !labels2.includes('重建') && labels2.includes('SOLVE 调试'), labels2.join('|'));
  check('页面无报错', !errors.length, errors.join(' | '));
} catch (e) { check('流程未中断', false, `${phase}: ${String(e).slice(0, 300)}`); await shot('fail').catch(() => {}); }
finally {
  if (avatar && !keep) await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) }); }, avatar).catch(() => {});
  await page.evaluate(() => localStorage.removeItem('solve.buttons.v1')).catch(() => {});
  await browser.close();
  console.log(`${results.filter(r => r.ok).length}/${results.length} 通过（${mobile ? 390 : 1440}）`);
}
