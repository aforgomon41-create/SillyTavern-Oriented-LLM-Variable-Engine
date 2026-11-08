/** Status bar: panel, tabs from the declared layout, scene strip, entity master-detail, node map. */
import * as React from 'react';
import { useKit } from '../kit.js';
import { isEmpty, StatusModel, type Path } from './model.js';
import { EntityCard, Field, ModelContext, NavigateContext, RefChip, Section, useModel, Value } from './fields.js';
import { part, solve } from './widgets.js';

export interface BgmView { title?: string; source: string; playing: boolean; enabled: boolean; volume: number; onToggle(v: boolean): void; onVolume(v: number): void }
export interface StatusBarProps { model: StatusModel; onClose: () => void; bgm?: BgmView; title?: string; defaultTab?: string }

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = React.useState(800);
  React.useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function StatusBar({ model, onClose, bgm, title = '状态', defaultTab }: StatusBarProps) {
  const K = useKit();
  const tabs = model.layout.filter((t: any) => model.moduleOn(t.module));
  const [tab, setTab] = React.useState<string>(defaultTab ?? tabs[0]?.tab ?? '');
  const [focus, setFocus] = React.useState<Path | undefined>();
  const navigate = React.useCallback((path: Path) => {
    const target = tabs.find((t: any) => t.items.some((item: any) => (item.list ?? item.map) && path.join('.').startsWith((item.list ?? item.map) + '.') && (item.detail || item.map)));
    if (target) { setTab(target.tab); setFocus(path); }
  }, [tabs]);
  const round = model.def.round ? model.value(model.def.round.split('.')) : undefined;
  return (
    <ModelContext.Provider value={model}>
      <NavigateContext.Provider value={navigate}>
        <K.TooltipProvider>
          <K.Panel title={<span {...solve('title')}>{title}{typeof round === 'number' ? <small>第 {round} 轮</small> : null}</span>} onClose={onClose}
            defaultSize={{ w: 760, h: 720 }} actions={bgm ? <BgmButton bgm={bgm} /> : undefined}>
            <K.Tabs label="状态栏" mode="scroll" sticky swipe value={tab} onValueChange={setTab}
              items={tabs.map((t: any) => ({ value: t.tab, label: t.tab, content: <div {...solve('tab')}>{t.items.map((item: any, i: number) => <LayoutItem key={i} item={item} focus={focus} />)}</div> }))} />
          </K.Panel>
        </K.TooltipProvider>
      </NavigateContext.Provider>
    </ModelContext.Provider>
  );
}

function LayoutItem({ item, focus }: { item: any; focus?: Path }) {
  const m = useModel();
  if (typeof item === 'string') return <Section path={item.split('.')} />;
  if (item.path && item.as === 'strip') return <SceneStrip path={item.path.split('.')} />;
  if (item.map) return <NodeMap path={item.map.split('.')} current={item.current?.split('.')} focus={focus} />;
  if (item.list) {
    const path = item.list.split('.') as Path, meta = m.meta(path);
    if (meta?.type === 'refs') {
      const ids: string[] = m.value(path) ?? [];
      return <EntityStrip title={item.title ?? m.label(path)} paths={ids.map(id => m.locate(id)).filter((p): p is Path => !!p)} summary={item.summary} />;
    }
    if (item.detail) return <MasterDetail path={path} focus={focus} />;
    return <EntityList path={path} />;
  }
  return null;
}

