// 实机验收：设置 › 变量更新。
//   · 手机宽度下不溢出、最大回复长度的数字看得见；旧默认（温度 0.3、上限 16384）迁移成温度 1、65536
//   · 自定义 API 方案：保存、改动后显示「未保存」、切回方案、删除
//   · 独立操作模型：聊天还没有数据时，发给操作模型的提示词里玩家那句后面加「执行变量初始化」；有数据后不再加
//   · 随正文输出：提示词位置有 6 个选项
// 前提：本机测试酒馆 + 假模型（8787）。用法：npm run build && node scripts/live-update.mjs [--mobile]
// 需要预加载 gate-use（新聊天直接用官方数据结构），会把 dist 复制成酒馆的 third-party/solve 扩展，结束时删除测试角色。
import { createRequire } from 'node:module';
import { cp, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/package.json');
const { chromium } = require('playwright');
const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000/';
const ST_ROOT = process.env.ST_ROOT || '/workspace/st-test/SillyTavern';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:8787';
const mobile = process.argv.includes('--mobile');
const tag = mobile ? '390' : '1440';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`); };
const mock = async (path, body) => (await fetch(MOCK + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
const INIT = '执行变量初始化';

const target = resolve(ST_ROOT, 'public/scripts/extensions/third-party/solve');
await rm(target, { recursive: true, force: true }); await mkdir(target, { recursive: true }); await cp(resolve('dist'), target, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
const errors = [];
let phase = 'start', avatar;
page.on('pageerror', e => errors.push(`[${phase}] ` + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error' && /SOLVE|solve/u.test(m.text())) errors.push(`[${phase}] console: ` + m.text().slice(0, 300)); });
page.on('dialog', d => void d.accept());
const bar = page.locator('solve-statusbar'), $ = s => bar.locator(s);
const prefs = patch => page.evaluate(patch => localStorage.setItem('solve.update.v1', JSON.stringify(patch)), patch);
const ready = () => page.waitForFunction(() => window.SOLVE && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
async function openChat() {
  await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await ctx.getCharacters(); await ctx.selectCharacterById(ctx.characters.findIndex(c => c.avatar === a)); }, avatar);
  await page.waitForFunction(a => { const c = SillyTavern.getContext(); return c.characters[c.characterId]?.avatar === a && SOLVE.controller?.getStatus()?.ready; }, avatar, { timeout: 90000 });
}
async function openUpdate() {
  await page.evaluate(() => document.querySelectorAll('#toast-container .toast').forEach(t => t.remove()));
  if (!(await $('[data-k="panel"]').isVisible().catch(() => false))) { await $('[data-solve="launcher"] [data-solve-part="open"], [data-solve="launcher"] button').first().click(); await $('[data-k="panel"]').waitFor(); }
  await $('[data-solve="settings-trigger"]').click(); await page.waitForTimeout(300);
  await bar.getByRole('button', { name: /^变量更新/ }).or(bar.getByRole('tab', { name: /^变量更新/ })).first().click();
  await $('[data-solve="settings-section"]').waitFor(); await page.waitForTimeout(400);
}
const overflow = () => page.evaluate(() => {
  const sec = document.querySelector('solve-statusbar').shadowRoot.querySelector('[data-solve="settings-section"]'), box = sec.getBoundingClientRect(), out = [];
  for (const el of sec.querySelectorAll('*')) { const b = el.getBoundingClientRect(); if (b.width && b.right > box.right + 1) out.push(`${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') || el.getAttribute('data-solve') || el.textContent.slice(0, 12)}] +${Math.round(b.right - box.right)}px`); }
  return out;
});

