/**
 * 结构制作 · 字段蓝图。React Flow 画布：每个顶层字段一张卡片，标量字段是卡片里的一行，复合字段（一组字段、字典 / 列表的每一项）嵌成子卡片。
 * 拖动：组件栏的类型拖进卡片 = 新字段，拖到空白处 = 新卡片；按住 ⠿ 拖行 / 子卡片到别的卡片 = 移进去，拖到空白处 = 变成独立卡片；整张卡片压到另一张上 = 嵌进去。
 * 连线：「指向」字段右侧端口 → 实体卡片 = 指向哪类实体；模块卡片 → 字段 = 归入模块；模块 → 模块 = 上下级。点线可删。
 * 手机：同样的拖动（按住 ⠿）；组件栏在底部，也可以点一下类型再点卡片放置；连线可以点起点再点终点。
 */
import * as React from 'react';
import {
  ReactFlow, ReactFlowProvider, Handle, Position, Background, BackgroundVariant, Controls, MiniMap, BaseEdge, EdgeLabelRenderer, getBezierPath,
  applyNodeChanges, useReactFlow, useUpdateNodeInternals,
  type Node, type Edge, type NodeProps, type EdgeProps, type Connection, type NodeChange, type EdgeChange, type IsValidConnection,
} from '@xyflow/react';
import xyCss from '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { useKit } from '../kit.js';
import { useWide } from '../statusbar/widgets.js';
import type { FieldNode, FieldType, StructureDescription, StructureModule } from '../../structure.js';
import { addrKey, childrenOf, fromKey, freeKey, insertAt, nodeAt, relocate, retype, update, within, type Addr } from './draft.js';
import { Inspector, ModuleEditor, TYPES, nameOf, part, solve, typeInfo, useB } from './builder.js';

export { xyCss };

// ── helpers ──

const isCard = (n: FieldNode | undefined) => !!n && (n.type === 'object' || ((n.type === 'record' || n.type === 'array') && n.of?.type === 'object'));
/** Where a card's own fields live (the object itself, or each entry). */
const hostOf = (addr: Addr, n: FieldNode | undefined): Addr | undefined => !n ? undefined : n.type === 'object' ? addr : isCard(n) ? [...addr, '*'] : undefined;
const listOf = (v: string | string[] | undefined) => ([] as string[]).concat(v ?? []);
const NEW_KEY: Record<string, string> = { string: 'text', int: 'count', number: 'value', bool: 'flag', enum: 'choice', ladder: 'level', ref: 'target', refs: 'targets', object: 'group', record: 'dict', array: 'list', oneOf: 'either' };
const SHORT: Record<string, string> = { string: '文字', int: '整数', number: '小数', bool: '开关', enum: '选项', ladder: '等级', ref: '指向一个', refs: '指向多个', object: '一组字段', record: '字典', array: '列表', oneOf: '多种写法' };
const shortLabel = (t: FieldType) => SHORT[t] ?? t;

function summary(n: FieldNode, entities: Record<string, string>, self: string[] = []): string {
  switch (n.type) {
    case 'int': case 'number': return n.min !== undefined && n.max !== undefined ? `${n.min}–${n.max}` : n.min !== undefined ? `≥ ${n.min}` : n.max !== undefined ? `≤ ${n.max}` : '';
    case 'enum': case 'ladder': return n.values?.length ? (n.values.length <= 3 ? n.values.join(' / ') : `${n.values.length} 个选项`) : '无选项';
    case 'ref': case 'refs': return listOf(n.to).length ? '→ ' + listOf(n.to).map(e => (entities[e] ?? e) + (self.includes(e) ? '↺' : '')).join(' / ') : '→ 任意';
    case 'array': return `列表 · ${n.of ? shortLabel(n.of.type) : '?'}${n.list?.max ? ` · ≤${n.list.max}` : ''}`;
    case 'record': return `字典 · ${n.of ? shortLabel(n.of.type) : '?'}`;
    case 'oneOf': return `${n.variants?.length ?? 0} 种写法`;
    default: return '';
  }
}

// ── blueprint state shared by cards ──

type Payload = { kind: 'move'; addr: Addr } | { kind: 'new'; type: FieldType } | { kind: 'module'; name: string };
type Target = { host: Addr; index?: number; mark: string; edge?: 'before' | 'after' | 'in' } | { pane: true; x: number; y: number };
interface Bp {
  isOpen: (key: string, top: boolean) => boolean; toggle: (key: string, top: boolean) => void;
  begin: (e: React.PointerEvent, p: Payload) => void; target?: Target; dragging?: string;
  armed?: FieldType; place: (host: Addr, index?: number) => void;
  query: string; entities: Record<string, string>; entityAt: Record<string, Addr>; layers: { ref: boolean };
  /** Module view: the module being painted onto fields (tap a field to add / remove it). */
  lens?: string; paint: (addr: Addr) => void; tone: (module: string) => number;
  /** Where the selected wire was clicked (flow coordinates) — the × goes there. */
  clickAt?: { x: number; y: number };
}
const BpContext = React.createContext<Bp | null>(null);
const useBp = () => React.useContext(BpContext)!;

/** Every entity type → the collection that declares it, and its label. */
function entityMap(d: StructureDescription) {
  const at: Record<string, Addr> = {}, label: Record<string, string> = {};
  const walk = (n: FieldNode, addr: Addr) => { for (const [k, c] of childrenOf(n)) { const a = [...addr, k]; if (c.entity) { at[c.entity] = a; label[c.entity] = c.label ?? c.entity; } walk(c, a); } };
  walk({ type: 'object', fields: d.fields }, []);
  return { at, label };
}

