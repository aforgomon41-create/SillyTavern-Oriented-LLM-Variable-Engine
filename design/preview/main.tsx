/**
 * SOLVE 界面合并预览（审阅用，不是验证）：状态栏、设置、调试面板放在同一个页面、同一段聊天里，只用卡密默认皮肤「碎光」。
 *   · 总览（无参数）：选要看的界面，同时看电脑 1440 浅/深与手机 390 浅/深四个窗口（都是可操作的真页面）
 *   · 单窗（?scheme=light|dark&view=<界面>）：模拟酒馆页面 + 状态栏（+ 打开的设置或调试面板）
 * 数据：官方数据结构 + 示例世界，在内存里的模拟酒馆上由真控制器跑了几轮（../debug-preview/demo.ts）。
 * 状态栏用的是酒馆宿主同一个组件（src/host/statusbar.tsx 的 Bound），玩家操作走真控制器，调试面板的历史里能看到。
 * 构建：node design/preview/build.mjs（需要卡密预设仓库，KAMI_ROOT 指定位置）。
 */
import * as React from 'react';
import { createRuntime } from 'kami/frontend/runtime/index';
import { SkinManager, type SkinEntry, type StoredSettings } from 'kami/frontend/skin-engine/manager';
import * as DS from 'kami/frontend/ds';
import kamiSkins from 'kami-skins';
import { KitProvider, type Kit } from '../../src/ui/kit';
import { DebugPanel } from '../../src/ui/debug/panel';
import type { DebugHost } from '../../src/ui/debug/shared';
import { Bound } from '../../src/host/statusbar';
import { BgmPlayer } from '../../src/host/bgm';
import { IMAGES, MUSIC, MUSIC_CREDIT } from '../../examples/official/media';
import statusCss from '../../src/ui/statusbar/statusbar.css';
import debugCss from '../../src/ui/debug/debug.css';
import { jerCss } from '../../src/ui/debug/console';
import builderCss from '../../src/ui/builder/builder.css';
import { StructureBuilder } from '../../src/ui/builder/builder';
import { xyCss } from '../../src/ui/builder/blueprint';
import { exampleStructure } from '../../examples/official/example';
import { createDebugDemo } from '../debug-preview/demo';

declare const __BUILD__: string;
const SKIN = 'suiguang';
const entries = (kamiSkins as unknown as SkinEntry[]).filter(e => e.manifest.id === SKIN);
const GROUPS: { title: string; views: [string, string][] }[] = [
  { title: '状态栏', views: [['bar', '横条'], ['dot', '按钮'], ['tab:角色', '角色'], ['tab:社交', '社交'], ['tab:地图', '地图'], ['tab:图鉴', '图鉴'], ['tab:势力', '势力'], ['tab:设定', '设定'], ['tab:建筑', '建筑']] },
  { title: '设置', views: [['settings', '设置']] },
  { title: '结构制作', views: [['builder:fields', '字段蓝图'], ['builder:modules', '模块'], ['builder:publish', '检查与发布'], ['builder:layout', '状态栏布局'], ['builder:interact', '交互'], ['builder:prompt', '提示词'], ['builder:views', '视图'], ['builder:initial', '开局数据'], ['builder:music', '音乐']] },
  { title: '调试面板', views: [['debug:overview', '概览'], ['debug:state', '状态'], ['debug:history', '历史'], ['debug:console', '操作台'], ['debug:prompt', '提示词'], ['debug:structure', '结构'], ['debug:logs', '日志']] },
];
const q = new URLSearchParams(location.search);
const ATTRS: [string, string][] = [['wod', 'WOD'], ['dnd', 'DND'], ['fate', 'FATE'], ['fu', 'FU']];
if (q.get('scheme')) void single(q.get('scheme')!, q.get('view') || 'bar', q.get('embed') === '1', q.get('attr') || 'wod'); else gallery();

