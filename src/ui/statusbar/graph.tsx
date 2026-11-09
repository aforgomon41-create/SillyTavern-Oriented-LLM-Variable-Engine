/**
 * Interactive node graph (map, relationships, diplomacy): force layout, pan / wheel / pinch zoom,
 * draggable nodes, labels at a constant on-screen size, selection highlighting.
 * Hooks: [data-solve="graph"] with parts canvas / region / area / region-name / edge / edge-label / node / dot / halo / name / here / tools.
 * Groups (map regions) are drawn as soft areas around their members instead of nodes.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { bounds, forceLayout, nodeBox, type Point } from './force.js';
import { part, solve } from './widgets.js';

export type Tone = 'positive' | 'negative' | 'neutral' | 'info';
/** `hidden`: takes part in the layout (e.g. a region pulling its places together) but is not drawn. */
export interface GraphNode { id: string; label: string; r?: number; kind?: string; current?: boolean; muted?: boolean; mark?: string; tone?: Tone; hidden?: boolean; image?: string }
export interface GraphEdge { a: string; b: string; kind?: 'link' | 'hierarchy' | 'relation'; tone?: Tone; label?: string; width?: number; length?: number; strength?: number; opacity?: number; hidden?: boolean }
/** An area drawn around `members` (ids of drawn nodes); `level` 0 is innermost, outer areas get more padding. */
export interface GraphGroup { id: string; label: string; members: string[]; level?: number; current?: boolean }

