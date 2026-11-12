// 实机验收：左下角魔法棒里的 SOLVE 入口（设置 / 调试 / 结构制作），页面上不再有右下角的「◈ SOLVE」浮动按钮。
//
// 前提：本机测试酒馆（SillyTavern 1.19 + 酒馆助手）+ 假模型（卡密仓库 test/mock-llm/server.mjs，默认 8787）。
// 用法：npm run build && node scripts/live-menu.mjs [--mobile] [--shots=目录]
//   ST_URL（默认 http://127.0.0.1:8000/）、ST_ROOT（默认 /workspace/st-test/SillyTavern）、
//   MOCK_URL（默认 http://127.0.0.1:8787）、PLAYWRIGHT_PKG（默认 /workspace/tools/package.json）
// 会把 dist 复制成酒馆的 third-party/solve 扩展，创建一个随机命名的测试角色，结束时删除。
import { createRequire } from 'node:module';
import { cp, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/package.json');
const { chromium } = require('playwright');
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000/';
const ST_ROOT = process.env.ST_ROOT || '/workspace/st-test/SillyTavern';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:8787';
const mobile = process.argv.includes('--mobile');
const shots = process.argv.find(a => a.startsWith('--shots='))?.slice(8) || '/tmp/solve-live-menu';
const tag = mobile ? '390' : '1440';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };
const mock = async (path, body) => (await fetch(MOCK + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();

const target = resolve(ST_ROOT, 'public/scripts/extensions/third-party/solve');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve('dist'), target, { recursive: true });
await mkdir(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
const errors = [];
let phase = 'start';
page.on('pageerror', e => errors.push(`[${phase}] ` + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' && /SOLVE|solve|React|状态栏/u.test(m.text())) errors.push(`[${phase}] console: ` + m.text().slice(0, 300)); });
const shot = name => page.screenshot({ path: `${shots}/${tag}-${name}.png` });
const bar = page.locator('solve-statusbar');
const $ = sel => bar.locator(sel);
const settle = (ms = 500) => page.waitForTimeout(ms);
let avatar;

/** Opens the wand menu and clicks a SOLVE entry, as a player would. */
async function wand(label) {
  await page.click('#extensionsMenuButton');
  const item = page.locator('#extensionsMenu [data-solve-open]').filter({ hasText: label });
  await item.waitFor({ state: 'visible', timeout: 10000 });
  await item.click();
  await settle(800);
}
const panelWith = sel => $(`[data-k="panel"]:has(${sel})`);
async function closePanel(sel) { await panelWith(sel).locator('[data-k-part="close"]').first().click(); await settle(); }

try {
  phase = 'navigation';
  await mock('/__mock/reset', {});
  await page.goto(ST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#send_textarea', { timeout: 90000 });
  await page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
  await settle(1500);
  check('页面上没有右下角的「◈ SOLVE」浮动按钮', await page.locator('#solve-debug-launcher').count() === 0);

  phase = 'menu';
  await page.click('#extensionsMenuButton');
  await settle();
  const items = await page.locator('#extensionsMenu [data-solve-open]').allInnerTexts();
  check('魔法棒菜单里有 SOLVE 的三个入口', items.join('|') === 'SOLVE 设置|SOLVE 调试|SOLVE 结构制作', items.join('、'));
  await shot('wand-menu');
  await page.click('#extensionsMenuButton'); await settle();

  phase = 'unbound';
  await page.evaluate(async () => { const ctx = SillyTavern.getContext(); if (ctx.characterId !== undefined) await ctx.closeCurrentChat?.(); });
  await settle(800);
  if (!(await page.evaluate(() => SOLVE.controller))) {
    await wand('SOLVE 调试');
    check('没绑定时也能打开调试面板（显示原因）', await panelWith('[data-solve="debug-unbound"]').count() === 1);
    await shot('debug-unbound');
    await closePanel('[data-solve="debug-unbound"]');
  }

  phase = 'setup';
  avatar = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext(), headers = { ...ctx.getRequestHeaders() };
    delete headers['Content-Type'];
    const form = new FormData(), name = 'SOLVE入口验收_' + Math.random().toString(36).slice(2, 8);
    for (const [key, value] of Object.entries({ ch_name: name, first_mes: '夜雨中的王都。', description: '{{solve_SOP}}', personality: '', scenario: '', mes_example: '', talkativeness: '0.5', fav: 'false', tags: '' })) form.append(key, value);
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
  await page.waitForFunction(() => SOLVE.controller?.getStatus()?.ready, null, { timeout: 90000 });
  // One turn so the bar has data.
  await mock('/__mock/next', { content: '<content>\n雨还在下。\n</content>\n<solve_operate>\n' + JSON.stringify([{ $set: { 'places.capital': { name: '王都' }, 'meta.location': 'capital', 'meta.weather': '雨' } }]) + '\n</solve_operate>' });
  const head = await page.evaluate(() => SOLVE.controller.getStatus().headId);
  await page.fill('#send_textarea', '我走进酒馆。'); await page.click('#send_but');
  await page.waitForFunction(h => { const s = SOLVE.controller.getStatus(); return s.ready && !s.busy && s.headId !== h; }, head, { timeout: 90000 });
  await settle(800);
  check('状态栏横条出现', await $('[data-solve="launcher"]').count() > 0);
  const send = await page.evaluate(() => { const b = document.querySelector('#send_but').getBoundingClientRect(); const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return top?.closest('#send_but') ? 'ok' : (top?.tagName + '#' + top?.id); });
  check('发送按钮没有被 SOLVE 挡住', send === 'ok', send);
  await shot('bar');

  phase = 'settings';
  await wand('SOLVE 设置');
  check('「SOLVE 设置」打开状态栏的设置页', await panelWith('[data-solve="settings-section"]').count() === 1);
  await shot('settings');
  await closePanel('[data-solve="settings-section"]');
  check('关闭后设置面板消失', await panelWith('[data-solve="settings-section"]').count() === 0);

  phase = 'debug';
  await wand('SOLVE 调试');
  const debug = panelWith('[data-solve="debug"]');
  check('「SOLVE 调试」打开调试面板（已绑定）', await debug.count() === 1);
  const statusText = await $('[data-solve="debug-status"]').innerText().catch(() => '');
  check('调试面板显示当前结构与状态', /solve-official/u.test(statusText) && /已同步/u.test(statusText), statusText.replace(/\s+/gu, ' '));
  const gotoPage = async name => { const nav = debug.locator('[data-k="nav"] [data-k-part="item"]').filter({ hasText: name }); if (await nav.count()) await nav.first().click(); else await debug.locator('[role="tab"]').filter({ hasText: name }).first().click(); await settle(); };
  await gotoPage('历史');
  await shot('debug-history');
  await gotoPage('状态');
  check('调试面板「状态」页能看到数据', /王都|capital/u.test(await debug.innerText()));
  await shot('debug-state');
  await closePanel('[data-solve="debug"]');

  phase = 'builder';
  await wand('SOLVE 结构制作');
  const builder = panelWith('[data-solve="builder"]');
  check('「SOLVE 结构制作」打开结构制作', await builder.count() === 1);
  check('结构制作载入官方数据结构', /角色|characters/u.test(await builder.innerText()));
  await shot('builder');
  await closePanel('[data-solve="builder"]');
  check('关闭后结构制作消失', await panelWith('[data-solve="builder"]').count() === 0);
} catch (error) {
  check('流程未中断', false, `${phase}: ${String(error).slice(0, 400)}`);
  await shot('failure').catch(() => undefined);
} finally {
  check('页面无 SOLVE 相关报错', !errors.length, errors.slice(0, 5).join(' | '));
  if (avatar) {
    await page.evaluate(async a => {
      const ctx = SillyTavern.getContext();
      await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) });
    }, avatar).catch(() => undefined);
  }
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过（${tag}）；截图在 ${shots}`);
  process.exitCode = failed.length ? 1 : 0;
}