function gallery(): void {
  document.body.classList.add('gallery');
  const root = document.createElement('div');
  root.id = 'gallery';
  root.innerHTML = `<header><h1>SOLVE 界面 · 合并预览 <small class="build">构建于 ${__BUILD__}</small></h1>
    <p class="lead">审阅用预览，不是验证（能不能用以酒馆实机为准）。状态栏、设置、调试面板在同一段聊天里，皮肤只用卡密预设默认的「碎光」。状态栏用的是接进酒馆的同一个组件：在状态栏里做的操作（喝药、开关模块、改上限）会存进当前楼层，打开调试面板的「历史」就能看到。调试面板和结构制作的入口都在 ⚙ 设置 › 显示。示例角色四套属性体系（WOD / DND / FATE / FU）都有数据，用下面的「属性体系」切换（等同玩家在设置里切换）。</p>
    <p class="lead">演示聊天：示例世界在模拟酒馆里跑了 3 轮（好感度超上限被夹住、两条被拒绝的操作、玩家喝药带旁白、同一楼两个回复版本）。所有操作只改这个页面的内存，刷新即复原。</p>
    ${GROUPS.map(g => `<nav class="tabs" aria-label="${g.title}"><span>${g.title}：</span>${g.views.map(([id, label]) => `<button type="button" data-view="${id}">${label}</button>`).join('')}</nav>`).join('')}
    <nav class="tabs attrs" aria-label="属性体系"><span>属性体系：</span>${ATTRS.map(([id, label]) => `<button type="button" data-attr="${id}">${label}</button>`).join('')}</nav>
    <p class="note"><a class="solo" target="_blank" rel="noopener">在新窗口单独打开</a>（有声音：点一下页面开始播放当前地点的配乐）</p>
    <details class="credits"><summary>图片与音乐来源（都是外链的网络资源）</summary>
      <p>图片：<a href="https://www.irasutoya.com/" target="_blank" rel="noopener">いらすとや</a>（みふねたかし），按其<a href="https://www.irasutoya.com/p/terms.html" target="_blank" rel="noopener">使用条款</a>免费使用。音乐：${MUSIC_CREDIT}。</p>
      <ul>${Object.entries(IMAGES).map(([k, v]) => `<li><code>${k}</code> <a href="${v.source}" target="_blank" rel="noopener">${v.title}</a> · ${v.artist}</li>`).join('')}
      ${MUSIC.map(t => `<li><code>${t.id}</code> 「${t.title}」 · CC BY 4.0</li>`).join('')}</ul>
    </details></header>
    <section class="frames">
      <figure class="pc"><figcaption>电脑 1440 · 浅色</figcaption><div class="box"><iframe data-scheme="light" data-w="1440" data-h="900"></iframe></div></figure>
      <figure class="pc"><figcaption>电脑 1440 · 深色</figcaption><div class="box"><iframe data-scheme="dark" data-w="1440" data-h="900"></iframe></div></figure>
      <figure class="mobile"><figcaption>手机 390 · 浅色</figcaption><div class="box"><iframe data-scheme="light" data-w="390" data-h="844"></iframe></div></figure>
      <figure class="mobile"><figcaption>手机 390 · 深色</figcaption><div class="box"><iframe data-scheme="dark" data-w="390" data-h="844"></iframe></div></figure>
    </section>`;
  document.body.appendChild(root);
  let view = 'bar', attr = 'wod';
  const frames = Array.from(root.querySelectorAll<HTMLIFrameElement>('iframe'));
  const load = () => {
    root.querySelectorAll<HTMLButtonElement>('.tabs button[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    root.querySelectorAll<HTMLButtonElement>('.tabs button[data-attr]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.attr === attr)));
    const stamp = encodeURIComponent(__BUILD__), v = encodeURIComponent(view);
    for (const f of frames) f.src = `${location.pathname}?scheme=${f.dataset.scheme}&view=${v}&attr=${attr}&embed=1&b=${stamp}`;
    root.querySelector<HTMLAnchorElement>('.solo')!.href = `${location.pathname}?scheme=light&view=${v}&attr=${attr}&b=${stamp}`;
  };
  root.querySelectorAll('.tabs').forEach(nav => nav.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (b?.dataset.view) { view = b.dataset.view; load(); } if (b?.dataset.attr) { attr = b.dataset.attr; load(); } }));
  const fit = () => { for (const f of frames) { const w = Number(f.dataset.w), h = Number(f.dataset.h), box = f.parentElement!; const s = box.clientWidth / w; f.style.width = w + 'px'; f.style.height = h + 'px'; f.style.transform = `scale(${s})`; box.style.height = h * s + 'px'; } };
  new ResizeObserver(fit).observe(root); fit(); load();
}