try {
  phase = 'setup';
  await mock('/__mock/reset', {});
  await page.goto(ST_URL, { waitUntil: 'domcontentloaded' }); await ready();
  avatar = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext(), headers = { ...ctx.getRequestHeaders() }; delete headers['Content-Type'];
    const form = new FormData();
    for (const [k, v] of Object.entries({ ch_name: 'SOLVE变量更新验收_' + Math.random().toString(36).slice(2, 6), first_mes: '雨夜的王都。', description: '', personality: '', scenario: '', mes_example: '', talkativeness: '0.5', fav: 'false', tags: '' })) form.append(k, v);
    const a = (await (await fetch('/api/characters/create', { method: 'POST', headers, body: form })).text()).trim();
    await SOLVE.register(SOLVE.compileStructure(SOLVE.officialStructure), { characters: [a] });
    return a;
  });
  // 旧版本存下的默认值（没有 rev）
  await prefs({ mode: 'out-of-band', source: 'custom', api: { url: 'https://api.example.com/v1', key: 'sk-test', model: 'model-a', temperature: 0.3, maxTokens: 16384 } });
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await openChat();

  phase = 'layout';
  await openUpdate();
  const num = await page.evaluate(() => { const i = document.querySelector('solve-statusbar').shadowRoot.querySelector('input[aria-label="最大回复长度"]'); return { value: i.value, client: i.clientWidth, scroll: i.scrollWidth }; });
  check('最大回复长度：旧默认 16384 迁移成 65536，数字完整可见', num.value === '65536' && num.client >= 40 && num.scroll <= num.client + 1, `${num.value} · 宽 ${num.client}px / 内容 ${num.scroll}px`);
  const temp = await $('[data-solve="pref"]').filter({ hasText: /^温度/u }).first().textContent().catch(() => '');
  check('温度：旧默认 0.3 迁移成 1.0', /1\.0/u.test(temp ?? ''), (temp ?? '').trim().slice(-6));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('solve.update.v1')));
  check('迁移后存下新版本号，之后再选 0.3 不会被改回', saved.rev === 2 && saved.api.temperature === 1);
  const ov = await overflow();
  check('独立操作模型页：没有元素超出卡片', !ov.length, ov.slice(0, 5).join(' | '));
  await page.screenshot({ path: `/tmp/live-update-${tag}.png`, fullPage: false });

  phase = 'sets';
  await bar.getByRole('button', { name: '保存', exact: true }).first().click();
  await $('input[aria-label="方案名称"]').fill('便宜档');
  await $('form[data-kind="name"] button[type="submit"]').click(); await page.waitForTimeout(300);
  const sel = $('select[aria-label="已存的方案"]');
  check('保存方案后出现在方案列表里并被选中', await sel.count() && (await sel.locator('option:checked').textContent()) === '便宜档');
  const model = $('input[aria-label="模型名称"]');
  await model.fill('model-b'); await model.press('Enter'); await page.waitForTimeout(300);
  check('改了设置：方案显示「未保存」', (await sel.locator('option:checked').textContent()) === '（未保存）');
  await sel.selectOption({ label: '便宜档' }); await page.waitForTimeout(300);
  check('切回方案：模型名称、温度、上限恢复', await model.inputValue() === 'model-a' && await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('solve.update.v1')); return p.api.model === 'model-a' && p.api.maxTokens === 65536 && p.api.temperature === 1; }));
  check('方案存的是这台设备（localStorage），带密钥', await page.evaluate(() => JSON.parse(localStorage.getItem('solve.update.v1')).saved?.[0]?.api?.key === 'sk-test'));
  await bar.getByRole('button', { name: '删除', exact: true }).first().click(); await page.waitForTimeout(300);
  check('删除方案', !(await sel.count()) && await page.evaluate(() => !JSON.parse(localStorage.getItem('solve.update.v1')).saved?.length));
  const ov2 = await overflow();
  check('方案一栏：没有元素超出卡片', !ov2.length, ov2.slice(0, 5).join(' | '));

  phase = 'init';
  await page.keyboard.press('Escape').catch(() => undefined);
  await prefs({ mode: 'out-of-band', source: 'same', rev: 2 });
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await openChat();
  await mock('/__mock/reset', {});
  const turn = async (say, ops) => {
    await mock('/__mock/next', [{ content: '<content>\n雨还在下。\n</content>' }, { content: '<solve_operate>\n' + JSON.stringify(ops) + '\n</solve_operate>' }]);
    const head = await page.evaluate(() => SOLVE.controller.getStatus().headId);
    await page.fill('#send_textarea', say); await page.click('#send_but');
    await page.waitForFunction(h => { const s = SOLVE.controller.getStatus(); return s.ready && !s.busy && s.headId !== h; }, head, { timeout: 90000 });
    const all = await mock('/__mock/requests'); const list = all.requests ?? all;
    return list.filter(r => JSON.stringify(r.body ?? '').includes('你是变量更新器')).at(-1);
  };
  let req = await turn('我推开酒馆的门。', [{ $set: { 'meta.weather': '雨' } }]);
  let text = JSON.stringify(req?.body ?? '');
  const prompt = (req?.body?.messages ?? []).map(m => String(m.content)).join('\n') || String(req?.body?.prompt ?? '');
  const line = prompt.split('\n').findIndex(l => l.includes('玩家：我推开酒馆的门。'));
  check('没有数据时：操作模型的提示词里有「执行变量初始化」', text.includes(INIT));
  check('「执行变量初始化」紧跟在玩家这句之后', line >= 0 && prompt.split('\n')[line + 1]?.includes(INIT), prompt.split('\n').slice(line, line + 2).join(' ⏎ ').slice(0, 120));
  check('「执行变量初始化」不出现在聊天里', !(await page.evaluate(i => SillyTavern.getContext().chat.some(m => m.mes.includes(i)), INIT)));
  req = await turn('我坐下。', []);
  check('有数据后：不再加「执行变量初始化」', req && !JSON.stringify(req.body).includes(INIT));

  phase = 'in-band';
  await prefs({ mode: 'in-band', rev: 2 });
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await openChat();
  await openUpdate();
  const options = await $('select[aria-label="操作说明的位置"] option').allTextContents();
  check('随正文输出：提示词位置有 6 个选项', options.length === 6, options.join('、'));
  await $('select[aria-label="操作说明的位置"]').selectOption('user'); await page.waitForTimeout(300);
  const stack = await $('[data-solve="inject-stack"]').textContent();
  check('位置示意图显示「玩家最后一句 + 操作说明」', stack.includes('玩家最后一句') && stack.includes('操作说明'));
  const ov3 = await overflow();
  check('随正文输出页：没有元素超出卡片', !ov3.length, ov3.slice(0, 5).join(' | '));
} catch (error) {
  check('流程未中断', false, `${phase}: ${String(error).slice(0, 400)}`);
} finally {
  check('页面无 SOLVE 相关报错', !errors.length, errors.slice(0, 5).join(' | '));
  await page.evaluate(() => localStorage.removeItem('solve.update.v1')).catch(() => undefined);
  if (avatar) await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) }); }, avatar).catch(() => undefined);
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过（${tag}）`);
  process.exitCode = failed.length ? 1 : 0;
}
