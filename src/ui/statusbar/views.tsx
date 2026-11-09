/**
 * Status bar: a floating launcher that shows a one-line overview bar while there is data (a round
 * button otherwise); clicking it expands the panel, and the overview bar becomes the panel title.
 * Panel tabs come from the declared layout: player sheet, collapsible entity lists with a
 * relationship graph, and a force-directed map.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { isEmpty, StatusModel, type Path } from './model.js';
import { ModelContext, NavigateContext, RefChip, Section, useModel } from './fields.js';
import { EntityBody, Pages, type PageSpec } from './body.js';
import { GraphView, type GraphEdge, type GraphNode, type Tone } from './graph.js';
import { PlayerSheet, type SheetItem } from './sheet.js';
import { Codex, type CodexCategory } from './codex.js';
import { part, solve } from './widgets.js';

export interface BgmView { title?: string; source: string; playing: boolean; enabled: boolean; volume: number; onToggle(v: boolean): void; onVolume(v: number): void }
export interface StatusBarProps {
  model: StatusModel; bgm?: BgmView;
  /** Last open tab; the host persists it through onTabChange. */
  defaultTab?: string; onTabChange?: (tab: string) => void;
  /** Starting state of the launcher (the host restores the last one). */
  defaultMode?: Mode; onModeChange?: (mode: Mode) => void;
  /** Saved launcher position; the host persists it. */
  position?: { x: number; y: number }; onPositionChange?: (p: { x: number; y: number }) => void;
}
export type Mode = 'bar' | 'dot' | 'panel';
const rel = (s: string): Path => s.split('.');

export function StatusBar({ model, bgm, defaultTab, onTabChange, defaultMode = 'bar', onModeChange, position, onPositionChange }: StatusBarProps) {
  const K = useKit();
  const tabs = model.layout.filter((t: any) => model.moduleOn(t.module));
  const [tab, setTabState] = React.useState<string>(tabs.some((t: any) => t.tab === defaultTab) ? defaultTab! : tabs[0]?.tab ?? '');
  const setTab = (t: string) => { setTabState(t); onTabChange?.(t); };
  const [focus, setFocus] = React.useState<{ path: Path; at: number } | undefined>();
  const hasData = barItems(model).length > 0;
  const [mode, setModeState] = React.useState<Mode>(defaultMode);
  const [rest, setRest] = React.useState<'bar' | 'dot'>(defaultMode === 'dot' ? 'dot' : 'bar');
  const setMode = (next: Mode) => { setModeState(next); if (next !== 'panel') setRest(next); onModeChange?.(next); };
  const anchor = React.useRef<DOMRect | null>(null);
  // The launcher unmounts while the panel is open, so its position lives here and survives folding.
  const [pos, setPos] = React.useState(position);
  const navigate = React.useCallback((path: Path) => {
    const key = path.join('.');
    const hit = (item: any) => {
      if (item.sheet) return key === [item.sheet, item.id === '$user' ? model.userId : item.id].join('.');
      if (item.codex) return (item.codex as CodexCategory[]).some(c => c.collection && key.startsWith(c.collection + '.'));
      const base = item.list ?? item.map ?? item.graph;
      return typeof base === 'string' && key.startsWith(base + '.') && !(item.exclude === '$user' && path[rel(base).length] === model.userId) && !item.graph;
    };
    const target = tabs.find((t: any) => t.items.some(hit));
    if (target) { setTabState(target.tab); onTabChange?.(target.tab); setFocus({ path, at: Date.now() }); setModeState('panel'); }
  }, [tabs, model]); // eslint-disable-line react-hooks/exhaustive-deps

  const content = (
    <K.TooltipProvider>
      {mode === 'panel' ? (
        <K.Panel title={<Overview model={model} where="title" />} onClose={() => setMode(rest)} closeLabel="收起"
          geometry={panelGeometry(anchor.current)} defaultSize={{ w: 780, h: 720 }} actions={bgm ? <BgmButton bgm={bgm} /> : undefined}>
          <K.Tabs label="状态栏" mode="scroll" sticky swipe value={tab} onValueChange={setTab}
            items={tabs.map((t: any) => ({ value: t.tab, label: t.tab, content: <div {...solve('tab')}>{t.items.filter((i: any) => typeof i === 'string' || model.moduleOn(i.module)).map((item: any, i: number) => <LayoutItem key={i} item={item} focus={focus} />)}</div> }))} />
        </K.Panel>
      ) : (
        <Launcher mode={hasData ? rest : 'dot'} canBar={hasData} pos={pos} onMove={setPos} onMoved={p => onPositionChange?.(p)}
          onOpen={rect => { anchor.current = rect; setMode('panel'); }} onMode={setMode} />
      )}
    </K.TooltipProvider>
  );
  return <ModelContext.Provider value={model}><NavigateContext.Provider value={navigate}>{content}</NavigateContext.Provider></ModelContext.Provider>;
}
/** Desktop: the panel opens where the bar was, so the bar visibly turns into the title. */
function panelGeometry(r: DOMRect | null): { x: number; y: number; w: number; h: number } | undefined {
  if (!r || typeof window === 'undefined' || window.innerWidth <= 1000) return undefined;
  const w = Math.max(780, Math.min(r.width, 960)), x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const y = Math.max(8, Math.min(r.top, window.innerHeight - 480));
  return { x, y, w, h: Math.min(760, window.innerHeight - y - 16) };
}

