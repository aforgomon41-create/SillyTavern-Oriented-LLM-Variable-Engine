// 实机验收：官方数据结构与 0.9-dev.9 引擎能力（轮次、自动时间戳、单次变化上限、清单上限与整理提示、
// 互斥组迁移指令、计算字段、声明式投影、玩家设置、背景音乐）。
//
// 前提：本机测试酒馆（SillyTavern 1.19）+ 假模型（卡密仓库 test/mock-llm/server.mjs，默认 8787）。
// 用法：npm run build && node scripts/live-official.mjs [--mobile] [--keep]
//   ST_URL（默认 http://127.0.0.1:8000/）、ST_ROOT（默认 /workspace/st-test/SillyTavern）、
//   MOCK_URL（默认 http://127.0.0.1:8787）、PLAYWRIGHT_PKG（默认 /workspace/tools/package.json）
// 会把 dist 复制成酒馆的 third-party/solve 扩展，创建一个随机命名的测试角色；结束时删除角色（--keep 保留）。
import { createRequire } from 'node:module';
import { cp, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/package.json');
const { chromium } = require('playwright');
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000/';
const ST_ROOT = process.env.ST_ROOT || '/workspace/st-test/SillyTavern';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:8787';
const mobile = process.argv.includes('--mobile'), keep = process.argv.includes('--keep');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };
const mock = async (path, body) => (await fetch(MOCK + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
const op = (ops, prose = '雨还在下。') => `<content>\n${prose}\n</content>\n<solve_operate>\n${JSON.stringify(ops)}\n</solve_operate>`;

// 1. 安装扩展
const target = resolve(ST_ROOT, 'public/scripts/extensions/third-party/solve');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve('dist'), target, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
const errors = [];
let phase = 'start';
page.on('pageerror', e => errors.push(`[${phase}] ` + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' && /SOLVE|solve/u.test(m.text())) errors.push(`[${phase}] console: ` + m.text().slice(0, 200)); });
const ready = async () => {
  phase = 'navigation';
  await page.goto(ST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#send_textarea', { timeout: 90000 });
  await page.waitForFunction(() => window.SOLVE && window.TavernHelper && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
  phase = 'loaded';
};
const status = () => page.evaluate(() => window.SOLVE.controller?.getStatus());
const waitReady = (headNot) => page.waitForFunction(h => { const s = window.SOLVE.controller?.getStatus(); return s?.ready && !s.busy && s.headId && s.headId !== h; }, headNot ?? null, { timeout: 90000 });
const state = () => page.evaluate(() => window.SOLVE.controller.getState());
let avatar;

async function openTestChat() {
  avatar = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext(), headers = { ...ctx.getRequestHeaders() };
    delete headers['Content-Type'];
    const form = new FormData(), name = 'SOLVE官方结构验收_' + Math.random().toString(36).slice(2, 8);
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
}
// After a reload the author script must register again (as a real card script would) and the chat is reopened.
async function reopen() {
  await ready();
  await page.evaluate(async a => {
    const ctx = SillyTavern.getContext();
    await SOLVE.register(SOLVE.compileStructure(SOLVE.officialStructure), { characters: [a] });
    if (ctx.characters[ctx.characterId]?.avatar !== a) await ctx.selectCharacterById(ctx.characters.findIndex(c => c.avatar === a));
  }, avatar);
  await page.waitForFunction(() => window.SOLVE.controller?.getStatus()?.ready, null, { timeout: 90000 });
}
async function send(text, reply, { headBefore } = {}) {
  await mock('/__mock/next', { content: reply });
  const before = headBefore ?? (await status()).headId;
  await page.fill('#send_textarea', text);
  await page.click('#send_but');
  await waitReady(before);
  await page.waitForTimeout(300);
}
async function lastRequestText() {
  const requests = await mock('/__mock/requests');
  const last = (requests.requests ?? requests).at(-1);
  return JSON.stringify(last?.messages ?? last ?? '');
}

try {
  await mock('/__mock/reset', {});
  await ready();
  await openTestChat();
  const s0 = await status();
  check('绑定官方结构并就绪', s0.ready && s0.definition.id === 'solve-official', `${s0.definition.id} ${s0.definition.version}`);

  // 2. 第一回合：模型从空白建立角色、地点与关系；轮次 = 楼层号
  await send('我走进酒馆。', op([
    { $set: { 'places.capital': { name: '王都', kind: '区域' }, 'characters.erin': { name: '艾琳', role: '用户角色', age: '二十出头' }, 'characters.mira': { name: '米拉', role: '核心角色' } } },
    { $set: { 'places.tavern': { name: '醉橡木酒馆', parent: 'capital' }, 'meta.location': 'tavern', 'meta.present': ['erin', 'mira'], 'meta.weather': '雨', 'meta.mood': '日常' } },
    { $set: { '@erin.relations.mira': { affection: 20, keyEvents: ['初次见面'] }, '@erin.rp.attributes.dnd.str': 14 }, $push: { '@erin.tags': '见习骑士' } },
  ]));
  let st = await state();
  const floor1 = await page.evaluate(() => SillyTavern.getContext().chat.length - 1);
  check('轮次等于酒馆楼层号', st.data.meta.round === floor1, `round=${st.data.meta.round} 楼层=#${floor1}`);
  check('关键事件写字符串，引擎自动补轮次', JSON.stringify(st.data.characters.erin.relations.mira.keyEvents) === JSON.stringify([{ round: floor1, text: '初次见面' }]), JSON.stringify(st.data.characters.erin.relations.mira.keyEvents));
  check('新角色自动补齐默认字段（属性空缺为 null）', st.data.characters.mira.rp.attributes.dnd.str === null && st.data.characters.erin.rp.attributes.dnd.str === 14);

  // 3. 单次变化上限 + 模型不能改轮次
  await send('我请米拉喝一杯。', op([{ $inc: { '@erin.relations.mira.affection': 30 }, $set: { 'meta.round': 999 } }]));
  st = await state();
  const floor2 = await page.evaluate(() => SillyTavern.getContext().chat.length - 1);
  const feedback = await page.evaluate(() => SOLVE.controller.inspectCommit().then(c => c.commit.feedback));
  check('好感度单次变化被截断到 ±10', st.data.characters.erin.relations.mira.affection === 30 && feedback.some(f => f.code === 'DELTA_CLAMPED'), `affection=${st.data.characters.erin.relations.mira.affection}`);
  check('模型写轮次被拒绝，轮次仍为楼层号', st.data.meta.round === floor2 && feedback.some(f => f.code === 'SYSTEM_FIELD'), `round=${st.data.meta.round} 楼层=#${floor2}`);

  // 4. 清单到预警线 → 发给模型的提示词里有整理要求
  await send('继续聊。', op([{ $push: { '@erin.tags': '流亡者' } }, { $push: { '@erin.tags': '契约者' } }, { $push: { '@erin.tags': '剑士' } }, { $push: { '@erin.tags': '骑手' } }, { $push: { '@erin.tags': '夜行者' } }, { $push: { '@erin.tags': '酒客' } }, { $push: { '@erin.tags': '雨中人' } }]));
  st = await state();
  check('清单达到预警线（8/10）', st.data.characters.erin.tags.length === 8, `${st.data.characters.erin.tags.length} 条`);
  await send('再说说。', op([{ $push: { '@erin.tags': '旅人' } }, { $push: { '@erin.tags': '第十个' } }, { $push: { '@erin.tags': '第十一个' } }]));
  const promptWithWarn = await lastRequestText();
  check('预警整理指令进入模型实际收到的提示词', promptWithWarn.includes('【清单整理】') && promptWithWarn.includes('characters.erin.tags'));
  st = await state();
  const fb4 = await page.evaluate(() => SOLVE.controller.inspectCommit().then(c => c.commit.feedback));
  check('到上限后新增被拒绝', st.data.characters.erin.tags.length === 10 && fb4.some(f => f.code === 'LIST_FULL'), `${st.data.characters.erin.tags.length} 条`);

  // 5. 玩家设置：放宽上限，刷新后仍在
  await page.evaluate(() => SOLVE.controller.setSettings({ lists: { 'characters.*.tags': { max: 12, warn: 11 } } }));
  // 6. 互斥组：切换属性体系 → 下一次提示词带迁移指令与旧数据
  await page.evaluate(() => SOLVE.controller.setModule('attr_wod', true));
  const guideAfterSwitch = await page.evaluate(() => SOLVE.getGuide());
  check('切换属性体系生成迁移指令（附旧体系数据）', /属性体系由「DND」切换为「WOD」/u.test(guideAfterSwitch) && guideAfterSwitch.includes('"str":14'));
  await reopen();
  st = await state();
  check('刷新后状态、设置与迁移待办都从聊天恢复', st.engineState.settings?.lists?.['characters.*.tags']?.max === 12 && st.engineState.activeModules.attr_wod === true && st.engineState.migration?.to === 'attr_wod');
  await send('属性体系换了。', op([{ $set: { '@erin.rp.attributes.wod': { str: 11, dex: 6, sta: 4, int: 3, wits: 4, res: 5, pre: 2, man: 2, com: 3 }, '@mira.rp.attributes.wod': { str: 2, dex: 5, sta: null } } }]));
  const migrationPrompt = await lastRequestText();
  check('迁移指令进入模型实际收到的提示词', migrationPrompt.includes('【迁移】属性体系由「DND」切换为「WOD」'));
  st = await state();
  check('迁移指令只出现一次（模型回复后清除）', st.engineState.migration === undefined && st.data.characters.erin.rp.attributes.wod.str === 11);
  await send('看看状态。', op([]));
  const computedPrompt = await lastRequestText();
  check('计算字段（超凡）进入提示词', computedPrompt.includes('str(超凡)\\":2') || computedPrompt.includes('"str(超凡)":2'), computedPrompt.match(/str\(超凡\)[^,]{0,6}/u)?.[0] ?? '未找到');
  check('休眠体系不进提示词', !/"dnd":\{/u.test(computedPrompt.replace(/\\"/g, '"')));

  // 7. 声明式投影：米拉离场后只留核心字段，社交只留在场相关
  await send('米拉先走了。', op([{ $set: { 'meta.present': ['erin'] } }]));
  await send('我一个人坐着。', op([]));
  const projected = JSON.parse(await page.evaluate(() => SOLVE.toJson(SOLVE.controller.core.definition, SOLVE.controller.getState())));
  check('不在场角色只保留核心字段', !projected.characters['@mira'].rp && projected.characters['@mira'].name === '米拉');
  check('社交只保留在场相关条目', Object.keys(projected.characters['@erin'].relations ?? {}).length === 0);

  // 8. 重新生成（Swipe）：同一楼层轮次不变
  const roundBefore = (await state()).data.meta.round;
  await mock('/__mock/next', { content: op([{ $set: { 'meta.weather': '阴' } }], '换一种说法。') });
  const headBeforeSwipe = (await status()).headId;
  await page.evaluate(async () => { const ctx = SillyTavern.getContext(); await ctx.executeSlashCommandsWithOptions?.('/swipes-swipe') ?? null; });
  try { await page.waitForFunction(() => window.SOLVE.controller?.getStatus()?.ready && window.SOLVE.controller.getState().data.meta.weather === '阴', null, { timeout: 30000 }); }
  catch { await page.locator('.last_mes .swipe_right').first().click(); await page.waitForFunction(() => window.SOLVE.controller?.getStatus()?.ready && window.SOLVE.controller.getState().data.meta.weather === '阴', null, { timeout: 90000 }); }
  const swipeInfo = await page.evaluate(() => { const ctx = SillyTavern.getContext(), last = ctx.chat.at(-1); return { floor: ctx.chat.length - 1, swipes: last.swipes?.length, swipeId: last.swipe_id }; });
  console.log('  swipe:', JSON.stringify(swipeInfo));
  st = await state();
  check('重新生成同一楼层，轮次不变', st.data.meta.round === roundBefore && st.data.meta.weather === '阴', `round ${roundBefore} → ${st.data.meta.round}`);

  // 9. 背景音乐：情绪选曲、点击后播放
  const wav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  await page.evaluate(url => SOLVE.bgm.addTracks([{ id: 'calm', url, moods: ['日常'] }]), wav);
  await page.mouse.click(5, 300);
  await page.waitForTimeout(2500);
  const music = await page.evaluate(() => SOLVE.bgm.status());
  check('背景音乐按场景情绪选曲', music.selection.source === 'mood' && music.selection.track?.id === 'calm', JSON.stringify({ source: music.selection.source, playing: music.playing, blocked: music.blocked }));
  await page.evaluate(() => SOLVE.bgm.removeTrack('calm'));

  // 10. 刷新后仍可继续：轮次与历史从聊天恢复
  await reopen();
  st = await state();
  check('刷新后轮次从聊天恢复', st.data.meta.round === roundBefore);
  const real = errors.filter(e => !e.startsWith('[navigation]'));
  check('页面没有 SOLVE 相关错误（刷新时被中断的请求另计）', real.length === 0, real.slice(0, 3).join(' | '));
  if (errors.length !== real.length) console.log(`  刷新期间被中断的请求：${errors.length - real.length} 条`);
} catch (error) {
  check('流程未中断', false, String(error?.stack ?? error).slice(0, 600));
} finally {
  if (!keep && avatar) {
    await page.evaluate(async a => {
      const ctx = SillyTavern.getContext();
      await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) });
    }, avatar).catch(() => {});
  }
  await page.screenshot({ path: `/workspace/st-test/solve-official-${mobile ? 'mobile' : 'pc'}.png` }).catch(() => {});
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${mobile ? '手机 390' : '电脑 1440'}：${results.length - failed.length}/${results.length} 通过`);
  process.exitCode = failed.length ? 1 : 0;
}
