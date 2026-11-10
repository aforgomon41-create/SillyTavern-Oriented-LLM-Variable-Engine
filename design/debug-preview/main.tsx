/**
 * 调试面板设计预览（审阅用，不是验证）。用卡密预设真实的运行库与皮肤引擎渲染 SOLVE 调试面板：
 *   · 总览（无参数）：选皮肤与页面，同时看电脑 1440 浅/深与手机 390 浅/深四个窗口（都是可操作的真页面）
 *   · 单窗（?skin=<id>&scheme=light|dark&page=<页>）：模拟酒馆页面 + 打开的调试面板
 * 数据：官方数据结构 + 示例世界，在内存里的模拟酒馆上由真控制器跑了几轮（见 demo.ts）。
 * 构建：node design/debug-preview/build.mjs（需要卡密预设仓库，KAMI_ROOT 指定位置）。
 */
import * as React from 'react';
import { createRuntime } from 'kami/frontend/runtime/index';
import { SkinManager, type SkinEntry, type StoredSettings } from 'kami/frontend/skin-engine/manager';
import * as DS from 'kami/frontend/ds';
import kamiSkins from 'kami-skins';
import { KitProvider, type Kit } from '../../src/ui/kit';
import { DebugPanel } from '../../src/ui/debug/panel';
import type { DebugHost } from '../../src/ui/debug/shared';
import statusCss from '../../src/ui/statusbar/statusbar.css';
import debugCss from '../../src/ui/debug/debug.css';
import solveManifest from '../statusbar-preview/solve-skin.json';
import solveSkinCss from '../statusbar-preview/solve-skin.css';
import { createDebugDemo } from './demo';

declare const __BUILD__: string;
const PICK = ['suiguang', 'quest', 'neon'];
const entries: SkinEntry[] = [
  ...(kamiSkins as unknown as SkinEntry[]).filter(e => PICK.includes(e.manifest.id)),
  { manifest: solveManifest as unknown as SkinEntry['manifest'], css: solveSkinCss },
];
const PAGES: [string, string][] = [['overview', '概览'], ['state', '状态'], ['history', '历史'], ['console', '操作台'], ['prompt', '提示词'], ['structure', '结构'], ['logs', '日志']];
const q = new URLSearchParams(location.search);
const skinId = q.get('skin');
if (skinId) void single(skinId, q.get('scheme') || 'light', q.get('page') || 'overview'); else gallery();