/* ───────── launcher (floating bar / round button) ───────── */
type Pos = { x: number; y: number };
function Launcher({ mode, canBar, pos, onMove, onMoved, onOpen, onMode }: {
  mode: 'bar' | 'dot'; canBar: boolean; pos?: Pos; onMove: (p: Pos) => void; onMoved: (p: Pos) => void;
  onOpen: (rect: DOMRect) => void; onMode: (m: Mode) => void;
}) {
  const m = useModel();
  const ref = React.useRef<HTMLDivElement>(null);
  const setPos = onMove;
  // Keep the saved spot on screen: after mounting, switching bar ↔ button, or resizing the window.
  React.useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current; if (!el || !pos) return;
      const r = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      const x = Math.min(Math.max(4, pos.x), Math.max(4, vw - r.width - 4)), y = Math.min(Math.max(4, pos.y), Math.max(4, vh - r.height - 4));
      if (x !== pos.x || y !== pos.y) setPos({ x, y });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [pos, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const drag = React.useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-solve-part="shrink"]')) return;
    const r = ref.current!.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
    ref.current!.setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    const r = ref.current!.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    setPos({ x: Math.min(Math.max(4, d.left + dx), vw - r.width - 4), y: Math.min(Math.max(4, d.top + dy), vh - r.height - 4) });
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.moved) { if (pos) onMoved(pos); return; }
    onOpen(ref.current!.getBoundingClientRect());
  };
  const style = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', transform: 'none' } as React.CSSProperties : undefined;
  return (
    <div ref={ref} {...solve('launcher', { mode, placed: pos ? '' : undefined })} style={style}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}>
      {mode === 'bar' ? (
        <div {...solve('bar')} data-k-level="surface-1" role="button" tabIndex={0} aria-label="展开状态栏" title="点击展开 · 按住拖动"
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(ref.current!.getBoundingClientRect()); } }}>
          <Overview model={m} where="bar" />
          <span {...part('open')} aria-hidden="true">▾</span>
          <button type="button" {...part('shrink')} aria-label="收起为按钮" title="收起为按钮" onClick={e => { e.stopPropagation(); onMode('dot'); }}>‹</button>
        </div>
      ) : (
        <>
          <button type="button" {...solve('dot')} aria-label="展开状态栏"
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(ref.current!.getBoundingClientRect()); } }}>
            <span aria-hidden="true">◈</span>
          </button>
          {canBar ? <button type="button" {...part('shrink')} data-dir="expand" aria-label="展开为概览横条" title="展开为概览横条" onClick={e => { e.stopPropagation(); onMode('bar'); }}>›</button> : null}
        </>
      )}
    </div>
  );
}

