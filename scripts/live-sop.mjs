// 实机验收：{{solve_SOP}} 操作说明。发给模型的提示词里要有每个算子的用法；模型把说明里的示例原样回复，要能全部执行成功。
//
// 前提：本机测试酒馆 + 假模型（卡密仓库 test/mock-llm/server.mjs，默认 8787）。
// 用法：npm run build && node scripts/live-sop.mjs [--mobile]
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
    const form = new FormData(), name = 'SOLVE操作说明验收_' + Math.random().toString(36).slice(2, 8);
    for (const [key, value] of Object.entries({ ch_name: name, first_mes: '夜雨中的王都，醉橡木酒馆的门被推开了。', description: '{{solve_SOP}}\n{{solve_guide}}\n当前变量：{{solve_json}}', personality: '', scenario: '', mes_example: '', talkativeness: '0.5', fav: 'false', tags: '' })) form.append(key, value);
    const response = await fetch('/api/characters/create', { method: 'POST', headers, body: form });
    if (!response.ok) throw new Error('创建测试角色失败：' + response.status);
    return (await response.text()).trim();
  });
  await page.evaluate(async a => {
    const ctx = SillyTavern.getContext();
    await SOLVE.register(SOLVE.compileStructure({ ...SOLVE.officialStructure, templates: { cult_zealot: { type: 'character', data: { name: '教团狂信徒', role: '一次性敌人', origin: 'cult_zealot', tags: ['灰烬教团'] } } } }), { characters: [a] });
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
    await SOLVE.register(SOLVE.compileStructure({ ...SOLVE.officialStructure, templates: { cult_zealot: { type: 'character', data: { name: '教团狂信徒', role: '一次性敌人', origin: 'cult_zealot', tags: ['灰烬教团'] } } } }), { characters: [a] });
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
  check('绑定官方结构并就绪', (await status()).ready);
  // Turn 1: set up the two characters the SOP example talks about.
  await send('我走进酒馆。', op([
    { $set: { 'items.gold': { name: '金币', type: '货币' }, 'items.healing_draught': { name: '治疗药剂', type: '消耗' }, 'characters.erin': { name: '艾琳', role: '用户角色' }, 'characters.mira': { name: '米拉', role: '核心角色' } } },
    { $set: { '@erin.items.gold': { count: 140 }, '@erin.items.healing_draught': { count: 2 }, '@erin.rp.gauges.生命': { value: 72, max: 100 }, 'meta.weather': '雨' } },
  ]));
  let st = await state();
  check('开局数据就位', st.data.characters.erin.items.gold.count === 140 && st.data.characters.erin.rp.gauges['生命'].value === 72, JSON.stringify(st.data.characters.erin.items));
  // The prompt the model received in turn 1 carries the full SOP.
  const prompt = await lastRequestText();
  const ops = ['$createEntity', '$move', '$swap', '$set', '$inc', '$transfer', '$push', '$pull', '$unset', '$deleteEntity', '$group'];
  check('发给模型的提示词里有完整的操作说明', prompt.includes('SOLVE 变量操作说明') && prompt.includes('$valueOf'), `提示词 ${prompt.length} 字`);
  check('说明里每个算子都有用法和参数格式', ops.every(o => prompt.includes(`- ${o} `)), ops.filter(o => !prompt.includes(`- ${o} `)).join(',') || '11/11');
  // Turn 2: the model answers with the SOP's own example block, verbatim.
  const example = await page.evaluate(() => { const t = SOLVE.sop?.() ?? SOLVE.controller.getContextPreview().sop; return t.slice(t.indexOf('<solve_operate>', t.indexOf('### 示例'))); });
  await send('外面打起来了。', `<content>\n火把照亮了巷口。\n</content>\n${example}`);
  st = await state();
  const feedback = await page.evaluate(() => SOLVE.controller.inspectCommit().then(c => c.commit.feedback));
  const e = st.data.characters.erin;
  check('示例操作原样执行，没有失败', !feedback.some(f => f.level === 'L3'), JSON.stringify(feedback).slice(0, 300));
  check('$set / $inc 生效', st.data.meta.weather === '暴雨' && e.condition === '左臂流血' && e.rp.gauges['生命'].value === 60, `weather=${st.data.meta.weather} hp=${e.rp.gauges['生命'].value}`);
  check('$createEntity + $from 建出独立实体', st.data.characters.zealot_a?.name === '持火把的狂信徒' && st.data.characters.zealot_a?.role === '一次性敌人');
  check('$group 内 $transfer 守恒、$inc 生效', e.items.gold.count === 110 && st.data.characters.mira.items.gold.count === 30 && e.items.healing_draught.count === 3, `gold ${e.items.gold.count}/${st.data.characters.mira.items.gold.count}`);
  await page.screenshot({ path: '/workspace/scratch/bp/live-sop.png' });
} catch (error) {
  check('脚本异常', false, String(error).slice(0, 300));
} finally {
  if (avatar) await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) }); }, avatar).catch(() => {});
  console.log(errors.length ? errors.join('\n') : '无页面错误');
  await browser.close();
  process.exit(results.every(r => r.ok) ? 0 : 1);
}
