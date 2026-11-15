/**
 * Deterministic force-directed layout (no randomness: the same data always gives the same picture).
 * Charge repulsion + springs on edges + weak gravity, then box collision so that nodes *and their
 * labels* never overlap. Units are abstract world units; the graph view scales them to the screen.
 */
/** `group`: nodes are only swapped with nodes of the same group when untangling (a place stays in its region). */
export interface ForceNode { id: string; r: number; label: string; group?: string }
/** `drawn: false`: a spring only (e.g. region membership); it does not count as a line that may cross others. */
export interface ForceEdge { a: string; b: string; length?: number; strength?: number; drawn?: boolean }
export interface Point { x: number; y: number }

const LABEL_GAP = 6, LABEL_H = 20, CHAR_W = 15;
/** Box of a node with its label underneath, relative to the node centre. */
export function nodeBox(n: ForceNode): { w: number; top: number; bottom: number } {
  const labelW = [...n.label].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? CHAR_W : CHAR_W * 0.6), 0);
  return { w: Math.max(n.r * 2, labelW) + 16, top: n.r + 6, bottom: n.r + LABEL_GAP + LABEL_H + 6 };
}

/**
 * `centers`: nodes whose lines end at the middle of other nodes (a map region is drawn as an area around its places),
 * used when counting crossings.
 *
 * Lines that cross although they need not: the spiral start can leave the simulation stuck in a tangle. When the
 * first layout has crossings, the simulation is run again from tree-shaped starts (a spanning tree laid out radially
 * never crosses itself), the layout with the fewest crossings wins, and what is left is untangled by moving / swapping
 * single nodes. A layout without crossings is returned as it is, so pictures that were fine do not change.
 */