/* ───────── scene strip (meta) ───────── */
function SceneStrip({ path }: { path: Path }) {
  const m = useModel(), K = useKit(), value = m.value(path) ?? {};
  const keys = m.children(path).filter(k => !m.dormant([...path, k]) && !(m.def.round && [...path, k].join('.') === m.def.round));
  const time = keys.find(k => m.widget([...path, k]) === 'datetime');
  const location = keys.find(k => m.meta([...path, k])?.type === 'ref');
  const chips = keys.filter(k => m.meta([...path, k])?.type === 'enum');
  const rest = keys.filter(k => k !== time && k !== location && !chips.includes(k) && m.meta([...path, k])?.type !== 'refs');
  return (
    <section {...solve('scene')} data-k-level="surface-1">
      {location ? <div {...part('place')}><PlacePath id={value[location]} /></div> : null}
      {time ? <div {...part('time')}>{formatTime(value[time])}</div> : null}
      <div {...part('chips')}>
        {chips.map(k => isEmpty(value[k]) ? null : <span key={k} {...solve('fact')}><span {...part('label')}>{m.label([...path, k])}</span><K.Badge tone="accent">{value[k]}</K.Badge></span>)}
        {rest.map(k => isEmpty(value[k]) ? null : <span key={k} {...solve('fact')}><span {...part('label')}>{m.label([...path, k])}</span><Value path={[...path, k]} value={value[k]} /></span>)}
      </div>
    </section>
  );
}
function formatTime(t: any): string {
  if (!t || typeof t !== 'object') return '';
  const date = [t.year !== undefined ? `${t.year}年` : '', t.month !== undefined ? `${t.month}月` : '', t.day !== undefined ? `${t.day}日` : ''].join('');
  return [t.era, date, t.clock].filter(Boolean).join(' · ');
}
function PlacePath({ id }: { id: string | null }) {
  const m = useModel();
  if (!id) return <span {...solve('none')}>位置未知</span>;
  const chain: string[] = [];
  for (let cursor: any = id, n = 0; typeof cursor === 'string' && n < 16; n++) { chain.unshift(cursor); const p = m.locate(cursor); cursor = p ? m.value(p)?.parent : undefined; }
  return <span {...solve('place-path')}>{chain.map((c, i) => <React.Fragment key={c}>{i ? <span {...part('sep')}>›</span> : null}<RefChip id={c} /></React.Fragment>)}</span>;
}