/** Direct: the field lists the module; inherit: a card it sits in does. */
function lensOf(d: StructureDescription, addr: Addr, m: string | undefined): 'in' | 'inherit' | 'out' | undefined {
  if (!m) return undefined;
  if (listOf(nodeAt(d, addr)?.module).includes(m)) return 'in';
  for (let i = 1; i < addr.length; i++) if (listOf(nodeAt(d, addr.slice(0, i))?.module).includes(m)) return 'inherit';
  return 'out';
}
const TONES = 6;
const TONE_VARS = ['var(--k-accent)', 'var(--k-info)', 'var(--k-warning)', 'var(--k-success)', 'var(--k-danger)', 'color-mix(in srgb, var(--k-accent) 50%, var(--k-info))'];

// ── cards ──

function Grip({ addr, label }: { addr: Addr; label: string }) {
  const bp = useBp();
  return <button type="button" className="nodrag nopan" {...part('grip')} onPointerDown={e => bp.begin(e, { kind: 'move', addr })} aria-label={`拖动「${label}」：放进别的卡片，或拖到空白处变成独立卡片`}>⠿</button>;
}
function Dots({ node }: { node: FieldNode }) {
  const { d } = useB(), bp = useBp();
  const mods = listOf(node.module);
  return mods.length ? <span {...part('mods')}>{mods.map(m => <small key={m} {...part('mod')} data-tone={bp.tone(m)} data-on={bp.lens === m ? '' : undefined}>{d.modules?.[m]?.label ?? m}</small>)}</span> : null;
}
function IssueDot({ addr }: { addr: Addr }) {
  const { issuesAt } = useB(), issues = issuesAt(addr);
  if (!issues.length) return null;
  const level = issues.some(i => i.level === 'error') ? 'error' : 'warning';
  return <b {...part('issue')} data-level={level} title={issues.map(i => i.message).join('\n')} aria-label={level === 'error' ? '有错误' : '有提醒'} />;
}
const matchQ = (n: FieldNode, key: string, q: string) => !!q && ((n.label ?? '').toLowerCase().includes(q) || key.toLowerCase().includes(q));

function Row({ addr, node, parent }: { addr: Addr; node: FieldNode; parent?: FieldNode }) {
  const { selected, select } = useB(), bp = useBp();
  const key = addrKey(addr), name = nameOf(node, addr.at(-1)!, parent);
  const t = bp.target && 'mark' in bp.target && bp.target.mark === key ? bp.target.edge : undefined;
  const { d } = useB();
  const self = listOf(node.to).filter(e => bp.entityAt[e]?.[0] === addr[0]);
  const pick = () => { if (bp.armed) { const host = addr.slice(0, -1), sibs = Object.keys(parent?.fields ?? {}); bp.place(host, sibs.indexOf(addr.at(-1)!) + 1); } else if (bp.lens) bp.paint(addr); else select(addr); };
  return (
    <div {...solve('bp-row', { type: node.type })} data-bp-row={key} data-lens={lensOf(d, addr, bp.lens)} data-current={selected && addrKey(selected) === key ? '' : undefined}
      data-drop={t} data-dragging={bp.dragging === key ? '' : undefined} data-match={matchQ(node, addr.at(-1)!, bp.query) ? '' : undefined}>
      <Handle type="target" position={Position.Left} id={'in:' + key} className="bp-port" data-kind="in" />
      <Grip addr={addr} label={name} />
      <button type="button" {...part('pick')} onClick={pick}>
        <i {...part('type')} data-type={node.type} title={typeInfo(node.type).label}>{typeInfo(node.type).tag}</i>
        <span {...part('label')}>{name}</span>
        <code>{addr.at(-1)}</code>
        <small {...part('sum')} title={self.length ? '↺ 指向本卡片里的实体，不画线' : undefined}>{summary(node, bp.entities, self)}</small>
        <Dots node={node} /><IssueDot addr={addr} />
      </button>
      {node.type === 'ref' || node.type === 'refs' ? <Handle type="source" position={Position.Right} id={'ref:' + key} className="bp-port" data-kind="ref" title="拖到实体卡片上：指向这类实体" /> : null}
    </div>
  );
}

