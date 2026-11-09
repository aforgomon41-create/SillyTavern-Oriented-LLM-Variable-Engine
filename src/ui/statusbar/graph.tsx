/**
 * Interactive node graph (map, relationships, diplomacy): force layout, pan / wheel / pinch zoom,
 * draggable nodes, labels at a constant on-screen size, selection highlighting.
 * Hooks: [data-solve="graph"] with parts canvas / edge / edge-label / node / dot / halo / name / here / tools.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { bounds, forceLayout, nodeBox, type Point } from './force.js';
import { part, solve } from './widgets.js';

export type Tone = 'positive' | 'negative' | 'neutral' | 'info';
export interface GraphNode { id: string; label: string; r?: number; kind?: string; current?: boolean; muted?: boolean; mark?: string; tone?: Tone }
export interface GraphEdge { a: string; b: string; kind?: 'link' | 'hierarchy' | 'relation'; tone?: Tone; label?: string; width?: number; length?: number; strength?: number; opacity?: number }

export function GraphView({ nodes, edges, selected, onSelect, label, start, height = 'md' }: {
  nodes: GraphNode[]; edges: GraphEdge[]; selected?: string; onSelect?: (id: string | undefined) => void; label: string;
  /** Narrow screens open zoomed around this node. */
  start?: string; height?: 'sm' | 'md';
}) {
  const K = useKit();
  const key = JSON.stringify([nodes.map(n => [n.id, n.label, n.r]), edges.map(e => [e.a, e.b, e.length])]);
  const layout = React.useMemo(() => forceLayout(nodes.map(n => ({ id: n.id, r: n.r ?? 16, label: n.label })), edges.map(e => ({ a: e.a, b: e.b, ...(e.length ? { length: e.length } : {}), strength: e.strength ?? (e.kind === 'hierarchy' ? 0.9 : 0.6) }))), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [moved, setMoved] = React.useState<Record<string, Point>>({});
  React.useEffect(() => setMoved({}), [key]);
  const pos = (id: string): Point => moved[id] ?? layout.get(id) ?? { x: 0, y: 0 };
  const box = React.useMemo(() => bounds(nodes.map(n => ({ ...(layout.get(n.id) ?? { x: 0, y: 0 }), box: nodeBox({ id: n.id, r: n.r ?? 16, label: n.label }) }))), [layout]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (id) setMoved(m => { const p = m[id] ?? layout.get(id) ?? { x: 0, y: 0 }; return { ...m, [id]: { x: p.x + dx, y: p.y + dy } }; });
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
  const dim = (id: string) => !!selected && id !== selected && !near.has(id);
  return (
    <div {...solve('graph', { size: height })}>
      <div {...part('canvas')} data-k-level="sunken">
        <svg ref={svgRef} viewBox={`${view.minX} ${view.minY} ${view.w} ${view.h}`} role="group" aria-label={label}
          onPointerDown={e => onPointerDown(e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {edges.map((e, i) => {
            const a = pos(e.a), b = pos(e.b), off = !!selected && e.a !== selected && e.b !== selected;
            return <line key={i} {...part('edge')} data-kind={e.kind ?? 'link'} data-tone={e.tone} data-dim={off ? '' : undefined}
              style={e.width || e.opacity !== undefined ? { ...(e.width ? { strokeWidth: e.width } : {}), ...(e.opacity !== undefined ? { strokeOpacity: e.opacity } : {}) } : undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {edges.map((e, i) => {
            if (!e.label) return null;
            const a = pos(e.a), b = pos(e.b), off = !!selected && e.a !== selected && e.b !== selected;
            return <g key={'l' + i} transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2}) scale(${ts})`} data-dim={off ? '' : undefined}>
              <text {...part('edge-label')} data-tone={e.tone} y={4}>{e.label}</text></g>;
          })}
          {nodes.map(n => {
            const p = pos(n.id), r = n.r ?? 16;
            return (
              <g key={n.id} {...part('node')} data-kind={n.kind} data-tone={n.tone} data-current={n.current ? '' : undefined} data-muted={n.muted ? '' : undefined}
                data-selected={n.id === selected ? '' : undefined} data-dim={dim(n.id) ? '' : undefined}
                transform={`translate(${p.x} ${p.y})`} tabIndex={0} role="button" aria-pressed={n.id === selected} aria-label={n.label}
                onPointerDown={e => onPointerDown(e, n.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(n.id === selected ? undefined : n.id); } }}>
                {n.current ? <circle {...part('halo')} r={r + 12} /> : null}
                <circle {...part('dot')} r={r} />
                {n.mark ? <g transform={`scale(${Math.min(ts, r / 12)})`}><text {...part('mark')} y={5}>{n.mark}</text></g> : null}
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