/* ───────── overview (bar content and panel title) ───────── */
interface BarItem { path: string; as?: string; limit?: number; label?: string }
function barItems(m: StatusModel): BarItem[] {
  const raw = ((m.def.display as any)?.bar ?? []) as (string | BarItem)[];
  return raw.map(i => typeof i === 'string' ? { path: i } : i).filter(i => {
    const p = resolve(m, i.path);
    return p && m.meta(p) && !m.dormant(p) && !isEmpty(m.value(p));
  });
}
function resolve(m: StatusModel, s: string): Path | undefined {
  const out = rel(s).map(k => k === '$user' ? m.userId ?? '' : k);
  return out.includes('') ? undefined : out;
}
function Overview({ model: m, where }: { model: StatusModel; where: 'bar' | 'title' }) {
  const round = m.def.round ? m.value(rel(m.def.round)) : undefined;
  return (
    <span {...solve('overview', { where })}>
      {barItems(m).map(item => <BarPiece key={item.path} item={item} path={resolve(m, item.path)!} where={where} />)}
      {typeof round === 'number' ? <span {...part('round')}>第 {round} 轮</span> : null}
    </span>
  );
}
function BarPiece({ item, path, where }: { item: BarItem; path: Path; where: 'bar' | 'title' }) {
  const m = useModel(), value = m.value(path), meta = m.meta(path);
  if (meta?.type === 'ref') {
    const chain: string[] = [];
    for (let c: any = value, n = 0; typeof c === 'string' && n < 8; n++) { chain.unshift(m.entityName(c)); const p = m.locate(c); c = p ? m.value(p)?.parent : undefined; }
    return <span {...part('place')}>{chain.slice(-2).join(' › ')}</span>;
  }
  if (m.widget(path) === 'datetime' || item.as === 'datetime') return <span {...part('time')}>{formatTime(value, true)}</span>;
  if (meta?.type === 'record' && Object.values(value).every((g: any) => typeof g?.value === 'number' && typeof g?.max === 'number')) {
    return <span {...part('vitals')}>{Object.entries(value).slice(0, item.limit ?? 3).map(([k, g]: any, i) => (
      <span key={k} {...part('vital')} data-slot={i % 4} title={`${k} ${g.value}/${g.max}`}>
        <span {...part('label')}>{k}</span><span {...part('track')}><i style={{ width: `${Math.max(0, Math.min(1, g.value / g.max)) * 100}%` }} /></span><span {...part('value')}>{g.value}</span>
      </span>))}</span>;
  }
  if (meta?.type === 'refs') return <People ids={value as string[]} label={m.label(path)} where={where} />;
  return <span {...part('chip')} title={m.label(path)}>{String(value)}</span>;
}
/** Present characters as avatars; in the panel title each one opens that character. */
function People({ ids, label, where }: { ids: string[]; label: string; where: 'bar' | 'title' }) {
  const m = useModel(), go = React.useContext(NavigateContext);
  const names = ids.map(id => m.entityName(id));
  const shown = ids.slice(0, where === 'title' ? 6 : 4);
  return (
    <span {...part('people')} title={`${label}：${names.join('、')}`} aria-label={`${label}：${names.join('、')}`}>
      {shown.map(id => where === 'title'
        ? <button key={id} type="button" onClick={() => { const p = m.locate(id); if (p) go(p); }} aria-label={`查看${m.entityName(id)}`} title={m.entityName(id)}>{[...m.entityName(id)][0]}</button>
        : <i key={id}>{[...m.entityName(id)][0]}</i>)}
      {ids.length > shown.length ? <small>+{ids.length - shown.length}</small> : null}
    </span>
  );
}
function formatTime(t: any, short = false): string {
  if (!t || typeof t !== 'object') return '';
  const date = [!short && t.year !== undefined ? `${t.year}年` : '', t.month !== undefined ? `${t.month}月` : '', t.day !== undefined ? `${t.day}日` : ''].join('');
  return [short ? '' : t.era, date, t.clock].filter(Boolean).join(' ');
}

