/**
 * 状态栏设计预览（审阅用，不是验证）。用卡密预设真实的运行库与皮肤引擎渲染 SOLVE 状态栏：
 *   · 总览（无参数）：选一款皮肤，同时看电脑 1440 浅/深与手机 390 浅/深四个窗口（都是可操作的真页面）
 *   · 单窗（?skin=<id>&scheme=light|dark[&tab=角色]）：模拟酒馆页面 + 打开的状态栏面板
 * 数据：SOLVE 官方数据结构 + examples/official 示例（真引擎编译、计算值与投影）。
 * 构建：node design/statusbar-preview/build.mjs（需要卡密预设仓库，KAMI_ROOT 指定位置）。
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { CurrencyIcon } from '../../src/ui/statusbar/currency';
import { createRuntime } from 'kami/frontend/runtime/index';
import { SkinManager, type SkinEntry, type StoredSettings } from 'kami/frontend/skin-engine/manager';
import * as DS from 'kami/frontend/ds';
import kamiSkins from 'kami-skins';
import { compile, SolveCore, compileStructure, selectBgm } from '../../src/index';
import { exampleState, exampleStructure, exampleTextScales } from '../../examples/official/example';
import { IMAGES, MUSIC, MUSIC_CREDIT } from '../../examples/official/media';
import { KitProvider, type Kit } from '../../src/ui/kit';
import { StatusBar } from '../../src/ui/statusbar/views';
import { StatusModel } from '../../src/ui/statusbar/model';
import type { Interact } from '../../src/ui/statusbar/interact';
import type { LogicalState } from '../../src/types';
import statusCss from '../../src/ui/statusbar/statusbar.css';
import solveManifest from './solve-skin.json';
import solveSkinCss from './solve-skin.css';

declare const __BUILD__: string;
const PICK = ['suiguang', 'quest', 'neon'];
const entries: SkinEntry[] = [
  ...(kamiSkins as unknown as SkinEntry[]).filter(e => PICK.includes(e.manifest.id)),
  { manifest: solveManifest as unknown as SkinEntry['manifest'], css: solveSkinCss },
];
const NOTES: Record<string, string> = {
  suiguang: '卡密预设默认皮肤：宣纸与青瓷，安静的阅读感。',
  quest: '卡密「世界观」系列 · 西幻冒险：羊皮纸与金属。和示例的黑暗奇幻题材最贴。',
  neon: '卡密「朋克」系列 · 赛博朋克：切角、霓虹、扫描线，风格跨度最大，用来压力测试。',
  solve: 'SOLVE 独立皮肤：没有卡密预设时使用。松绿与暖石灰，像一块精密仪表盘。',
};
const q = new URLSearchParams(location.search);
const skinId = q.get('skin');
if (skinId) single(skinId, q.get('scheme') || 'light', q.get('view') || '横条'); else gallery();

function gallery(): void {
  document.body.classList.add('gallery');
  const order = [...PICK, 'solve'];
  const nameOf = (id: string) => entries.find(e => e.manifest.id === id)?.manifest.name ?? id;
  const root = document.createElement('div');
  root.id = 'gallery';
  root.innerHTML = `<header><h1>SOLVE 状态栏 · 设计预览 <small class="build">构建于 ${__BUILD__}</small></h1>
    <p class="lead">审阅用预览，不是验证（能不能用以酒馆实机为准）。数据是官方数据结构的示例：王都酒馆、第 42 轮、WOD 属性体系。有数据时浮着一条概览横条（电脑在上方、手机在输入框上方，可拖动，‹ 收成圆按钮），点一下展开面板，横条变成面板标题栏；× 收回横条。四个窗口都是可操作的真页面。</p>
    <nav class="skins" aria-label="皮肤">${order.map(id => `<button type="button" data-id="${id}">${nameOf(id)}${id === 'solve' ? '<small>独立</small>' : '<small>卡密</small>'}</button>`).join('')}</nav>
    <p class="note"></p>
    <div class="coins" aria-label="货币图标"></div>
    <details class="credits"><summary>图片与音乐来源（都是外链的网络资源）</summary>
      <p>图片：<a href="https://www.irasutoya.com/" target="_blank" rel="noopener">いらすとや</a>（みふねたかし），按其<a href="https://www.irasutoya.com/p/terms.html" target="_blank" rel="noopener">使用条款</a>免费使用（商用作品最多 20 张）。音乐：${MUSIC_CREDIT}。</p>
      <ul>${Object.entries(IMAGES).map(([k, v]) => `<li><code>${k}</code> <a href="${v.source}" target="_blank" rel="noopener">${v.title}</a> · ${v.artist} · ${v.license}</li>`).join('')}
      ${MUSIC.map(t => `<li><code>${t.id}</code> 「${t.title}」 · CC BY 4.0${t.moods.length ? ' · 情绪：' + t.moods.join('、') : ''}</li>`).join('')}</ul>
    </details>
    <p class="note audio-note">四个窗口默认静音；点窗口右上角 ♪ 打开播放，或 <a class="solo" target="_blank" rel="noopener">在新窗口单独打开</a>（点一下页面就开始播放当前场景的配乐）。</p>
    <nav class="tabs" aria-label="页签">${['横条', '按钮', '角色', '社交', '地图', '图鉴', '势力', '设定', '建筑'].map(t => `<button type="button" data-tab="${t}">${t}</button>`).join('')}</nav>
    <nav class="tabs scales" aria-label="量表与熟练度"><span>量表与熟练度：</span><button type="button" data-scales="num">数值</button><button type="button" data-scales="text">描述</button></nav></header>
    <section class="frames">
      <figure class="pc"><figcaption>电脑 1440 · 浅色</figcaption><div class="box"><iframe data-scheme="light" data-w="1440" data-h="900"></iframe></div></figure>
      <figure class="pc"><figcaption>电脑 1440 · 深色</figcaption><div class="box"><iframe data-scheme="dark" data-w="1440" data-h="900"></iframe></div></figure>
      <figure class="mobile"><figcaption>手机 390 · 浅色</figcaption><div class="box"><iframe data-scheme="light" data-w="390" data-h="844"></iframe></div></figure>
      <figure class="mobile"><figcaption>手机 390 · 深色</figcaption><div class="box"><iframe data-scheme="dark" data-w="390" data-h="844"></iframe></div></figure>
    </section>`;
  document.body.appendChild(root);
  const coins = ['金币', '银币', '铜币', '文', '银两', '美元', '人民币', '日元', '下品灵石', '中品灵石', '上品灵石', '极品灵石', '贝壳'];
  createRoot(root.querySelector('.coins')!).render(<>{coins.map(c => <span key={c}><CurrencyIcon name={c} size={24} />{c}{c === '贝壳' ? <small>（未识别→通用）</small> : null}</span>)}</>);
  let skin = order[0]!, tab = '横条', scales = 'num';
  const frames = Array.from(root.querySelectorAll<HTMLIFrameElement>('iframe'));
  const load = () => {
    root.querySelectorAll<HTMLButtonElement>('.skins button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === skin)));
    root.querySelectorAll<HTMLButtonElement>('.tabs button[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    root.querySelectorAll<HTMLButtonElement>('.tabs button[data-scales]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scales === scales)));
    root.querySelector('.note')!.textContent = NOTES[skin] ?? '';
    // The build stamp keeps the frames from coming out of the browser cache after a new deploy.
    const stamp = encodeURIComponent(__BUILD__);
    for (const f of frames) f.src = `${location.pathname}?skin=${skin}&scheme=${f.dataset.scheme}&view=${encodeURIComponent(tab)}&scales=${scales}&embed=1&b=${stamp}`;
    root.querySelector<HTMLAnchorElement>('.solo')!.href = `${location.pathname}?skin=${skin}&scheme=light&view=${encodeURIComponent(tab)}&scales=${scales}&b=${stamp}`;
  };
  root.querySelector('.skins')!.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (b?.dataset.id) { skin = b.dataset.id; load(); } });
  root.querySelectorAll('.tabs').forEach(nav => nav.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (b?.dataset.tab) { tab = b.dataset.tab; load(); } if (b?.dataset.scales) { scales = b.dataset.scales; load(); } }));
  const fit = () => { for (const f of frames) { const w = Number(f.dataset.w), h = Number(f.dataset.h), box = f.parentElement!; const s = box.clientWidth / w; f.style.width = w + 'px'; f.style.height = h + 'px'; f.style.transform = `scale(${s})`; box.style.height = h * s + 'px'; } };
  new ResizeObserver(fit).observe(root); fit(); load();
}

async function single(id: string, scheme: string, view: string): Promise<void> {
  document.body.classList.add('single');
  document.body.insertAdjacentHTML('afterbegin', `<div id="tavern" aria-hidden="true"><div class="topbar"></div><div class="chat">
    <div class="mes"><b>旁白</b><p>夜雨中的王都，醉橡木酒馆的门被推开了。炉火噼啪作响，角落里的吟游诗人抬起头。</p></div>
    <div class="mes user"><b>你</b><p>我抖掉斗篷上的雨水，在吧台边坐下。</p></div>
    <div class="mes"><b>旁白</b><p>米拉拨了一下琴弦：“又是你啊，被逐出骑士团的那位。今晚想听什么？”门边那副锈蚀的板甲里，幽蓝的火微微跳动。</p></div>
  </div><div class="input"></div></div>`);
  const rt = createRuntime(window);
  let saved: unknown = null;
  const store = { load: (): unknown => saved, save: (s: StoredSettings): void => { saved = JSON.parse(JSON.stringify(s)); } };
  const mgr = new SkinManager(store, rt, entries, window);
  mgr.select(id); mgr.setScheme(scheme); mgr.apply();
  document.documentElement.dataset.scheme = mgr.current.manifest.schemes[scheme] ? scheme : 'light';
  const layer = rt.layer();
  // Must come after Kami's sheets: a <style> element precedes adoptedStyleSheets and would declare
  // k.components first, ranking it below k.reset. Restate the order too.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('@layer k.reset, k.tokens, k.base, k.components, k.skin, k.lock;\n@layer k.components {\n' + statusCss + '\n}');
  layer.shadow.adoptedStyleSheets = [...layer.shadow.adoptedStyleSheets, sheet];

  const def = await compile(compileStructure(exampleStructure));
  const core = new SolveCore(def);
  // ?scales=text: 量表与熟练度 kept as sentences (the 描述 mode of the exclusive group).
  const initial = q.get('scales') === 'text' ? await exampleTextScales(core, await exampleState(core)) : await exampleState(core);
  // Background music, chosen by the engine's rules (place → region → mood). Browsers only start audio after a user gesture.
  const embed = q.get('embed') === '1';
  const audio = new Audio();
  audio.loop = true; audio.preload = 'none';
  const music = (state: LogicalState) => {
    const pick = selectBgm(def, state), places = (state.data as any).places ?? {};
    const placeName = (id?: string) => (id && (places[id]?.name as string)) || id || '';
    const source = pick.source === 'place' ? `当前地点「${placeName(pick.place)}」的配乐` : pick.source === 'region' ? `沿用区域「${placeName(pick.place)}」的配乐`
      : pick.source === 'mood' ? `按场景情绪「${pick.mood}」选曲` : '没有可用的曲目';
    return { pick, source };
  };
  // Player interactions run through the real engine as user actions (all-or-nothing); the preview keeps an undo
  // stack and lists what would be told to the model on the next turn (the tavern host injects it into the prompt).
  const kit = DS as unknown as Kit;
  // Launcher position, remembered per device class (the host does this in the tavern too).
  const key = 'solve.launcher.v1.' + (window.innerWidth > 1000 ? 'desktop' : 'mobile');
  let launcher: { pos?: { x: number; y: number }; tab?: string } = {};
  try { launcher = JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { launcher = {}; }
  const remember = (patch: object) => { try { launcher = { ...launcher, ...patch }; localStorage.setItem(key, JSON.stringify(launcher)); } catch { /* storage unavailable */ } };
  function App() {
    const [history, setHistory] = React.useState<{ state: LogicalState; narrate?: string }[]>([{ state: initial }]);
    const state = history.at(-1)!.state;
    const model = React.useMemo(() => new StatusModel(def, state), [state]);
    const { pick, source } = React.useMemo(() => music(state), [state]);
    React.useEffect(() => { if (pick.url && audio.src !== pick.url) { const was = !audio.paused; audio.src = pick.url; if (was) void audio.play().catch(() => undefined); } }, [pick.url]);
    const interact = React.useMemo<Interact>(() => ({
      async run({ ops, narrate }) {
        // Narration only (use / train / develop an ability): nothing changes until the model answers.
        if (!ops.length) { setHistory(h => [...h, { state, ...(narrate ? { narrate } : {}) }]); return { ok: true }; }
        const result = await core.execute([{ $group: ops }] as never, state, { source: 'user' });
        const errors = result.feedback.filter(f => f.level === 'L3');
        if (errors.length) return { ok: false, error: errors.map(f => f.message).join('；') };
        setHistory(h => [...h, { state: result.state, ...(narrate ? { narrate } : {}) }]);
        return { ok: true };
      },
      async undo() { if (history.length < 2) return false; setHistory(h => h.slice(0, -1)); return true; },
      pending: history.flatMap(h => h.narrate ? [h.narrate] : []),
    }), [state, history]);
    const [bgm, setBgm] = React.useState({ enabled: !embed, volume: 0.5 });
    const [playing, setPlaying] = React.useState(false);
    React.useEffect(() => {
      const on = () => setPlaying(true), off = () => setPlaying(false);
      audio.addEventListener('playing', on); audio.addEventListener('pause', off);
      return () => { audio.removeEventListener('playing', on); audio.removeEventListener('pause', off); };
    }, []);
    React.useEffect(() => {
      audio.volume = bgm.volume;
      if (!bgm.enabled || !pick.url) { audio.pause(); return undefined; }
      const start = () => { void audio.play().catch(() => undefined); };
      start();
      // Autoplay is blocked until the first gesture: retry on it.
      window.addEventListener('pointerdown', start, { once: true });
      return () => window.removeEventListener('pointerdown', start);
    }, [bgm.enabled, bgm.volume]);
    const mode = view === '横条' ? 'bar' : view === '按钮' ? 'dot' : 'panel';
    return (
      <KitProvider value={kit}>
        <StatusBar model={model} interact={interact} defaultMode={mode} {...(mode === 'panel' ? { defaultTab: view } : launcher.tab ? { defaultTab: launcher.tab } : {})} onTabChange={tab => remember({ tab })}
          {...(launcher.pos ? { position: launcher.pos } : {})} onPositionChange={pos => remember({ pos })}
          bgm={{ title: pick.track?.title ?? (pick.url ? decodeURIComponent(pick.url.split('/').pop() ?? '') : ''), source, playing, enabled: bgm.enabled, volume: bgm.volume, onToggle: v => setBgm(b => ({ ...b, enabled: v })), onVolume: v => setBgm(b => ({ ...b, volume: v })) }} />
      </KitProvider>
    );
  }
  layer.open('solve-status', <App />);
}
