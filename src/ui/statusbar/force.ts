/**
 * Deterministic force-directed layout (no randomness: the same data always gives the same picture).
 * Charge repulsion + springs on edges + weak gravity, then box collision so that nodes *and their
 * labels* never overlap. Units are abstract world units; the graph view scales them to the screen.
 */
export interface ForceNode { id: string; r: number; label: string }
export interface ForceEdge { a: string; b: string; length?: number; strength?: number }
export interface Point { x: number; y: number }

const LABEL_GAP = 6, LABEL_H = 20, CHAR_W = 15;
/** Box of a node with its label underneath, relative to the node centre. */
export function nodeBox(n: ForceNode): { w: number; top: number; bottom: number } {
  const labelW = [...n.label].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? CHAR_W : CHAR_W * 0.6), 0);
  return { w: Math.max(n.r * 2, labelW) + 16, top: n.r + 6, bottom: n.r + LABEL_GAP + LABEL_H + 6 };
}

export function forceLayout(nodes: ForceNode[], edges: ForceEdge[], iterations = 420): Map<string, Point> {
  const n = nodes.length, index = new Map(nodes.map((node, i) => [node.id, i]));
  const x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
  // Start from a sunflower spiral, ordered by degree so hubs sit in the middle.
  const degree = nodes.map((node) => edges.filter(e => e.a === node.id || e.b === node.id).length);
  const order = nodes.map((_, i) => i).sort((a, b) => degree[b]! - degree[a]! || (nodes[a]!.id < nodes[b]!.id ? -1 : 1));
  order.forEach((i, rank) => { const r = 70 * Math.sqrt(rank + 0.5), a = rank * 2.399963; x[i] = r * Math.cos(a); y[i] = r * Math.sin(a); });
  const links = edges.map(e => ({ a: index.get(e.a), b: index.get(e.b), len: e.length ?? 170, k: e.strength ?? 0.6 }))
    .filter((l): l is { a: number; b: number; len: number; k: number } => l.a !== undefined && l.b !== undefined && l.a !== l.b);
  const boxes = nodes.map(nodeBox);
  let alpha = 1;
  const decay = 1 - Math.pow(0.002, 1 / iterations);
  for (let step = 0; step < iterations; step++) {
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
  return new Map(nodes.map((node, i) => [node.id, { x: x[i]!, y: y[i]! }]));
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
