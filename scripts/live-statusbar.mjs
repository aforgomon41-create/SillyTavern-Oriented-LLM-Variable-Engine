// 实机验收：酒馆里的状态栏（官方结构的声明式布局、玩家交互、撤销、旁白进入下一轮提示词、设置页、生成时锁定）。
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
const tag = (mobile ? '390' : '1440') + (forceSolve ? '-solve' : '');
const example = JSON.parse(await readFile(process.env.EXAMPLE_STATE || '/tmp/solve-example-state.json', 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };
const mock = async (path, body) => (await fetch(MOCK + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
const op = (ops, prose = '雨还在下。') => `<content>\n${prose}\n</content>\n<solve_operate>\n${JSON.stringify(ops)}\n</solve_operate>`;

const target = resolve(ST_ROOT, 'public/scripts/extensions/third-party/solve');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve('dist'), target, { recursive: true });
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
  await settle(800);
  const launcher = $('[data-solve="launcher"]');
  check('有数据时显示概览横条', await launcher.count() > 0 && await launcher.first().isVisible());
  const skin = await page.evaluate(() => document.querySelector('solve-statusbar').shadowRoot.querySelector('[data-k-surface]').getAttribute('data-solve-skin'));
  const hasKami = await page.evaluate(() => !!window.KamiRuntimeNext);
  check('套用的皮肤', skin === (forceSolve || !hasKami ? 'solve' : 'kami'), `${skin}（页面${hasKami ? '有' : '没有'}卡密预设）`);
  await shot('bar');

  phase = 'panel';
  await openPanel();
  check('点开横条展开面板', await $('[data-k="panel"]').count() === 1);
  await shot('panel-sheet');
  for (const tab of ['社交', '地图', '设定']) { await goTab(tab); await shot('tab-' + tab); }
  await goTab('角色');

  phase = 'interact';
  const pages = $('[data-solve="sheet"] [role="tab"], [data-solve="pages"] button');
  await pages.filter({ hasText: '背包' }).first().click(); await settle();
  await $('[data-solve="slot"]').filter({ hasText: '治疗药剂' }).first().click(); await settle();
  const before = (await state()).data.characters.erin.items.healing_draught?.count;
  await $('[data-solve="actions"] button').filter({ hasText: '使用' }).first().click();
  await $('[data-solve="toast"]').waitFor({ timeout: 15000 });
  await settle(600);
  const after = (await state()).data.characters.erin.items.healing_draught?.count ?? 0;
  const toast = (await $('[data-solve="toast"]').innerText()).replace(/\s+/g, ' ');
  check('点「使用」后物品数量变化', after === before - 1, `${before} → ${after}；提示：${toast}`);
  const mes = await page.evaluate(() => { const c = SillyTavern.getContext().chat; return c[c.length - 1].mes; });
  check('玩家动作写进回复正文的玩家操作块（含旁白）', /<solve_mutual_operate>[\s\S]*narrate[\s\S]*<\/solve_mutual_operate>/u.test(mes));
  check('面板底部列出下一轮要告诉模型的事', (await $('[data-solve="pending"]').count()) > 0, (await $('[data-solve="pending"]').allInnerTexts()).join(' ').replace(/\s+/g, ' ').slice(0, 80));
  await shot('used');

  await $('[data-solve="toast"] [data-solve-part="undo"]').click();
  await settle(1200);
  const undone = (await state()).data.characters.erin.items.healing_draught?.count;
  check('撤销后数量恢复', undone === before, `${undone}`);
  const mes2 = await page.evaluate(() => { const c = SillyTavern.getContext().chat; return c[c.length - 1].mes; });
  check('撤销后正文里只剩之前的玩家操作', !/narrate/u.test(mes2) || !mes2.includes('治疗药剂'));

  // 再用一次，发下一轮：发给模型的请求里要有这句旁白，不能有操作块
  await $('[data-solve="slot"]').filter({ hasText: '治疗药剂' }).first().click(); await settle();
  await $('[data-solve="actions"] button').filter({ hasText: '使用' }).first().click();
  await settle(1200);
  const narration = (await $('[data-solve="pending"]').allInnerTexts()).join(' ');
  phase = 'next-turn';
  await send('我把空瓶放回桌上。', op([{ $set: { 'meta.mood': '日常' } }], '米拉看了你一眼。'));
  const prompt = await lastRequestText();
  check('下一轮请求里带有玩家在状态栏中的操作', prompt.includes('玩家在状态栏中'), (prompt.match(/玩家在状态栏中[^"\\]{0,40}/u) ?? [''])[0]);
  // The SOP in the card describes the block format, so look for the player's block and its JSON instead.
  check('请求里没有玩家操作块与动作数据', !prompt.includes('solve_mutual_operate>') && !prompt.includes('narrate') && !prompt.includes('actionId'));
  void narration;

  phase = 'settings';
  await openPanel();
  await $('[data-solve="settings-trigger"]').click(); await settle();
  await shot('settings-modules');
  const factionsTab = async () => $('[data-k="nav"] [data-k-part="item"], [data-k="tabs"] [role="tab"]').filter({ hasText: '势力' }).count();
  await bar.getByRole('switch', { name: '势力' }).click();
  await settle(1200);
  const mods = await page.evaluate(() => SOLVE.controller.getModules().find(m => m.name === 'factions')?.enabled);
  check('设置页关闭「势力」模块（作为玩家动作保存）', mods === false);
  await bar.getByRole('button', { name: /^清单上限/ }).or(bar.getByRole('tab', { name: /^清单上限/ })).first().click(); await settle();
  await bar.getByRole('button', { name: '身份：上限 加 1' }).click();
  await bar.getByRole('button', { name: '保存', exact: true }).click(); await settle(1200);
  const limits = await page.evaluate(() => SOLVE.controller.getSettings().lists['characters.*.tags']);
  check('清单上限保存到聊天', limits?.max === 11, JSON.stringify(limits));
  await shot('settings-lists');
  await $('[data-solve="settings-trigger"]').click(); await settle();
  check('关闭的模块页签消失', await factionsTab() === 0);

  phase = 'lock';
  // 模型回复期间锁定：假模型慢一点回，回复中途点一个交互
  if (await $('[data-k="panel"]').count()) { await $('[data-k="panel"] [data-k-part="close"]').first().click(); await settle(); }
  await mock('/__mock/next', { content: op([{ $set: { 'meta.mood': '日常' } }], '……'), delayMs: 250 });
  const headBefore = (await status()).headId;
  await page.fill('#send_textarea', '等一下。');
  await page.click('#send_but');
  await page.waitForFunction(() => window.SOLVE.controller?.getStatus()?.generating, null, { timeout: 10000 }).catch(() => undefined);
  const lockedNow = await page.evaluate(() => window.SOLVE.controller?.getStatus()?.generating);
  check('模型回复期间状态为生成中（交互被锁定）', !!lockedNow);
  await waitReady(headBefore);
  await settle(500);
} catch (error) {
  check('流程未中断', false, `${phase}: ${String(error).slice(0, 400)}`);
  console.log('launcher', await page.evaluate(() => {
    const l = document.querySelector('solve-statusbar')?.shadowRoot?.querySelector('[data-solve="launcher"]');
    if (!l) return 'none';
    const r = l.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const chain = [];
    for (let n = l.parentElement ?? l.getRootNode().host; n; n = n.parentElement ?? (n.getRootNode() !== document ? n.getRootNode().host : null)) {
      const cs = getComputedStyle(n), b = n.getBoundingClientRect();
      chain.push(`${n.tagName}${n.getAttribute('data-k-surface') ? '[surface]' : ''} h=${Math.round(b.height)} y=${Math.round(b.y)} pos=${cs.position} contain=${cs.contain} ct=${cs.containerType} tf=${cs.transform} filter=${cs.filter}`);
      if (chain.length > 6) break;
    }
    return { chain, rect: [r.x, r.y, r.width, r.height].map(Math.round), on: top?.tagName + '#' + top?.id + '.' + String(top?.className).slice(0, 40), html: l.outerHTML.slice(0, 300), css: getComputedStyle(l).cssText?.slice(0, 10), pos: getComputedStyle(l).position, vis: getComputedStyle(l).visibility, op: getComputedStyle(l).opacity };
  }).catch(e => String(e)));
  await shot('failure').catch(() => undefined);
} finally {
  check('页面无 SOLVE 相关报错', !errors.length, errors.slice(0, 5).join(' | '));
  if (!keep && avatar) {
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