function Card({ addr, node, parent, top }: { addr: Addr; node: FieldNode; parent?: FieldNode; top?: boolean }) {
  const { selected, select } = useB(), bp = useBp();
  const key = addrKey(addr), name = nameOf(node, addr.at(-1)!, parent), host = hostOf(addr, node), hostKey = host ? addrKey(host) : undefined;
  const open = bp.isOpen(key, !!top);
  const body = node.type === 'object' ? node : node.of;
  const kids = childrenOf(body);
  const t = bp.target && 'mark' in bp.target && (bp.target.mark === hostKey || bp.target.mark === key) ? bp.target.edge ?? 'in' : undefined;
  const { d } = useB();
  const pick = () => { if (bp.armed && host) bp.place(host); else if (bp.lens) bp.paint(addr); else select(addr); };
  return (
    <section {...solve('bp-card', { type: node.type, top: top ? '' : undefined })} data-bp-host={hostKey} data-bp-card={key} data-lens={lensOf(d, addr, bp.lens)}
      data-current={selected && addrKey(selected) === key ? '' : undefined} data-drop={t} data-dragging={bp.dragging === key ? '' : undefined}
      data-entity={node.entity ? '' : undefined} data-match={matchQ(node, addr.at(-1)!, bp.query) ? '' : undefined}>
      <header className={top ? 'bp-drag' : undefined}>
        <Handle type="target" position={Position.Left} id={'in:' + key} className="bp-port" data-kind={node.entity ? 'entity' : 'in'} title={node.entity ? '「指向」字段连到这里' : undefined} />
        {top ? <span {...part('grip')} data-top="" aria-hidden="true">⠿</span> : <Grip addr={addr} label={name} />}
        <button type="button" className="nodrag" {...part('twist')} onClick={() => bp.toggle(key, !!top)} aria-label={open ? '收起' : '展开'} aria-expanded={open}>{open ? '▾' : '▸'}</button>
        <button type="button" {...part('pick')} onClick={pick}>
          <i {...part('type')} data-type={node.type}>{typeInfo(node.type).tag}</i>
          <b {...part('label')}>{name}</b>
          {addr.at(-1) !== '*' ? <code>{addr.at(-1)}</code> : null}
          {node.entity ? <small {...part('entity')}>实体 · {node.entity}</small> : null}
          <Dots node={node} /><IssueDot addr={addr} />
          {!open ? <small {...part('sum')}>{kids.length} 个字段</small> : null}
        </button>
        <Handle type="source" position={Position.Right} id={'out:' + key} className="bp-port" data-kind="hidden" isConnectable={false} />
      </header>
      {open ? (
        <div {...part('body')}>
          {node.type !== 'object' ? <p {...part('each')}>{node.type === 'record' ? (node.entity ? `按 ID 存多个${node.label ?? ''}，每个都有：` : node.keys ? `固定的几项（${node.keys.length}），每项都有：` : '按名字存多条，每条都有：') : `列表${node.list?.max ? `（最多 ${node.list.max} 条）` : ''}，每一项都有：`}</p> : null}
          {kids.map(([k, c]) => {
            const a = [...host!, k];
            return isCard(c) ? <Card key={k} addr={a} node={c} parent={body} /> : <Row key={k} addr={a} node={c} parent={body} />;
          })}
          <button type="button" className="nodrag" {...part('drop')} onClick={() => (bp.armed ? bp.place(host!) : select(addr))}>
            {bp.armed ? `放一个「${shortLabel(bp.armed)}」到这里` : kids.length ? '把字段拖进来' : '空的 · 把字段拖进来'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function FieldCardNode({ id, data }: NodeProps<Node<{ addr: Addr }, 'field'>>) {
  const { d } = useB(), bp = useBp(), upd = useUpdateNodeInternals();
  const node = nodeAt(d, data.addr);
  const sig = JSON.stringify(node);
  React.useEffect(() => { upd(id); }, [sig, bp.isOpen, upd, id]);
  if (!node) return null;
  return isCard(node) ? <Card addr={data.addr} node={node} top /> : (
    <section {...solve('bp-card', { type: node.type, top: '' })} data-single="">
      <header className="bp-drag"><span {...part('grip')} data-top="" aria-hidden="true">⠿</span><b {...part('label')}>顶层字段</b></header>
      <div {...part('body')}><Row addr={data.addr} node={node} /></div>
    </section>
  );
}

// ── wires ──

type WireData = { kind: 'ref'; path?: string; entity?: string };
function Wire(props: EdgeProps<Edge<WireData, 'wire'>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data, markerEnd, style } = props;
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const unwire = useUnwire(), at = useBp().clickAt ?? { x: lx, y: ly };
  return (
    <>
      <BaseEdge path={path} {...(markerEnd ? { markerEnd } : {})} {...(style ? { style } : {})} interactionWidth={24} />
      {selected && data ? (
        <EdgeLabelRenderer>
          <button type="button" className="nodrag nopan" {...solve('bp-unwire')} style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }} onClick={() => unwire(data)} aria-label="断开这根线">×</button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
function useUnwire() {
  const { d, set, note } = useB();
  return (w: WireData) => {
    if (w.kind === 'ref' && w.path) { const n = nodeAt(d, fromKey(w.path)); const to = listOf(n?.to).filter(e => e !== w.entity); set(update(d, fromKey(w.path), { to: to.length ? (to.length === 1 ? to[0] : to) : undefined } as Partial<FieldNode>)); note('已断开：不再限定指向这类实体'); }
  };
}

const nodeTypes = { field: FieldCardNode };
const edgeTypes = { wire: Wire };

// ── layout ──

const COL = 360, GAP = 28;
function estimate(n: FieldNode, top: boolean, open: (k: string, top: boolean) => boolean, key: string): number {
  if (!isCard(n)) return 36;
  if (!open(key, top)) return 44;
  const host = n.type === 'object' ? key : key + '.*', body = n.type === 'object' ? n : n.of;
  return 44 + 40 + (n.type === 'object' ? 0 : 26) + childrenOf(body).reduce((s, [k, c]) => s + estimate(c, false, open, host + '.' + k) + 4, 0);
}
/** Pushes cards down so none overlap (after something grew). */
function settle(all: Node[]): Node[] {
  const b = settleSome(all, 320, 80, GAP);
  if (b.changed) { const by = new Map(b.nodes.map(n => [n.id, n])); return all.map(n => by.get(n.id) ?? n); }
  return all;
}
function settleSome(nodes: Node[], W: number, H: number, gap: number): { nodes: Node[]; changed: boolean } {
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y), placed: Node[] = [];
  let changed = false;
  for (const n of sorted) {
    let y = n.position.y; const w = n.measured?.width ?? W;
    for (let again = true; again;) {
      again = false;
      for (const p of placed) {
        const pw = p.measured?.width ?? W, ph = p.measured?.height ?? H;
        if (n.position.x < p.position.x + pw && p.position.x < n.position.x + w && y < p.position.y + ph + gap && p.position.y < y + (n.measured?.height ?? H)) { y = p.position.y + ph + gap; again = true; }
      }
    }
    if (y !== n.position.y) { changed = true; placed.push({ ...n, position: { ...n.position, y } }); } else placed.push(n);
  }
  return { nodes: placed, changed };
}

/**
 * Layout by the wires: dagre layers the cards left → right along the references (a card that points at an entity sits left of
 * that entity's card) and orders each layer to cut crossings. Cards without any wire go into a block of their own on the right.
 */
function arrange(nodes: Node[], d: StructureDescription, ents: Record<string, Addr>): Node[] {
  const links = new Map<string, number>();
  const walk = (n: FieldNode, addr: Addr) => {
    for (const [k, c] of childrenOf(n)) {
      const a = [...addr, k];
      if (c.type === 'ref' || c.type === 'refs') for (const e of listOf(c.to)) { const t = ents[e]; if (t && t[0] !== a[0]) { const key = 'f:' + a[0] + '>f:' + t[0]; links.set(key, (links.get(key) ?? 0) + 1); } }
      walk(c, a);
    }
  };
  walk({ type: 'object', fields: d.fields }, []);
  const wired = new Set([...links.keys()].flatMap(k => k.split('>')));
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 150, marginx: 0, marginy: 0, ranker: 'network-simplex' });
  g.setDefaultEdgeLabel(() => ({}));
  const size = (n: Node) => ({ width: n.measured?.width ?? 320, height: n.measured?.height ?? 200 });
  for (const n of nodes) if (wired.has(n.id)) g.setNode(n.id, size(n));
  for (const [k, w] of links) { const [a, b] = k.split('>') as [string, string]; if (g.hasNode(a) && g.hasNode(b)) g.setEdge(a, b, { weight: w, minlen: 1 }); }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  let right = 0;
  for (const id of g.nodes()) { const p = g.node(id), sz = size(nodes.find(n => n.id === id)!); out.set(id, { x: p.x - sz.width / 2, y: p.y - sz.height / 2 }); right = Math.max(right, p.x + sz.width / 2); }
  const cols = [0, 0], x0 = wired.size ? right + 120 : 0;
  for (const n of nodes) if (!out.has(n.id)) { const c = cols[0]! <= cols[1]! ? 0 : 1; out.set(n.id, { x: x0 + c * COL, y: cols[c]! }); cols[c]! += size(n).height + GAP; }
  return nodes.map(n => ({ ...n, position: out.get(n.id) ?? n.position }));
}

// ── canvas ──

export function Blueprint() {
  return <ReactFlowProvider><Canvas /></ReactFlowProvider>;
}

function Canvas() {
  const K = useKit(), b = useB(), { d, set, select, selected, note } = b;
  const rf = useReactFlow();
  const [box, wide] = useWide(760);
  const wrap = box as React.RefObject<HTMLDivElement | null>;
  const [fold, setFold] = React.useState<Map<string, boolean>>(() => new Map());
  const isOpen = React.useCallback((k: string, top: boolean) => fold.get(k) ?? top, [fold]);
  const [query, setQuery] = React.useState('');
  const [layers, setLayers] = React.useState({ ref: true });
  const [lens, setLens] = React.useState<string | undefined>();
  const [armed, setArmed] = React.useState<FieldType | undefined>();
  const [drag, setDrag] = React.useState<{ p: Payload; x: number; y: number; target?: Target } | undefined>();
  const [edgeSel, setEdgeSel] = React.useState<string | undefined>();
  const [clickAt, setClickAt] = React.useState<{ x: number; y: number } | undefined>();
  const ents = React.useMemo(() => entityMap(d), [d]);

  // Expand the ancestors of the selected field.
  React.useEffect(() => {
    if (!selected || selected[0]?.startsWith('module:')) return;
    setFold(cur => { let next: Map<string, boolean> | undefined; for (let i = 1; i < selected.length; i++) { const k = addrKey(selected.slice(0, i)); if (selected[i - 1] !== '*' && (cur.get(k) ?? i === 1) === false) (next ??= new Map(cur)).set(k, true); } return next ?? cur; });
  }, [selected && addrKey(selected)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Module view opens the cards its fields sit in, so the members are visible.
  React.useEffect(() => {
    if (!lens) return undefined;
    const open: string[] = [];
    const walk = (n: FieldNode, addr: Addr) => { for (const [k, c] of childrenOf(n)) { const x = [...addr, k]; if (listOf(c.module).includes(lens)) for (let i = 1; i < x.length; i++) if (x[i - 1] !== '*') open.push(addrKey(x.slice(0, i))); walk(c, x); } };
    walk({ type: 'object', fields: d.fields }, []);
    if (open.length) setFold(cur => { const next = new Map(cur); for (const k of open) next.set(k, true); return next; });
    // Then bring the first member into view if it is off screen.
    const t = setTimeout(() => {
      const el = wrap.current?.querySelector('[data-lens="in"]'), box = wrap.current?.querySelector('.react-flow')?.getBoundingClientRect();
      if (!el || !box) return;
      const r = el.getBoundingClientRect();
      if (r.top >= box.top + 90 && r.bottom <= box.bottom - 70 && r.left >= box.left && r.right <= box.right) return;
      const c = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      void rf.setCenter(c.x, c.y, { zoom: rf.getZoom(), duration: 300 });
    }, 120);
    return () => clearTimeout(t);
  }, [lens]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nodes: one per top-level field + one per module. Positions are kept across edits; new ones get a masonry slot.
  const [nodes, setNodes] = React.useState<Node[]>([]);
  const heights = React.useRef<Record<string, number>>({});
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    setNodes(cur => {
      const byId = new Map(cur.map(n => [n.id, n]));
      const out: Node[] = [];
      const cols = [0, 0, 0];
      for (const n of cur) if (n.type === 'field') { const c = Math.round(n.position.x / COL); if (c >= 0 && c < 3) cols[c] = Math.max(cols[c]!, n.position.y + (n.measured?.height ?? 200) + GAP); }
      for (const [k, f] of Object.entries(d.fields)) {
        const id = 'f:' + k, old = byId.get(id);
        if (old) { out.push({ ...old, data: { addr: [k] } }); continue; }
        const c = cols.indexOf(Math.min(...cols));
        out.push({ id, type: 'field', position: { x: c * COL, y: cols[c]! }, data: { addr: [k] }, dragHandle: '.bp-drag', selectable: false, deletable: false });
        cols[c]! += (heights.current[id] ?? estimate(f, true, isOpen, k)) + GAP;
      }
      return out;
    });
  }, [d, isOpen, tick]);
  const pending = React.useRef<Record<string, { x: number; y: number }>>({});
  const onNodesChange = React.useCallback((changes: NodeChange[]) => {
    setNodes(ns => {
      let next = applyNodeChanges(changes, ns);
      const pend = pending.current;
      if (Object.keys(pend).length) { next = next.map(n => pend[n.id] ? { ...n, position: pend[n.id]! } : n); pending.current = {}; }
      return changes.some(c => c.type === 'dimensions') ? settle(next) : next;
    });
  }, []);

  // Wires derived from the structure.
  const edges = React.useMemo(() => {
    const out: Edge<WireData>[] = [];
    const visible = (a: Addr): Addr => { for (let i = 1; i < a.length; i++) { const p = a.slice(0, i); if (a[i - 1] === '*') continue; if (isCard(nodeAt(d, p)) && !isOpen(addrKey(p), i === 1)) return p; } return a.at(-1) === '*' ? a.slice(0, -1) : a; };
    const walk = (n: FieldNode, addr: Addr) => {
      for (const [k, c] of childrenOf(n)) {
        const a = [...addr, k], path = addrKey(a);
        if (layers.ref && (c.type === 'ref' || c.type === 'refs')) for (const e of listOf(c.to)) {
          const target = ents.at[e]; if (!target) continue;
          const s = visible(a), t = visible(target), id = `ref|${path}|${e}`;
          if (s[0] === t[0]) continue;
          out.push({ id, type: 'wire', source: 'f:' + s[0], target: 'f:' + t[0], sourceHandle: (addrKey(s) === path ? 'ref:' : 'out:') + addrKey(s), targetHandle: 'in:' + addrKey(t), data: { kind: 'ref', path, entity: e }, className: 'bp-wire', selected: edgeSel === id });
        }
        walk(c, a);
      }
    };
    walk({ type: 'object', fields: d.fields }, []);
    return out.map(e => ({ ...e, className: 'bp-wire bp-wire-' + e.data!.kind }));
  }, [d, isOpen, layers, ents, edgeSel]);
  const onEdgesChange = React.useCallback((changes: EdgeChange[]) => { for (const c of changes) if (c.type === 'select') setEdgeSel(c.selected ? c.id : undefined); }, []);
  const unwire = useUnwire();

  // Connecting.
  const parse = (c: Connection | Edge) => ({ s: String(c.sourceHandle ?? ''), t: String(c.targetHandle ?? '') });
  const isValidConnection: IsValidConnection = c => {
    const { s, t } = parse(c);
    if (s.startsWith('ref:') && t.startsWith('in:')) return !!nodeAt(d, fromKey(t.slice(3)))?.entity;
    return false;
  };
  const onConnect = (c: Connection) => {
    if (!isValidConnection(c)) return;
    const { s, t } = parse(c);
    if (s.startsWith('ref:')) {
      const a = fromKey(s.slice(4)), n = nodeAt(d, a), e = nodeAt(d, fromKey(t.slice(3)))!.entity!;
      const all = [...new Set([...listOf(n?.to), e])], to = all.length === 1 ? all[0] : all;
      set(update(d, a, { to } as Partial<FieldNode>)); note(`「${n?.label ?? a.at(-1)}」指向${ents.label[e] ?? e}`);
    }
  };

  // Structural drag (rows, nested cards, palette types) and drops.
  const hit = (root: Document | ShadowRoot, x: number, y: number, p: Payload, skip?: string): Target | undefined => {
    for (const el of root.elementsFromPoint(x, y)) {
      if (skip && el.closest(`[data-id="${skip}"]`)) continue;
      if (el.closest('[data-solve="bp-side"], [data-solve="bp-palette"], .react-flow__panel')) return undefined;
      if (p.kind === 'module') {
        const at = el.closest('[data-bp-row]')?.getAttribute('data-bp-row') ?? el.closest('[data-bp-card]')?.getAttribute('data-bp-card');
        if (at) return { host: fromKey(at), mark: at, edge: 'in' };
        if (el.classList.contains('react-flow__pane')) return undefined;
        continue;
      }
      const row = el.closest('[data-bp-row]');
      if (row) {
        const a = fromKey(row.getAttribute('data-bp-row')!), host = a.slice(0, -1);
        if (p.kind === 'move' && within(host, p.addr)) return undefined;
        const sibs = Object.keys(nodeAt(d, host)?.fields ?? {}), r = row.getBoundingClientRect(), after = y > r.top + r.height / 2;
        return { host, index: sibs.indexOf(a.at(-1)!) + (after ? 1 : 0), mark: addrKey(a), edge: after ? 'after' : 'before' };
      }
      const card = el.closest('[data-bp-host]');
      if (card) {
        const host = fromKey(card.getAttribute('data-bp-host')!);
        if (p.kind === 'move' && within(host, p.addr)) return undefined;
        return { host, mark: addrKey(host), edge: 'in' };
      }
      if (el.closest('[data-bp-card]')) return undefined;
      if (el.classList.contains('react-flow__pane')) return { pane: true, x, y };
    }
    return undefined;
  };
  const create = (type: FieldType, host: Addr, index?: number, at?: { x: number; y: number }) => {
    const h = nodeAt(d, host); if (!h) return;
    const key = freeKey(h.fields, NEW_KEY[type] ?? 'field');
    const next = retype(insertAt(d, host, key, { type, label: '新' + shortLabel(type) } as FieldNode, index), [...host, key], type).next;
    if (at && !host.length) pending.current['f:' + key] = at;
    set(next); select([...host, key]); note(`已添加「新${shortLabel(type)}」，在右边改名字和键名`);
  };
  const drop = (p: Payload, t: Target | undefined) => {
    if (!t) return;
    const at = 'pane' in t ? rf.screenToFlowPosition({ x: t.x, y: t.y }) : undefined;
    const host = 'pane' in t ? [] : t.host, index = 'pane' in t ? undefined : t.index;
    if (p.kind === 'new') { create(p.type, host, index, at); return; }
    if (p.kind === 'module') { if (!('pane' in t)) paintWith(p.name, t.host, true); return; }
    if ('pane' in t && p.addr.length === 1) return;
    const r = relocate(d, p.addr, host, index);
    if (r.next === d) return;
    if (at) pending.current['f:' + r.addr[0]] = at;
    set(r.next); select(r.addr);
    note(addrKey(r.addr.slice(0, -1)) === addrKey(p.addr.slice(0, -1)) ? '已调整顺序' : host.length ? `已移进「${nameOf(nodeAt(r.next, host), host.at(-1)!, nodeAt(r.next, host.slice(0, -1)))}」，开局数据里的旧值没有搬过去` : '已变成独立卡片');
  };
  const begin = (e: React.PointerEvent, p: Payload) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const root = (e.currentTarget as Element).getRootNode() as Document | ShadowRoot, sx = e.clientX, sy = e.clientY;
    let moved = false, last: Target | undefined;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true; last = hit(root, ev.clientX, ev.clientY, p);
      setDrag({ p, x: ev.clientX, y: ev.clientY, ...(last ? { target: last } : {}) });
    };
    const end = (ev: PointerEvent, ok: boolean) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      setDrag(undefined);
      if (!ok) return;
      if (moved) drop(p, hit(root, ev.clientX, ev.clientY, p));
      else if (p.kind === 'new') setArmed(cur => cur === p.type ? undefined : p.type);
      else if (p.kind === 'module') setLens(cur => cur === p.name ? undefined : p.name);
    };
    const up = (ev: PointerEvent) => end(ev, true), cancel = (ev: PointerEvent) => end(ev, false);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };
  // A whole top-level card dropped onto another card nests it.
  const [nodeDrop, setNodeDrop] = React.useState<Target | undefined>();
  const pointOf = (ev: MouseEvent | TouchEvent) => 'changedTouches' in ev ? { x: ev.changedTouches[0]!.clientX, y: ev.changedTouches[0]!.clientY } : { x: ev.clientX, y: ev.clientY };
  const rootOf = () => (wrap.current?.getRootNode() ?? document) as Document | ShadowRoot;
  const onNodeDrag = (ev: React.MouseEvent | MouseEvent | TouchEvent, n: Node) => {
    if (n.type !== 'field') return;
    const { x, y } = pointOf((('nativeEvent' in ev) ? ev.nativeEvent : ev) as MouseEvent);
    const t = hit(rootOf(), x, y, { kind: 'move', addr: (n.data as { addr: Addr }).addr }, n.id);
    setNodeDrop(t && !('pane' in t) ? t : undefined);
  };
  const onNodeDragStop = (_: unknown, n: Node) => {
    const t = nodeDrop; setNodeDrop(undefined);
    if (!t || 'pane' in t || n.type !== 'field') return;
    drop({ kind: 'move', addr: (n.data as { addr: Addr }).addr }, t);
  };

  /** Adds a field to a module, or takes it out (add: true only adds). */
  const paintWith = (m: string, addr: Addr, add = false) => {
    const n = nodeAt(d, addr); if (!n) return;
    const name = nameOf(n, addr.at(-1)!, nodeAt(d, addr.slice(0, -1))), label = d.modules?.[m]?.label ?? m, mods = listOf(n.module);
    if (mods.includes(m) && add) { note(`「${name}」已经在「${label}」里`); return; }
    const next = mods.includes(m) ? mods.filter(x => x !== m) : [...mods, m];
    set(update(d, addr, { module: next.length ? (next.length === 1 ? next[0] : next) : undefined } as Partial<FieldNode>));
    note(mods.includes(m) ? `「${name}」移出了「${label}」` : `「${name}」加入了「${label}」${isCard(n) ? '，卡片里的字段跟着它' : ''}`);
  };
  const modNames = Object.keys(d.modules ?? {});
  const tone = (m: string) => Math.max(0, modNames.indexOf(m)) % TONES;
  const place = (host: Addr, index?: number) => { if (armed) { create(armed, host, index); setArmed(undefined); } };
  const target = drag?.target ?? nodeDrop;
  const bp: Bp = {
    isOpen, toggle: (k, top) => setFold(cur => new Map(cur).set(k, !(cur.get(k) ?? top))),
    begin, ...(target ? { target } : {}), ...(drag?.p.kind === 'move' ? { dragging: addrKey(drag.p.addr) } : {}),
    ...(armed ? { armed } : {}), place, query: query.trim().toLowerCase(), entities: ents.label, entityAt: ents.at, layers, ...(clickAt ? { clickAt } : {}),
    ...(lens ? { lens } : {}), paint: a => { if (lens) paintWith(lens, a); }, tone,
  };

  // The tool bar and module bar sit on top of the canvas (and the type strip at the bottom on phones): keep cards out from under them.
  const fitOpts = { padding: { top: '104px', bottom: wide ? '20px' : '72px', left: '24px', right: '24px' }, maxZoom: 0.85 } as const;
  // Initial viewport; focus the selected card when it is off screen.
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (ready || !nodes.length || !nodes.every(n => n.measured)) return;
    setReady(true);
    const laid = arrange(nodes, d, ents.at);
    setNodes(laid);
    if (selected && !selected[0]?.startsWith('module:')) void rf.fitView({ nodes: [{ id: 'f:' + selected[0] }], maxZoom: 1, padding: 0.2 });
    else {
      // Start at the top-left of the layout (where the wires begin), as large as still fits, but readable.
      const box = wrap.current?.querySelector('.react-flow')?.getBoundingClientRect();
      const minX = Math.min(...laid.map(n => n.position.x)), minY = Math.min(...laid.map(n => n.position.y));
      const maxX = Math.max(...laid.map(n => n.position.x + (n.measured?.width ?? 320))), maxY = Math.max(...laid.map(n => n.position.y + (n.measured?.height ?? 200)));
      const fit = box ? Math.min((box.width - 48) / (maxX - minX), (box.height - 124) / (maxY - minY)) : 0.7;
      const zoom = wide ? Math.min(0.85, Math.max(0.55, fit)) : 0.72;
      // Phones see one card at a time: start at the leftmost one, where the wires begin.
      const first = [...laid].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)[0]!;
      void rf.setViewport(wide ? { x: 24 - minX * zoom, y: 104 - minY * zoom, zoom } : { x: 16 - first.position.x * zoom, y: 104 - first.position.y * zoom, zoom });
    }
  }, [nodes, ready, wide]); // eslint-disable-line react-hooks/exhaustive-deps

  const addModule = () => {
    const name = freeKey(d.modules, 'module');
    set({ ...d, modules: { ...d.modules, [name]: { label: '新模块' } } }); select(['module:' + name]); setLens(name); note('已添加模块：右边改名字，点字段把它加进来');
  };
  const relayout = () => { heights.current = Object.fromEntries(nodes.filter(n => n.measured?.height).map(n => [n.id, n.measured!.height!])); setNodes([]); setTick(t => t + 1); setReady(false); };
  const findFirst = () => {
    const q = query.trim().toLowerCase(); if (!q) return;
    let hitAddr: Addr | undefined;
    const walk = (n: FieldNode, a: Addr) => { for (const [k, c] of childrenOf(n)) { if (hitAddr) return; const x = [...a, k]; if (matchQ(c, k, q)) hitAddr = x; else walk(c, x); } };
    walk({ type: 'object', fields: d.fields }, []);
    if (hitAddr) { select(hitAddr); void rf.fitView({ nodes: [{ id: 'f:' + hitAddr[0] }], maxZoom: 1, padding: 0.2, duration: 300 }); } else note('没找到', 'error');
  };

  // Gestures inside the canvas belong to the canvas: the panel around it (pull-down sheet, window drag, swipes, Esc) never sees them.
  const esc = React.useRef<() => boolean>(() => false);
  esc.current = () => { if (armed) { setArmed(undefined); return true; } if (selected) { select(undefined); return true; } if (lens) { setLens(undefined); return true; } if (edgeSel) { setEdgeSel(undefined); return true; } return false; };
  // The Kami panel tracks touches natively on its own element (pull the sheet down to close, swipe sideways between tabs), which
  // stopPropagation in React cannot reach without also cutting React Flow off. Instead, on the first move of a touch inside the
  // canvas, a touchcancel bubbles up from here: the panel drops the gesture it started tracking, the canvas keeps the touch.
  React.useEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    let sent = false;
    const start = () => { sent = false; };
    const move = () => { if (!sent) { sent = true; el.dispatchEvent(new Event('touchcancel', { bubbles: true })); } };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); };
  }, [wrap]);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const isolate = {
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      // Keys (Esc) should land on the canvas, not on the panel around it: take focus unless a control inside takes it.
      if (!(e.target as HTMLElement).closest('input, textarea, select, button, a, [tabindex]:not([data-solve="bp"])')) wrap.current?.focus({ preventScroll: true });
    },
    onMouseDown: stop, onWheel: stop, onContextMenu: stop,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!(e.target as HTMLElement).closest('input, textarea, select') && esc.current()) e.preventDefault();
    },
  };

  const sideModule = selected?.[0]?.startsWith('module:') ? selected[0].slice(7) : undefined;
  const side = selected ? (sideModule
    ? <div {...solve('bp-module-side')}><header><K.Button size="sm" variant="ghost" onClick={() => select(undefined)}>✕ 关闭</K.Button><h3>模块 · {d.modules?.[sideModule]?.label ?? sideModule}</h3></header><ModuleEditor name={sideModule} onDeleted={() => select(undefined)} /></div>
    : <Inspector addr={selected} onBack={() => select(undefined)} backLabel="✕ 关闭" />) : null;

  const palette = (
    <div {...solve('bp-palette', { layout: wide ? 'column' : 'strip' })} role="toolbar" aria-label="字段类型：拖到画布上，或点一下再点卡片">
      {wide ? <p {...part('hint')}>拖进卡片 = 新字段<br />拖到空白处 = 新卡片</p> : null}
      {TYPES.map(t => (
        <button type="button" key={t.type} {...part('chip')} aria-pressed={armed === t.type} onPointerDown={e => begin(e, { kind: 'new', type: t.type })} title={t.label}>
          <i {...part('type')} data-type={t.type}>{t.tag}</i><span>{shortLabel(t.type)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <BpContext.Provider value={bp}>
      <div ref={box} {...solve('bp', { layout: wide ? 'wide' : 'narrow', side: side ? '' : undefined, armed: armed ? '' : undefined, lens: lens ? '' : undefined, dragging: drag || nodeDrop ? '' : undefined })} {...isolate} data-k-swipe="off" tabIndex={-1}
        style={lens ? { '--bp-lens': TONE_VARS[tone(lens)] } as React.CSSProperties : undefined}>
        {wide ? palette : null}
        <div {...part('canvas')}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onEdgeClick={(ev, e) => { setEdgeSel(e.id); setClickAt(rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })); }}
            onConnect={onConnect} isValidConnection={isValidConnection} onNodeDrag={onNodeDrag} onNodeDragStop={onNodeDragStop}
            onEdgesDelete={es => es.forEach(e => e.data && unwire(e.data as WireData))}
            onPaneClick={ev => { if (armed) { create(armed, [], undefined, rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })); setArmed(undefined); } else { setEdgeSel(undefined); } }}
            fitViewOptions={fitOpts} minZoom={0.2} maxZoom={1.6} connectionRadius={36} deleteKeyCode={['Delete', 'Backspace']} nodesFocusable={false} elevateEdgesOnSelect
            proOptions={{ hideAttribution: true }}>
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
            <Controls showInteractive={false} position="bottom-left" />
            {wide ? <MiniMap pannable zoomable position="bottom-right" nodeStrokeWidth={2} /> : null}
          </ReactFlow>
          <div {...solve('bp-tools')}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') findFirst(); }} placeholder="搜索字段" aria-label="搜索字段" />
            <span {...part('layers')} role="group" aria-label="显示连线">
              <button type="button" aria-pressed={layers.ref} onClick={() => setLayers(l => ({ ...l, ref: !l.ref }))}><i data-kind="ref" />指向</button>
            </span>
            <button type="button" {...part('tool')} onClick={relayout}>重新排列</button>
          </div>
          <div {...solve('bp-modules')} role="toolbar" aria-label="模块：点一个进入模块视图，或拖到字段上">
            <span {...part('title')}>模块</span>
            <div {...part('list')}>
              {modNames.map(m => {
                const x = d.modules![m]!;
                return (
                  <span key={m} {...part('module')} data-tone={tone(m)} data-on={lens === m ? '' : undefined} data-off={x.enabled === false ? '' : undefined}>
                    <button type="button" {...part('chip')} aria-pressed={lens === m} onPointerDown={e => begin(e, { kind: 'module', name: m })}
                      title={`${x.label ?? m}${x.parent ? ` · 上级：${d.modules?.[x.parent]?.label ?? x.parent}` : ''}${x.exclusive ? ` · 互斥：${d.groups?.[x.exclusive]?.label ?? x.exclusive}` : ''}${x.enabled === false ? ' · 默认关' : ''}`}>
                      {x.parent ? <small aria-hidden="true">↳</small> : null}{x.label ?? m}
                    </button>
                    {lens === m ? <button type="button" {...part('gear')} onClick={() => select(['module:' + m])} aria-label={`「${x.label ?? m}」的设置`}>⚙</button> : null}
                  </span>
                );
              })}
              <button type="button" {...part('add')} onClick={addModule}>+ 模块</button>
            </div>
          </div>
          {lens && !armed ? (
            <div {...solve('bp-armed')} data-kind="lens" role="status">
              <span>模块视图「{d.modules?.[lens]?.label ?? lens}」：点字段加入 / 移出</span>
              <button type="button" onClick={() => setLens(undefined)}>完成</button>
            </div>
          ) : null}
          {armed ? (
            <div {...solve('bp-armed')} role="status">
              <span>点卡片放进「{shortLabel(armed)}」，点空白处新建卡片</span>
              <button type="button" onClick={() => setArmed(undefined)} aria-label="取消放置">取消</button>
            </div>
          ) : null}
          {!wide ? palette : null}
          {side ? <aside {...solve('bp-side')} aria-label="设置">{side}</aside> : null}
          {drag ? (
            <div {...solve('bp-ghost')} data-ok={drag.target ? '' : undefined} style={ghostAt(wrap.current, drag.x, drag.y)}>
              {drag.p.kind === 'new' ? `新${shortLabel(drag.p.type)}` : drag.p.kind === 'module' ? `模块「${d.modules?.[drag.p.name]?.label ?? drag.p.name}」` : nameOf(nodeAt(d, drag.p.addr), drag.p.addr.at(-1)!)}
              <small>{!drag.target ? (drag.p.kind === 'module' ? '拖到字段或卡片上' : '这里放不下') : drag.p.kind === 'module' ? '加入这个模块' : 'pane' in drag.target ? (drag.p.kind === 'new' ? '新建一张卡片' : drag.p.addr.length === 1 ? '' : '变成独立卡片') : drag.target.edge === 'in' ? '放进这张卡片' : '放在这里'}</small>
            </div>
          ) : null}
        </div>
      </div>
    </BpContext.Provider>
  );
}
function ghostAt(el: HTMLElement | null, x: number, y: number): React.CSSProperties {
  const r = el?.getBoundingClientRect();
  return { left: x - (r?.left ?? 0) + 14, top: y - (r?.top ?? 0) + 14 };
}