function gallery(): void {
  document.body.classList.add('gallery');
  const order = [...PICK, 'solve'];
  const nameOf = (id: string) => entries.find(e => e.manifest.id === id)?.manifest.name ?? id;
  const root = document.createElement('div');
  root.id = 'gallery';
  root.innerHTML = `<header><h1>SOLVE 调试面板 · 设计预览 <small class="build">构建于 ${__BUILD__}</small></h1>
    <p class="lead">审阅用预览，不是验证（能不能用以酒馆实机为准）。给卡作者用：和状态栏同一套组件与皮肤，在同一层里打开（不再是单独的 iframe 工作台）。演示数据是官方结构的示例世界，在内存里的模拟酒馆上由真引擎跑了 3 层：好感度超上限被夹住（已调整）、一条写错路径与一条写进关闭模块的操作（被拒绝）、玩家在状态栏喝药（带旁白）、同一楼的两个回复版本。四个窗口都能操作（演示里提交、重放只改这个页面的内存）。</p>
    <nav class="skins" aria-label="皮肤">${order.map(id => `<button type="button" data-id="${id}">${nameOf(id)}${id === 'solve' ? '<small>独立</small>' : '<small>卡密</small>'}</button>`).join('')}</nav>
    <nav class="tabs" aria-label="页面">${PAGES.map(([id, label]) => `<button type="button" data-page="${id}">${label}</button>`).join('')}</nav>
    <p class="note"><a class="solo" target="_blank" rel="noopener">在新窗口单独打开</a></p></header>
    <section class="frames">
      <figure class="pc"><figcaption>电脑 1440 · 浅色</figcaption><div class="box"><iframe data-scheme="light" data-w="1440" data-h="900"></iframe></div></figure>
      <figure class="pc"><figcaption>电脑 1440 · 深色</figcaption><div class="box"><iframe data-scheme="dark" data-w="1440" data-h="900"></iframe></div></figure>
      <figure class="mobile"><figcaption>手机 390 · 浅色</figcaption><div class="box"><iframe data-scheme="light" data-w="390" data-h="844"></iframe></div></figure>
      <figure class="mobile"><figcaption>手机 390 · 深色</figcaption><div class="box"><iframe data-scheme="dark" data-w="390" data-h="844"></iframe></div></figure>
    </section>`;
  document.body.appendChild(root);
  let skin = order[0]!, page = 'overview';
  const frames = Array.from(root.querySelectorAll<HTMLIFrameElement>('iframe'));
  const load = () => {
    root.querySelectorAll<HTMLButtonElement>('.skins button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === skin)));
    root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.page === page)));
    const stamp = encodeURIComponent(__BUILD__);
    for (const f of frames) f.src = `${location.pathname}?skin=${skin}&scheme=${f.dataset.scheme}&page=${page}&b=${stamp}`;
    root.querySelector<HTMLAnchorElement>('.solo')!.href = `${location.pathname}?skin=${skin}&scheme=light&page=${page}&b=${stamp}`;
  };
  root.querySelector('.skins')!.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (b?.dataset.id) { skin = b.dataset.id; load(); } });
  root.querySelector('.tabs')!.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (b?.dataset.page) { page = b.dataset.page; load(); } });
  const fit = () => { for (const f of frames) { const w = Number(f.dataset.w), h = Number(f.dataset.h), box = f.parentElement!; const s = box.clientWidth / w; f.style.width = w + 'px'; f.style.height = h + 'px'; f.style.transform = `scale(${s})`; box.style.height = h * s + 'px'; } };
  new ResizeObserver(fit).observe(root); fit(); load();
}

async function single(id: string, scheme: string, page: string): Promise<void> {
  document.body.classList.add('single');
  document.body.insertAdjacentHTML('afterbegin', `<div id="tavern" aria-hidden="true"><div class="topbar"></div><div class="chat">
    <div class="mes"><b>旁白</b><p>雨停了，下城区的方向传来早市的吆喝。</p></div></div><div class="input"></div></div>`);
  const rt = createRuntime(window);
  let saved: unknown = null;
  const store = { load: (): unknown => saved, save: (s: StoredSettings): void => { saved = JSON.parse(JSON.stringify(s)); } };
  const mgr = new SkinManager(store, rt, entries, window);
  mgr.select(id); mgr.setScheme(scheme); mgr.apply();
  document.documentElement.dataset.scheme = mgr.current.manifest.schemes[scheme] ? scheme : 'light';
  const layer = rt.layer();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('@layer k.reset, k.tokens, k.base, k.components, k.skin, k.lock;\n@layer k.components {\n' + statusCss + '\n' + debugCss + '\n}');
  layer.shadow.adoptedStyleSheets = [...layer.shadow.adoptedStyleSheets, sheet];

  const demo = await createDebugDemo();
  const host: DebugHost = {
    version: 'SOLVE 0.9.0-dev',
    sessions: { get controller() { return demo.sessions.controller; }, subscribe: l => demo.sessions.subscribe(l), getStatus: () => demo.sessions.getStatus() },
    demo: demo.simulation,
  };
  function App() {
    const [open, setOpen] = React.useState(true);
    return (
      <KitProvider value={DS as unknown as Kit}>
        {open ? <DebugPanel host={host} onClose={() => setOpen(false)} defaultPage={page as never} />
          : <button type="button" data-solve="reopen" style={{ position: 'fixed', right: 16, bottom: 80 }} onClick={() => setOpen(true)}>打开调试面板</button>}
      </KitProvider>
    );
  }
  layer.open('solve-debug', <App />);
}