export function forceLayout(nodes: ForceNode[], edges: ForceEdge[], iterations = 420, centers: Record<string, string[]> = {}): Map<string, Point> {
  const n = nodes.length, index = new Map(nodes.map((node, i) => [node.id, i]));
  const degree = nodes.map((node) => edges.filter(e => e.a === node.id || e.b === node.id).length);
  const links = edges.map(e => ({ a: index.get(e.a), b: index.get(e.b), len: e.length ?? 170, k: e.strength ?? 0.6, drawn: e.drawn !== false }))
    .filter((l): l is { a: number; b: number; len: number; k: number; drawn: boolean } => l.a !== undefined && l.b !== undefined && l.a !== l.b);
  const boxes = nodes.map(nodeBox);
  const simulate = (x: Float64Array, y: Float64Array, steps: number, alpha0 = 1): void => {
    const vx = new Float64Array(n), vy = new Float64Array(n);
    let alpha = alpha0;
    const decay = 1 - Math.pow(0.002, 1 / steps);
    for (let step = 0; step < steps; step++) {
      // repulsion
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let dx = x[j]! - x[i]!, dy = y[j]! - y[i]!;
        if (dx === 0 && dy === 0) { dx = (j - i) * 0.01; dy = 0.01; }
        const d2 = Math.max(dx * dx + dy * dy, 100), f = -2600 * alpha / d2;
        vx[i]! += dx * f; vy[i]! += dy * f; vx[j]! -= dx * f; vy[j]! -= dy * f;
      }
      // springs
      for (const l of links) {
        const dx = x[l.b]! - x[l.a]!, dy = y[l.b]! - y[l.a]!, d = Math.hypot(dx, dy) || 1;
        const f = (d - l.len) / d * alpha * l.k * 0.5;
        vx[l.a]! += dx * f; vy[l.a]! += dy * f; vx[l.b]! -= dx * f; vy[l.b]! -= dy * f;
      }
      // gravity (stronger for unconnected nodes, so they stay at the edge of the cluster instead of drifting away), integrate
      for (let i = 0; i < n; i++) {
        const g = degree[i] ? 0.012 : 0.05;
        vx[i]! -= x[i]! * g * alpha; vy[i]! -= y[i]! * g * alpha;
        vx[i]! *= 0.6; vy[i]! *= 0.6; x[i]! += vx[i]!; y[i]! += vy[i]!;
      }
      collide(x, y, boxes, 0.5);
      alpha -= alpha * decay;
    }
    for (let pass = 0; pass < 60; pass++) if (!collide(x, y, boxes, 1)) break;
  };
  const result = (x: Float64Array, y: Float64Array) => new Map(nodes.map((node, i) => [node.id, { x: x[i]!, y: y[i]! }]));

  // Start from a sunflower spiral, ordered by degree so hubs sit in the middle.
  const order = nodes.map((_, i) => i).sort((a, b) => degree[b]! - degree[a]! || (nodes[a]!.id < nodes[b]!.id ? -1 : 1));
  let x: Float64Array = new Float64Array(n), y: Float64Array = new Float64Array(n);
  order.forEach((i, rank) => { const r = 70 * Math.sqrt(rank + 0.5), a = rank * 2.399963; x[i] = r * Math.cos(a); y[i] = r * Math.sin(a); });
  simulate(x, y, iterations);

  // ── crossings ──
  const drawn = links.filter(l => l.drawn);
  const members = nodes.map(node => (centers[node.id] ?? []).map(id => index.get(id)).filter((i): i is number => i !== undefined));
  const at = (px: Float64Array, py: Float64Array, i: number): Point => {
    const m = members[i]!;
    if (!m.length) return { x: px[i]!, y: py[i]! };
    return { x: m.reduce((s, k) => s + px[k]!, 0) / m.length, y: m.reduce((s, k) => s + py[k]!, 0) / m.length };
  };
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const crossing = (px: Float64Array, py: Float64Array): [number, number][] => {
    const ends = drawn.map(l => [at(px, py, l.a), at(px, py, l.b)] as const), out: [number, number][] = [];
    for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
      const e = drawn[i]!, f = drawn[j]!;
      if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
      const [p, q] = ends[i]!, [r, t] = ends[j]!;
      if (side(p, q, r) * side(p, q, t) < 0 && side(r, t, p) * side(r, t, q) < 0) out.push([i, j]);
    }
    return out;
  };
  let count = crossing(x, y).length;
  if (!count || drawn.length < 2) return pack(x, y);

  // ── tree-shaped starts ──
  const adjacent: number[][] = nodes.map(() => []);
  for (const l of links) { adjacent[l.a]!.push(l.b); adjacent[l.b]!.push(l.a); }
  for (const list of adjacent) list.sort((a, b) => (nodes[a]!.id < nodes[b]!.id ? -1 : 1));
  const treeStart = (pick: number): [Float64Array, Float64Array] => {
    const tx = new Float64Array(n), ty = new Float64Array(n), seen = new Uint8Array(n);
    let component = 0;
    for (const first of order) {
      if (seen[first]) continue;
      // nodes of this component, by degree; the root is the pick-th hub of the first (largest-hub) component
      const part: number[] = [], queue = [first]; seen[first] = 1;
      while (queue.length) { const v = queue.shift()!; part.push(v); for (const u of adjacent[v]!) if (!seen[u]) { seen[u] = 1; queue.push(u); } }
      const hubs = order.filter(i => part.includes(i));
      const root = hubs[component === 0 ? Math.min(pick, hubs.length - 1) : 0]!;
      const parent = new Map<number, number>([[root, -1]]), kids = new Map<number, number[]>(), bfs = [root], depth = new Map<number, number>([[root, 0]]);
      for (let h = 0; h < bfs.length; h++) {
        const v = bfs[h]!;
        for (const u of adjacent[v]!) if (!parent.has(u)) { parent.set(u, v); depth.set(u, depth.get(v)! + 1); (kids.get(v) ?? kids.set(v, []).get(v)!).push(u); bfs.push(u); }
      }
      const leaves = new Map<number, number>();
      for (let h = bfs.length - 1; h >= 0; h--) { const v = bfs[h]!; leaves.set(v, Math.max(1, (kids.get(v) ?? []).reduce((s, u) => s + leaves.get(u)!, 0))); }
      // components after the first sit on a ring around it
      const ring = component === 0 ? 0 : 320 + 180 * Math.sqrt(component), turn = component * 2.399963;
      const cx = ring * Math.cos(turn), cy = ring * Math.sin(turn);
      const place = (v: number, from: number, to: number) => {
        const r = depth.get(v)! * 150, a = (from + to) / 2;
        tx[v] = cx + r * Math.cos(a); ty[v] = cy + r * Math.sin(a);
        let start = from;
        for (const u of kids.get(v) ?? []) { const span = (to - from) * leaves.get(u)! / leaves.get(v)!; place(u, start, start + span); start += span; }
      };
      place(root, 0, Math.PI * 2);
      component++;
    }
    return [tx, ty];
  };
  for (let pick = 0; pick < 3 && count; pick++) {
    const [tx, ty] = treeStart(pick);
    simulate(tx, ty, iterations);
    const c = crossing(tx, ty).length;
    if (c < count) { x = tx; y = ty; count = c; }
  }

  // ── untangle what is left: move one node, or swap two, when that removes crossings ──
  const neighbours: number[][] = nodes.map(() => []);
  for (const l of drawn) { neighbours[l.a]!.push(l.b); neighbours[l.b]!.push(l.a); }
  for (let round = 0; round < 8 && count; round++) {
    const bx = x.slice(), by = y.slice(), before = count;
    const tangled = [...new Set(crossing(x, y).flatMap(([i, j]) => [drawn[i]!.a, drawn[i]!.b, drawn[j]!.a, drawn[j]!.b]))].sort((a, b) => (nodes[a]!.id < nodes[b]!.id ? -1 : 1));
    for (const v of tangled) {
      if (!count) break;
      const ox = x[v]!, oy = y[v]!;
      let best = count, move: { x: number; y: number; swap?: number } | undefined;
      const near = neighbours[v]!;
      if (near.length) {
        // towards the middle of its neighbours (a leaf: right next to its only neighbour, on the far side)
        const mx = near.reduce((s, k) => s + x[k]!, 0) / near.length, my = near.reduce((s, k) => s + y[k]!, 0) / near.length;
        for (const t of [1, 0.5]) {
          x[v] = ox + (mx - ox) * t + 1; y[v] = oy + (my - oy) * t + 1;
          const c = crossing(x, y).length;
          if (c < best) { best = c; move = { x: x[v]!, y: y[v]! }; }
        }
        x[v] = ox; y[v] = oy;
      }
      for (let u = 0; u < n; u++) {
        if (u === v || (nodes[u]!.group ?? '') !== (nodes[v]!.group ?? '') || members[u]!.length || members[v]!.length) continue;
        x[v] = x[u]!; y[v] = y[u]!; x[u] = ox; y[u] = oy;
        const c = crossing(x, y).length;
        if (c < best) { best = c; move = { x: x[v]!, y: y[v]!, swap: u }; }
        x[u] = x[v]!; y[u] = y[v]!; x[v] = ox; y[v] = oy;
      }
      if (move) { if (move.swap !== undefined) { x[move.swap] = ox; y[move.swap] = oy; } x[v] = move.x; y[v] = move.y; count = best; }
    }
    if (count === before) break;
    // let the springs and label boxes settle; keep the result only if it did not tangle again
    const sx = x.slice(), sy = y.slice();
    simulate(sx, sy, 90, 0.25);
    const settled = crossing(sx, sy).length;
    if (settled <= count) { x = sx; y = sy; count = settled; continue; }
    for (let pass = 0; pass < 60; pass++) if (!collide(x, y, boxes, 1)) break;
    count = crossing(x, y).length;
    if (count >= before) { x = bx; y = by; count = before; break; }
  }
  return pack(x, y);

  /**
   * Parts with no line or spring between them (separate worlds on a map, people with no ties) are laid out each on
   * its own and then set side by side in rows, biggest first, instead of drifting far apart.
   */
  function pack(px: Float64Array, py: Float64Array): Map<string, Point> {
    const comp = new Int32Array(n).fill(-1), parts: number[][] = [];
    const near: number[][] = nodes.map(() => []);
    for (const l of links) { near[l.a]!.push(l.b); near[l.b]!.push(l.a); }
    for (const i of order) {
      if (comp[i]! >= 0) continue;
      const part = [i]; comp[i] = parts.length;
      for (let h = 0; h < part.length; h++) for (const u of near[part[h]!]!) if (comp[u]! < 0) { comp[u] = parts.length; part.push(u); }
      parts.push(part);
    }
    if (parts.filter(p => p.length > 1).length < 2) return result(px, py);
    // Room between parts for region areas (drawn around their places) and their names above.
    const GAP = 150;
    const rects = parts.map(part => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const i of part) {
        const b = boxes[i]!;
        minX = Math.min(minX, px[i]! - b.w / 2); maxX = Math.max(maxX, px[i]! + b.w / 2);
        minY = Math.min(minY, py[i]! - b.top); maxY = Math.max(maxY, py[i]! + b.bottom);
      }
      return { part, minX, minY, w: maxX - minX, h: maxY - minY };
    }).sort((a, b) => b.part.length - a.part.length || b.w * b.h - a.w * a.h || (nodes[a.part[0]!]!.id < nodes[b.part[0]!]!.id ? -1 : 1));
    const area = rects.reduce((s, r) => s + (r.w + GAP) * (r.h + GAP), 0);
    const width = Math.max(rects[0]!.w, Math.sqrt(area) * 1.15);
    const ox = new Float64Array(n), oy = new Float64Array(n);
    let cx = 0, cy = 0, row = 0;
    for (const r of rects) {
      if (cx > 0 && cx + r.w > width) { cx = 0; cy += row + GAP; row = 0; }
      for (const i of r.part) { ox[i] = px[i]! - r.minX + cx; oy[i] = py[i]! - r.minY + cy; }
      cx += r.w + GAP; row = Math.max(row, r.h);
    }
    // centre the whole picture on the origin
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += ox[i]!; sy += oy[i]!; }
    for (let i = 0; i < n; i++) { ox[i] = ox[i]! - sx / n; oy[i] = oy[i]! - sy / n; }
    return result(ox, oy);
  }
}
/** Number of crossings between drawn lines in a finished layout (tests, diagnostics). */
export function countCrossings(layout: Map<string, Point>, edges: ForceEdge[], centers: Record<string, string[]> = {}): number {
  const at = (id: string): Point | undefined => {
    const m = (centers[id] ?? []).map(k => layout.get(k)).filter((p): p is Point => !!p);
    return m.length ? { x: m.reduce((s, p) => s + p.x, 0) / m.length, y: m.reduce((s, p) => s + p.y, 0) / m.length } : layout.get(id);
  };
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const lines = edges.filter(e => e.drawn !== false && e.a !== e.b && at(e.a) && at(e.b));
  let total = 0;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const e = lines[i]!, f = lines[j]!;
    if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
    const p = at(e.a)!, q = at(e.b)!, r = at(f.a)!, t = at(f.b)!;
    if (side(p, q, r) * side(p, q, t) < 0 && side(r, t, p) * side(r, t, q) < 0) total++;
  }
  return total;
}

