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
import type { LocalPrefs, SettingsHost } from '../ui/statusbar/settings.js';
import { UPDATE_DEFAULTS, type UpdateHost, type UpdatePrefs } from '../ui/statusbar/update.js';
import { GATE_DEFAULTS, type GatePrefs, type StructureHost } from '../ui/statusbar/gate.js';
import type { BgmStatus } from './bgm.js';
import type { BgmTrack, Batch, CompiledDefinition, LogicalState } from '../types.js';
import tokensCss from '../ui/kit-solve/tokens.css';
import kitCss from '../ui/kit-solve/kit.css';
import statusCss from '../ui/statusbar/statusbar.css';

const PREFS = 'solve.statusbar.prefs.v1';
const UPDATE = 'solve.update.v1';
export const GATE = 'solve.gate.v1';
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
interface SessionsLike { controller?: ControllerLike; subscribe(listener: () => void): () => void }
interface BgmLike { status(): BgmStatus; setEnabled(v: boolean): void; setVolume(v: number): void; addTracks(t: BgmTrack[]): void; removeTrack(id: string): void; subscribe(l: () => void): () => void }
export interface StatusBarHost { sessions(): SessionsLike | undefined; onSessions(listener: () => void): () => void; bgm(): BgmLike | undefined }

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const read = <T,>(scope: any, key: string, fallback: T): T => { try { return JSON.parse(scope.localStorage?.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const write = (scope: any, key: string, value: unknown) => { try { scope.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };

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
  const own = sheet(LAYERS + '\n@layer k.components {\n' + statusCss + '\n}\n'
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

  const root: Root = createRoot(app);
  root.render(<PortalContext.Provider value={portal}><KitProvider value={solveKit}><Live scope={scope} host={host} /></KitProvider></PortalContext.Provider>);
  return () => {
    doc.removeEventListener('kami:skin-changed', onSkin); doc.removeEventListener('kami-runtime-ready', onSkin); doc.removeEventListener('solve:statusbar-prefs', onSkin);
    detachKami?.(); root.unmount(); el.remove();
  };
}

/** Re-renders on every engine change of the bound chat; renders nothing while unbound or without a layout. */
function Live({ scope, host }: { scope: any; host: StatusBarHost }) {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  const sessions = host.sessions();
  const controller = sessions?.controller;
  React.useEffect(() => host.onSessions(tick), [host]);
  React.useEffect(() => controller?.subscribe(tick), [controller]);
  const bgm = host.bgm();
  React.useEffect(() => bgm?.subscribe(tick), [bgm]);
  if (!controller) return null;
  const def = controller.core.definition;
  const display = (def.display ?? {}) as { layout?: unknown[]; render?: unknown };
  if (display.render === false || !Array.isArray(display.layout) || !display.layout.length) return null;
  let state: LogicalState | undefined;
  try { state = controller.getState(); } catch { state = undefined; }
  if (!state) return null;
  return <Bound key={def.fingerprint} scope={scope} controller={controller} def={def} state={state} {...(bgm ? { bgm } : {})} />;
}

/** Opening view (previews) and the debug-panel entry. */
export interface StatusBarExtras { initial?: { mode?: Mode; tab?: string; settings?: boolean; section?: string }; openDebug?: () => void; openBuilder?: () => void; update?: Partial<UpdateHost>; structure?: Partial<StructureHost> }
/** The status bar for one bound controller (the tavern host and the design preview both render this). */
export function Bound({ scope, controller, def, state, bgm, extras = {} }: { scope: any; controller: ControllerLike; def: CompiledDefinition; state: LogicalState; bgm?: BgmLike; extras?: StatusBarExtras }) {
  const status = controller.getStatus();
  const [prefs, setPrefs] = React.useState<LocalPrefs>(() => ({ revealSpoilers: false, ...read(scope, PREFS, {}) }));
  React.useEffect(() => {
    write(scope, PREFS, prefs);
    try { scope.document.dispatchEvent(new scope.CustomEvent('solve:statusbar-prefs')); } catch { /* old browser */ }
  }, [prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = React.useMemo(() => new StatusModel(def, state, { revealSpoilers: prefs.revealSpoilers }), [def, state, prefs.revealSpoilers]);
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
  // Who writes the operations (this browser). Read by the settings page; the controller does not use it yet.
  const [updatePrefs, setUpdatePrefs] = React.useState<UpdatePrefs>(() => ({ ...UPDATE_DEFAULTS, ...read<Partial<UpdatePrefs>>(scope, UPDATE, {}) }));
  React.useEffect(() => { write(scope, UPDATE, updatePrefs); }, [updatePrefs]); // eslint-disable-line react-hooks/exhaustive-deps
  let ctx: any; try { ctx = scope.SillyTavern?.getContext?.(); } catch { ctx = undefined; }
  const savedProfiles = (ctx?.extensionSettings?.connectionManager?.profiles ?? []) as { id: string; name: string; model?: string }[];
  const update: UpdateHost = {
    prefs: updatePrefs, onPrefs: patch => setUpdatePrefs(p => ({ ...p, ...patch })),
    cardMode: (status as { mode?: 'in-band' | 'out-of-band' }).mode ?? 'in-band',
    ...(savedProfiles.length ? { profiles: savedProfiles.map(x => ({ id: x.id, name: x.name, ...(x.model ? { detail: x.model } : {}) })) } : {}),
    ...((controller as { getContextPreview?: () => { operatorPrompt?: string } }).getContextPreview ? { prompt: () => (controller as any).getContextPreview().operatorPrompt ?? '' } : {}),
    ...extras.update,
  };
  // Default structure and the chat-entry checks (this browser). Read by the settings page; chat entry does not use it yet.
  const [gatePrefs, setGatePrefs] = React.useState<GatePrefs>(() => ({ ...GATE_DEFAULTS, ...read<Partial<GatePrefs>>(scope, GATE, {}) }));
  React.useEffect(() => { write(scope, GATE, gatePrefs); }, [gatePrefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const structure: StructureHost = {
    prefs: gatePrefs, onPrefs: patch => setGatePrefs(p => ({ ...p, ...patch })),
    choices: [{ id: 'official', label: '官方数据结构', detail: 'SOLVE 自带' }],
    chat: { on: true, reason: `正在使用「${(def as { label?: string }).label ?? def.id}」${def.version ? ' ' + def.version : ''}` },
    ...extras.structure,
  };
  const bgmStatus = bgm?.status();
  const settings: SettingsHost = {
    setModule: (name, on) => locked ? Promise.resolve({ ok: false, error: locked }) : guard(() => controller.setModule(name, on)),
    setSettings: patch => locked ? Promise.resolve({ ok: false, error: locked }) : guard(() => controller.setSettings(patch)),
    prefs, onPrefs: patch => setPrefs(p => ({ ...p, ...patch })),
    ...(scope.KamiRuntimeNext?.hub ? { kami: true } : {}),
    ...(bgm ? { tracks: { list: bgmStatus!.library.player, add: t => bgm.addTracks([{ ...t, id: 'mine_' + Date.now().toString(36) }]), remove: id => bgm.removeTrack(id) } } : {}),
    ...(locked ? { locked } : {}),
    ...(extras.openDebug ? { openDebug: extras.openDebug } : {}),
    ...(extras.openBuilder ? { openBuilder: extras.openBuilder } : {}),
    update,
    structure,
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
    <StatusBar model={model} interact={interact} settings={settings} {...(bgmView ? { bgm: bgmView } : {})}
      defaultMode={saved.mode ?? 'bar'} {...(saved.settings ? { defaultSettings: true } : {})} onModeChange={mode => { if (mode !== 'panel') remember({ mode }); }}
      {...(saved.tab ? { defaultTab: saved.tab } : {})} onTabChange={tab => remember({ tab })}
      {...(saved.pos ? { position: saved.pos } : {})} onPositionChange={pos => remember({ pos })} />
  );
}