/** In-memory storage: the four frames share one origin, so each keeps its own launcher place and preferences. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: k => void map.delete(k), clear: () => map.clear() };
}

async function single(scheme: string, view: string, embed: boolean, attr: string): Promise<void> {
  document.body.classList.add('single');
  document.body.insertAdjacentHTML('afterbegin', `<div id="tavern" aria-hidden="true"><div class="topbar"></div><div class="chat">
    <div class="mes"><b>灰烬纪元</b><p>地窖里，幽蓝的火在锈蚀的板甲里跳动。灰烬没有动，只是轻声说：“你父亲也走过这道楼梯。”</p></div>
    <div class="mes user"><b>艾琳</b><p>我收起剑，回到楼上。天快亮了。</p></div>
    <div class="mes"><b>灰烬纪元</b><p>雨停了，下城区的方向传来早市的吆喝。</p></div>
  </div><div class="input"></div></div>`);
  const rt = createRuntime(window);
  let saved: unknown = null;
  const store = { load: (): unknown => saved, save: (s: StoredSettings): void => { saved = JSON.parse(JSON.stringify(s)); } };
  const mgr = new SkinManager(store, rt, entries, window);
  mgr.select(SKIN); mgr.setScheme(scheme); mgr.apply();
  document.documentElement.dataset.scheme = mgr.current.manifest.schemes[scheme] ? scheme : 'light';
  const layer = rt.layer();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('@layer k.reset, k.tokens, k.base, k.components, k.skin, k.lock;\n@layer k.components {\n' + statusCss + '\n' + jerCss + '\n' + xyCss + '\n' + debugCss + '\n' + builderCss + '\n}');
  layer.shadow.adoptedStyleSheets = [...layer.shadow.adoptedStyleSheets, sheet];

  const demo = await createDebugDemo();
  const sessions = demo.sessions;
  // Another attribute system: switched the way a player would (⚙ 设置 › 模块), so it shows up in the history too.
  if (attr !== 'wod' && ATTRS.some(([id]) => id === attr)) await sessions.controller!.setModule('attr_' + attr, true);
  // The host's scope: this window, but with storage of its own (frames are muted).
  const storage = embed ? memoryStorage({ 'solve.bgm.v1': JSON.stringify({ enabled: false, volume: 0.5, library: [] }) }) : window.localStorage;
  const scope = { document, localStorage: storage, get innerWidth() { return window.innerWidth; }, CustomEvent, Audio, addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window), setInterval: window.setInterval.bind(window), clearInterval: window.clearInterval.bind(window), setTimeout: window.setTimeout.bind(window) };
  const bgm = new BgmPlayer(scope, () => { const c = sessions.controller; if (!c) return undefined; try { return { definition: c.core.definition, state: c.getState() }; } catch { return undefined; } });
  sessions.subscribe(() => bgm.sync()); bgm.sync();
  const host: DebugHost = {
    version: 'SOLVE 0.9.0-dev',
    sessions: { get controller() { return sessions.controller; }, subscribe: l => sessions.subscribe(l), getStatus: () => sessions.getStatus() },
    demo: demo.simulation,
  };
  const initial = view === 'dot' ? { mode: 'dot' as const } : view === 'settings' ? { mode: 'panel' as const, settings: true } : view.startsWith('tab:') ? { mode: 'panel' as const, tab: view.slice(4) } : { mode: 'bar' as const };
  const firstDebug = view.startsWith('debug:') ? view.slice(6) : undefined;
  const firstBuilder = view.startsWith('builder:') ? view.slice(8) : undefined;
  const builderHost = { start: exampleStructure, published: exampleStructure, official: exampleStructure, character: '灰烬纪元', sample: () => { try { return sessions.controller?.getState(); } catch { return undefined; } } };
  function App() {
    const [, tick] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => sessions.subscribe(tick), []);
    const [debug, setDebug] = React.useState<string | undefined>(firstDebug);
    const [builder, setBuilder] = React.useState<string | undefined>(firstBuilder);
    const c = sessions.controller!;
    let state; try { state = c.getState(); } catch { state = undefined; }
    return (
      <KitProvider value={DS as unknown as Kit}>
        {/* Separate stacking contexts: the debug panel stays above the status bar's launcher and panel. */}
        <div style={{ position: 'relative', zIndex: 1 }}>{state ? <Bound key={c.core.definition.fingerprint} scope={scope} controller={c as never} def={c.core.definition} state={state} bgm={bgm} extras={{ initial, openDebug: () => setDebug('overview'), openBuilder: () => setBuilder('fields') }} /> : null}</div>
        <div style={{ position: 'relative', zIndex: 3 }}>{builder ? <StructureBuilder key={builder} host={builderHost} onClose={() => setBuilder(undefined)} defaultPage={builder as never} /> : null}</div>
        <div style={{ position: 'relative', zIndex: 2 }}>{debug ? <DebugPanel key={debug} host={host} onClose={() => setDebug(undefined)} defaultPage={debug as never} /> : null}</div>
      </KitProvider>
    );
  }
  layer.open('solve', <App />);
}
