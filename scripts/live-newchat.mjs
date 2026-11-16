// 实机验收：新开聊天（auto.js 角色脚本）——状态栏出现；第一次保存失败时自动重试后绑定；切到没有 SOLVE 脚本的角色时 SOLVE 卸载、不留残留，切回来重新启动（不重新下载运行时）。
// 新版打开没用过 SOLVE 的聊天会先弹窗选结构；本脚本测的是绑定和卸载，用 gate-use 预加载（直接使用）跳过弹窗，弹窗由 live-gate.mjs 测。
// 用法：DYN_URL=<auto.js 地址> node scripts/live-newchat.mjs [--mobile]（会暂时挪开原生扩展 third-party/solve，结束后放回）
import { createRequire } from 'node:module';
import { rename, access } from 'node:fs/promises';
const require = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/package.json');
const { chromium } = require('playwright');
const NEW = process.env.DYN_URL || 'http://127.0.0.1:8933/auto.js', mobile = process.argv.includes('--mobile');
const ROOT = process.env.ST_ROOT || '/workspace/st-test/SillyTavern', NATIVE = ROOT + '/public/scripts/extensions/third-party/solve', BAK = ROOT + '/../solve-native-bak-newchat';
const shots = '/tmp/solve-live-newchat', tag = mobile ? '390' : '1440';
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? '✔' : '✖'} ${n}${d ? ' — ' + d : ''}`); };
let moved = false; try { await access(NATIVE); await rename(NATIVE, BAK); moved = true; } catch {}
const b = await chromium.launch();
const page = await b.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
const errs = []; page.on('pageerror', e => { errs.push(String(e).slice(0, 200)); if (process.env.STACK) console.log('STACK', e.stack?.slice(0, 1500)); });
const boot = () => page.waitForFunction(() => window.TavernHelper && window.SillyTavern?.getContext()?.onlineStatus !== 'no_connection', null, { timeout: 120000 });
const useScript = url => page.evaluate(async code => { await TavernHelper.replaceScriptTrees([{ type: 'script', enabled: true, name: 'SOLVE', id: crypto.randomUUID(), content: code, info: '', button: { enabled: true, buttons: [] }, data: {} }], { type: 'character' }); }, `import '${url}';`);
const persist = a => page.evaluate(async a => {
  const ctx = SillyTavern.getContext(), th = ctx.extensionSettings.tavern_helper;
  if (!th.script.enabled.characters.includes(a)) th.script.enabled.characters.push(a);
  ctx.saveSettingsDebounced();
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 500)); const s = JSON.parse((await (await fetch('/api/settings/get', { method: 'POST', headers: ctx.getRequestHeaders(), body: '{}' })).json()).settings); if ((s.extension_settings?.tavern_helper?.script?.enabled?.characters ?? []).includes(a)) return; }
  throw new Error('允许名单没存上');
}, a);
const st = () => page.evaluate(() => { const s = window.SOLVE?.sessions?.getStatus?.(); return { phase: s?.phase, reason: s?.reason, chat: SillyTavern.getContext().chatId, bar: !!document.querySelector('solve-statusbar')?.shadowRoot?.querySelector('[data-solve="launcher"]') }; });
const waitBar = async (chat, ms = 30000) => { for (let i = 0; i < ms / 500; i++) { const s = await st(); if (s.bar && s.phase === 'ready' && (!chat || s.chat !== chat)) return s; await page.waitForTimeout(500); } return st(); };
const toasts = async () => (await page.locator('#toast-container .toast').allInnerTexts()).join(' / ').replace(/\s+/g, ' ');
const created = [];
let runtimeLoads = 0;
page.on('request', r => { if (/\/runtime\.js(?:\?|$)/u.test(r.url())) runtimeLoads++; });
try {
  await page.goto('http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded' }); await boot();
  const nativeFetch = await page.evaluate(() => window.fetch.toString());
  const make = name => page.evaluate(async name => {
    const ctx = SillyTavern.getContext(), headers = { ...ctx.getRequestHeaders() }; delete headers['Content-Type'];
    const form = new FormData();
    for (const [k, v] of Object.entries({ ch_name: name + Math.random().toString(36).slice(2, 7), first_mes: '雨夜，王都的酒馆。', description: '老板娘。', personality: '', scenario: '', mes_example: '', talkativeness: '0.5', fav: 'false', tags: '' })) form.append(k, v);
    return (await (await fetch('/api/characters/create', { method: 'POST', headers, body: form })).text()).trim();
  }, name);
  const open = a => page.evaluate(async a => { const ctx = SillyTavern.getContext(); await ctx.getCharacters(); if (ctx.characters[ctx.characterId]?.avatar !== a) await ctx.selectCharacterById(ctx.characters.findIndex(c => c.avatar === a)); }, a);
  const avatar = await make('SOLVE新聊天_'); created.push(avatar);
  const plain = await make('没有SOLVE_'); created.push(plain);
  await open(avatar); await page.waitForTimeout(1500);
  await useScript(NEW); await persist(avatar);
  await page.reload({ waitUntil: 'domcontentloaded' }); await boot(); await open(avatar);
  const s1 = await waitBar();
  check('带 SOLVE 的角色：第一个聊天有状态栏', s1.bar && s1.phase === 'ready', JSON.stringify(s1));

  // 新开聊天
  await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/newchat'));
  const s2 = await waitBar(s1.chat);
  check('新开一个聊天：状态栏照常出现', s2.bar && s2.phase === 'ready' && s2.chat !== s1.chat, JSON.stringify(s2));
  await page.screenshot({ path: `${shots}-${tag}-newchat.png` });

  // 新聊天第一次写盘失败（和酒馆自己的保存撞车）：自动重试后绑定
  let failed = 0;
  await page.route('**/api/chats/save', async route => { const body = route.request().postData() ?? ''; if (failed < 1 && /definitionHash/u.test(body)) { failed++; await route.fulfill({ status: 500, body: 'simulated' }); } else await route.continue(); });
  await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/newchat'));
  const s3 = await waitBar(s2.chat, 40000);
  const log3 = await page.evaluate(() => SOLVE.sessions.getStatus && (SOLVE.sessions.journal?.read?.() ?? []).slice(-10).map(l => l.code).join(','));
  check('新聊天第一次保存失败：自动重试后绑定，状态栏出现', failed === 1 && s3.bar && s3.phase === 'ready', JSON.stringify({ failed, ...s3, log: log3 }));
  await page.unroute('**/api/chats/save');

  // 切到没有 SOLVE 脚本的角色：角色脚本停了，SOLVE 把自己放进页面的东西全部拿走
  await open(plain); await page.waitForTimeout(4000);
  const left = await page.evaluate(native => {
    const ctx = SillyTavern.getContext();
    return {
      solve: typeof window.SOLVE, interceptor: typeof window.solve_generation_interceptor, registry: typeof window.__SOLVE_RUNTIME_V1__,
      layer: document.querySelectorAll('solve-statusbar').length, buttons: !!document.getElementById('solve_buttons'), wand: !!document.getElementById('solve_wand_container'),
      // SOLVE 的保存守卫（认 /api/chats/save）不再是页面的 fetch（别的脚本也可能包一层 fetch，那不算）
      fetch: !window.fetch.toString().includes('/api/chats/save') || window.fetch.toString().slice(0, 160), prompts: Object.keys(ctx.extensionPrompts ?? {}).filter(k => /solve/iu.test(k)),
      macro: ctx.substituteParams('{{solve_json}}'), audio: [...document.querySelectorAll('audio')].filter(a => /solve/iu.test(a.id + a.className)).length,
    };
  }, nativeFetch);
  check('切到没有 SOLVE 脚本的角色：SOLVE 卸载，不留界面、菜单、按钮、全局变量、fetch 钩子、注入和宏', left.solve === 'undefined' && left.interceptor === 'undefined' && left.registry === 'undefined'
    && !left.layer && !left.buttons && !left.wand && left.fetch === true && !left.prompts.length && left.macro === '{{solve_json}}' && !left.audio, JSON.stringify(left));
  await page.screenshot({ path: `${shots}-${tag}-unloaded.png` });
  const before = runtimeLoads;
  await open(avatar);
  const s5 = await waitBar(undefined, 40000);
  check('切回带 SOLVE 的角色：重新启动，状态栏回来，没有重新下载运行时', s5.bar && s5.phase === 'ready' && runtimeLoads === before && await page.evaluate(() => document.querySelectorAll('solve-statusbar').length) === 1, JSON.stringify({ ...s5, runtimeLoads }));
  check('页面无报错', !errs.length, errs.join(' | '));
} catch (e) { check('流程未中断', false, String(e).slice(0, 300)); await page.screenshot({ path: `${shots}-${tag}-fail.png` }).catch(() => {}); }
finally {
  for (const a of created) await page.evaluate(async a => { const ctx = SillyTavern.getContext(); await fetch('/api/characters/delete', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ avatar_url: a, delete_chats: true }) }); }, a).catch(() => {});
  await b.close();
  if (moved) await rename(BAK, NATIVE).catch(() => {});
  console.log(`${results.filter(Boolean).length}/${results.length} 通过（${tag}）`);
}
