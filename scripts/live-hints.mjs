// 实机验收：数据结构说明。发给模型的请求里有「数据结构」；结构制作 › 提示词页的字段说明表能改说明，右边预览跟着变；
// 字段设置里分开「给模型的说明」和「给玩家的说明」；调试面板 › 提示词能看到数据结构。
//
// 前提：本机测试酒馆（SillyTavern 1.19 + 酒馆助手）+ 假模型（卡密仓库 test/mock-llm/server.mjs，默认 8787）。
// 用法：npm run build && node scripts/live-hints.mjs [--mobile] [--shots=目录]
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
const shots = process.argv.find(a => a.startsWith('--shots='))?.slice(8) || '/tmp/solve-live-hints';
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


const overflow = loc => loc.evaluate(el => { const bad = []; for (const n of el.querySelectorAll('*')) { const r = n.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 1 || r.left < -1)) bad.push(n.tagName + '.' + (n.getAttribute('data-solve-part') || n.getAttribute('data-solve') || '')); } return bad.slice(0, 5); });
async function goPage(panel, name) {
  const nav = panel.locator('[data-k="nav"] [data-k-part="item"]').filter({ hasText: name });
  if (await nav.count()) await nav.first().click(); else await panel.locator('[role="tab"]').filter({ hasText: name }).first().click();
  await settle(800);
}