/** Push overlapping boxes apart along the axis of least overlap. Returns whether anything moved. */
function collide(x: Float64Array, y: Float64Array, boxes: { w: number; top: number; bottom: number }[], strength: number): boolean {
  let moved = false;
  for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    const ox = (a.w + b.w) / 2 - Math.abs(x[j]! - x[i]!);
    if (ox <= 0) continue;
    // vertical extents: [y - top, y + bottom]
    const aTop = y[i]! - a.top, aBottom = y[i]! + a.bottom, bTop = y[j]! - b.top, bBottom = y[j]! + b.bottom;
    const oy = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);
    if (oy <= 0) continue;
    moved = true;
    if (ox < oy) {
      const s = (x[j]! >= x[i]! ? 1 : -1) * ox / 2 * strength;
      x[i]! -= s; x[j]! += s;
    } else {
      const s = ((bTop + bBottom) >= (aTop + aBottom) ? 1 : -1) * oy / 2 * strength;
      y[i]! -= s; y[j]! += s;
    }
  }
  return moved;
}

export function bounds(points: Iterable<Point & { box: { w: number; top: number; bottom: number } }>, pad = 24): { minX: number; minY: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x - p.box.w / 2); maxX = Math.max(maxX, p.x + p.box.w / 2);
    minY = Math.min(minY, p.y - p.box.top - 18); maxY = Math.max(maxY, p.y + p.box.bottom);
  }
  if (!Number.isFinite(minX)) return { minX: -200, minY: -150, w: 400, h: 300 };
  return { minX: minX - pad, minY: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}
