/**
 * 进入聊天时选择数据结构。
 *
 * 打开一个还没有 SOLVE 存档的聊天（新聊天，或从没用过 SOLVE 的旧聊天）时弹窗问：用哪个数据结构、用哪套存好的设置。
 * 卡自带 SOLVE 结构时它排第一并选好；卡自带 MVU / ERA 时照样询问，并说明两套变量会同时更新（不再静默关闭）。
 * 错过弹窗（点了「稍后」）或选了「这个聊天不用」后，右下角的悬浮球可以随时再打开它。已经有存档的聊天照旧，不问。
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { part, solve, CloseButton } from './widgets.js';

export type Framework = 'solve' | 'mvu' | 'era';
export const FRAMEWORK_NAME: Record<Framework, string> = { solve: 'SOLVE', mvu: 'MVU', era: 'ERA' };
export interface Detection {
  /** The card's own variable framework; undefined = none found. */
  framework?: Framework;
  /** Why we think so, one line each (shown to the player). */
  evidence: string[];
  /** The card's own SOLVE structure. */
  structure?: { label: string; version?: string };
}

// ── detection (pure) ──

/** What the detector reads: the card, its main world book, the chat's variables and messages. */
export interface CardSnapshot {
  greeting: string;
  /** Tavern Helper character scripts (data.extensions.tavern_helper.scripts, or the older TavernHelper_scripts). */
  scripts: { name: string; content: string }[];
  /** Entries of the card's world book (comment + content). */
  entries: { comment: string; content: string }[];
  /** Chat variables (Tavern Helper's chat scope). */
  chatVariables: Record<string, unknown>;
  /** Text of the chat's messages, in order. */
  messages: string[];
}
const RULES: { framework: Framework; test: (s: CardSnapshot) => string[] }[] = [
  { framework: 'solve', test: s => [
    ...s.entries.filter(e => /^\[SOLVE:/iu.test(e.comment.trim())).slice(0, 3).map(e => `角色世界书条目「${e.comment.trim()}」`),
    ...s.scripts.filter(x => /\bSOLVE\s*\.\s*(?:register|registerWorldInfo|use)\s*\(/u.test(x.content)).map(x => `角色脚本「${x.name}」注册了 SOLVE 结构`),
  ] },
  { framework: 'mvu', test: s => [
    ...s.entries.filter(e => /\[initvar\]/iu.test(e.comment)).slice(0, 2).map(e => `角色世界书条目「${e.comment.trim()}」（MVU 变量初始化）`),
    ...(/<initvar>/iu.test(s.greeting) ? ['开场白里有 <initvar> 初始化块'] : []),
    ...s.entries.filter(e => /\[mvu_(?:update|plot)\]/iu.test(e.comment)).slice(0, 1).map(e => `角色世界书条目「${e.comment.trim()}」`),
    ...s.scripts.filter(x => /MagVarUpdate|\bmvu\b/iu.test(x.name + '\n' + x.content)).map(x => `角色脚本「${x.name}」加载了 MVU`),
  ] },
  { framework: 'era', test: s => [
    ...(/<VariableInsert>/u.test(s.greeting) ? ['开场白里有 <VariableInsert> 初始化块'] : []),
    ...s.scripts.filter(x => /ERA变量框架|EfficientRollback|\bERA\b/u.test(x.name + '\n' + x.content)).map(x => `角色脚本「${x.name}」加载了 ERA`),
    ...('ERAMetaData' in s.chatVariables || 'SelectedMks' in s.chatVariables ? ['聊天变量里有 ERA 的记录（ERAMetaData）'] : []),
    ...(s.messages.some(m => /<era_data>/u.test(m)) ? ['消息里有 ERA 的消息密钥（<era_data>）'] : []),
  ] },
];
/**
 * The card's own framework. A card's own SOLVE structure wins (the author meant SOLVE to run);
 * otherwise MVU before ERA. Only the card's own things count, not global scripts or books the player turned on.
 */
export function detectFrameworks(s: CardSnapshot): Detection {
  for (const rule of RULES) {
    const evidence = rule.test(s);
    if (evidence.length) return { framework: rule.framework, evidence };
  }
  return { evidence: [] };
}

// ── settings ──

export interface StructureChoice { id: string; label: string; detail?: string }
export interface GatePrefs {
  /** Structure picked first for cards without one of their own (a definition id). */
  defaultStructure: string;
  /** Chats without SOLVE yet: ask every time (default) / bind at once with the card's or the default structure / leave SOLVE off. */
  whenNone: 'ask' | 'use' | 'skip';
}
export const GATE_DEFAULTS: GatePrefs = { defaultStructure: 'solve-official', whenNone: 'ask' };
export interface StructureHost {
  prefs: GatePrefs; onPrefs(patch: Partial<GatePrefs>): void;
  choices: StructureChoice[];
  /** The current chat's structure, one line. */
  chat?: { reason: string };
}

export function StructureSection({ host }: { host: StructureHost }) {
  const p = host.prefs, set = host.onPrefs;
  return (
    <>
      <p {...part('intro')}>打开一个还没用过 SOLVE 的聊天（包括每个新聊天）时，SOLVE 会弹窗问这个聊天用哪个数据结构、用哪套存好的设置。错过了也没关系，点右下角的 ◈ 悬浮球就能重新打开。已经在用 SOLVE 的聊天不受影响。</p>
      {host.chat ? (
        <section {...solve('limit-group')}>
          <h4>当前聊天</h4>
          <div {...solve('pref-list')}><p {...part('hint')}>{host.chat.reason}</p></div>
        </section>
      ) : null}
      <section {...solve('limit-group')}>
        <h4>新聊天</h4>
        <div {...solve('pref-list')}>
          <div {...solve('pref', { kind: 'stack' })}>
            <span {...part('label')}>打开还没用 SOLVE 的聊天时</span>
            <div {...solve('update-modes', { size: 'sm' })} role="radiogroup" aria-label="打开还没用 SOLVE 的聊天时">
              {([['ask', '每次询问', '弹窗选数据结构和设置（推荐）'], ['use', '直接使用', '不弹窗：卡自带结构优先，否则用下面的默认结构，设置沿用上次选的'], ['skip', '不使用', '不弹窗，SOLVE 保持关闭；需要时点悬浮球']] as const).map(([v, l, t]) => (
                <button key={v} type="button" role="radio" aria-checked={p.whenNone === v} {...part('mode')} onClick={() => set({ whenNone: v })}><b>{l}</b><small>{t}</small></button>
              ))}
            </div>
          </div>
          <div {...solve('pref')}>
            <span {...part('label')}>默认数据结构<small>卡没有自带结构时，弹窗里先选它</small></span>
            <select {...solve('select')} aria-label="默认数据结构" value={p.defaultStructure} onChange={e => set({ defaultStructure: e.target.value })}>
              {host.choices.map(c => <option key={c.id} value={c.id}>{c.label}{c.detail ? ` · ${c.detail}` : ''}</option>)}
            </select>
          </div>
        </div>
      </section>
      <section {...solve('limit-group')}>
        <h4>自带变量的卡</h4>
        <div {...solve('pref-list')}>
          <p {...part('hint')}>卡自带 SOLVE 结构（角色脚本注册，或角色世界书里的 [SOLVE:…] 条目）时，弹窗里它排第一并选好。卡自带 MVU 或 ERA 时照样询问，并写明识别依据：同时开启时两套变量会各自更新，提示词里也会有两份说明。识别只看这张卡自己的东西（开场白、角色世界书、角色脚本、聊天变量），你全局开着的脚本和世界书不算。</p>
        </div>
      </section>
    </>
  );
}

// ── the dialog ──

export interface BindCandidate { key: string; id: string; label: string; version: string; own: boolean }
export interface PresetOption { value: string; label: string; detail?: string }
export interface GateView {
  card: string;
  detection?: Detection;
  /** Why SOLVE is not running here: 'choose' (no structure yet), 'off' (the player said no), 'error' / 'unbound' (could not open). */
  phase: string;
  reason?: string;
  candidates: BindCandidate[];
  initial?: string;
  presets(structureId: string): { options: PresetOption[]; initial: string };
}

/** A modal card in the status-bar layer; Esc and the backdrop take the safe choice. */
function Modal({ title, children, footer, onEscape, label }: { title: React.ReactNode; children: React.ReactNode; footer: React.ReactNode; onEscape: () => void; label: string }) {
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onEscape(); } };
    const el = box.current; el?.addEventListener('keydown', key);
    return () => el?.removeEventListener('keydown', key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div {...solve('gate')} onClick={e => { if (e.target === e.currentTarget) onEscape(); }}>
      <div ref={box} {...part('card')} role="dialog" aria-modal="true" aria-label={label}>
        <div {...part('top')}><span {...part('mark')} aria-hidden="true">◈ SOLVE</span><CloseButton size="sm" label="稍后再说" onClick={onEscape} /></div>
        <h3 {...part('title')}>{title}</h3>
        <div {...part('body')}>{children}</div>
        <div {...part('foot')}>{footer}</div>
      </div>
    </div>
  );
}
function Evidence({ items }: { items: string[] }) {
  return <ul {...part('evidence')} aria-label="识别依据">{items.map(x => <li key={x}>{x}</li>)}</ul>;
}

