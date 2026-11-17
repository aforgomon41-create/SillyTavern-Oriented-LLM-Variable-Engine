// 实机验收：音乐（默认曲库外链、合集、标签搜索）与两行的悬浮横条。
//   · 默认曲库：从清单读出曲目，按场景情绪自动播放（真的在播放、音频地址可下载），情绪变了换成带那个标签的曲子
//   · 一首放完换同情绪的下一首；「换一首」
//   · 添加曲目：打标签、同时放进新合集；合集作为播放来源；批量把默认曲目加入 / 移出合集；删除合集不删曲目
//   · 按名称和 #标签搜索、点标签筛选
//   · 悬浮横条两行：上面时间（完整）、天气、情绪；下面地点、人物；手机上不压住输入框上方的按钮
// 前提：本机测试酒馆 + 假模型；需要预加载 gate-use。用法：npm run build && [MANIFEST_URL=…] node scripts/live-music.mjs [--mobile]
import { createRequire } from 'node:module';
import { cp, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/package.json');
const { chromium } = require('playwright');
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000/';
const ST_ROOT = process.env.ST_ROOT || '/workspace/st-test/SillyTavern';
const MANIFEST = process.env.MANIFEST_URL;
const mobile = process.argv.includes('--mobile');
const tag = mobile ? '390' : '1440';
const shots = '/tmp/solve-live-music'; await mkdir(shots, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };

const target = resolve(ST_ROOT, 'public/scripts/extensions/third-party/solve');
await rm(target, { recursive: true, force: true }); await mkdir(target, { recursive: true }); await cp(resolve('dist'), target, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
// 记下页面创建的音频（SOLVE 的音频不放进 DOM）
await page.addInitScript(() => { const A = window.Audio; window.__audios = []; window.Audio = function (...args) { const a = new A(...args); window.__audios.push(a); return a; }; window.Audio.prototype = A.prototype; });
if (MANIFEST) await page.addInitScript(url => { window.__SOLVE_BGM_MANIFEST__ = url; }, MANIFEST);
const errors = [];
let phase = 'start', avatar;
page.on('pageerror', e => errors.push(`[${phase}] ` + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' && /SOLVE|solve/u.test(m.text())) errors.push(`[${phase}] console: ` + m.text().slice(0, 300)); });
page.on('dialog', d => void d.accept());
const bar = page.locator('solve-statusbar'), $ = s => bar.locator(s);
const status = () => page.evaluate(() => SOLVE.bgm.status());
const ready = () => page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
const setMood = mood => page.evaluate(m => SOLVE.controller.submit([{ $set: { 'meta.mood': m } }], { actionId: 'mood-' + m + Date.now() }), mood);
async function openMusic() {
  await page.evaluate(() => document.querySelectorAll('#toast-container .toast').forEach(t => t.remove()));
  if (!(await $('[data-k="panel"]').isVisible().catch(() => false))) { await $('[data-solve="launcher"] [data-solve-part="open"], [data-solve="launcher"] button').first().click(); await $('[data-k="panel"]').waitFor(); }
  if (!(await $('[data-solve="music-list"]').isVisible().catch(() => false))) {
    await $('[data-solve="settings-trigger"]').click(); await page.waitForTimeout(300);
    await bar.getByRole('button', { name: /^音乐/ }).or(bar.getByRole('tab', { name: /^音乐/ })).first().click();
    await $('[data-solve="music-list"]').waitFor(); await page.waitForTimeout(300);
  }
}
const overflow = () => page.evaluate(() => {
  const sec = document.querySelector('solve-statusbar').shadowRoot.querySelector('[data-solve="settings-section"]'), box = sec.getBoundingClientRect(), out = [];
  for (const el of sec.querySelectorAll('*')) { const b = el.getBoundingClientRect(); if (b.width && b.right > box.right + 1) out.push(`${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') || el.getAttribute('data-solve') || el.textContent.slice(0, 12)}] +${Math.round(b.right - box.right)}px`); }
  return out;
});

try {
  phase = 'setup';
  await page.goto(ST_URL, { waitUntil: 'domcontentloaded' }); await ready();
  await page.evaluate(() => { localStorage.removeItem('solve.bgm.v1'); localStorage.removeItem('solve.bgm.default.v1'); });
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  avatar = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext(), headers = { ...ctx.getRequestHeaders() }; delete headers['Content-Type'];
    const form = new FormData();
    for (const [k, v] of Object.entries({ ch_name: 'SOLVE音乐验收_' + Math.random().toString(36).slice(2, 6), first_mes: '夜雨中的王都。', description: '', personality: '', scenario: '', mes_example: '', talkativeness: '0.5', fav: 'false', tags: '' })) form.append(k, v);
    const a = (await (await fetch('/api/characters/create', { method: 'POST', headers, body: form })).text()).trim();
    await SOLVE.register(SOLVE.compileStructure(SOLVE.officialStructure), { characters: [a] });
    await ctx.getCharacters(); await ctx.selectCharacterById(ctx.characters.findIndex(c => c.avatar === a));
    return a;
  });
  await page.waitForFunction(() => SOLVE.controller?.getStatus()?.ready, null, { timeout: 90000 });
  await page.mouse.click(5, 300);

  phase = 'defaults';
  await page.waitForFunction(() => ['ready', 'failed'].includes(SOLVE.bgm.status().defaultsState.state), null, { timeout: 60000 });
  let st = await status();
  check('默认曲库：读到曲目清单', st.defaultsState.state === 'ready' && st.library.defaults.length >= 30, `${st.defaultsState.state} ${st.defaultsState.error ?? ''} · ${st.library.defaults.length} 首`);
  const moods = ['日常', '紧张', '战斗', '悲伤', '浪漫', '神秘', '欢快', '恐怖'];
  const per = moods.map(m => [m, st.library.defaults.filter(t => t.moods.includes(m)).length]);
  check('默认曲库覆盖全部场景情绪（每种至少 4 首）', per.every(([, n]) => n >= 4), per.map(([m, n]) => m + n).join(' '));
  await setMood('日常');
  await page.waitForFunction(() => SOLVE.bgm.status().playing, null, { timeout: 30000 }).catch(() => undefined);
  st = await status();
  check('按场景情绪自动播放默认曲库的曲子', st.selection.source === 'mood' && st.selection.track?.id.startsWith('solve:') && st.selection.track.moods.includes('日常') && st.playing, `${st.selection.track?.title} · playing=${st.playing}`);
  const head = await page.evaluate(async url => { const r = await fetch(url, { headers: { Range: 'bytes=0-1023' } }); return { status: r.status, type: r.headers.get('content-type'), len: (await r.arrayBuffer()).byteLength }; }, st.selection.url);
  check('音频文件可从外链下载（jsDelivr）', [200, 206].includes(head.status) && /audio|mpeg|octet/u.test(head.type ?? ''), `${head.status} ${head.type} · ${st.selection.url.slice(0, 90)}`);
  await setMood('战斗'); await page.waitForTimeout(800);
  st = await status();
  check('情绪变成「战斗」：换成带战斗标签的曲子', st.selection.track?.moods.includes('战斗'), st.selection.track?.title);
  const first = st.selection.track?.id;
  await page.evaluate(() => SOLVE.bgm.next()); await page.waitForTimeout(500);
  st = await status();
  check('「换一首」：换成同情绪的另一首', st.selection.track?.id !== first && st.selection.track?.moods.includes('战斗'), st.selection.track?.title);
  // 一首放完：把正在放的那首跳到结尾，等它自动换成同情绪的下一首
  const before = st.selection.track?.id;
  await page.waitForFunction(u => window.__audios.some(a => a.src === u && Number.isFinite(a.duration) && a.duration > 5), st.selection.url, { timeout: 60000 }).catch(() => undefined);
  await page.evaluate(u => { const a = window.__audios.find(x => x.src === u); if (a) a.currentTime = a.duration - 1.5; }, st.selection.url);
  const moved = await page.waitForFunction(b => SOLVE.bgm.status().selection.track?.id !== b, before, { timeout: 20000 }).then(() => true, () => false);
  st = await status();
  check('一首放完自动换同情绪的下一首', moved && st.selection.track?.moods.includes('战斗'), `${before} → ${st.selection.track?.id}`);

  phase = 'ui';
  await openMusic();
  const options = await $('select[aria-label="播放来源"] option').allTextContents();
  check('设置 › 音乐：播放来源有「默认曲库」「全部曲目」', options.some(o => o.startsWith('默认曲库')) && options.some(o => o.startsWith('全部曲目')), options.join('、'));
  const rows = await $('[data-solve="music-track"]').count();
  check('曲目列表列出默认曲库', rows >= 30, `${rows} 行`);
  await $('input[aria-label="搜索曲目"]').fill('肖邦');
  let titles = await $('[data-solve="music-track"] b').allTextContents();
  check('按名称搜索「肖邦」', titles.length >= 5 && titles.every(t => t.includes('肖邦')), `${titles.length} 首`);
  await $('input[aria-label="搜索曲目"]').fill('#夜晚');
  titles = await $('[data-solve="music-track"] b').allTextContents();
  const nightIds = (await status()).library.defaults.filter(t => t.moods.some(m => m.includes('夜晚'))).length;
  check('按 #标签 搜索「#夜晚」', titles.length === nightIds && titles.length > 0, `${titles.length} 首`);
  await $('input[aria-label="搜索曲目"]').fill('');
  const visibleTags = await $('[data-solve="music-find"] [data-solve-part="tags"] button').count();
  check('标签筛选默认只列场景情绪 + 「更多标签」', visibleTags === 9, `${visibleTags} 个按钮`);
  await $('[data-solve="music-find"] button[data-kind="more"]').click();
  check('点「更多标签」展开全部标签', await $('[data-solve="music-find"] [data-solve-part="tags"] button').count() > 20);
  await $('[data-solve="music-find"] button[data-kind="more"]').click();
  await $('[data-solve="music-find"] button').filter({ hasText: /^恐怖$/u }).first().click();
  titles = await $('[data-solve="music-track"] b').allTextContents();
  check('点标签「恐怖」筛选', titles.length === per.find(([m]) => m === '恐怖')[1], `${titles.length} 首`);
  await $('[data-solve="music-find"] button').filter({ hasText: /^恐怖$/u }).first().click();

  phase = 'add';
  await bar.getByRole('button', { name: '添加曲目' }).click();
  await $('[data-solve="track-add"] input[aria-label="曲目名称"]').fill('我的战歌');
  await $('[data-solve="track-add"] input[aria-label="音频链接"]').fill(st.selection.url);
  await $('[data-solve="track-add"] [aria-label="场景情绪"] button').filter({ hasText: /^战斗$/u }).click();
  await $('[data-solve="track-add"] input[aria-label="其他标签"]').fill('鼓 史诗');
  await $('[data-solve="track-add"] input[aria-label="新合集名称"]').fill('我的战斗曲');
  await $('[data-solve="track-add"] button[type="submit"]').click(); await page.waitForTimeout(400);
  st = await status();
  const mine = st.library.player.find(t => t.title === '我的战歌'), coll = st.collections.find(c => c.name === '我的战斗曲');
  check('添加曲目：标签（情绪 + 自定义）保存', mine && ['战斗', '鼓', '史诗'].every(t => mine.moods.includes(t)), mine?.moods.join(' '));
  check('添加时同时放进新合集', coll && mine && coll.tracks.includes(mine.id));

  phase = 'collections';
  await $('select[aria-label="播放来源"]').selectOption(coll.id); await page.waitForTimeout(400);
  st = await status();
  check('选合集为播放来源：只从合集里选（战斗 → 我的战歌）', st.active === coll.id && st.pool === 1 && st.selection.track?.id === mine.id, `${st.pool} 首 · ${st.selection.track?.title}`);
  await setMood('浪漫'); await page.waitForTimeout(500);
  st = await status();
  check('合集里没有这个情绪的曲子：不播放（不乱放别的）', st.selection.source === 'none' || !st.selection.track, st.selection.track?.title ?? '无');
  // 批量：搜「夜曲」，全选加入合集
  await $('input[aria-label="搜索曲目"]').fill('夜曲');
  const boxes = $('[data-solve="music-track"] input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await $('[data-solve="music-bulk"] select').selectOption(coll.id); await page.waitForTimeout(400);
  st = await status();
  const c2 = st.collections.find(c => c.id === coll.id);
  check('批量把搜到的「夜曲」加入合集', c2.tracks.length === 1 + n && n >= 3, `${n} 首 → 合集 ${c2.tracks.length} 首`);
  check('合集里有浪漫的夜曲后，浪漫场景开始播放合集里的曲子', st.selection.track && c2.tracks.includes(st.selection.track.id), st.selection.track?.title);
  await boxes.first().check();
  await $('[data-solve="music-bulk"]').getByRole('button', { name: /^移出/ }).click(); await page.waitForTimeout(300);
  st = await status();
  check('移出合集', st.collections.find(c => c.id === coll.id).tracks.length === n, `${st.collections.find(c => c.id === coll.id).tracks.length} 首`);
  await $('input[aria-label="搜索曲目"]').fill('');
  const ov = await overflow();
  check('音乐页没有元素超出卡片', !ov.length, ov.slice(0, 5).join(' | '));
  await page.screenshot({ path: `${shots}/${tag}-music.png` });
  await bar.getByRole('button', { name: '删除', exact: true }).first().click(); await page.waitForTimeout(300);
  st = await status();
  check('删除合集：曲目还在，播放来源回到默认曲库', !st.collections.length && st.library.player.some(t => t.id === mine.id) && st.active === 'default');
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await ctx.getCharacters(); await ctx.selectCharacterById(ctx.characters.findIndex(c => c.avatar === a)); }, avatar);
  await page.waitForFunction(() => SOLVE.controller?.getStatus()?.ready, null, { timeout: 90000 });
  await page.waitForFunction(() => SOLVE.bgm.status().defaultsState.state === 'ready', null, { timeout: 30000 }).catch(() => undefined);
  st = await status();
  check('刷新后曲库还在（这台设备）', st.library.player.some(t => t.title === '我的战歌') && st.defaultsState.state === 'ready');

  phase = 'bar';
  await page.evaluate(async () => { await SOLVE.controller.submit([{ $set: { 'meta.weather': '雨', 'meta.mood': '神秘' } }], { actionId: 'bar-' + Date.now() }); });
  await page.waitForTimeout(800);
  const barInfo = await page.evaluate(() => {
    const r = document.querySelector('solve-statusbar').shadowRoot, rows = [...r.querySelectorAll('[data-solve="bar"] [data-solve-part="row"]')];
    const form = document.getElementById('send_form').getBoundingClientRect(), b = r.querySelector('[data-solve="launcher"]').getBoundingClientRect();
    return { rows: rows.map(x => x.getAttribute('data-row') + ':' + x.textContent), bottom: b.bottom, formTop: form.top };
  });
  check('悬浮横条两行：上行时间、天气、情绪', barInfo.rows[0]?.startsWith('when:') && /雨/u.test(barInfo.rows[0]) && /神秘/u.test(barInfo.rows[0]), barInfo.rows.join(' / '));
  if (mobile) check('手机：横条在输入区（含按钮行）上方', barInfo.bottom <= barInfo.formTop + 1, `横条底 ${Math.round(barInfo.bottom)} · 输入区顶 ${Math.round(barInfo.formTop)}`);
  await page.screenshot({ path: `${shots}/${tag}-bar.png` });
} catch (error) {
  check('流程未中断', false, `${phase}: ${String(error).slice(0, 400)}`);
} finally {
  check('页面无 SOLVE 相关报错', !errors.length, errors.slice(0, 5).join(' | '));
  await page.evaluate(() => { localStorage.removeItem('solve.bgm.v1'); }).catch(() => undefined);
  if (avatar) await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) }); }, avatar).catch(() => undefined);
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过（${tag}）；截图在 ${shots}`);
  process.exitCode = failed.length ? 1 : 0;
}