try {
  phase = 'setup';
  await mock('/__mock/reset', {});
  await page.goto(ST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#send_textarea', { timeout: 90000 });
  await page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
  await page.evaluate(() => localStorage.removeItem('solve.update.v1'));
  avatar = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext(), headers = { ...ctx.getRequestHeaders() };
    delete headers['Content-Type'];
    const form = new FormData(), name = 'SOLVE数据结构验收_' + Math.random().toString(36).slice(2, 8);
    for (const [key, value] of Object.entries({ ch_name: name, first_mes: '夜雨中的王都。', description: '一位在王都开酒馆的老板娘。', personality: '', scenario: '', mes_example: '', talkativeness: '0.5', fav: 'false', tags: '' })) form.append(key, value);
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

  phase = 'first-turn';
  // 第一轮：变量还是空的，请求里已经有完整的数据结构。模型按它先建后引用，全部成功。
  await mock('/__mock/next', { content: '<content>\n雨还在下。\n</content>\n<solve_operate>\n' + JSON.stringify([
    { $createEntity: { 'places.tavern': { name: '橡木酒馆' }, 'characters.me': { name: '旅人', role: '用户角色', intro: '刚到王都的旅人' }, 'characters.rosa': { name: '罗莎', role: '核心角色', intro: '酒馆老板娘', appearance: '红发，系着围裙' } } },
    { $set: { 'meta.location': 'tavern', 'meta.present': ['me', 'rosa'], 'meta.weather': '雨' } },
  ]) + '\n</solve_operate>' });
  const head = await page.evaluate(() => SOLVE.controller.getStatus().headId);
  await page.fill('#send_textarea', '我走进酒馆。'); await page.click('#send_but');
  await page.waitForFunction(h => { const s = SOLVE.controller.getStatus(); return s.ready && !s.busy && s.headId !== h; }, head, { timeout: 90000 });
  await settle(800);
  const requests = await mock('/__mock/requests');
  const text = JSON.stringify((requests.requests ?? requests).at(-1) ?? {});
  check('第一轮请求里有数据结构', text.includes('## 数据结构') && text.includes('characters（角色）.<ID>'), `${text.length} 字`);
  check('数据结构里有字段说明', text.includes('intro（简介）: 文字 — 一两句'));
  const feedback = await page.evaluate(() => SOLVE.controller.inspectCommit().then(c => c.commit.feedback));
  const st = await page.evaluate(() => SOLVE.controller.getState().data);
  check('按数据结构先建后引用：全部成功', !feedback.some(f => f.level === 'L3') && st.meta.location === 'tavern' && st.meta.present.join() === 'me,rosa', JSON.stringify(feedback).slice(0, 200));
  const report = await page.evaluate(() => SOLVE.injection());
  const item = report?.items?.find(i => i.key === 'schema');
  check('SOLVE.injection() 里有「数据结构」一项', item?.on && item.chars > 1000, item ? `${item.label} ${item.chars} 字 @${item.where}` : '无');

  phase = 'debug';
  await wand('SOLVE 调试');
  const debug = panelWith('[data-solve="debug"]');
  await goPage(debug, '提示词');
  const seg = debug.getByRole('radio', { name: '数据结构' }).or(debug.locator('button').filter({ hasText: /^数据结构$/u })).first();
  await seg.click(); await settle();
  check('调试面板 › 提示词 › 数据结构', /## 数据结构/u.test(await debug.innerText()));
  await shot('debug-schema');
  await closePanel('[data-solve="debug"]');

  phase = 'builder';
  await wand('SOLVE 结构制作');
  const builder = panelWith('[data-solve="builder"]');
  await goPage(builder, '提示词');
  const hints = builder.locator('[data-solve="builder-hints"]');
  check('提示词页有字段说明表', await hints.count() === 1);
  const groups = await hints.locator('h5').allInnerTexts();
  check('字段说明按模块分组（通用 / 驱动力 / 社交 …）', groups.some(g => g.startsWith('通用')) && groups.some(g => g.startsWith('驱动力')) && groups.some(g => g.startsWith('社交')), groups.map(g => g.split('\n')[0]).join('、'));
  const live = builder.locator('[data-solve="builder-live"]');
  // 手机上编辑与预览是两个页签。
  const toggle = async v => { const r = builder.getByRole('radio', { name: v }); if (await r.count()) { await r.first().click(); await settle(); } };
  const preview = async () => { await toggle('模型看到的'); const t = await live.innerText(); await toggle('编辑'); return t; };
  check('预览默认是数据结构', /## 数据结构/u.test(await preview()));
  await shot('builder-hints');
  const age = hints.getByRole('textbox', { name: '角色 › 年龄 给模型的说明' });
  await age.scrollIntoViewIfNeeded();
  await age.fill('外表看起来的年龄');
  await age.press('Tab'); await settle(1200);
  check('改说明后预览跟着变', /age（年龄）: 文字 — 外表看起来的年龄/u.test(await preview()));
  const before = await hints.locator('[data-solve-part="row"]').count();
  await hints.getByLabel('只看没写的').check(); await settle();
  const after = await hints.locator('[data-solve-part="row"]').count();
  check('「只看没写的」过滤掉已写说明的字段', after > 0 && after < before, `${before} → ${after}`);
  await hints.getByLabel('只看没写的').uncheck(); await settle();
  await hints.getByLabel('搜索字段说明').fill('好感'); await settle();
  check('搜索字段说明', await hints.locator('[data-solve-part="row"]').count() === 1);
  await hints.getByLabel('搜索字段说明').fill(''); await settle();
  const bad = await overflow(builder.locator('[data-solve="builder-page"]'));
  check('字段说明表没有横向溢出', !bad.length, bad.join(' '));
  await shot('builder-hints-edited');

  phase = 'inspector';
  await goPage(builder, '字段');
  const search = builder.getByLabel('搜索字段');
  if (await search.count()) {
    await search.first().fill('年龄'); await search.first().press('Enter'); await settle(1200);
    const insp = builder.locator('[data-solve="builder-inspector"]');
    const model = insp.getByRole('textbox', { name: '给模型的说明' }), player = insp.getByRole('textbox', { name: '给玩家的说明' });
    check('字段设置里分开「给模型的说明」和「给玩家的说明」', await model.count() === 1 && await player.count() === 1);
    check('字段设置里看到刚写的说明', (await model.inputValue().catch(() => '')) === '外表看起来的年龄');
    await shot('builder-inspector');
  } else check('字段页有搜索框', false);
  await closePanel('[data-solve="builder"]');
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