/* ───────── entities ───────── */
function EntityStrip({ title, paths, summary }: { title: string; paths: Path[]; summary?: string[] }) {
  const go = React.useContext(NavigateContext);
  return (
    <section {...solve('group')}>
      <h4 {...part('title')}>{title}<small>{paths.length}</small></h4>
      <div {...solve('cards')}>{paths.map(p => <EntityCard key={p.join('.')} path={p} summary={summary} onOpen={() => go(p)} />)}</div>
    </section>
  );
}
function EntityList({ path }: { path: Path }) {
  const m = useModel(), K = useKit(), value = m.value(path) ?? {};
  const ids = Object.keys(value);
  if (!ids.length) return <K.Empty title={`还没有${m.label(path)}`} />;
  return <div {...solve('stack')}>{ids.map(id => <K.CollapseCard key={id} title={value[id]?.name ?? id} defaultOpen={ids.length <= 2}><EntityBody path={[...path, id]} /></K.CollapseCard>)}</div>;
}
function MasterDetail({ path, focus }: { path: Path; focus?: Path }) {
  const m = useModel(), K = useKit(), ref = React.useRef<HTMLDivElement>(null), width = useWidth(ref);
  const value = m.value(path) ?? {}, ids = Object.keys(value);
  const present = new Set<string>((m.value(['meta', 'present']) as string[] | undefined) ?? []);
  const focused = focus && focus.slice(0, path.length).join('.') === path.join('.') ? focus[path.length] : undefined;
  const [current, setCurrent] = React.useState<string>(focused ?? m.userId ?? ids[0] ?? '');
  React.useEffect(() => { if (focused) setCurrent(focused); }, [focused]);
  if (!ids.length) return <K.Empty title={`还没有${m.label(path)}`} />;
  const wide = width >= 640;
  const items = ids.map(id => ({ id, label: value[id]?.name ?? id, meta: present.has(id) ? '在场' : undefined }));
  return (
    <div ref={ref} {...solve('master-detail', { layout: wide ? 'wide' : 'narrow' })}>
      {wide ? <div {...part('nav')}><K.NavList items={items} current={current} onSelect={setCurrent} layout="sidebar" label={m.label(path)} /></div>
        : <div {...part('picker')} role="tablist" aria-label={m.label(path)}>{items.map(it => <button key={it.id} type="button" role="tab" aria-selected={it.id === current} onClick={() => setCurrent(it.id)}>{it.label}{it.meta ? <i aria-label="在场" /> : null}</button>)}</div>}
      <div {...part('detail')}>{value[current] ? <EntityBody path={[...path, current]} header /> : null}</div>
    </div>
  );
}
/** Full entity: header facts, then sections; composite groups (e.g. roleplay) are flattened one level. */
export function EntityBody({ path, header = false }: { path: Path; header?: boolean }) {
  const m = useModel(), K = useKit(), v = m.value(path) ?? {};
  const keys = m.children(path).filter(k => !m.dormant([...path, k]) && m.spoiler([...path, k]) !== 'hidden');
  const type = (k: string) => m.meta([...path, k])?.type ?? '';
  const isStringList = (k: string) => type(k) === 'array' && !m.meta([...path, k])?.stamp && (v[k] ?? []).every((x: unknown) => typeof x === 'string');
  const scalar = keys.filter(k => ['string', 'enum', 'int', 'number', 'bool', 'ref', 'refs', 'ladder'].includes(type(k)) || isStringList(k));
  const composite = keys.filter(k => !scalar.includes(k));
  const badges = scalar.filter(k => type(k) === 'enum' && !isEmpty(v[k]));
  const paragraphs = scalar.filter(k => m.widget([...path, k]) === 'paragraph' && !isEmpty(v[k]));
  const facts = scalar.filter(k => !badges.includes(k) && !paragraphs.includes(k) && k !== 'name' && k !== 'alias');
  const flatten = (k: string) => type(k) === 'object' && m.children([...path, k]).some(c => ['object', 'record'].includes(m.meta([...path, k, c])?.type ?? '') && m.children([...path, k, c]).length > 1 || m.meta([...path, k, c])?.type === 'record');
  return (
    <div {...solve('entity')}>
      {header ? (
        <header {...part('head')}>
          <h3 {...part('name')}>{v.name ?? path.at(-1)}{v.alias ? <small>「{v.alias}」</small> : null}</h3>
          <span {...part('badges')}>{badges.map(k => <K.Badge key={k} tone="accent">{v[k]}</K.Badge>)}</span>
        </header>
      ) : null}
      <div {...solve('fields')}>{facts.map(k => <Field key={k} path={[...path, k]} compact />)}</div>
      {paragraphs.map(k => <Field key={k} path={[...path, k]} compact />)}
      {composite.map(k => flatten(k) ? <Group key={k} path={[...path, k]} />
        : ['object', 'record'].includes(type(k)) ? <Section key={k} path={[...path, k]} /> : <Field key={k} path={[...path, k]} />)}
    </div>
  );
}
function Group({ path }: { path: Path }) {
  const m = useModel();
  const keys = m.children(path).filter(k => !m.dormant([...path, k]) && !isEmpty(m.value([...path, k])));
  const scalar = keys.filter(k => ['string', 'enum', 'int', 'number', 'ladder'].includes(m.meta([...path, k])?.type ?? ''));
  return (
    <section {...solve('group')}>
      <h4 {...part('title')}>{m.label(path)}</h4>
      {scalar.length ? <div {...solve('fields')}>{scalar.map(k => <Field key={k} path={[...path, k]} compact />)}</div> : null}
      {keys.filter(k => !scalar.includes(k)).map(k => ['object', 'record'].includes(m.meta([...path, k])?.type ?? '')
        ? <Section key={k} path={[...path, k]} /> : <Field key={k} path={[...path, k]} />)}
    </section>
  );
}

