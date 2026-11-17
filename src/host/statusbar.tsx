/**
 * The status bar in the tavern page: a shadow-DOM layer that shows the bound chat's state through the structure's
 * declared layout (src/ui/statusbar), with the player interactions, settings and music wired to the engine.
 *
 * Styling: when the Kami preset's runtime is on the page (KamiRuntimeNext), its design-system and skin sheets are
 * attached to this layer, so the status bar wears the player's Kami skin; otherwise SOLVE's default skin is used.
 * Either way React, the components and the status bar code are SOLVE's own.
 */
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { KitProvider } from '../ui/kit.js';
import { PortalContext, solveKit } from '../ui/kit-solve/index.js';
import { StatusBar, type BgmView, type Mode } from '../ui/statusbar/views.js';
import { StatusModel } from '../ui/statusbar/model.js';
import type { Interact } from '../ui/statusbar/interact.js';
import type { LocalPrefs, MusicHost, MusicTrack, SettingsHost } from '../ui/statusbar/settings.js';
import { UPDATE_DEFAULTS, type UpdateHost, type UpdatePrefs, type UpdateRun } from '../ui/statusbar/update.js';
import { listOperatorModels, migrateApi, PREFS_REV, testOperator } from './operator.js';
import { type GatePrefs, type StructureHost } from '../ui/statusbar/gate.js';
import { GATE, GateLayer, OPEN_GATE, gatePrefs as readGatePrefs } from './gate.js';
import { PRESETS_EVENT, applyPreset, deletePreset, lastSettings, listPresets, recordLast, savePreset } from './presets.js';
import type { BgmStatus } from './bgm.js';
import type { BgmTrack, Batch, CompiledDefinition, LogicalState } from '../types.js';
import tokensCss from '../ui/kit-solve/tokens.css';
import kitCss from '../ui/kit-solve/kit.css';
import statusCss from '../ui/statusbar/statusbar.css';
import debugCss from '../ui/debug/debug.css';
import builderCss from '../ui/builder/builder.css';
import { jerCss } from '../ui/debug/console.js';
import { xyCss } from '../ui/builder/blueprint.js';
import { DebugPanel } from '../ui/debug/panel.js';
import type { DebugHost } from '../ui/debug/shared.js';
import { StructureBuilder, type BuilderHost } from '../ui/builder/builder.js';
import { officialStructure } from '../official/structure.js';
import { VERSION } from '../version.js';
import { UPDATE_PREFS, detectCardMacros, injectTexts, type InjectionReport } from './inject.js';
import type { InjectKey } from '../ui/statusbar/inject.js';
import { ImageGenContext, imageFields, imageSpec, type ImageGenView } from '../ui/statusbar/imagegen.js';
import { IMAGE_DEFAULTS, IMAGE_PREFS, ImageService, PLUGIN_LABELS, type ImagePrefs } from './images.js';
import { dormant } from '../schema.js';
import { BUTTONS, BUTTONS_EVENT, BUTTON_PREFS, buttonPrefs, installButtons, shown as buttonShown, type ButtonPrefs } from './buttons.js';

