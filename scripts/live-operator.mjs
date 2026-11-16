// 实机验收（真实模型）：独立操作模型（变量更新 › 独立请求）、单独生成变量、随正文输出时真实模型写操作块 / 生图提示词。
//
// 前提：本机测试酒馆（SillyTavern 1.19 + 酒馆助手）。正文请求和操作模型都用真实的 OpenAI 兼容接口：
//   LLM_TEST（默认 /root/.config/solve/llm-test：第一行地址，第二行密钥；脚本不打印密钥）、LLM_MODEL（默认 deepseek-v4-flash）。
// 正文请求在浏览器里被改写成「自定义 API」发给酒馆后端（不改酒馆保存的连接设置，别的会话照常用假模型），预设换成朴素提示词（见下）。
// 酒馆后端连外网要走代理时，在酒馆 config.yaml 打开 requestProxy。
// 用法：npm run build && node scripts/live-operator.mjs [--mobile] [--keep] [--shots=目录]
import { createRequire } from 'node:module';
import { cp, rm, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/package.json');
const { chromium } = require('playwright');
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000/';
const ST_ROOT = process.env.ST_ROOT || '/workspace/st-test/SillyTavern';
const [API_URL, API_KEY] = (await readFile(process.env.LLM_TEST || '/root/.config/solve/llm-test', 'utf8')).split('\n').map(s => s.trim());
const MODEL = process.env.LLM_MODEL || 'deepseek-v4-flash';
const mobile = process.argv.includes('--mobile'), keep = process.argv.includes('--keep');
const shots = process.argv.find(a => a.startsWith('--shots='))?.slice(8) || '/tmp/solve-live-operator';
const tag = mobile ? '390' : '1440';
const results = [];
const hide = s => String(s).split(API_KEY).join('<key>');
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(hide(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`)); };

const target = resolve(ST_ROOT, 'public/scripts/extensions/third-party/solve');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve(process.env.DIST || 'dist'), target, { recursive: true });
await mkdir(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
const errors = [];
let phase = 'start';
page.on('pageerror', e => errors.push(`[${phase}] ` + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' && /SOLVE|solve|React|状态栏/u.test(m.text())) errors.push(`[${phase}] console: ` + m.text().slice(0, 300)); });

// 正文请求 → 真实模型（只改这次请求，不动酒馆设置）；记录每次请求的内容
const story = [], operator = [], trace = [];
await page.route('**/api/backends/chat-completions/generate', async route => {
  let body; try { body = JSON.parse(route.request().postData() ?? '{}'); } catch { return route.continue(); }
  const text = JSON.stringify(body.messages ?? '');
  const isOperator = body.chat_completion_source === 'custom' && body.custom_url === API_URL.replace(/\/+$/u, '');
  (isOperator ? operator : story).push(text);
  // 测试酒馆当前的预设（和别的会话共用、很长、要求特定标签）换成一份朴素提示词：角色卡与 SOLVE 注入的那几段（按原样）
  // + 聊天记录；正文包在 <content> 里（和假模型的回复一样）。流式与否照原请求。
  let messages = body.messages;
  if (!isOperator && Array.isArray(messages)) {
    const keep = messages.filter(m => typeof m.content === 'string' && m.content.length < 40000 && !/奈亚子|<prologue>/u.test(m.content) && /SOLVE 变量操作说明|数据结构|变量规则|当前变量|上一轮的反馈/u.test(m.content));
    const page2 = await page.evaluate(() => { const ctx = SillyTavern.getContext(), ch = ctx.characters[ctx.characterId];
      return { card: ctx.substituteParams(ch.description), chat: ctx.chat.map(m => ({ role: m.is_user ? 'user' : 'assistant', content: String(m.mes ?? '').replace(/<solve_(mutual_)?operate>[\s\S]*?<\/solve_\1operate>/gu, '').trim() })) }; }).catch(() => ({ card: '', chat: [] }));
    const chat = page2.chat;
    messages = [{ role: 'system', content: [page2.card, ...keep.map(m => m.content)].join('\n\n') + '\n\n剧情正文写在 <content> 和 </content> 之间（酒馆的正则只保留这一段）；不要输出思考过程或选项。' }, ...chat.filter(m => m.content)];
  }
  const post = isOperator ? body : { ...body, messages, chat_completion_source: 'custom', custom_url: API_URL, model: MODEL, max_tokens: 4000,
    custom_include_headers: `Authorization: ${JSON.stringify('Bearer ' + API_KEY)}` };
  const response = await route.fetch({ postData: JSON.stringify(post), timeout: 0 });
  const answer = await response.text();
  trace.push({ kind: isOperator ? 'operator' : 'story', phase, request: post.messages, response: answer });
  return route.fulfill({ response, body: answer });
});

const status = () => page.evaluate(() => window.SOLVE.controller?.getStatus());
const waitReady = (headNot, timeout = 240000) => page.waitForFunction(h => { const s = window.SOLVE.controller?.getStatus(); return s?.ready && !s.busy && !s.generating && s.headId && s.headId !== h; }, headNot ?? null, { timeout, polling: 500 });
const waitIdle = (timeout = 240000) => page.waitForFunction(() => { const s = window.SOLVE.controller?.getStatus(); return s && !s.busy && !s.generating && !s.operatorBusy && !document.querySelector('#mes_stop:not([style*="none"])')?.offsetParent; }, null, { timeout, polling: 500 });
const state = () => page.evaluate(() => window.SOLVE.controller.getState());
const shot = name => page.screenshot({ path: `${shots}/${tag}-${name}.png` });
const bar = page.locator('solve-statusbar');
const $ = sel => bar.locator(sel);
const settle = (ms = 400) => page.waitForTimeout(ms);
const toasts = async () => (await page.locator('#toast-container .toast').allInnerTexts()).join(' / ').replace(/\s+/g, ' ');
const clearToasts = () => page.evaluate(() => { try { toastr.clear(); document.querySelectorAll('#toast-container .toast').forEach(t => t.remove()); } catch { /* */ } });
const waitToast = async (re, n = 240) => { for (let i = 0; i < n; i++) { const t = await toasts(); if (re.test(t)) return t; await page.waitForTimeout(500); } return await toasts(); };
const lastMes = () => page.evaluate(() => SillyTavern.getContext().chat.at(-1).mes);
const prefs = patch => page.evaluate(p => {
  const now = JSON.parse(localStorage.getItem('solve.update.v1') ?? '{}');
  localStorage.setItem('solve.update.v1', JSON.stringify({ ...now, ...p, api: { ...now.api, ...p.api }, notify: { ...now.notify, ...p.notify } }));
}, patch);
let avatar;

async function send(text) {
  if (await bar.count() && await $('[data-k="panel"]').count()) { await $('[data-k="panel"] [data-k-part="close"]').first().click(); await settle(); }
  await page.fill('#send_textarea', text);
  await page.click('#send_but');
  await page.waitForFunction(() => { const s = window.SOLVE.controller?.getStatus(); return s?.generating; }, null, { timeout: 30000 }).catch(() => {});
}
async function openSettings(section) {
  if (!await $('[data-k="panel"]').count()) {
    await $('[data-solve="launcher"] [data-solve-part="open"], [data-solve="launcher"] button').first().click();
    await $('[data-k="panel"]').waitFor({ timeout: 10000 }); await settle();
  }
  await $('[data-solve="settings-trigger"]').click(); await settle();
  await bar.getByRole('button', { name: new RegExp('^' + section) }).or(bar.getByRole('tab', { name: new RegExp('^' + section) })).first().click(); await settle(600);
}

try {
  phase = 'navigation';
  await page.goto(ST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#send_textarea', { timeout: 90000 });
  await page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
  phase = 'setup';
  avatar = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext(), headers = { ...ctx.getRequestHeaders() };
    delete headers['Content-Type'];
    const form = new FormData(), name = 'SOLVE独立处理验收_' + Math.random().toString(36).slice(2, 8);
    const description = '你是跑团主持人，用简体中文写一段 150 字以内的剧情。场景：夜雨中的王都，醉橡木酒馆。酒馆老板娘米拉，红发，爽朗。\n{{solve_SOP}}\n{{solve_guide}}\n当前变量：{{solve_json}}';
    for (const [key, value] of Object.entries({ ch_name: name, first_mes: '夜雨中的王都，醉橡木酒馆的门被推开了。炉火边，红发的老板娘米拉抬起头。', description, personality: '', scenario: '', mes_example: '', talkativeness: '0.5', fav: 'false', tags: '' })) form.append(key, value);
    const response = await fetch('/api/characters/create', { method: 'POST', headers, body: form });
    if (!response.ok) throw new Error('创建测试角色失败：' + response.status);
    return (await response.text()).trim();
  });
  // 独立操作模型：自定义 API（真实模型）
  await prefs({ mode: 'out-of-band', source: 'custom', api: { url: API_URL, key: API_KEY, model: MODEL, temperature: 0.3, maxTokens: 16384 }, retries: 1, timeout: 120, auto: true, minLength: 0, trigger: '' });
  await page.evaluate(async a => {
    const ctx = SillyTavern.getContext();
    await SOLVE.register(SOLVE.compileStructure(SOLVE.officialStructure), { characters: [a] });
    await ctx.getCharacters();
    await ctx.selectCharacterById(ctx.characters.findIndex(c => c.avatar === a));
  }, avatar);
  await waitReady();
  const s0 = await status();
  check('设置里选了「独立请求」：状态里的更新方式随之变成 out-of-band（卡片默认仍是 in-band）', s0.mode === 'out-of-band' && s0.cardMode === 'in-band', `${s0.mode} / ${s0.cardMode}`);

  phase = 'settings';
  await openSettings('变量更新');
  const testBtn = $('button').filter({ hasText: /^测试$/u });
  if (await testBtn.count()) {
    await testBtn.first().click();
    await $('[data-tone="ok"], [data-tone="error"]').filter({ hasText: /连接正常|失败|错误|超时/u }).first().waitFor({ timeout: 60000 }).catch(() => {});
    const res = (await $('[data-tone="ok"], [data-tone="error"]').allInnerTexts()).join(' ');
    check('设置 › 变量更新 › 测试连接：真实模型经酒馆后端返回', /连接正常/u.test(res), res.slice(0, 120));
  } else check('设置 › 变量更新 › 测试连接：真实模型经酒馆后端返回', false, '没找到「测试」按钮');
  const listBtn = $('button').filter({ hasText: '获取列表' });
  if (await listBtn.count()) {
    await listBtn.first().click();
    await page.waitForFunction(m => [...document.querySelector('solve-statusbar').shadowRoot.querySelectorAll('option')].some(o => o.value === m) && document.querySelector('solve-statusbar').shadowRoot.querySelectorAll('option').length > 3, MODEL, { timeout: 30000 }).catch(() => {});
    const n = await $('option').count();
    check('获取模型列表（经酒馆后端）', n > 3, `${n} 个选项`);
  } else check('获取模型列表（经酒馆后端）', false, '没找到按钮');
  const keyType = await $('input[aria-label*="密钥"], input[type="password"]').first().getAttribute('type').catch(() => null);
  check('密钥输入框是密码框（截图里不显示密钥）', keyType === 'password', String(keyType));
  await shot('settings');
  await $('[data-k="panel"] [data-k-part="close"]').first().click().catch(() => {}); await settle();

  phase = 'out-of-band';
  await clearToasts();
  const h1 = (await status()).headId;
  const storyBefore = story.length, opBefore = operator.length;
  await send('我走进酒馆，抖掉斗篷上的雨水，向米拉要了一杯热麦酒，付了三枚铜币。外面的雨越下越大了。');
  const working = await waitToast(/正在更新变量/u, 120);
  await waitReady(h1);
  const reply = await lastMes();
  check('正文请求不带 SOLVE 操作说明（独立请求时不注入）', story.length > storyBefore && !/SOLVE 变量操作说明|solve_operate/u.test(story.at(-1)), `正文请求 ${story.length - storyBefore} 次`);
  check('正文回复后自动请求操作模型（真实模型）', operator.length > opBefore && /变量更新器/u.test(operator.at(-1)) && /【最新回复】/u.test(operator.at(-1)), `操作请求 ${operator.length - opBefore} 次`);
  check('请求中显示「正在更新变量」提示', /正在更新变量/u.test(working), working.slice(0, 80));
  const block = /<solve_operate>\s*([\s\S]*?)\s*<\/solve_operate>/u.exec(reply)?.[1];
  let ops = []; try { ops = JSON.parse(block ?? '[]'); } catch { ops = 'bad'; }
  check('操作模型的结果写进这条回复（正文保留）', Array.isArray(ops) && reply.replace(/<solve_operate>[\s\S]*$/u, '').trim().length > 20, `${Array.isArray(ops) ? ops.length : ops} 组操作：${String(block).slice(0, 160)}`);
  const st1 = await state();
  check('变量按真实模型的操作更新（状态已就绪且有变化）', (await status()).ready && JSON.stringify(st1.data) !== '{}', `weather=${st1.data.meta?.weather} 角色数=${Object.keys(st1.data.characters ?? {}).length}`);
  await settle(1500);
  check('完成后「正在更新变量」提示消失', !/正在更新变量/u.test(await toasts()));
  await shot('out-of-band');

  phase = 'generate';
  await clearToasts();
  const btns = page.locator('#solve_buttons [data-solve-button]');
  await btns.filter({ hasText: '单独生成变量' }).click();
  const t1 = await waitToast(/已生成并写入|没有完成/u);
  check('单独生成变量（真实模型）：重新写入最新回复的操作', /已生成并写入/u.test(t1), t1.slice(0, 120));
  await waitIdle();
  check('单独生成后状态就绪、只有一个操作块', (await status()).ready && ((await lastMes()).match(/<solve_operate>/gu) ?? []).length === 1);

  phase = 'auto-off';
  await prefs({ auto: false });
  const opN = operator.length, h2 = (await status()).headId;
  await send('我问米拉今晚有没有空房间。');
  await waitIdle();
  await settle(1500);
  check('关掉自动请求：正文回复后不请求操作模型', operator.length === opN && (await status()).headId === h2 && !/<solve_operate>/u.test(await lastMes()), `操作请求 ${operator.length - opN} 次`);
  await clearToasts();
  await btns.filter({ hasText: '单独生成变量' }).click();
  const t2 = await waitToast(/已生成并写入|没有完成/u);
  await waitIdle();
  check('关掉自动请求后点「单独生成变量」补上这一楼', /已生成并写入/u.test(t2) && (await status()).headId !== h2 && (await status()).ready, t2.slice(0, 80));
  await prefs({ auto: true });

  phase = 'trigger';
  await prefs({ trigger: '【战斗】' });
  const opT = operator.length;
  await send('我在炉火边坐下，烤干靴子。');
  await waitIdle(); await settle(1000);
  check('触发标签：回复里没有「【战斗】」时不自动请求', operator.length === opT, `操作请求 ${operator.length - opT} 次`);
  await prefs({ trigger: '/<\\/content>/' });
  const h4 = (await status()).headId;
  await send('我把靴子挪近炉火，问米拉最近王都有什么新闻。');
  await waitReady(h4);
  check('触发标签（/正则/）命中 </content> 时照常请求', operator.length === opT + 1, `操作请求 ${operator.length - opT} 次`);
  await prefs({ trigger: '' });

  phase = 'failure';
  await prefs({ api: { key: 'sk-wrong-key-for-test' }, retries: 1 });
  await clearToasts();
  const opF = operator.length;
  await send('我向窗外望去。');
  const failed = await waitToast(/变量没有更新/u, 240);
  await waitIdle();
  check('密钥错误：重试 1 次后报「变量没有更新」，正文照常保留', /变量没有更新/u.test(failed) && operator.length - opF === 2 && (await lastMes()).length > 10, `${failed.slice(0, 120)}（请求 ${operator.length - opF} 次）`);
  await shot('failed');
  await prefs({ api: { key: API_KEY } });
  await clearToasts();
  await btns.filter({ hasText: '单独生成变量' }).click();
  const t3 = await waitToast(/已生成并写入|没有完成/u);
  await waitIdle();
  check('改回正确密钥后「单独生成变量」补上失败的那一楼', /已生成并写入/u.test(t3) && (await status()).ready, t3.slice(0, 120));

  phase = 'in-band';
  // 随正文输出：真实正文模型按注入的说明写操作块，新角色带生图提示词
  await prefs({ mode: 'in-band' });
  await page.evaluate(() => SOLVE.controller.setModule('image', true));
  await waitIdle();
  check('改回「随正文输出」：状态里的更新方式随之变化', (await status()).mode === 'in-band');
  const h3 = (await status()).headId, opI = operator.length;
  await send('一个陌生的银发女剑士推门进来，在吧台另一头坐下。请把她作为新角色登记到变量里。');
  await waitReady(h3);
  const r3 = await lastMes(), st3 = await state();
  check('正文请求带上了 SOLVE 操作说明', /solve_operate/u.test(story.at(-1)));
  check('真实正文模型在回复里写了操作块并被处理', /<solve_operate>[\s\S]*<\/solve_operate>/u.test(r3) && operator.length === opI, String(/<solve_operate>([\s\S]*?)<\/solve_operate>/u.exec(r3)?.[1]).slice(0, 200));
  const chars = Object.entries(st3.data.characters ?? {});
  const withPrompt = chars.filter(([, c]) => typeof c?.imagePrompt === 'string' && c.imagePrompt.trim());
  check('配图开着时，真实模型给新角色写了生图提示词', withPrompt.length > 0, withPrompt.map(([k, c]) => `${k}: ${c.imagePrompt.slice(0, 60)}`).join('；') || `角色：${chars.map(([k]) => k).join(',')}`);
  await shot('in-band');

  phase = 'swipe';
  // 真实模型的 Swipe：重新生成这一楼 → 按新回复计算；切回原回复 → 恢复原来的变量
  const headA = (await status()).headId, stateA = JSON.stringify((await state()).data);
  await page.locator('.last_mes .swipe_right').first().click();
  await waitReady(headA);
  const swipeInfo = await page.evaluate(() => { const m = SillyTavern.getContext().chat.at(-1); return { swipes: m.swipes?.length, id: m.swipe_id, block: /<solve_operate>/u.test(m.mes) }; });
  check('真实模型重新生成（Swipe）：新回复被处理', swipeInfo.swipes === 2 && swipeInfo.id === 1 && (await status()).ready, JSON.stringify(swipeInfo));
  await page.locator('.last_mes .swipe_left').first().click();
  await page.waitForFunction(h => { const s = window.SOLVE.controller?.getStatus(); return s?.ready && !s.busy && s.headId === h; }, headA, { timeout: 60000 });
  check('切回原回复：变量恢复成原来的', JSON.stringify((await state()).data) === stateA);

  phase = 'repair';
  await clearToasts();
  await btns.filter({ hasText: '重新处理变量' }).click();
  const r1 = await waitToast(/已重新处理|没有完成/u); await waitIdle();
  check('重新处理变量（真实回复）：结果不变', /已重新处理/u.test(r1) && JSON.stringify((await state()).data) === stateA, r1.slice(0, 80));
  await clearToasts();
  await btns.filter({ hasText: '重建' }).click();
  const r2 = await waitToast(/已按聊天记录重建|已重建|没有完成/u); await waitIdle();
  check('重建（真实回复）：变量和重建前一致', /重建/u.test(r2) && !/没有完成/u.test(r2) && JSON.stringify((await state()).data) === stateA, r2.slice(0, 80));
  await clearToasts();
  const opR = operator.length;
  page.once('dialog', d => d.accept('2'));
  await btns.filter({ hasText: '重放' }).click();
  const r3b = await waitToast(/已从第|没有完成/u); await waitIdle();
  // 第 2 楼起按正文重算：前几楼是独立请求写进回复的操作块，重放只读正文，不再请求操作模型
  check('重放（从第 2 楼）：按正文重算，变量一致，不再请求操作模型', /已从第 2 楼重放/u.test(r3b) && JSON.stringify((await state()).data) === stateA && operator.length === opR, r3b.slice(0, 80));
  await shot('repair');

  check('页面没有 SOLVE 相关报错', errors.length === 0, errors.join(' | '));
} catch (error) {
  check(`流程中断（${phase}）`, false, String(error?.stack ?? error).slice(0, 600));
  await shot('crash').catch(() => {});
  const dump = await page.evaluate(() => ({ mes: SillyTavern.getContext().chat.at(-1)?.mes, log: SOLVE.controller?.journal.read().slice(-15).map(e => `${e.code} ${e.message}`), status: SOLVE.controller?.getStatus() })).catch(e => String(e));
  await (await import('node:fs/promises')).writeFile(`${shots}/${tag}-crash.json`, hide(JSON.stringify(dump, null, 1)));
} finally {
  if (avatar && !keep) await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) }); }, avatar).catch(() => {});
  await browser.close();
  await (await import('node:fs/promises')).writeFile(`${shots}/${tag}-trace.json`, hide(JSON.stringify(trace, null, 1)));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${tag}: ${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}