/* ───────── node map ───────── */
interface MapNode { id: string; name: string; kind?: string; parent?: string; links: string[]; discovered: boolean; x: number; y: number }
function layoutMap(places: Record<string, any>): MapNode[] {
  const ids = Object.keys(places);
  const nodes: MapNode[] = ids.map(id => ({ id, name: places[id]?.name ?? id, kind: places[id]?.kind, parent: places[id]?.parent ?? undefined, links: (places[id]?.links ?? []).filter((l: string) => places[l]), discovered: places[id]?.discovered !== false, x: 0, y: 0 }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const roots = nodes.filter(n => !n.parent || !byId.has(n.parent));
  const childrenOf = (id: string) => nodes.filter(n => n.parent === id);
  const place = (n: MapNode, cx: number, cy: number, radius: number, depth: number) => {
    n.x = cx; n.y = cy;
    const kids = childrenOf(n.id);
    kids.forEach((kid, i) => { const a = (i / Math.max(1, kids.length)) * Math.PI * 2 + depth; place(kid, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, radius * 0.55, depth + 1); });
  };
  roots.forEach((r, i) => place(r, i * 420, (i % 2) * 120, 170, i));
  // relax: repel all, pull along links and parent edges (deterministic)
  const edges: [MapNode, MapNode, number][] = [];
  for (const n of nodes) { for (const l of n.links) if (n.id < l) edges.push([n, byId.get(l)!, 150]); if (n.parent && byId.has(n.parent)) edges.push([n, byId.get(n.parent)!, 120]); }
  for (let step = 0; step < 240; step++) {
    const t = 1 - step / 240;
    for (const a of nodes) for (const b of nodes) {
      if (a === b) continue;
      const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 0.01;
      if (d < 130) { const f = (130 - d) * 0.06 * t; a.x += dx / d * f; a.y += dy / d * f; }
    }
    for (const [a, b, len] of edges) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, f = (d - len) * 0.02 * t;
      a.x += dx / d * f; a.y += dy / d * f; b.x -= dx / d * f; b.y -= dy / d * f;
    }
  }
  return nodes;
}
function NodeMap({ path, current, focus }: { path: Path; current?: Path; focus?: Path }) {
  const m = useModel(), K = useKit(), places = m.value(path) ?? {};
  const here: string | undefined = current ? m.value(current) ?? undefined : undefined;
  const nodes = React.useMemo(() => layoutMap(places), [places]);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const focused = focus && focus.slice(0, path.length).join('.') === path.join('.') ? focus[path.length] : undefined;
  const [selected, setSelected] = React.useState<string | undefined>(focused ?? here);
  React.useEffect(() => { if (focused) setSelected(focused); }, [focused]);
  const box = React.useMemo(() => {
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const minX = Math.min(...xs) - 90, minY = Math.min(...ys) - 70, w = Math.max(...xs) - minX + 90, h = Math.max(...ys) - minY + 80;
    return { minX, minY, w, h };
  }, [nodes]);
  const [view, setView] = React.useState(box);
  // Narrow screens open zoomed around the current place; the whole map is one tap (⤢) away.
  const narrow = React.useRef<boolean | undefined>(undefined);
  const initial = React.useCallback(() => {
    const n = here ? byId.get(here) : undefined;
    return narrow.current && n ? { minX: n.x - box.w * 0.3, minY: n.y - box.h * 0.3, w: box.w * 0.6, h: box.h * 0.6 } : box;
  }, [box, here]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => setView(initial()), [initial]);
  const svgRef = React.useRef<SVGSVGElement>(null);
  // Labels keep a constant on-screen size: scale them by world units per screen pixel.
  const [px, setPx] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = svgRef.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      setPx({ w: el.clientWidth, h: el.clientHeight });
      if (narrow.current === undefined && el.clientWidth > 0) { narrow.current = el.clientWidth < 480; if (narrow.current) setView(initial()); }
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const ts = px.w && px.h ? Math.min(3, Math.max(0.4, Math.max(view.w / px.w, view.h / px.h))) : 1;
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const zoom = (factor: number, cx = view.minX + view.w / 2, cy = view.minY + view.h / 2) => setView(v => {
    const w = Math.min(box.w * 3, Math.max(box.w / 4, v.w * factor)), h = w * (v.h / v.w);
    return { minX: cx - (cx - v.minX) * (w / v.w), minY: cy - (cy - v.minY) * (h / v.h), w, h };
  });
  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: view.minX + (clientX - r.left) / r.width * view.w, y: view.minY + (clientY - r.top) / r.height * view.h };
  };
  const onPointerDown = (e: React.PointerEvent) => { pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId); if (!prev) return;
    const r = svgRef.current!.getBoundingClientRect();
    if (pointers.current.size === 1) {
      const dx = (e.clientX - prev.x) / r.width * view.w, dy = (e.clientY - prev.y) / r.height * view.h;
      setView(v => ({ ...v, minX: v.minX - dx, minY: v.minY - dy }));
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()].map(([id, p]) => id === e.pointerId ? { x: e.clientX, y: e.clientY } : p);
      const [pa, pb] = [...pointers.current.values()];
      const before = Math.hypot(pa!.x - pb!.x, pa!.y - pb!.y), after = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (before > 0 && after > 0) { const c = toWorld((a!.x + b!.x) / 2, (a!.y + b!.y) / 2); zoom(before / after, c.x, c.y); }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); };
  const onWheel = (e: React.WheelEvent) => { const c = toWorld(e.clientX, e.clientY); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, c.x, c.y); };
  const center = () => { const n = here ? byId.get(here) : undefined; setView(n ? { minX: n.x - box.w / 4, minY: n.y - box.h / 4, w: box.w / 2, h: box.h / 2 } : box); };
  const edges: { a: MapNode; b: MapNode; kind: 'link' | 'parent' }[] = [];
  for (const n of nodes) { for (const l of n.links) if (n.id < l || !byId.get(l)!.links.includes(n.id)) edges.push({ a: n, b: byId.get(l)!, kind: 'link' }); if (n.parent && byId.has(n.parent)) edges.push({ a: n, b: byId.get(n.parent)!, kind: 'parent' }); }
  const sel = selected ? byId.get(selected) : undefined;
  return (
    <div {...solve('map')}>
      <div {...part('canvas')} data-k-level="sunken">
        <svg ref={svgRef} viewBox={`${view.minX} ${view.minY} ${view.w} ${view.h}`} role="img" aria-label={`${m.label(path)}地图`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
          {edges.map((e, i) => <line key={i} data-solve-part={e.kind === 'link' ? 'link' : 'hierarchy'} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />)}
          {nodes.map(n => (
            <g key={n.id} data-solve-part="node" data-kind={n.kind === '区域' ? 'region' : 'place'} data-current={n.id === here ? '' : undefined} data-selected={n.id === selected ? '' : undefined} data-undiscovered={n.discovered ? undefined : ''}
              transform={`translate(${n.x} ${n.y})`} tabIndex={0} role="button" aria-label={n.discovered ? n.name : '未发现的地点'}
              onClick={() => setSelected(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelected(n.id); }}>
              {n.id === here ? <circle data-solve-part="halo" r={n.kind === '区域' ? 40 : 30} /> : null}
              <circle data-solve-part="dot" r={n.kind === '区域' ? 26 : 16} />
              <g transform={`translate(0 ${n.kind === '区域' ? 26 : 16}) scale(${ts})`}><text data-solve-part="name" y={20}>{n.discovered ? n.name : '？？？'}</text></g>
              {n.id === here ? <g transform={`translate(0 ${n.kind === '区域' ? -40 : -30}) scale(${ts})`}><text data-solve-part="here" y={-4}>当前</text></g> : null}
            </g>
          ))}
        </svg>
        <div {...part('tools')}>
          <K.IconButton label="放大" size="sm" variant="default" onClick={() => zoom(1 / 1.3)}>＋</K.IconButton>
          <K.IconButton label="缩小" size="sm" variant="default" onClick={() => zoom(1.3)}>－</K.IconButton>
          <K.IconButton label="回到当前位置" size="sm" variant="default" onClick={center}>◎</K.IconButton>
          <K.IconButton label="查看全图" size="sm" variant="default" onClick={() => setView(box)}>⤢</K.IconButton>
        </div>
      </div>
      {sel ? (
        <div {...part('detail')}>
          <K.Card title={sel.discovered ? sel.name : '未发现的地点'} meta={<>{sel.kind ? <K.Badge tone="neutral">{sel.kind}</K.Badge> : null}{sel.id === here ? <K.Badge tone="accent">当前位置</K.Badge> : null}</>}>
            {sel.discovered ? <EntityBody path={[...path, sel.id]} /> : <p {...solve('paragraph')}>这里还没有被探索。</p>}
          </K.Card>
        </div>
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
export { StatusModel };