const PREFS = 'solve.statusbar.prefs.v1';
const UPDATE = UPDATE_PREFS;
export { GATE };
const LAYERS = '@layer k.reset, k.tokens, k.base, k.components, k.skin, k.lock;';
interface ControllerLike {
  core: { definition: CompiledDefinition };
  getState(): LogicalState;
  getStatus(): { ready: boolean; busy: boolean; reason: string; pendingCount: number; generating?: boolean };
  subscribe(listener: () => void): () => void;
  runtime?: { getCommit(): { actions: { source: string; authorInputs?: any }[] } | undefined };
  preview(operations: Batch, authorInputs?: any): Promise<{ feedback: { level: string; message: string }[] }>;
  submit(operations: Batch, options?: { authorInputs?: any }): Promise<unknown>;
  undoUser(): Promise<unknown>;
  setModule(name: string, enabled: boolean): Promise<unknown>;
  setSettings(patch: any): Promise<unknown>;
}
interface SessionsLike { controller?: ControllerLike; subscribe(listener: () => void): () => void; getStatus?(): any; inspectArchive?(commitId?: string): Promise<any> }
interface BgmLike {
  status(): BgmStatus; setEnabled(v: boolean): void; setVolume(v: number): void; addTracks(t: BgmTrack[], into?: string[]): void; removeTrack(id: string): void; subscribe(l: () => void): () => void;
  setUseDefaults?(on: boolean): void; setActive?(id: string): void; next?(): void; preview?(id: string): void; updateTrack?(id: string, patch: { title?: string; moods?: string[] }): void;
  createCollection?(name: string, tracks?: string[]): string; renameCollection?(id: string, name: string): void; deleteCollection?(id: string): void; setInCollection?(id: string, tracks: string[], remove?: boolean): void;
  failed?: string;
}
export interface StatusBarHost { sessions(): SessionsLike | undefined; onSessions(listener: () => void): () => void; bgm(): BgmLike | undefined; injection?(): InjectionReport | undefined; source?: string }

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const read = <T,>(scope: any, key: string, fallback: T): T => { try { return JSON.parse(scope.localStorage?.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const write = (scope: any, key: string, value: unknown) => { try { scope.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };

/** ⚙ 设置 › 音乐 over the player (default library, the player's tracks, the card author's, collections). */
function musicHost(bgm: BgmLike, st: BgmStatus, model: StatusModel): MusicHost {
  const spec = (model.def as { bgm?: { mood?: string } }).bgm;
  const moodField = spec?.mood ? model.meta(spec.mood.split('.')) : undefined;
  const moods = moodField?.values ?? [...new Set(st.library.defaults.flatMap(t => t.moods))];
  const tracks: MusicTrack[] = [
    ...(st.library.defaults ?? []).map(t => ({ id: t.id, title: t.title ?? t.id, url: t.url, tags: t.moods, kind: 'default' as const,
      ...(t.composer || t.performer ? { detail: [t.composer, t.performer].filter(Boolean).join(' · ') } : {}), ...(t.seconds ? { seconds: t.seconds } : {}) })),
    ...st.library.player.map(t => ({ id: t.id, title: t.title ?? decodeURIComponent(t.url.split('/').pop() ?? t.url), url: t.url, tags: t.moods, kind: 'mine' as const })),
    ...st.library.author.map(t => ({ id: t.id, title: t.title ?? t.id, url: t.url, tags: t.moods, kind: 'author' as const })),
  ];
  const sel = st.selection as { track?: { id: string }; url?: string };
  return {
    tracks, collections: st.collections ?? [], active: st.active ?? 'all', useDefaults: st.useDefaults !== false, defaultsState: st.defaultsState ?? { state: 'off' }, moods, pool: st.pool ?? 0,
    ...(st.enabled && sel.track ? { playingId: sel.track.id } : {}), ...(bgm.failed && bgm.failed === sel.url ? { failed: true } : {}),
    setActive: id => bgm.setActive?.(id), setUseDefaults: on => bgm.setUseDefaults?.(on),
    add: (t, into) => bgm.addTracks([{ id: 'mine_' + Date.now().toString(36), url: t.url, moods: t.tags, ...(t.title ? { title: t.title } : {}) }], into),
    update: (id, patch) => bgm.updateTrack?.(id, { ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.tags ? { moods: patch.tags } : {}) }),
    remove: id => bgm.removeTrack(id),
    createCollection: (name, list) => bgm.createCollection?.(name, list) ?? '', renameCollection: (id, name) => bgm.renameCollection?.(id, name),
    deleteCollection: id => bgm.deleteCollection?.(id), setInCollection: (id, list, remove) => bgm.setInCollection?.(id, list, remove),
    preview: id => bgm.preview?.(id), next: () => bgm.next?.(),
  };
}

/** Mount once per page; follows chat binding changes. Returns a disposer. */
export function installStatusBar(scope: any, host: StatusBarHost): () => void {
  const doc: Document = scope.document;
  const el = doc.createElement('solve-statusbar');
  // The layer spans the viewport without taking clicks, and is itself the containing block of the fixed launcher and
  // panel: the tavern transforms <html> on phones (which would pin fixed elements to a 0-high box), and skins may give
  // the surface layout containment.
  el.setAttribute('style', 'position:fixed;left:0;top:0;width:100vw;height:100dvh;transform:translateZ(0);z-index:9990;pointer-events:none;display:block;');
  const shadow = el.attachShadow({ mode: 'open' });
  const surface = doc.createElement('div'); surface.setAttribute('data-k-surface', 'layer');
  const app = doc.createElement('div'), portal = doc.createElement('div');
  portal.setAttribute('data-k-portal', '');
  surface.append(app, portal); shadow.append(surface);
  doc.body.append(el);

  // ── styles: Kami's sheets when the preset runtime is present, SOLVE's default skin otherwise ──
  const sheet = (css: string) => { const s = new scope.CSSStyleSheet(); s.replaceSync(css); return s as CSSStyleSheet; };
  const own = sheet(LAYERS + '\n@layer k.components {\n' + statusCss + '\n' + jerCss + '\n' + xyCss + '\n' + debugCss + '\n' + builderCss + '\n}\n'
    + '[data-k-surface="layer"] { position: absolute; inset: 0; pointer-events: none; background: none; }\n'
    + '[data-k-surface="layer"] > div > * { pointer-events: auto; }');
  const standalone = [sheet(LAYERS + '\n' + tokensCss), sheet(LAYERS + '\n' + kitCss)];
  let detachKami: (() => void) | undefined, kamiAttrs: string[] = [];
  const darkPage = () => {
    // Follow the tavern theme: a dark page background gets the dark scheme.
    try {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/u.exec(scope.getComputedStyle(doc.body).backgroundColor);
      if (m) return (0.2126 * +m[1]! + 0.7152 * +m[2]! + 0.0722 * +m[3]!) / 255 < 0.5;
    } catch { /* fall through */ }
    try { return scope.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
  };
  const applyStyles = () => {
    const kami = read<{ skin?: string }>(scope, PREFS, {}).skin === 'solve' ? undefined : scope.KamiRuntimeNext;
    for (const name of kamiAttrs) surface.removeAttribute(name);
    kamiAttrs = [];
    if (kami?.hub && kami?.current) {
      if (!detachKami) {
        shadow.adoptedStyleSheets = [own];
        detachKami = kami.hub(doc).attach(shadow); // puts Kami's ds + skin sheets first, keeps ours after
      }
      for (const [name, value] of Object.entries(kami.current().attrs as Record<string, string>)) { surface.setAttribute(name, value); kamiAttrs.push(name); }
      surface.setAttribute('data-solve-skin', 'kami');
    } else {
      detachKami?.(); detachKami = undefined;
      shadow.adoptedStyleSheets = [...standalone, own];
      surface.setAttribute('data-k-mode', darkPage() ? 'dark' : 'light');
      surface.setAttribute('data-k-motion', 'full');
      surface.setAttribute('data-solve-skin', 'solve');
    }
  };
  applyStyles();
  const onSkin = () => applyStyles();
  doc.addEventListener('kami:skin-changed', onSkin);
  doc.addEventListener('kami-runtime-ready', onSkin);
  doc.addEventListener('solve:statusbar-prefs', onSkin);

  // Phones: the floating bar sits just above the input area (its buttons row included), however tall that is.
  let watched: Element | null = null;
  const fit = () => {
    const form = doc.getElementById('send_form');
    if (form !== watched) { resize?.disconnect(); watched = form; if (form) resize?.observe(form); }
    if (!form) { el.style.removeProperty('--solve-launcher-bottom'); return; }
    const gap = Math.round(scope.innerHeight - form.getBoundingClientRect().top + 8);
    if (gap > 0 && gap < scope.innerHeight / 2) el.style.setProperty('--solve-launcher-bottom', gap + 'px'); else el.style.removeProperty('--solve-launcher-bottom');
  };
  const resize: ResizeObserver | undefined = typeof scope.ResizeObserver === 'function' ? new scope.ResizeObserver(() => fit()) : undefined;
  const fitTimer = scope.setInterval?.(fit, 2000);
  scope.addEventListener?.('resize', fit);
  fit();

  const root: Root = createRoot(app);
  root.render(<PortalContext.Provider value={portal}><KitProvider value={solveKit}><Live scope={scope} host={host} /></KitProvider></PortalContext.Provider>);
  const removeMenu = installWandMenu(scope);
  const removeButtons = installButtons(scope, { controller: () => host.sessions()?.controller as never, onSessions: host.onSessions,
    openDebug: () => doc.dispatchEvent(new scope.CustomEvent(OPEN_EVENT, { detail: 'debug' })) });
  return () => {
    doc.removeEventListener('kami:skin-changed', onSkin); doc.removeEventListener('kami-runtime-ready', onSkin); doc.removeEventListener('solve:statusbar-prefs', onSkin);
    removeMenu(); removeButtons(); detachKami?.(); root.unmount(); el.remove();
    resize?.disconnect(); scope.clearInterval?.(fitTimer); scope.removeEventListener?.('resize', fit);
  };
}

/** Entries in the tavern's wand menu (bottom left). Each one asks the layer to open a surface. */
export type Surface = 'settings' | 'debug' | 'builder';
export const OPEN_EVENT = 'solve:open';
const MENU: [Surface, string, string][] = [['settings', 'fa-sliders', 'SOLVE 设置'], ['debug', 'fa-bug', 'SOLVE 调试'], ['builder', 'fa-pen-ruler', 'SOLVE 结构制作']];
function installWandMenu(scope: any): () => void {
  const doc: Document = scope.document;
  let box: HTMLElement | undefined, timer: any;
  const add = () => {
    const menu = doc.getElementById('extensionsMenu');
    if (!menu) return false;
    if (doc.getElementById('solve_wand_container')) return true;
    box = doc.createElement('div'); box.id = 'solve_wand_container'; box.className = 'extension_container';
    for (const [id, icon, label] of MENU) {
      const item = doc.createElement('div');
      item.className = 'list-group-item flex-container flexGap5 interactable'; item.tabIndex = 0; item.dataset.solveOpen = id;
      const i = doc.createElement('div'); i.className = `fa-fw fa-solid ${icon} extensionsMenuExtensionButton`;
      const span = doc.createElement('span'); span.textContent = label;
      item.append(i, span);
      const open = () => doc.dispatchEvent(new scope.CustomEvent(OPEN_EVENT, { detail: id }));
      item.addEventListener('click', open);
      item.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      box.append(item);
    }
    menu.append(box);
    return true;
  };
  // The tavern renders the wand menu after extensions load; wait for it.
  if (!add()) { let tries = 0; timer = scope.setInterval(() => { if (add() || ++tries > 120) scope.clearInterval(timer); }, 500); }
  return () => { scope.clearInterval?.(timer); box?.remove(); };
}

/** Re-renders on every engine change; the status bar shows only for a bound chat with a layout, the debug panel and builder open from the wand menu. */
function Live({ scope, host }: { scope: any; host: StatusBarHost }) {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  const sessions = host.sessions();
  const controller = sessions?.controller;
  React.useEffect(() => host.onSessions(tick), [host]);
  React.useEffect(() => controller?.subscribe(tick), [controller]);
  const bgm = host.bgm();
  React.useEffect(() => bgm?.subscribe(tick), [bgm]);
  const [debug, setDebug] = React.useState(false);
  const [builder, setBuilder] = React.useState(false);
  const [settingsAt, setSettingsAt] = React.useState(0);
  const images = React.useMemo(() => new ImageService(scope), [scope]);
  let bar: { def: CompiledDefinition; state: LogicalState } | undefined;
  if (controller) {
    const def = controller.core.definition;
    const display = (def.display ?? {}) as { layout?: unknown[]; render?: unknown };
    let state: LogicalState | undefined;
    try { state = controller.getState(); } catch { state = undefined; }
    if (state && display.render !== false && Array.isArray(display.layout) && display.layout.length) bar = { def, state };
  }
  const hasBar = React.useRef(false); hasBar.current = !!bar;
  React.useEffect(() => {
    const doc: Document = scope.document;
    const onOpen = (e: Event) => {
      const what = (e as CustomEvent).detail as Surface;
      if (what === 'debug') setDebug(true);
      else if (what === 'builder') setBuilder(true);
      else if (what === 'settings') {
        if (hasBar.current) setSettingsAt(Date.now());
        else if (!host.sessions()?.controller && ['choose', 'off', 'error', 'unbound'].includes(String((host.sessions()?.getStatus?.() as { phase?: string } | undefined)?.phase))) {
          // No SOLVE in this chat yet: the way in is 选择数据结构.
          doc.dispatchEvent(new scope.CustomEvent(OPEN_GATE));
        }
        else {
          // Say why: the session's own reason (not bound, still loading, an error), not a generic sentence.
          const st = host.sessions()?.getStatus?.() as { phase?: string; reason?: string } | undefined;
          const ctl = host.sessions()?.controller;
          let detail: string;
          if (!host.sessions()) detail = '这张角色卡没有加载 SOLVE（SOLVE 写在角色脚本里时，只在那张卡上生效；也可能还在加载）。';
          else if (ctl && !(ctl.core.definition.display as { layout?: unknown[] } | undefined)?.layout?.length) detail = '这张卡的数据结构没有状态栏。';
          else if (st?.phase === 'loading') detail = `SOLVE 正在恢复这个聊天（${st.reason || '请稍等'}），稍后再试。`;
          else if (st?.phase === 'error') detail = `SOLVE 绑定这个聊天时出错：${st.reason || '原因未知'}。可以刷新页面，或在「SOLVE 调试 › 概览」里查看。`;
          else detail = `当前聊天没有启用 SOLVE：${st?.reason || '原因未知'}。`;
          if (scope.toastr?.info) scope.toastr[st?.phase === 'error' ? 'error' : 'info'](detail, 'SOLVE', { timeOut: 12000 }); else scope.alert?.(detail);
        }
      }
    };
    doc.addEventListener(OPEN_EVENT, onOpen);
    return () => doc.removeEventListener(OPEN_EVENT, onOpen);
  }, [scope]);
  const debugHost = React.useMemo<DebugHost>(() => ({
    version: `SOLVE ${VERSION}`,
    ...(host.source ? { source: host.source } : {}),
    ...(host.injection ? { injection: host.injection } : {}),
    sessions: {
      get controller() { return host.sessions()?.controller as DebugHost['sessions']['controller']; },
      subscribe: (listener: () => void) => host.onSessions(listener),
      getStatus: () => host.sessions()?.getStatus?.() ?? { phase: 'idle', reason: 'SOLVE 尚未加载' },
      inspectArchive: (commitId?: string) => { const s = host.sessions(); if (!s?.inspectArchive) throw new Error('SOLVE 尚未加载'); return s.inspectArchive(commitId); },
    },
  }), [host]);
  let character: string | undefined;
  try { const ctx = scope.SillyTavern?.getContext?.(); character = ctx?.characters?.[ctx.characterId]?.name; } catch { character = undefined; }
  const builderHost: BuilderHost = {
    start: officialStructure, published: officialStructure, official: officialStructure,
    ...(character ? { character } : {}),
    sample: () => { try { return host.sessions()?.controller?.getState(); } catch { return undefined; } },
  };
  return (
    <>
      {/* Separate stacking contexts: the builder above the debug panel above the status bar. */}
      <div style={{ position: 'relative', zIndex: 1 }}>{controller && bar
        ? <Bound key={bar.def.fingerprint} scope={scope} controller={controller} def={bar.def} state={bar.state} {...(bgm ? { bgm } : {})} images={images}
          extras={{ openDebug: () => setDebug(true), openBuilder: () => setBuilder(true), ...(settingsAt ? { openSettings: settingsAt } : {}), choices: structureChoices(host) }} />
        : null}</div>
      <div style={{ position: 'relative', zIndex: 1 }}>{controller ? null
        : <GateLayer scope={scope} sessions={host.sessions as never} onSessions={host.onSessions} openDebug={() => setDebug(true)} />}</div>
      <div style={{ position: 'relative', zIndex: 2 }}>{debug ? <DebugPanel host={debugHost} onClose={() => setDebug(false)} /> : null}</div>
      <div style={{ position: 'relative', zIndex: 3 }}>{builder ? <StructureBuilder host={builderHost} onClose={() => setBuilder(false)} /> : null}</div>
    </>
  );
}

/** 清除本机数据: SOLVE's keys in localStorage and its IndexedDB cache. */
export async function clearLocalData(scope: any): Promise<number> {
  let n = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < scope.localStorage.length; i++) { const k = scope.localStorage.key(i); if (k && /^solve[.:]/u.test(k)) keys.push(k); }
    for (const k of keys) { scope.localStorage.removeItem(k); n++; }
  } catch { /* storage unavailable */ }
  try {
    const dbs: { name?: string }[] = typeof scope.indexedDB?.databases === 'function' ? await scope.indexedDB.databases() : [{ name: 'solve-cache-v05' }];
    for (const db of dbs) if (db.name && /^solve/u.test(db.name)) {
      await new Promise<void>(resolve => { const r = scope.indexedDB.deleteDatabase(db.name); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
      n++;
    }
  } catch { /* no IndexedDB */ }
  return n;
}

/** The structures a chat can start with (for 设置 › 数据结构 › 默认数据结构). */
function structureChoices(host: StatusBarHost): { id: string; label: string; detail?: string }[] {
  try {
    const list = (host.sessions() as { candidates?(): { id: string; label: string; version: string }[] } | undefined)?.candidates?.() ?? [];
    return [...new Map(list.map(c => [c.id, { id: c.id, label: c.label, detail: c.version }])).values()];
  } catch { return []; }
}

/** Opening view (previews) and the debug-panel entry. */
export interface StatusBarExtras { initial?: { mode?: Mode; tab?: string; settings?: boolean; section?: string }; openDebug?: () => void; openBuilder?: () => void; openSettings?: number; update?: Partial<UpdateHost>; structure?: Partial<StructureHost>; choices?: { id: string; label: string; detail?: string }[] }
/** The status bar for one bound controller (the tavern host and the design preview both render this). */
export function Bound({ scope, controller, def, state, bgm, images, extras = {} }: { scope: any; controller: ControllerLike; def: CompiledDefinition; state: LogicalState; bgm?: BgmLike; images?: ImageService; extras?: StatusBarExtras }) {
  const status = controller.getStatus();
  const [prefs, setPrefs] = React.useState<LocalPrefs>(() => ({ revealSpoilers: false, ...read(scope, PREFS, {}) }));
  React.useEffect(() => {
    write(scope, PREFS, prefs);
    try { scope.document.dispatchEvent(new scope.CustomEvent('solve:statusbar-prefs')); } catch { /* old browser */ }
  }, [prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  // ── 生图: generated pictures are shown over the entities' `image` / `thumb`; they are not engine state ──
  const fields = React.useMemo(() => imageFields({ def } as StatusModel), [def]);
  const gen = images && fields.length ? images : undefined;
  const [imgPrefs, setImgPrefs] = React.useState<ImagePrefs>(() => ({ ...IMAGE_DEFAULTS, ...read<Partial<ImagePrefs>>(scope, IMAGE_PREFS, {}) }));
  React.useEffect(() => { write(scope, IMAGE_PREFS, imgPrefs); }, [imgPrefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [imgRev, imgTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => gen?.subscribe(imgTick), [gen]);
  React.useEffect(() => {
    // Plugins finish loading at their own pace (the built-in one ~15 s after the page): watch their readiness.
    if (!gen) return;
    let sig = '';
    const check = () => { const s = JSON.stringify(gen.plugins().map(p => [p.installed, p.ready])); if (s !== sig) { sig = s; imgTick(); } };
    const timer = scope.setInterval(check, 3000);
    return () => scope.clearInterval(timer);
  }, [gen]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = React.useMemo(() => gen ? overlayImages(def, state, gen) : state, [def, state, gen, imgRev]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    // 自动生成: entities whose prompt has no picture yet (authored art stays as it is).
    if (!gen || imgPrefs.mode !== 'auto' || !status.ready || status.generating || !gen.pick(imgPrefs)) return;
    const m = new StatusModel(def, state);
    for (const f of fields) for (const parts of expand(state.data, f.owner.split('.'))) {
      if (!imageSpec(m, parts)) continue;
      const v = m.value(parts), prompt = typeof v?.imagePrompt === 'string' ? v.imagePrompt.trim() : '', key = parts.join('.');
      if (!prompt || v.image || v.thumb || gen.job(key) || gen.record(key)?.versions.some(x => x.prompt === prompt)) continue;
      gen.generate(key, prompt, f.shape, imgPrefs);
    }
  }, [state, imgPrefs, status.ready, status.generating]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = React.useMemo(() => new StatusModel(def, shown, { revealSpoilers: prefs.revealSpoilers }), [def, shown, prefs.revealSpoilers]);
  const picked = gen?.pick(imgPrefs);
  const genView: ImageGenView | undefined = gen ? {
    mode: imgPrefs.mode,
    plugin: picked ? { label: PLUGIN_LABELS[picked] } : { missing: imgPrefs.plugin === 'auto' ? '没有检测到可用的生图插件，请在「设置 → 生图」里查看' : `「${PLUGIN_LABELS[imgPrefs.plugin]}」没有安装或还没加载完` },
    record: key => gen.record(key), job: key => gen.job(key),
    generate: (key, prompt, shape) => gen.generate(key, prompt, shape, imgPrefs),
    cancel: key => gen.cancel(key), dismiss: key => gen.dismiss(key), select: (key, i) => void gen.select(key, i),
  } : undefined;
  const locked = !status.ready ? (status.reason || 'SOLVE 状态尚未就绪') : status.generating ? '模型正在回复，回复完成后再操作'
    : status.pendingCount ? '有待保存的操作，请先在调试面板处理' : undefined;
  // What the next turn will tell the model: the narrations of the player's actions on the current reply.
  let pending: string[] = [];
  try {
    pending = (controller.runtime?.getCommit()?.actions ?? []).filter(a => a.source === 'user')
      .map(a => a.authorInputs?.narrate).filter((n): n is string => typeof n === 'string' && !!n.trim());
  } catch { pending = []; }
  const guard = async (task: () => Promise<unknown>): Promise<{ ok: true } | { ok: false; error: string }> => {
    try { await task(); return { ok: true }; } catch (error) { return { ok: false, error: message(error) }; }
  };
  const interact: Interact = {
    async run({ ops, narrate }) {
      if (locked) return { ok: false, error: locked };
      const batch: Batch = ops.length ? [{ $group: ops }] as unknown as Batch : [] as unknown as Batch;
      const authorInputs = narrate ? { narrate } : undefined;
      // Dry run first: a rejected action never reaches the chat.
      try {
        const trial = await controller.preview(batch, authorInputs);
        const errors = trial.feedback.filter(f => f.level === 'L3');
        if (errors.length) return { ok: false, error: errors.map(f => f.message).join('；') };
      } catch (error) { return { ok: false, error: message(error) }; }
      return guard(() => controller.submit(batch, authorInputs ? { authorInputs } : {}));
    },
    async undo() { try { await controller.undoUser(); return true; } catch { return false; } },
    ...(locked ? { locked } : {}),
    pending,
  };
  // Who writes the operations (this browser). The controller reads it from storage on every reply.
  const [updatePrefs, setUpdatePrefs] = React.useState<UpdatePrefs>(() => {
    const saved = { ...UPDATE_DEFAULTS, ...read<Partial<UpdatePrefs>>(scope, UPDATE, {}) };
    // Old defaults were saved with the rest; the controller reads them as the current one (operator.ts).
    return { ...saved, api: migrateApi({ ...UPDATE_DEFAULTS.api, ...saved.api }, saved.rev), rev: PREFS_REV };
  });
  React.useEffect(() => { write(scope, UPDATE, updatePrefs); }, [updatePrefs]); // eslint-disable-line react-hooks/exhaustive-deps
  // Macros the card already writes (auto injection skips them); rechecked when the card changes.
  const [cardMacros, setCardMacros] = React.useState<InjectKey[] | undefined>();
  React.useEffect(() => { let live = true; void detectCardMacros(scope).then(m => { if (live) setCardMacros(m); }); return () => { live = false; }; }, [def.fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  let ctx: any; try { ctx = scope.SillyTavern?.getContext?.(); } catch { ctx = undefined; }
  const savedProfiles = (ctx?.extensionSettings?.connectionManager?.profiles ?? []) as { id: string; name: string; model?: string }[];
  const update: UpdateHost = {
    prefs: updatePrefs, onPrefs: patch => setUpdatePrefs(p => ({ ...p, ...patch })),
    cardMode: (status as { cardMode?: 'in-band' | 'out-of-band'; mode?: 'in-band' | 'out-of-band' }).cardMode ?? (status as { mode?: 'in-band' | 'out-of-band' }).mode ?? 'in-band',
    test: () => testOperator(scope),
    ...(updatePrefs.source === 'custom' ? { models: () => listOperatorModels(scope) } : {}),
    ...((controller as { lastOperator?: UpdateRun }).lastOperator ? { last: (controller as { lastOperator?: UpdateRun }).lastOperator! } : {}),
    ...((controller as { generateOperations?: unknown }).generateOperations ? { rerun: async (): Promise<UpdateRun> => {
      try { await (controller as any).generateOperations(); } catch (error) { return (controller as any).lastOperator ?? { ok: false, at: Date.now(), error: message(error) }; }
      return (controller as any).lastOperator ?? { ok: true, at: Date.now() };
    } } : {}),
    ...(savedProfiles.length ? { profiles: savedProfiles.map(x => ({ id: x.id, name: x.name, ...(x.model ? { detail: x.model } : {}) })) } : {}),
    ...((controller as { getContextPreview?: () => { operatorPrompt?: string } }).getContextPreview ? { prompt: () => (controller as any).getContextPreview().operatorPrompt ?? '' } : {}),
    ...((controller as { runtime?: unknown }).runtime ? { injectTexts: () => { try { return injectTexts(controller as never, updatePrefs.inject?.format ?? 'toon'); } catch { return {}; } } } : {}),
    ...(cardMacros ? { cardMacros } : {}),
    ...extras.update,
  };
  // 选择数据结构 for new chats (this browser).
  const [gatePrefs, setGatePrefs] = React.useState<GatePrefs>(() => readGatePrefs(scope));
  React.useEffect(() => { write(scope, GATE, gatePrefs); }, [gatePrefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const structure: StructureHost = {
    prefs: gatePrefs, onPrefs: patch => setGatePrefs(p => ({ ...p, ...patch })),
    choices: extras.choices?.length ? extras.choices : [{ id: 'solve-official', label: 'SOLVE 官方数据结构' }],
    chat: { reason: `这个聊天用「${(def as { label?: string }).label ?? def.id}」${def.version ? ' ' + def.version : ''}。一个聊天开局后不能换数据结构；想换就开一个新聊天。` },
    ...extras.structure,
  };
  // 设置存档 (the account): named sets of this structure's per-chat settings, and 「上次的设置」 recorded on every change.
  const [, presetsTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => { const doc: Document = scope.document; doc.addEventListener(PRESETS_EVENT, presetsTick); return () => doc.removeEventListener(PRESETS_EVENT, presetsTick); }, [scope]);
  const andRecord = <T,>(task: () => Promise<T>) => async () => { const r = await task(); recordLast(scope, controller as never); return r; };
  const bgmStatus = bgm?.status();
  const [btnPrefs, setBtnPrefs] = React.useState<ButtonPrefs>(() => buttonPrefs(scope));
  const settings: SettingsHost = {
    setModule: (name, on) => locked ? Promise.resolve({ ok: false, error: locked }) : guard(andRecord(() => controller.setModule(name, on))),
    setSettings: patch => locked ? Promise.resolve({ ok: false, error: locked }) : guard(andRecord(() => controller.setSettings(patch))),
    clearLocal: () => clearLocalData(scope),
    presets: {
      list: listPresets(scope, def.id).map(p => ({ id: p.id, name: p.name, savedAt: p.savedAt })),
      ...(lastSettings(scope, def.id) ? { last: lastSettings(scope, def.id)!.savedAt } : {}),
      save: name => { try { savePreset(scope, controller as never, name); return { ok: true }; } catch (e) { return { ok: false, error: message(e) }; } },
      overwrite: id => { try { const p = listPresets(scope, def.id).find(x => x.id === id); savePreset(scope, controller as never, p?.name ?? '未命名', id); return { ok: true }; } catch (e) { return { ok: false, error: message(e) }; } },
      remove: id => deletePreset(scope, def.id, id),
      apply: id => locked ? Promise.resolve({ ok: false, error: locked }) : guard(async () => {
        const values = id === 'last' ? lastSettings(scope, def.id) : listPresets(scope, def.id).find(x => x.id === id);
        if (!values) throw new Error('这套设置已经不在了');
        await applyPreset(controller as never, values); recordLast(scope, controller as never);
      }),
    },
    prefs, onPrefs: patch => setPrefs(p => ({ ...p, ...patch })),
    ...(scope.KamiRuntimeNext?.hub ? { kami: true } : {}),
    ...(bgm && bgmStatus ? { music: musicHost(bgm, bgmStatus, model) } : {}),
    ...(locked ? { locked } : {}),
    ...(extras.openDebug ? { openDebug: extras.openDebug } : {}),
    ...(extras.openBuilder ? { openBuilder: extras.openBuilder } : {}),
    update,
    structure,
    buttons: {
      list: BUTTONS.map(b => ({ id: b.id, label: b.label, desc: b.desc, on: buttonShown(btnPrefs, b) })),
      onToggle: (id, on) => {
        const next = { ...btnPrefs, [id]: on };
        setBtnPrefs(next); write(scope, BUTTON_PREFS, next);
        try { scope.document.dispatchEvent(new scope.CustomEvent(BUTTONS_EVENT)); } catch { /* old browser */ }
      },
    },
    ...(gen ? { images: {
      prefs: imgPrefs, onPrefs: patch => setImgPrefs(p => ({ ...p, ...patch } as ImagePrefs)),
      plugins: gen.plugins(), ...(picked ? { active: PLUGIN_LABELS[picked] } : {}), usage: gen.usage(),
      prune: () => gen.prune(new Set(fields.flatMap(f => expand(state.data, f.owner.split('.')).map(p => p.join('.'))))),
    } } : {}),
    ...(extras.initial?.section ? { section: extras.initial.section } : {}),
  };
  const bgmView: BgmView | undefined = bgm && bgmStatus && bgmStatus.selection ? (() => {
    const sel = bgmStatus.selection as any, places = (state.data as any)?.places ?? {};
    const placeName = (id?: string) => (id && (places[id]?.name as string)) || id || '';
    const source = sel.source === 'place' ? `当前地点「${placeName(sel.place)}」的配乐` : sel.source === 'region' ? `沿用区域「${placeName(sel.place)}」的配乐`
      : sel.source === 'mood' ? `按场景情绪「${sel.mood}」选曲` : '没有可用的曲目';
    const title = sel.track?.title ?? (sel.url ? decodeURIComponent(String(sel.url).split('/').pop() ?? '') : '');
    return { title, source: bgmStatus.blocked ? source + '（点一下页面即可开始播放）' : source, playing: bgmStatus.playing, enabled: bgmStatus.enabled, volume: bgmStatus.volume,
      onToggle: v => bgm.setEnabled(v), onVolume: v => bgm.setVolume(v) };
  })() : undefined;
  // Launcher place, last tab and folded/open state, per device class.
  const key = 'solve.statusbar.launcher.v1.' + (scope.innerWidth > 1000 ? 'desktop' : 'mobile');
  const [saved] = React.useState(() => ({ ...read<{ pos?: { x: number; y: number }; tab?: string; mode?: Mode }>(scope, key, {}), ...extras.initial }));
  const remember = (patch: object) => write(scope, key, { ...read(scope, key, {}), ...patch });
  return (
    <ImageGenContext.Provider value={genView}><StatusBar model={model} interact={interact} settings={settings} {...(bgmView ? { bgm: bgmView } : {})}
      defaultMode={saved.mode ?? 'bar'} {...(saved.settings ? { defaultSettings: true } : {})} onModeChange={mode => { if (mode !== 'panel') remember({ mode }); }}
      {...(extras.openSettings ? { openSettings: extras.openSettings } : {})}
      {...(saved.tab ? { defaultTab: saved.tab } : {})} onTabChange={tab => remember({ tab })}
      {...(saved.pos ? { position: saved.pos } : {})} onPositionChange={pos => remember({ pos })} /></ImageGenContext.Provider>
  );
}

/** Concrete paths matching a pattern (`characters.*` → each character). */
function expand(data: unknown, pattern: string[], at: string[] = []): string[][] {
  if (!pattern.length) return data && typeof data === 'object' ? [at] : [];
  if (!data || typeof data !== 'object') return [];
  const [head, ...rest] = pattern;
  const keys = head === '*' ? Object.keys(data) : [head!];
  return keys.flatMap(k => expand((data as Record<string, unknown>)[k], rest, [...at, k]));
}
/** The state as the status bar shows it: each entity with a generated picture wears it as `image` / `thumb`. */
function overlayImages(def: CompiledDefinition, state: LogicalState, images: ImageService): LogicalState {
  const records = images.records();
  let data = state.data as Record<string, unknown>;
  for (const [key, r] of Object.entries(records)) {
    const v = r.versions[r.current];
    const parts = key.split('.');
    if (!v || dormant(def, state, [...parts, 'imagePrompt'])) continue;
    const next = setIn(data, parts, { image: v.url, thumb: v.url });
    if (next) data = next;
  }
  return data === state.data ? state : { ...state, data } as LogicalState;
}
function setIn(data: Record<string, unknown>, parts: string[], patch: Record<string, unknown>): Record<string, unknown> | undefined {
  const [head, ...rest] = parts;
  const child = data[head!];
  if (!child || typeof child !== 'object' || Array.isArray(child)) return undefined;
  const next = rest.length ? setIn(child as Record<string, unknown>, rest, patch) : { ...(child as object), ...patch };
  return next ? { ...data, [head!]: next } : undefined;
}