/** Convex hull (monotone chain) of a point set. */
function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [], upper: Point[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
const AREA_PAD = 34, AREA_STEP = 28;

export function GraphView({ nodes, edges, groups = [], selected, onSelect, label, start, height = 'md' }: {
  nodes: GraphNode[]; edges: GraphEdge[]; groups?: GraphGroup[]; selected?: string; onSelect?: (id: string | undefined) => void; label: string;
  /** Narrow screens open zoomed around this node. */
  start?: string; height?: 'sm' | 'md';
}) {
  const K = useKit(), uid = React.useId().replace(/[^a-zA-Z0-9_-]/gu, '');
  const [broken, setBroken] = React.useState<Set<string>>(() => new Set());
  const key = JSON.stringify([nodes.map(n => [n.id, n.label, n.r]), edges.map(e => [e.a, e.b, e.length])]);
  const layout = React.useMemo(() => forceLayout(nodes.map(n => ({ id: n.id, r: n.r ?? 16, label: n.label })), edges.map(e => ({ a: e.a, b: e.b, ...(e.length ? { length: e.length } : {}), strength: e.strength ?? (e.kind === 'hierarchy' ? 0.9 : 0.6) }))), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [moved, setMoved] = React.useState<Record<string, Point>>({});
  React.useEffect(() => setMoved({}), [key]);
  const pos = (id: string): Point => moved[id] ?? layout.get(id) ?? { x: 0, y: 0 };
  const areaPad = groups.length ? AREA_PAD + AREA_STEP * Math.max(0, ...groups.map(g => g.level ?? 0)) + 20 : 24;
  const box = React.useMemo(() => bounds(nodes.filter(n => !n.hidden).map(n => ({ ...(layout.get(n.id) ?? { x: 0, y: 0 }), box: nodeBox({ id: n.id, r: n.r ?? 16, label: n.label }) })), areaPad), [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const svgRef = React.useRef<SVGSVGElement>(null);
  const [px, setPx] = React.useState({ w: 0, h: 0 });
  const [view, setView] = React.useState(box);
  const fitted = React.useRef(false);
  const focusOn = React.useCallback((id: string | undefined, zoom: number) => {
    const p = id ? layout.get(id) : undefined;
    setView(p ? { minX: p.x - box.w * zoom / 2, minY: p.y - box.h * zoom / 2, w: box.w * zoom, h: box.h * zoom } : box);
  }, [layout, box]);
  React.useEffect(() => { fitted.current = false; setView(box); }, [box]);
  React.useEffect(() => {
    const el = svgRef.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setPx({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  React.useEffect(() => {
    if (fitted.current || !px.w) return;
    fitted.current = true;
    // Fit by the scale the whole graph needs; when labels would get tiny, open zoomed on `start`.
    const scale = Math.min(px.w / box.w, px.h / box.h);
    if (scale < 0.55 && start) focusOn(start, Math.max(0.45, scale / 0.8));
  }, [px, box, start, focusOn]);
  /** World units per screen pixel (labels are scaled by this to stay a constant size). */
  const upp = px.w && px.h ? Math.max(view.w / px.w, view.h / px.h) : 1;
  const ts = Math.min(3, Math.max(0.35, upp));

  const toWorld = (cx: number, cy: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    // preserveAspectRatio="xMidYMid meet": the view is centred inside the element
    const s = Math.max(view.w / r.width, view.h / r.height);
    return { x: view.minX + view.w / 2 + (cx - r.left - r.width / 2) * s, y: view.minY + view.h / 2 + (cy - r.top - r.height / 2) * s };
  };
  const zoom = (factor: number, c?: Point) => setView(v => {
    const cx = c?.x ?? v.minX + v.w / 2, cy = c?.y ?? v.minY + v.h / 2;
    const w = Math.min(box.w * 3, Math.max(box.w / 5, v.w * factor)), f = w / v.w, h = v.h * f;
    return { minX: cx - (cx - v.minX) * f, minY: cy - (cy - v.minY) * f, w, h };
  });
  React.useEffect(() => {
    const el = svgRef.current; if (!el) return undefined;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, toWorld(e.clientX, e.clientY)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // pointers: background drag pans, node drag moves the node, two fingers pinch
  const pointers = React.useRef(new Map<number, Point>());
  const drag = React.useRef<{ id?: string; start: Point; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent, id?: string) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.current = pointers.current.size === 1 ? { ...(id ? { id } : {}), start: { x: e.clientX, y: e.clientY }, moved: false } : null;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId); if (!prev) return;
    const s = upp;
    if (pointers.current.size === 1 && drag.current) {
      if (Math.hypot(e.clientX - drag.current.start.x, e.clientY - drag.current.start.y) > 4) drag.current.moved = true;
      const dx = (e.clientX - prev.x) * s, dy = (e.clientY - prev.y) * s;
      const id = drag.current.id;
      const group = id ? groups.find(g => g.id === id) : undefined;
      if (id) setMoved(m => {
        const out = { ...m };
        for (const k of group ? group.members : [id]) { const p = m[k] ?? layout.get(k) ?? { x: 0, y: 0 }; out[k] = { x: p.x + dx, y: p.y + dy }; }
        return out;
      });
      else setView(v => ({ ...v, minX: v.minX - dx, minY: v.minY - dy }));
    } else if (pointers.current.size === 2) {
      const [pa, pb] = [...pointers.current.values()];
      const others = [...pointers.current.entries()].find(([pid]) => pid !== e.pointerId)?.[1];
      if (pa && pb && others) {
        const before = Math.hypot(pa.x - pb.x, pa.y - pb.y), after = Math.hypot(e.clientX - others.x, e.clientY - others.y);
        if (before > 0 && after > 0) zoom(before / after, toWorld((e.clientX + others.x) / 2, (e.clientY + others.y) / 2));
      }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current; drag.current = null;
    if (d && !d.moved && onSelect) onSelect(d.id && d.id !== selected ? d.id : undefined);
  };

  const near = new Set<string>();
  if (selected) for (const e of edges) { if (e.a === selected) near.add(e.b); if (e.b === selected) near.add(e.a); }
  const selGroup = groups.find(g => g.id === selected);
  if (selGroup) selGroup.members.forEach(id => near.add(id));
  const dim = (id: string) => !!selected && id !== selected && !near.has(id);
  // Areas: hull of the members' boxes, padded by a round-joined stroke; outer (higher level) areas first.
  const areas = groups.map(g => {
    const pts = g.members.flatMap(id => {
      const n = nodes.find(x => x.id === id); if (!n) return [];
      const p = pos(id), b = nodeBox({ id, r: n.r ?? 16, label: n.label });
      // The current place carries a halo and a 「当前」 tag above it: keep those inside the area too.
      const top = n.current ? Math.max(b.top, (n.r ?? 16) + 14 + 16 * ts) : b.top;
      return [{ x: p.x - b.w / 2, y: p.y - top }, { x: p.x + b.w / 2, y: p.y - top }, { x: p.x - b.w / 2, y: p.y + b.bottom }, { x: p.x + b.w / 2, y: p.y + b.bottom }];
    });
    const h = hull(pts), pad = AREA_PAD + AREA_STEP * (g.level ?? 0);
    const top = h.reduce((t, q) => q.y < t.y ? q : t, h[0] ?? { x: 0, y: 0 });
    const cx = pts.reduce((s, q) => s + q.x, 0) / (pts.length || 1), cy = pts.reduce((s, q) => s + q.y, 0) / (pts.length || 1);
    return { g, d: h.length ? 'M' + h.map(q => `${q.x} ${q.y}`).join('L') + 'Z' : '', pad, label: { x: (Math.min(...h.map(q => q.x)) + Math.max(...h.map(q => q.x))) / 2, y: top.y - pad * 0.5 }, center: { x: cx, y: cy } };
  }).sort((a, b) => (b.g.level ?? 0) - (a.g.level ?? 0));
  // Edges to a region end at its area's centre.
  const end = (id: string): Point => areas.find(a => a.g.id === id)?.center ?? pos(id);
  return (
    <div {...solve('graph', { size: height })}>
      <div {...part('canvas')} data-k-level="sunken">
        <svg ref={svgRef} viewBox={`${view.minX} ${view.minY} ${view.w} ${view.h}`} role="group" aria-label={label}
          onPointerDown={e => onPointerDown(e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {/* Links to a region run from its centre: drawn under the (opaque) areas so only the part between areas shows. */}
          {edges.map((e, i) => {
            if (e.hidden || !(areas.some(a => a.g.id === e.a) || areas.some(a => a.g.id === e.b))) return null;
            const a = end(e.a), b = end(e.b), off = !!selected && e.a !== selected && e.b !== selected;
            return <line key={'r' + i} {...part('edge')} data-kind={e.kind ?? 'link'} data-tone={e.tone} data-dim={off ? '' : undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {areas.map(({ g, d, pad }) => (
            <g key={'area-' + g.id} {...part('region')} data-current={g.current ? '' : undefined} data-selected={g.id === selected ? '' : undefined}
              data-dim={selected && !selGroup && !g.members.includes(selected) && g.id !== selected ? '' : undefined}>
              <path {...part('area')} d={d} style={{ strokeWidth: pad * 2 }} />
            </g>
          ))}
          {edges.map((e, i) => {
            if (e.hidden || areas.some(a => a.g.id === e.a || a.g.id === e.b)) return null;
            const a = end(e.a), b = end(e.b), off = !!selected && e.a !== selected && e.b !== selected && !(selGroup && (selGroup.members.includes(e.a) || selGroup.members.includes(e.b)));
            return <line key={i} {...part('edge')} data-kind={e.kind ?? 'link'} data-tone={e.tone} data-dim={off ? '' : undefined}
              style={e.width || e.opacity !== undefined ? { ...(e.width ? { strokeWidth: e.width } : {}), ...(e.opacity !== undefined ? { strokeOpacity: e.opacity } : {}) } : undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {edges.map((e, i) => {
            if (!e.label || e.hidden) return null;
            const a = end(e.a), b = end(e.b), off = !!selected && e.a !== selected && e.b !== selected;
            return <g key={'l' + i} transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2}) scale(${ts})`} data-dim={off ? '' : undefined}>
              <text {...part('edge-label')} data-tone={e.tone} y={4}>{e.label}</text></g>;
          })}
          {areas.map(({ g, label: at }) => (
            <g key={'name-' + g.id} {...part('region-label')} transform={`translate(${at.x} ${at.y}) scale(${ts})`} data-current={g.current ? '' : undefined}
              data-selected={g.id === selected ? '' : undefined} tabIndex={0} role="button" aria-pressed={g.id === selected} aria-label={g.label}
              onPointerDown={e => onPointerDown(e, g.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(g.id === selected ? undefined : g.id); } }}>
              <text {...part('region-name')} y={5}>{g.label}</text>
            </g>
          ))}
          {nodes.map(n => {
            if (n.hidden) return null;
            const p = pos(n.id), r = n.r ?? 16;
            return (
              <g key={n.id} {...part('node')} data-kind={n.kind} data-tone={n.tone} data-current={n.current ? '' : undefined} data-muted={n.muted ? '' : undefined}
                data-selected={n.id === selected ? '' : undefined} data-dim={dim(n.id) ? '' : undefined}
                transform={`translate(${p.x} ${p.y})`} tabIndex={0} role="button" aria-pressed={n.id === selected} aria-label={n.label}
                onPointerDown={e => onPointerDown(e, n.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(n.id === selected ? undefined : n.id); } }}>
                {n.current ? <circle {...part('halo')} r={r + 12} /> : null}
                <circle {...part('dot')} r={r} />
                {n.image && !broken.has(n.id) ? <>
                  <clipPath id={`${uid}-c-${n.id}`}><circle r={r - 1.5} /></clipPath>
                  <image {...part('photo')} href={n.image} x={-r} y={-r} width={r * 2} height={r * 2} preserveAspectRatio={n.kind === "place" ? "xMidYMid slice" : "xMidYMin slice"} clipPath={`url(#${uid}-c-${n.id})`}
                    onError={() => setBroken(b => new Set(b).add(n.id))} />
                </> : n.mark ? <g transform={`scale(${Math.min(ts, r / 12)})`}><text {...part('mark')} y={5}>{n.mark}</text></g> : null}
                <g transform={`translate(0 ${r + 4}) scale(${ts})`}><text {...part('name')} y={15}>{n.label}</text></g>
                {n.current ? <g transform={`translate(0 ${-r - 14}) scale(${ts})`}><text {...part('here')} y={-2}>当前</text></g> : null}
              </g>
            );
          })}
        </svg>
        <div {...part('tools')}>
          <K.IconButton label="放大" size="sm" variant="default" onClick={() => zoom(1 / 1.3)}>＋</K.IconButton>
          <K.IconButton label="缩小" size="sm" variant="default" onClick={() => zoom(1.3)}>－</K.IconButton>
          {start ? <K.IconButton label="回到当前位置" size="sm" variant="default" onClick={() => focusOn(start, 0.6)}>◎</K.IconButton> : null}
          <K.IconButton label="查看全图" size="sm" variant="default" onClick={() => { setMoved({}); setView(box); }}>⤢</K.IconButton>
        </div>
      </div>
    </div>
  );
}