/* ───────── layout items ───────── */
type Focus = { path: Path; at: number } | undefined;
function LayoutItem({ item, focus }: { item: any; focus: Focus }) {
  if (typeof item === 'string') return <Section path={rel(item)} />;
  if (item.sheet) return <PlayerSheet item={item as SheetItem} />;
  if (item.codex) return <Codex categories={item.codex as CodexCategory[]} {...(focus ? { focus } : {})} />;
  if (item.map) return <MapItem item={item} focus={focus} />;
  if (item.graph) return <RelationGraph item={item} />;
  if (item.list) return <CollapseList item={item} focus={focus} />;
  if (item.path) return <Section path={rel(item.path)} />;
  return null;
}

/** Entities as collapsed cards; present ones first, then by the declared order of `order` (an enum). */
function CollapseList({ item, focus }: { item: any; focus: Focus }) {
  const m = useModel(), K = useKit();
  const path = rel(item.list), value: Record<string, any> = m.value(path) ?? {};
  const present = new Set<string>(item.present ? m.value(rel(item.present)) ?? [] : []);
  const orderMeta = item.order ? m.meta([...path, '*', item.order]) : undefined;
  const rank = (id: string) => orderMeta?.values ? orderMeta.values.indexOf(value[id]?.[item.order]) : 0;
  const all = Object.keys(value).filter(id => !(item.exclude === '$user' && id === m.userId))
    .sort((a, b) => Number(present.has(b)) - Number(present.has(a)) || rank(a) - rank(b));
  const here = all.filter(id => present.has(id));
  const [only, setOnly] = React.useState<'all' | 'present'>('all');
  const ids = only === 'present' ? here : all;
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const refs = React.useRef(new Map<string, HTMLDivElement>());
  React.useEffect(() => {
    if (!focus || focus.path.slice(0, path.length).join('.') !== path.join('.')) return;
    const id = focus.path[path.length]; if (!id || !value[id]) return;
    setOnly('all'); setOpen(s => new Set(s).add(id));
    requestAnimationFrame(() => refs.current.get(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!all.length) return <K.Empty title={`还没有${item.title ?? m.label(path)}`} />;
  return (
    <section {...solve('group')}>
      <div {...solve('list-head')}>
        <h4 {...part('title')}>{item.title ?? m.label(path)}<small>{all.length}</small></h4>
        {here.length && here.length < all.length && K.Segmented ? <K.Segmented size="sm" label="筛选" value={only} onValueChange={v => setOnly(v as 'all' | 'present')}
          options={[{ value: 'all', label: `全部 ${all.length}` }, { value: 'present', label: `在场 ${here.length}` }]} /> : null}
      </div>
      <div {...solve('stack')}>
        {ids.map(id => {
          const v = value[id] ?? {}, score = item.score ? resolve(m, item.score) : undefined;
          const s = score ? m.value([...path, id, ...score]) : undefined, sMeta = score ? m.meta([...path, id, ...score]) : undefined;
          return (
            <div key={id} ref={el => { if (el) refs.current.set(id, el); else refs.current.delete(id); }} {...solve('entity-row', { present: present.has(id) ? '' : undefined })}>
              <K.CollapseCard open={open.has(id)} onOpenChange={o => setOpen(prev => { const n = new Set(prev); if (o) n.add(id); else n.delete(id); return n; })}
                title={<span {...solve('entity-head')}><span {...part('avatar')} aria-hidden="true">{[...(v.name ?? id)][0]}</span><span {...part('name')}>{v.name ?? id}{v.alias ? <small>「{v.alias}」</small> : null}</span></span>}
                meta={<span {...solve('entity-meta')}>
                  {present.has(id) ? <K.Badge tone="success">在场</K.Badge> : null}
                  {(item.badges ?? []).map((b: string) => v[b] ? <K.Badge key={b} tone="neutral">{String(v[b])}</K.Badge> : null)}
                  {typeof s === 'number' ? <span {...part('score')} data-sign={s > 0 ? 'positive' : s < 0 ? 'negative' : 'zero'} title={`${item.scoreLabel ?? sMeta?.desc ?? ''}`}>{item.scoreLabel ?? ''} {s > 0 ? '+' : ''}{s}</span> : null}
                </span>}>
                {open.has(id) ? (item.pages ? <Pages base={[...path, id]} pages={item.pages as PageSpec[]} label={`${v.name ?? id}的资料`} compact />
                  : <EntityBody path={[...path, id]} skip={item.badges} />) : null}
              </K.CollapseCard>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Relationship / diplomacy graph between the entities of one collection, collapsed by default. */
function RelationGraph({ item }: { item: any }) {
  const m = useModel(), K = useKit(), go = React.useContext(NavigateContext);
  const path = rel(item.graph), value: Record<string, any> = m.value(path) ?? {};
  const [sel, setSel] = React.useState<string | undefined>();
  const present = new Set<string>(item.present ? m.value(rel(item.present)) ?? [] : []);
  const sizeMeta = item.size ? m.meta([...path, '*', item.size]) : undefined;
  const nodes: GraphNode[] = Object.keys(value).map(id => {
    const tier = sizeMeta?.values ? sizeMeta.values.indexOf(value[id]?.[item.size]) : -1;
    const r = id === m.userId ? 24 : tier >= 0 ? Math.round(22 - tier * 2.5) : 18;
    return { id, label: value[id]?.name ?? id, r, mark: [...(value[id]?.name ?? id)][0], kind: id === m.userId ? 'user' : present.has(id) ? 'present' : 'entity' };
  });
  const pairs = new Map<string, { a: string; b: string; weights: number[]; labels: string[]; tones: string[] }>();
  for (const a of Object.keys(value)) for (const [b, r] of Object.entries(value[a]?.[item.edges] ?? {}) as [string, any][]) {
    if (!value[b]) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const p = pairs.get(key) ?? { a, b, weights: [], labels: [], tones: [] };
    if (item.weight && typeof r?.[item.weight] === 'number') p.weights.push(r[item.weight]);
    const lab = item.label ? r?.[item.label] : undefined;
    const text = Array.isArray(lab) ? lab[0] : lab;
    if (typeof text === 'string' && text && !p.labels.includes(text)) p.labels.push(text);
    if (item.tone && typeof r?.[item.tone] === 'string') p.tones.push(r[item.tone]);
    pairs.set(key, p);
  }
  const edges: GraphEdge[] = [...pairs.values()].map(p => {
    const avg = p.weights.length ? p.weights.reduce((s, w) => s + w, 0) / p.weights.length : 0;
    // Strength of the tie = mean |weight| (love and hatred are both strong ties); the sign only picks the colour.
    const intensity = p.weights.length ? Math.min(1, p.weights.reduce((s, w) => s + Math.abs(w), 0) / p.weights.length / 100) : 0.3;
    const mapped = p.tones.map(t => item.tones?.[t] as Tone | undefined).find(Boolean);
    const tone: Tone = mapped ?? (avg > 15 ? 'positive' : avg < -15 ? 'negative' : 'neutral');
    return { a: p.a, b: p.b, kind: 'relation', tone, label: p.labels.slice(0, 2).join(' / ') || p.tones[0],
      width: 1 + intensity * 5, opacity: 0.4 + intensity * 0.6, length: 220 - intensity * 90, strength: 0.25 + intensity * 0.7 };
  });
  const s = sel ? value[sel] : undefined;
  return (
    <K.CollapseCard title={item.title ?? '关系图'} meta={`${nodes.length} · ${edges.length}`} defaultOpen={!!item.open}>
      {nodes.length < 2 ? <span {...solve('none')}>暂无可显示的关系</span> : (
        <div {...solve('relation-graph')}>
          <GraphView nodes={nodes} edges={edges} selected={sel} onSelect={setSel} label={item.title ?? '关系图'} start={m.userId && value[m.userId] ? m.userId : undefined} height="sm" />
          <div {...part('legend')}>
            {item.legend ? Object.entries(item.legend as Record<string, string>).map(([tone, text]) => <span key={tone} data-tone={tone}><i />{text}</span>) : null}
            <span {...part('hint')}>点节点高亮关系，拖动节点可调整位置</span>
          </div>
          {s ? (
            <div {...part('selected')}>
              <b>{s.name ?? sel}</b>
              {(item.badges ?? []).map((b: string) => s[b] ? <K.Badge key={b} tone="neutral">{String(s[b])}</K.Badge> : null)}
              <K.Button size="sm" variant="ghost" onClick={() => go([...path, sel!])}>{sel === m.userId ? '查看角色' : '查看卡片'}</K.Button>
            </div>
          ) : null}
        </div>
      )}
    </K.CollapseCard>
  );
}

/** Force-directed map: hierarchy (parent) and adjacency (links); detail card for the selected place. */
function MapItem({ item, focus }: { item: any; focus: Focus }) {
  const m = useModel(), K = useKit();
  const path = rel(item.map), places: Record<string, any> = m.value(path) ?? {};
  const here: string | undefined = item.current ? m.value(rel(item.current)) ?? undefined : undefined;
  const parent = item.parent ?? 'parent', links = item.links ?? 'links', hidden = item.discovered ?? 'discovered';
  // The detail card follows the current place until the player picks a node; only a pick highlights.
  const [picked, setPicked] = React.useState<string | undefined>();
  React.useEffect(() => {
    if (focus && focus.path.slice(0, path.length).join('.') === path.join('.') && focus.path[path.length]) setPicked(focus.path[path.length]);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = picked ?? here;
  const known = (id: string) => places[id]?.[hidden] !== false;
  const nodes: GraphNode[] = Object.keys(places).map(id => {
    const region = Object.values(places).some(p => p?.[parent] === id);
    return { id, label: known(id) ? places[id]?.name ?? id : '？？？', r: region ? 24 : 14, kind: region ? 'region' : 'place', current: id === here, muted: !known(id) };
  });
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const id of Object.keys(places)) {
    const p = places[id]?.[parent];
    if (typeof p === 'string' && places[p]) edges.push({ a: id, b: p, kind: 'hierarchy', length: 120 });
    for (const l of (places[id]?.[links] ?? []) as string[]) {
      const key = id < l ? `${id}|${l}` : `${l}|${id}`;
      if (places[l] && !seen.has(key)) { seen.add(key); edges.push({ a: id, b: l, kind: 'link', length: 180 }); }
    }
  }
  const s = sel ? places[sel] : undefined;
  return (
    <div {...solve('map')}>
      <GraphView nodes={nodes} edges={edges} selected={picked} onSelect={setPicked} label={`${m.label(path)}地图`} {...(here ? { start: here } : {})} />
      <div {...part('legend')}><span data-kind="link"><i />相连</span><span data-kind="hierarchy"><i />隶属</span><span {...part('hint')}>拖动画布平移，滚轮或双指缩放</span></div>
      {s ? (
        <K.Card title={known(sel!) ? s.name ?? sel : '未发现的地点'} meta={<>{s.kind ? <K.Badge tone="neutral">{s.kind}</K.Badge> : null}{sel === here ? <K.Badge tone="accent">当前位置</K.Badge> : null}</>}>
          {known(sel!) ? <EntityBody path={[...path, sel!]} skip={['name', 'kind', hidden]} /> : <p {...solve('paragraph')}>这里还没有被探索。</p>}
        </K.Card>
      ) : null}
    </div>
  );
}

/* ───────── background music ───────── */
function BgmButton({ bgm }: { bgm: BgmView }) {
  const K = useKit();
  return (
    <K.InfoPopover label="背景音乐" trigger={<span {...solve('bgm-trigger', { playing: bgm.playing ? '' : undefined })} aria-label="背景音乐">♪</span>}>
      <div {...solve('bgm')}>
        <div {...part('now')}><span {...part('label')}>正在播放</span><strong>{bgm.enabled && bgm.title ? bgm.title : '—'}</strong><small>{bgm.source}</small></div>
        <div {...part('row')}><span>播放</span><K.Switch checked={bgm.enabled} onCheckedChange={bgm.onToggle} aria-label="播放背景音乐" /></div>
        <div {...part('row')}><span>音量</span><K.Slider value={Math.round(bgm.volume * 100)} min={0} max={100} onValueChange={v => bgm.onVolume(v / 100)} format={v => v + '%'} aria-label="音量" /></div>
      </div>
    </K.InfoPopover>
  );
}
export { StatusModel, RefChip };
