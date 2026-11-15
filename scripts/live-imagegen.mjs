// 实机验收：配图（生图模块、生图按钮、提示词、版本、字段开关、自动生成、刷新后保留）。准备流程同 live-statusbar。
// 另需假生图后端：node scripts/fake-a1111.mjs（7861）。PLUGIN=st|chami|rbq|chatu8|xiaobaix 选生图插件（默认 st，其余需先装好插件）。
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
const shots = process.argv.find(a => a.startsWith('--shots='))?.slice(8) || '/tmp/solve-live-imagegen';
const PLUGIN = process.env.PLUGIN || 'st';
const FAKE = 'http://127.0.0.1:7861';
const seen = async () => (await fetch(FAKE + '/__seen')).json();
// --skin=solve：即使页面上有卡密预设，也让状态栏用 SOLVE 自带皮肤（玩家在「显示」里的同名开关）
const forceSolve = process.argv.includes('--skin=solve');
const tag = (mobile ? '390' : '1440') + '-' + PLUGIN;
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
await page.addInitScript(p => { try { localStorage.setItem('solve.images.v1', JSON.stringify({ plugin: p, mode: 'button' })); } catch { /* ignore */ } }, PLUGIN);
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




  phase = 'plugin';
  // 玩家已经配好了生图插件（都指向假的 A1111 后端）
  if (PLUGIN === 'st') {
    await page.waitForFunction(() => !!SillyTavern.getContext().SlashCommandParser?.commands?.imagine, null, { timeout: 90000 });
    await page.evaluate(f => { const s = SillyTavern.getContext().extensionSettings.sd; s.source = 'auto'; s.auto_url = f; s.width = 512; s.height = 512; s.prompts = s.prompts ?? {}; }, FAKE);
  } else if (process.env.PLUGIN_SETUP) {
    await page.evaluate(new Function('fake', process.env.PLUGIN_SETUP), FAKE);
  }
  const prompt0 = await page.evaluate(() => (p => p.schema + '\n' + p.guide)(SOLVE.controller.getContextPreview()));
  check('配图默认关闭：提示词里没有 imagePrompt', !/imagePrompt/u.test(prompt0));

  phase = 'settings';
  await openPanel();
  await $('[data-solve="settings-trigger"]').click(); await settle();
  const imagesTab = bar.getByRole('button', { name: /^生图/ }).or(bar.getByRole('tab', { name: /^生图/ })).first();
  await imagesTab.click(); await settle();
  const section = () => $('[data-solve="settings-section"][data-section="images"]');
  const text0 = (await section().innerText()).replace(/\s+/g, ' ');
  check('设置里有「生图」页签，列出总开关和各字段开关', /配图/u.test(text0) && /角色/u.test(text0) && /地点/u.test(text0) && /物品/u.test(text0), text0.slice(0, 120));
  check('「模块」页签里不再重复列出配图', !(await page.evaluate(() => [...document.querySelector('solve-statusbar').shadowRoot.querySelectorAll('[data-section="modules"] [role="switch"]')].some(s => /配图/u.test(s.getAttribute('aria-label') ?? '')))));
  await page.waitForFunction(p => { const sec = document.querySelector('solve-statusbar').shadowRoot.querySelector('[data-section="images"]'); return [...(sec?.querySelectorAll('[data-solve="image-plugin"][data-ready]') ?? [])].some(b => b.textContent.includes(p)); },
    { st: '酒馆自带', chami: '酒馆场景插件', rbq: 'RBQ', chatu8: '智绘姬', xiaobaix: '小白X' }[PLUGIN], { timeout: 60000 }).catch(() => {});
  const plugins = (await $('[data-solve="image-plugin"]').allInnerTexts()).map(s => s.replace(/\s+/g, ' '));
  const label = { st: '酒馆自带', chami: '酒馆场景插件', rbq: 'RBQ', chatu8: '智绘姬', xiaobaix: '小白X' }[PLUGIN];
  check(`检测到「${label}」可用`, plugins.some(p => p.includes(label) && /可用/u.test(p)), plugins.join(' | '));
  await bar.getByRole('switch', { name: '配图总开关' }).click(); await settle(1200);
  const on = await page.evaluate(() => SOLVE.controller.getModules().filter(m => m.name.startsWith('image')).map(m => m.name + ':' + m.enabled).join(','));
  check('打开配图总开关（按聊天保存）', /image:true/u.test(on) && /image_characters:true/u.test(on), on);
  await shot('settings-images');
  await $('[data-solve="settings-trigger"]').click(); await settle();
  const prompt1 = await page.evaluate(() => (p => p.schema + '\n' + p.guide)(SOLVE.controller.getContextPreview()));
  check('打开后提示词里有 imagePrompt 和配图说明', /imagePrompt/u.test(prompt1) && /配图/u.test(prompt1));

  phase = 'model-writes';
  const nora = { name: '诺拉', role: '主要配角', age: '19', intro: '酒馆新来的吟游诗人', tags: ['吟游诗人'], appearance: '银发、红眼、黑色兜帽斗篷', condition: '健康',
    imagePrompt: '1girl, silver hair, red eyes, black hooded cloak, lute, calm expression' };
  await send('一个吟游诗人走了进来。', op([{ $createEntity: { 'characters.nora': nora } }, { $set: { 'places.tavern.imagePrompt': 'scenery, tavern interior, fireplace, wooden tables, night, rain outside' } }], '门口站着一个银发少女。'));
  const st1 = await state();
  check('模型写入的 imagePrompt 被接受', st1.data.characters.nora?.imagePrompt === nora.imagePrompt && /tavern interior/u.test(st1.data.places.tavern.imagePrompt ?? ''));

  phase = 'button';
  await openPanel();
  await goTab('社交');
  await $('[data-solve="entity-head"]').filter({ hasText: '诺拉' }).first().click(); await settle(600);
  const slot = $('[data-solve="art-slot"]').first();
  await slot.waitFor({ timeout: 10000 });
  const btn = () => slot.locator('[data-solve-part="tools"] button').first();
  check('原本放图的位置出现「生成配图」和「提示词」按钮', /生成配图/u.test(await btn().innerText()) && await slot.getByRole('button', { name: /提示词/u }).count() === 1);
  check('还没有图片', await slot.locator('[data-solve="art"]').count() === 0);
  await shot('slot-empty');
  const before = (await seen()).length;
  await btn().click();
  await page.waitForTimeout(400);
  const busy = (await slot.innerText()).replace(/\s+/g, ' ');
  check('按下后显示生成状态', /生成中|排队中|正在/u.test(busy), busy.slice(0, 60));
  await slot.locator('[data-solve="art"] img').waitFor({ timeout: 90000 });
  await settle(600);
  const got = (await seen()).slice(before);
  check('提示词送到生图后端', got.some(g => /silverhair,redeyes,blackhoodedcloak/u.test(String(g.prompt).replace(/\s+/gu, ''))), JSON.stringify(got.map(g => g.prompt)).slice(0, 160));
  const src = await slot.locator('[data-solve="art"] img').getAttribute('src');
  check('图片显示在按钮下方，存在 user/images/ 下', /\/user\/images\//u.test(src ?? ''), src);
  const order = await slot.evaluate(el => { const kids = [...el.children].map(c => c.getAttribute('data-solve-part') ?? c.getAttribute('data-solve')); return kids.join(','); });
  check('按钮在上、图片在下', order.indexOf('tools') < order.indexOf('art'), order);
  check('按钮变成「重新生成」', /重新生成/u.test(await btn().innerText()));
  const loaded = await slot.locator('[data-solve="art"] img').evaluate(i => i.complete && i.naturalWidth > 0);
  check('图片能加载', loaded);
  await shot('slot-done');

  phase = 'prompt';
  await slot.getByRole('button', { name: /提示词/u }).click(); await settle();
  const area = slot.locator('textarea');
  check('「提示词」展开显示模型写的提示词', (await area.inputValue()) === nora.imagePrompt);
  await shot('slot-prompt');
  await area.fill('1girl, silver hair, red eyes, white dress, smiling');
  await slot.getByRole('button', { name: '保存', exact: true }).click(); await settle(1200);
  const st2 = await state();
  check('改过的提示词写回数据（玩家动作）', st2.data.characters.nora.imagePrompt === '1girl, silver hair, red eyes, white dress, smiling');
  check('提示词变了：按钮提示按新提示词生成', /按新提示词生成/u.test(await btn().innerText()), await btn().innerText());
  await btn().click();
  await slot.locator('[data-solve-part="versions"]').waitFor({ timeout: 90000 }); await settle(600);
  const v2 = (await slot.locator('[data-solve-part="versions"]').innerText()).replace(/\s+/g, '');
  const src2 = await slot.locator('[data-solve="art"] img').getAttribute('src');
  check('重新生成后有两个版本，显示新图', v2.includes('2/2') && src2 !== src, `${v2} ${src2}`);
  await slot.getByRole('button', { name: '上一张' }).click(); await settle(500);
  check('可以切回上一张', (await slot.locator('[data-solve="art"] img').getAttribute('src')) === src);
  await slot.getByRole('button', { name: '下一张' }).click(); await settle(300);
  await shot('slot-versions');

  phase = 'other-spots';
  // 作者预制了图片的角色：按钮也在，图片照旧
  await goTab('角色');
  const hero = $('[data-solve="hero"] [data-solve="art-slot"]');
  check('主角页的立绘位置也有生图按钮（预制立绘照常显示）', await hero.count() === 1 && await hero.locator('[data-solve="art"]').count() === 1);
  await shot('hero');
  await goTab('地图');
  await $('[data-solve="map"] [data-solve-part="node"]').filter({ hasText: '醉橡木酒馆' }).first().click(); await settle(600);
  check('地图里地点详情有生图按钮', await $('[data-solve="map"] [data-solve="art-slot"]').count() === 1);
  await shot('map-slot');

  phase = 'field-switch';
  await $('[data-solve="settings-trigger"]').click(); await settle();
  await bar.getByRole('button', { name: /^生图/ }).or(bar.getByRole('tab', { name: /^生图/ })).first().click(); await settle();
  await bar.getByRole('switch', { name: '给地点配图' }).click(); await settle(1200);
  const placesOn = await page.evaluate(() => SOLVE.controller.getModules().find(m => m.name === 'image_places')?.enabled);
  check('单独关掉「地点」配图', placesOn === false);
  await $('[data-solve="settings-trigger"]').click(); await settle();
  await goTab('地图');
  await $('[data-solve="map"] [data-solve-part="node"]').filter({ hasText: '醉橡木酒馆' }).first().click().catch(() => {}); await settle(600);
  check('关掉后地点详情不再有生图按钮', await $('[data-solve="map"] [data-solve="art-slot"]').count() === 0);
  const fb = await page.evaluate(async () => { await SOLVE.controller.preview([{ $set: { 'places.tavern.imagePrompt': 'x' } }]).then(r => window.__r = r); return window.__r.feedback.filter(f => f.level === 'L3').map(f => f.code); });
  check('关掉后模型写地点的 imagePrompt 会被拒绝', fb.length > 0, fb.join(','));

  phase = 'auto';
  await page.evaluate(() => { localStorage.setItem('solve.images.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('solve.images.v1') ?? '{}'), mode: 'auto' })); });
  await $('[data-solve="settings-trigger"]').click(); await settle();
  await bar.getByRole('button', { name: /^生图/ }).or(bar.getByRole('tab', { name: /^生图/ })).first().click(); await settle();
  await bar.getByRole('radio', { name: '自动生成' }).click(); await settle();
  await $('[data-solve="settings-trigger"]').click(); await settle();
  const before3 = (await seen()).length;
  await send('又进来一个人。', op([{ $createEntity: { 'characters.bram': { name: '布拉姆', role: '次要配角', imagePrompt: '1boy, old man, grey beard, blacksmith apron' } } }], '一个老铁匠。'));
  await page.waitForFunction(() => SillyTavern.getContext().chatMetadata.solve_images?.entries?.['characters.bram']?.versions?.length > 0, null, { timeout: 90000 }).catch(() => {});
  const got3 = (await seen()).slice(before3);
  const meta = await page.evaluate(() => SillyTavern.getContext().chatMetadata.solve_images);
  check('自动生成：新角色写了提示词就自动出图', got3.some(g => /greybeard/u.test(String(g.prompt).replace(/\s+/gu, ''))) && meta?.entries?.['characters.bram']?.versions?.length === 1, JSON.stringify(got3.map(g => g.prompt)));
  check('自动生成不会重画已经有图的', got3.filter(g => /silverhair/u.test(String(g.prompt).replace(/\s+/gu, ''))).length === 0);

  phase = 'reload';
  const onDisk = () => page.evaluate(async () => {
    const ctx = SillyTavern.getContext();
    const res = await fetch('/api/chats/get', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ file_name: ctx.getCurrentChatId(), avatar_url: ctx.characters[ctx.characterId].avatar, ch_name: ctx.characters[ctx.characterId].name }) });
    const file = await res.json();
    return Object.keys(file?.[0]?.chat_metadata?.solve_images?.entries ?? {});
  });
  let disk = [];
  for (let i = 0; i < 40 && !disk.includes('characters.bram'); i++) { await page.waitForTimeout(500); disk = await onDisk(); }
  check('图片记录随聊天保存到磁盘', disk.includes('characters.nora') && disk.includes('characters.bram'), disk.join(','));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
  // 结构是脚本注册的（不在世界书里），刷新后重新注册并打开同一个聊天
  await page.evaluate(async a => {
    const ctx = SillyTavern.getContext();
    await SOLVE.register(SOLVE.compileStructure(SOLVE.officialStructure), { characters: [a] });
    if (ctx.characters[ctx.characterId]?.avatar !== a) await ctx.selectCharacterById(ctx.characters.findIndex(c => c.avatar === a));
  }, avatar);
  await page.waitForFunction(() => window.SOLVE?.controller?.getStatus()?.ready, null, { timeout: 120000 });
  await settle(1500);
  await openPanel();
  await goTab('社交');
  await $('[data-solve="entity-head"]').filter({ hasText: '诺拉' }).first().click(); await settle(800);
  const src3 = await $('[data-solve="art-slot"] [data-solve="art"] img').first().getAttribute('src').catch(() => null);
  check('刷新页面后图片还在（存于聊天元数据）', src3 === src2, String(src3));
  const avatarSrc = await $('[data-solve="entity-head"]').filter({ hasText: '布拉姆' }).locator('img').first().getAttribute('src').catch(() => null);
  check('列表头像也用生成的图', /\/user\/images\//u.test(avatarSrc ?? ''), String(avatarSrc));
  await shot('reload');

  phase = 'prune';
  await page.evaluate(() => SOLVE.controller.submit([{ $deleteEntity: 'characters.bram' }], { actionId: 'del' }));
  await settle(800);
  await $('[data-solve="settings-trigger"]').click(); await settle();
  await bar.getByRole('button', { name: /^生图/ }).or(bar.getByRole('tab', { name: /^生图/ })).first().click(); await settle();
  const file = meta.entries['characters.bram'].versions[0].url;
  await bar.getByRole('button', { name: '清理无主图片' }).click(); await settle(1500);
  const gone = await page.evaluate(async f => ({ entry: !!SillyTavern.getContext().chatMetadata.solve_images.entries['characters.bram'], status: (await fetch(f, { cache: 'no-store' })).status }), file);
  check('删除实体后可清理它的图片（文件也删掉）', !gone.entry && gone.status === 404, JSON.stringify(gone));
  await shot('pruned');
  check('页面无报错', !errors.length, errors.join(' | '));
} catch (e) { check('流程未中断', false, `${phase}: ${String(e).slice(0, 300)}`); await shot('fail').catch(() => {}); }
finally {
  if (avatar && !keep) await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) }); }, avatar).catch(() => {});
  await browser.close();
  console.log(`${results.filter(r => r.ok).length}/${results.length} 通过（${mobile ? 390 : 1440} · ${PLUGIN}）`);
}
