// 实机验收：地图（多个互不相通的世界、连线不交叉）。由 live-statusbar 的准备流程改写；用法同 live-statusbar。
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
const shots = process.argv.find(a => a.startsWith('--shots='))?.slice(8) || '/tmp/solve-live-statusbar';
// --skin=solve：即使页面上有卡密预设，也让状态栏用 SOLVE 自带皮肤（玩家在「显示」里的同名开关）
const forceSolve = process.argv.includes('--skin=solve');
const tag = (mobile ? '390' : '1440') + '-' + (process.env.TAG || 'x');
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



  phase = 'worlds';
  const P = (name, kind, parent, links, desc) => ({ name, kind, parent, links, desc, discovered: true });
  // 无限恐怖：主神空间 + 两个副本世界，彼此之间没有路；副本里地点互相连成网
  const places = {
    'places.god_space': P('主神空间', '区域', null, [], '白色的大厅，一切从这里开始'),
    'places.hall': P('主神大厅', '地点', 'god_space', ['rooms'], '光球悬在中央'),
    'places.rooms': P('休息室', '地点', 'god_space', ['hall'], '每人一间'),
    'places.raccoon': P('浣熊市', '区域', null, [], '生化危机'),
    'places.station': P('警察局', '地点', 'raccoon', ['street', 'lab', 'sewer'], ''),
    'places.street': P('主街', '地点', 'raccoon', ['station', 'clinic', 'mall'], ''),
    'places.lab': P('地下实验室', '地点', 'raccoon', ['station', 'sewer', 'clinic'], ''),
    'places.sewer': P('下水道', '地点', 'raccoon', ['station', 'lab', 'mall'], ''),
    'places.clinic': P('诊所', '地点', 'raccoon', ['street', 'lab'], ''),
    'places.mall': P('商场', '地点', 'raccoon', ['street', 'sewer'], ''),
    'places.grudge': P('咒怨之屋', '区域', null, [], '咒怨'),
    'places.g1': P('玄关', '地点', 'grudge', ['g2'], ''),
    'places.g2': P('二楼阁楼', '地点', 'grudge', ['g1'], ''),
    'places.dream': P('梦境', '地点', null, [], '只在梦里到过'),
  };
  await page.evaluate(ops => SOLVE.controller.submit(ops, { actionId: 'worlds' }), [{ $createEntity: places }, { $set: { 'meta.location': 'lab' } }]);
  const fb = await page.evaluate(() => SOLVE.controller.getContextPreview().feedback.filter(f => f.level === 'L3').map(f => f.code + ' ' + f.path));
  check('写入多个世界的地点', !fb.length, JSON.stringify(fb));
  await settle(600);
  await openPanel();
  await goTab('地图');
  await settle(800);
  const worlds = () => $('[data-solve="map"] [data-solve-part="worlds"] button').allInnerTexts();
  const ws = (await worlds()).map(s => s.replace(/\s+/g, ' ').trim());
  check('彼此不通的世界分成几张地图，当前所在的排第一', ws.length >= 4 && /浣熊市/u.test(ws[0]) && ws.some(w => /主神空间/u.test(w)) && ws.some(w => /咒怨之屋/u.test(w)) && ws.some(w => /梦境|零散/u.test(w)) && /全部/u.test(ws.at(-1)), ws.join(' | '));
  const names = () => $('[data-solve="map"] [data-solve-part="node"] [data-solve-part="name"]').allTextContents();
  const shownNames = await names();
  check('默认显示当前所在的世界', shownNames.includes('地下实验室') && !shownNames.includes('主神大厅'), shownNames.join(','));
  const crossings = () => page.evaluate(() => {
    const svg = document.querySelector('solve-statusbar').shadowRoot.querySelector('[data-solve="map"] svg');
    const ls = [...svg.querySelectorAll('line[data-solve-part="edge"]')].map(l => ['x1', 'y1', 'x2', 'y2'].map(k => +l.getAttribute(k)));
    const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const same = (a, b) => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
    let n = 0;
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
      const [a, b] = [[ls[i][0], ls[i][1]], [ls[i][2], ls[i][3]]], [c, d] = [[ls[j][0], ls[j][1]], [ls[j][2], ls[j][3]]];
      if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue;
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) n++;
    }
    return { lines: ls.length, crossings: n };
  });
  const c1 = await crossings();
  check('浣熊市 6 个地点 8 条路：连线不交叉', c1.lines === 8 && c1.crossings === 0, JSON.stringify(c1));
  await shot('map-world');
  const pick = async re => { const b = $('[data-solve="map"] [data-solve-part="worlds"] button').filter({ hasText: re }); await b.first().click(); await settle(700); };
  await pick(/主神空间/u);
  const god = await names();
  check('切到主神空间：只显示主神空间的地点', god.includes('主神大厅') && god.includes('休息室') && !god.includes('地下实验室'), god.join(','));
  check('不在当前世界时提示没有路相连', (await $('[data-solve="map"] [data-solve-part="elsewhere"]').count()) === 1);
  await shot('map-god');
  await $('[data-solve="map"] [data-solve-part="node"]').filter({ hasText: '主神大厅' }).first().click(); await settle(500);
  const card = (await $('[data-solve="map"] [data-k="card"], [data-solve="map"] [data-k-part="title"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('点别的世界里的地点能看详情', /主神大厅/u.test(card), card.slice(0, 40));
  await pick(/全部/u);
  const all = await names();
  check('「全部」显示所有地点', all.includes('主神大厅') && all.includes('地下实验室') && all.includes('玄关') && all.includes('梦境'), String(all.length));
  const c2 = await crossings();
  check('全部视图：连线不交叉', c2.crossings === 0, JSON.stringify(c2));
  await $('[data-solve="map"] svg').first().click({ position: { x: 8, y: 8 } }); await settle(400);
  await shot('map-all');
  // 移动到另一个世界：地图跟着切过去
  await page.evaluate(() => SOLVE.controller.submit([{ $set: { 'meta.location': 'g1' } }], { actionId: 'move' }));
  await settle(900);
  const after = (await worlds()).map(s => s.replace(/\s+/g, ' ').trim());
  const g = await names();
  check('当前位置换到咒怨之屋：地图跟着切过去', /咒怨之屋/u.test(after[0]) && g.includes('玄关') && !g.includes('主神大厅'), after[0] + ' / ' + g.join(','));
  // 只有一个世界时不显示世界切换
  check('页面无报错', !errors.length, errors.join(' | '));
} catch (e) { check('流程未中断', false, `${phase}: ${String(e).slice(0, 300)}`); }
finally {
  if (avatar) await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) }); }, avatar).catch(() => {});
  await browser.close();
  console.log(`${results.filter(r => r.ok).length}/${results.length} 通过（${mobile ? 390 : 1440}）`);
}
