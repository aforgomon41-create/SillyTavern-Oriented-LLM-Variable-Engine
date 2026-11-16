// 实机验收：打开没有 SOLVE 的聊天时「选择数据结构」弹窗、悬浮球、设置存档（新聊天沿用设置）、自带 MVU / 自带结构的卡。
//
// 前提：本机测试酒馆（SillyTavern 1.19 + 酒馆助手）+ 假模型（8787，本脚本不发消息）。
// 用法：npm run build && node scripts/live-gate.mjs [--mobile] [--keep] [--shots=目录]
// 会把 dist 复制成酒馆的 third-party/solve 扩展（只用原生扩展，不注册任何角色），建两个测试角色；结束时删除，
// 并还原酒馆扩展设置里 SOLVE 的设置存档。
import { createRequire } from 'node:module';
import { cp, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/package.json');
const { chromium } = require('playwright');
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000/';
const ST_ROOT = process.env.ST_ROOT || '/workspace/st-test/SillyTavern';
const mobile = process.argv.includes('--mobile'), keep = process.argv.includes('--keep');
const shots = process.argv.find(a => a.startsWith('--shots='))?.slice(8) || '/tmp/solve-live-gate';
const tag = mobile ? '390' : '1440';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };

const target = resolve(ST_ROOT, 'public/scripts/extensions/third-party/solve');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve(process.env.DIST || 'dist'), target, { recursive: true });
await mkdir(shots, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
// 这个脚本测的就是弹窗：去掉 gate-use 预加载（若有）设的「直接使用」
await context.addInitScript(() => { try { localStorage.removeItem('solve.gate.v1'); localStorage.removeItem('solve.ball.v1'); } catch { /* */ } });
const page = await context.newPage();
const errors = [];
let phase = 'start';
page.on('pageerror', e => errors.push(`[${phase}] ` + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' && /SOLVE|solve|React|状态栏/u.test(m.text())) errors.push(`[${phase}] console: ` + m.text().slice(0, 300)); });
const bar = page.locator('solve-statusbar');
const $ = sel => bar.locator(sel);
const dialog = $('[data-solve="gate"] [role="dialog"]');
const ball = $('button[data-solve="gate-ball"]');
const settle = (ms = 400) => page.waitForTimeout(ms);
const shot = name => page.screenshot({ path: `${shots}/${tag}-${name}.png` });
const status = () => page.evaluate(() => ({ s: SOLVE.sessions.getStatus(), ready: SOLVE.controller?.getStatus().ready }));
const toasts = async () => (await page.locator('#toast-container .toast').allInnerTexts()).join(' / ').replace(/\s+/g, ' ');
const clearToasts = () => page.evaluate(() => { try { toastr.clear(); document.querySelectorAll('#toast-container .toast').forEach(t => t.remove()); } catch { /* */ } });
const waitReady = () => page.waitForFunction(() => { const s = window.SOLVE?.controller?.getStatus(); return s?.ready && !s.busy; }, null, { timeout: 60000 });
const modules = () => page.evaluate(() => Object.fromEntries(SOLVE.controller.getModules().map(m => [m.name, m.enabled])));
const newChat = async () => {
  await page.evaluate(async () => { const { doNewChat } = await import('/script.js'); await doNewChat(); });
  await page.waitForFunction(() => window.SOLVE?.sessions.getStatus().phase !== 'loading', null, { timeout: 30000 });
  await settle(800);
};
async function createCharacter(name, firstMes) {
  return page.evaluate(async ([name, first]) => {
    const ctx = SillyTavern.getContext(), headers = { ...ctx.getRequestHeaders() };
    delete headers['Content-Type'];
    const form = new FormData();
    for (const [key, value] of Object.entries({ ch_name: name, first_mes: first, description: '测试角色', personality: '', scenario: '', mes_example: '', talkativeness: '0.5', fav: 'false', tags: '' })) form.append(key, value);
    const response = await fetch('/api/characters/create', { method: 'POST', headers, body: form });
    if (!response.ok) throw new Error('创建测试角色失败：' + response.status);
    return (await response.text()).trim();
  }, [name, firstMes]);
}
const select = avatar => page.evaluate(async a => { const ctx = SillyTavern.getContext(); await ctx.getCharacters(); await ctx.selectCharacterById(ctx.characters.findIndex(c => c.avatar === a)); }, avatar);
const closePanel = async () => { if (await $('[data-k="panel"]').count()) { await $('[data-k="panel"] [data-k-part="close"]').first().click(); await settle(); } };
async function openSettings(section) {
  if (!await $('[data-k="panel"]').count()) {
    await $('[data-solve="launcher"] [data-solve-part="open"], [data-solve="launcher"] button').first().click();
    await $('[data-k="panel"]').waitFor({ timeout: 10000 }); await settle();
  }
  if (!await $('[data-solve="settings"]').count()) { await $('[data-solve="settings-trigger"]').click(); await settle(); }
  await bar.getByRole('button', { name: new RegExp('^' + section) }).or(bar.getByRole('tab', { name: new RegExp('^' + section) })).first().click(); await settle(600);
}
let avatars = [], savedStore;

try {
  phase = 'navigation';
  await page.goto(ST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#send_textarea', { timeout: 90000 });
  await page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
  // 设置存档在酒馆扩展设置里：先记下，结束时还原
  savedStore = await page.evaluate(() => { const ctx = SillyTavern.getContext(), old = ctx.extensionSettings.solve; delete ctx.extensionSettings.solve; return old === undefined ? null : JSON.stringify(old); });

  phase = 'ask';
  const plain = await createCharacter('SOLVE选择验收_' + Math.random().toString(36).slice(2, 7), '夜雨中的王都，醉橡木酒馆的门被推开了。');
  avatars.push(plain);
  await select(plain);
  await dialog.waitFor({ timeout: 30000 }).catch(() => {});
  const title = await dialog.locator('[data-solve-part="title"]').innerText().catch(() => '');
  check('打开没用过 SOLVE 的聊天：弹窗询问数据结构', /这个聊天要用哪个数据结构/u.test(title), title);
  const choices = await dialog.locator('[data-solve-part="choice"]').allInnerTexts();
  check('弹窗列出官方数据结构（没有任何角色注册也可选）', choices.some(c => /SOLVE 官方数据结构/u.test(c)), choices.join(' | ').replace(/\s+/g, ' '));
  const presetOptions = await dialog.locator('select option').allInnerTexts();
  check('第一次：设置只有「结构默认」', presetOptions.length === 1 && /结构默认/u.test(presetOptions[0]), presetOptions.join(' | '));
  await shot('ask');
  await dialog.getByRole('button', { name: '稍后', exact: true }).click(); await settle();
  check('点「稍后」：弹窗关闭，右下角出现悬浮球', await dialog.count() === 0 && await ball.isVisible(), await ball.getAttribute('aria-label'));
  await shot('ball');
  await ball.click(); await settle();
  check('点悬浮球：重新打开选择弹窗', await dialog.isVisible());
  await dialog.getByRole('button', { name: '开始使用' }).click();
  await waitReady(); await settle(800);
  const st1 = await status();
  check('选「开始使用」：聊天绑定官方结构，状态栏出现，悬浮球消失', st1.ready && st1.s.phase === 'ready' && await $('[data-solve="launcher"]').count() > 0 && await ball.count() === 0, st1.s.phase);
  check('提示已开始使用', /开始用「SOLVE 官方数据结构」/u.test(await toasts()), await toasts());

  phase = 'presets';
  // 一个关着的顶层模块（没有上级、不在互斥组里，设置页直接有开关）
  const name = await page.evaluate(() => SOLVE.controller.getModules().find(m => !m.enabled && !m.parent && !m.exclusive && !/^image/u.test(m.name))?.name);
  await openSettings('模块');
  const label = await page.evaluate(n => SOLVE.controller.getModules().find(m => m.name === n)?.label ?? n, name);
  await bar.getByRole('switch', { name: label, exact: true }).first().click();
  await page.waitForFunction(n => SOLVE.controller.getModules().find(m => m.name === n)?.enabled === true, name, { timeout: 30000 });
  await settle(600);
  const last1 = await page.evaluate(() => SillyTavern.getContext().extensionSettings.solve?.last?.['solve-official']?.modules);
  check(`在设置里打开「${label}」：自动记为「上次的设置」`, last1?.[name] === true);
  await openSettings('设置存档');
  await bar.getByLabel('这套设置的名字').fill('测试套 · 开着' + label);
  await bar.getByRole('button', { name: '保存', exact: true }).click(); await settle(600);
  const saved = await page.evaluate(() => SillyTavern.getContext().extensionSettings.solve?.presets?.['solve-official'] ?? []);
  check('设置存档：把这个聊天的设置存成一套（存进酒馆扩展设置）', saved.length === 1 && saved[0].modules[name] === true, saved.map(p => p.name).join(','));
  await shot('presets');
  // 再关掉：「上次的设置」变成关着，存好的那套仍开着
  await openSettings('模块');
  await bar.getByRole('switch', { name: label, exact: true }).first().click();
  await page.waitForFunction(n => SOLVE.controller.getModules().find(m => m.name === n)?.enabled === false, name, { timeout: 30000 });
  await settle(600);
  await closePanel();

  phase = 'new-chat';
  await clearToasts();
  await newChat();
  await dialog.waitFor({ timeout: 30000 }).catch(() => {});
  const opts2 = await dialog.locator('select option').allInnerTexts();
  const initial2 = await dialog.locator('select').inputValue();
  check('新聊天：弹窗再次询问，设置默认选「上次的设置」，并列出存好的那套', await dialog.isVisible() && initial2 === 'last' && opts2.some(o => o.startsWith('测试套')), `${initial2} · ${opts2.join(' | ')}`);
  await shot('new-chat');
  await dialog.locator('select').selectOption({ label: opts2.find(o => o.startsWith('测试套')) });
  await dialog.getByRole('button', { name: '开始使用' }).click();
  await waitReady(); await page.waitForFunction(n => SOLVE.controller.getModules().find(m => m.name === n)?.enabled === true, name, { timeout: 30000 }).catch(() => {});
  check(`选存好的那套开始：新聊天里「${label}」是开着的（设置没有重置）`, (await modules())[name] === true);

  await newChat();
  await dialog.waitFor({ timeout: 30000 }).catch(() => {});
  const initial3 = await dialog.locator('select').inputValue();
  check('下一个新聊天：默认选上次选的那套', initial3 === saved[0].id, initial3);
  await dialog.locator('select').selectOption('last');
  await dialog.getByRole('button', { name: '开始使用' }).click();
  await waitReady(); await settle(800);
  check(`选「上次的设置」：「${label}」是关着的`, (await modules())[name] === false);

  phase = 'off';
  await newChat();
  await dialog.waitFor({ timeout: 30000 }).catch(() => {});
  await dialog.getByRole('button', { name: '这个聊天不用 SOLVE' }).click(); await settle(1500);
  const off = await page.evaluate(() => ({ phase: SOLVE.sessions.getStatus().phase, flag: SillyTavern.getContext().chatMetadata.solve_off }));
  check('「这个聊天不用 SOLVE」：记在聊天里，悬浮球变成灰色', off.phase === 'off' && off.flag === true && await ball.getAttribute('data-tone') === 'off', JSON.stringify(off));
  await shot('off');
  const offChat = await page.evaluate(() => SillyTavern.getContext().chatId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#send_textarea', { timeout: 90000 });
  await page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
  // 重新打开这个角色（最近的聊天就是刚才那个）
  await select(plain);
  await page.waitForFunction(id => SillyTavern.getContext().chatId === id && window.SOLVE?.sessions?.getStatus().phase === 'off', offChat, { timeout: 60000 }).catch(() => {});
  await settle(1500);
  check('刷新后：这个聊天不再弹窗，悬浮球还在', await dialog.count() === 0 && await ball.isVisible() && (await status()).s.phase === 'off');
  // 没开 SOLVE 的聊天里，正文中的操作块（例如别处复制来的）照样隐藏；流式输出到一半的块也隐藏
  const hidden = await page.evaluate(() => {
    const ctx = SillyTavern.getContext();
    const full = ctx.messageFormatting('米拉点点头。\n<solve_operate>\n[{"$set":{"meta.weather":"雾"}}]\n</solve_operate>', 'x', false, false, 0);
    const streaming = ctx.messageFormatting('米拉点点头。\n<solve_operate>\n[{"$set":{"meta.wea', 'x', false, false, 0);
    const cut = ctx.messageFormatting('米拉点点头。\n<solve_op', 'x', false, false, 0);
    return { full, streaming, cut };
  });
  check('正文显示时隐藏操作块（完整的、流式写到一半的、标签写到一半的；这个聊天没开 SOLVE 也隐藏）',
    Object.values(hidden).every(h => /米拉点点头/u.test(h) && !/solve_|meta\.wea|\$set/u.test(h)), JSON.stringify(hidden).slice(0, 200));
  await ball.click(); await settle();
  check('灰色悬浮球打开后可以重新开启', await dialog.isVisible() && await dialog.getByRole('button', { name: '开始使用' }).isVisible());
  await dialog.getByRole('button', { name: '稍后', exact: true }).click(); await settle();
  // 魔法棒菜单的「SOLVE 设置」在没有状态栏时也打开选择弹窗
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('solve:open', { detail: 'settings' }))); await settle();
  check('没有状态栏时点「SOLVE 设置」：打开选择弹窗', await dialog.isVisible());
  await dialog.getByRole('button', { name: '稍后', exact: true }).click(); await settle();

  phase = 'mvu';
  const mvu = await createCharacter('SOLVE选择验收MVU_' + Math.random().toString(36).slice(2, 7), '<initvar>\n角色:\n  好感度: 0\n</initvar>\n你来到了学院。');
  avatars.push(mvu);
  await select(mvu);
  await dialog.waitFor({ timeout: 30000 }).catch(() => {});
  const warn = await dialog.locator('[data-solve-part="warn"]').innerText().catch(() => '');
  check('自带 MVU 的卡：照样弹窗询问（不静默关闭），写明会同时更新和识别依据', /自带 MVU 变量/u.test(warn) && /<initvar>/u.test(warn) && (await status()).s.phase === 'choose', warn.replace(/\s+/g, ' ').slice(0, 120));
  await shot('mvu');

  phase = 'own';
  await dialog.getByRole('button', { name: '稍后', exact: true }).click(); await settle();
  await page.evaluate(async a => {
    const own = { ...SOLVE.officialStructure, id: 'solve-gate-test', label: '验收用自带结构', version: '0.1' };
    await SOLVE.register(SOLVE.compileStructure(own), { characters: [a] });
  }, mvu);
  await newChat();
  await dialog.waitFor({ timeout: 30000 }).catch(() => {});
  const ownChoices = await dialog.locator('[data-solve-part="choice"]').allInnerTexts();
  const checked = await dialog.locator('[data-solve-part="choice"][data-checked]').innerText().catch(() => '');
  check('卡自带 SOLVE 结构：排第一、标「这张卡自带」并已选好，官方结构也可选', /验收用自带结构/u.test(ownChoices[0] ?? '') && /这张卡自带/u.test(checked) && ownChoices.some(c => /官方/u.test(c)), ownChoices.join(' | ').replace(/\s+/g, ' '));
  await dialog.getByRole('button', { name: '开始使用' }).click();
  await waitReady(); await settle(600);
  check('用卡自带的结构开始', await page.evaluate(() => SOLVE.controller.core.definition.id) === 'solve-gate-test');

  check('页面没有 SOLVE 相关报错', errors.length === 0, errors.join(' | '));
} catch (error) {
  check(`流程中断（${phase}）`, false, String(error?.stack ?? error).slice(0, 600));
  await shot('crash').catch(() => {});
} finally {
  await page.evaluate(store => { const ctx = SillyTavern.getContext(); if (store === null) delete ctx.extensionSettings.solve; else ctx.extensionSettings.solve = JSON.parse(store); ctx.saveSettingsDebounced(); }, savedStore ?? null).catch(() => {});
  if (!keep) for (const a of avatars) await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) }); }, a).catch(() => {});
  await page.waitForTimeout(1500);
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${tag}: ${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}