/**
 * 选择数据结构: which structure this chat uses and which saved settings it starts with. Also the way back for a chat
 * where SOLVE is off, and where a chat that failed to open says why.
 */
export function BindDialog({ view, busy, error, onBind, onOff, onLater, onRetry, onDebug }: {
  view: GateView; busy?: boolean; error?: string;
  onBind(key: string, preset: string): void; onOff(): void; onLater(): void; onRetry?(): void; onDebug?(): void;
}) {
  const K = useKit();
  const [key, setKey] = React.useState(view.initial ?? view.candidates[0]?.key ?? '');
  const chosen = view.candidates.find(c => c.key === key) ?? view.candidates[0];
  const presets = chosen ? view.presets(chosen.id) : { options: [], initial: 'default' };
  const [preset, setPreset] = React.useState(presets.initial);
  React.useEffect(() => { setPreset(presets.initial); }, [chosen?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const other = view.detection?.framework && view.detection.framework !== 'solve' ? FRAMEWORK_NAME[view.detection.framework] : undefined;
  if (view.phase === 'error' || view.phase === 'unbound') {
    return (
      <Modal label="SOLVE 没能打开这个聊天" onEscape={onLater} title={<>SOLVE 没能打开「{view.card}」的这个聊天</>}
        footer={<span {...part('buttons')}>
          {onDebug ? <K.Button size="sm" variant="ghost" onClick={onDebug}>打开调试</K.Button> : null}
          {onRetry ? <K.Button size="sm" variant="primary" data-autofocus="" onClick={onRetry}>重试</K.Button> : null}
        </span>}>
        <p data-tone="error" role="alert">{view.reason || '原因未知'}</p>
        <p {...part('hint')}>这个聊天已经有 SOLVE 存档，需要原来的数据结构才能继续。常见原因：开局用的结构写在另一张卡的脚本里、结构升级后旧存档对不上，或者第一次保存和酒馆撞车（重试即可）。</p>
      </Modal>
    );
  }
  return (
    <Modal label="选择数据结构" onEscape={onLater} title={<>「{view.card}」这个聊天要用哪个数据结构？</>}
      footer={<>
        <K.Button size="sm" variant="ghost" disabled={busy} onClick={onOff}>{view.phase === 'off' ? '仍然不用' : '这个聊天不用 SOLVE'}</K.Button>
        <span {...part('buttons')}>
          <K.Button size="sm" variant="ghost" disabled={busy} onClick={onLater}>稍后</K.Button>
          <K.Button size="sm" variant="primary" data-autofocus="" disabled={busy || !chosen} onClick={() => chosen && onBind(chosen.key, preset)}>{busy ? '正在启用…' : '开始使用'}</K.Button>
        </span>
      </>}>
      {other ? (
        <div {...part('warn')} role="note">
          <b>这张卡自带 {other} 变量</b>
          <span>用 SOLVE 时两套变量会同时更新，提示词里也会有两份说明。只想用 {other} 的话，选「这个聊天不用 SOLVE」。</span>
          <Evidence items={view.detection!.evidence} />
        </div>
      ) : view.detection?.framework === 'solve' && view.detection.evidence.length ? (
        <p {...part('hint')}>这张卡自带 SOLVE 数据结构（{view.detection.evidence[0]}），已经替你选好。</p>
      ) : view.phase === 'off' ? <p {...part('hint')}>这个聊天之前选了不用 SOLVE。现在开启的话，从最新一条回复开始记录变量。</p> : null}
      <fieldset {...part('choices')}>
        <legend>数据结构</legend>
        {view.candidates.length ? view.candidates.map(c => (
          <label key={c.key} {...part('choice')} data-checked={c.key === chosen?.key ? '' : undefined}>
            <input type="radio" name="solve-structure" checked={c.key === chosen?.key} onChange={() => setKey(c.key)} />
            <span><b>{c.label}</b><small>{c.own ? '这张卡自带 · ' : ''}{c.version}</small></span>
          </label>
        )) : <p data-tone="error">没有可用的数据结构。SOLVE 可能还在加载，稍后点悬浮球再试。</p>}
      </fieldset>
      {chosen ? (
        <div {...part('preset')}>
          <label htmlFor="solve-gate-preset">设置</label>
          <select id="solve-gate-preset" {...solve('select')} value={preset} onChange={e => setPreset(e.target.value)} aria-label="用哪套设置">
            {presets.options.map(o => <option key={o.value} value={o.value}>{o.label}{o.detail ? ` · ${o.detail}` : ''}</option>)}
          </select>
          <small>模块开关、清单上限、变化上限。在 ⚙ 设置 › 设置存档 里可以把一个聊天的设置存成一套。</small>
        </div>
      ) : null}
      {error ? <p data-tone="error" role="alert">{error}</p> : null}
    </Modal>
  );
}

/**
 * The floating button while this chat has no SOLVE running: always reachable, opens 选择数据结构 (or why it failed).
 * Drag it anywhere; it remembers where (this browser).
 */
export function GateBall({ tone, label, onOpen, position, onMove }: {
  tone: 'ask' | 'off' | 'error'; label: string; onOpen(): void;
  position?: { x: number; y: number }; onMove(p: { x: number; y: number }): void;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const drag = React.useRef<{ dx: number; dy: number; x0: number; y0: number; moved: boolean } | undefined>(undefined);
  const dragged = React.useRef(false);
  const [at, setAt] = React.useState(position);
  React.useEffect(() => setAt(position), [position?.x, position?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (x: number, y: number) => ({ x: Math.min(Math.max(4, x), window.innerWidth - 56), y: Math.min(Math.max(4, y), window.innerHeight - 56) });
  return (
    <button ref={ref} type="button" {...solve('gate-ball', { tone })} aria-label={label} title={label}
      style={at ? { left: clamp(at.x, at.y).x, top: clamp(at.x, at.y).y, right: 'auto', bottom: 'auto' } : undefined}
      onPointerDown={e => {
        const r = ref.current!.getBoundingClientRect();
        drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
        ref.current!.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={e => {
        const d = drag.current; if (!d) return;
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
        d.moved = true; setAt(clamp(e.clientX - d.dx, e.clientY - d.dy));
      }}
      onPointerUp={() => { const d = drag.current; drag.current = undefined; dragged.current = !!d?.moved; if (d?.moved && at) onMove(at); }}
      onClick={() => { if (dragged.current) { dragged.current = false; return; } onOpen(); }}>
      <span {...part('glyph')} aria-hidden="true">◈</span>
      {tone !== 'off' ? <span {...part('dot')} aria-hidden="true" /> : null}
    </button>
  );
}
