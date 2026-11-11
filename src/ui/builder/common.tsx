/**
 * 结构制作 · 各页共用的部件：路径输入（带补全）、条件编辑、可拖动排序的清单、编辑 / 预览分栏、JSON 小编辑器、草稿实时状态栏。
 */
import * as React from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { useKit } from '../kit.js';
import { useWide } from '../statusbar/widgets.js';
import { StatusModel } from '../statusbar/model.js';
import { StatusPreview } from '../statusbar/views.js';
import type { Interact } from '../statusbar/interact.js';
import type { FieldNode, StructureDescription } from '../../structure.js';
import type { CompiledDefinition, LogicalState } from '../../types.js';
import { addrKey, childrenOf, nodeAt, type Addr } from './draft.js';
import { part, solve, useB } from './builder.js';

// ── paths ──

export interface PathOption { path: string; label: string; type: string }
/**
 * Fields under `base` as dotted paths relative to it (entries of records and lists are skipped through `*`, so `rp.gauges`
 * is offered but not `rp.gauges.*.value`). `deep` also lists inside records / lists (`relations.*.affection`).
 */
export function pathOptions(d: StructureDescription, base: Addr, deep = false): PathOption[] {
  const out: PathOption[] = [];
  const walk = (n: FieldNode | undefined, rel: string[], names: string[]) => {
    for (const [k, c] of childrenOf(n)) {
      if (k === '*') { if (deep && c.type === 'object') walk(c, [...rel, '*'], [...names, '每一项']); continue; }
      const r = [...rel, k], nm = [...names, c.label ?? k];
      out.push({ path: r.join('.'), label: nm.join(' › '), type: c.type });
      if (c.type === 'object') walk(c, r, nm);
      else if (deep && (c.type === 'record' || c.type === 'array') && c.of?.type === 'object') walk(c.of, [...r, '*'], [...nm, '每一项']);
    }
  };
  walk(nodeAt(d, base), [], []);
  return out;
}
/** Root records (entity collections first). */
export function collections(d: StructureDescription): { key: string; label: string; entity?: string }[] {
  return Object.entries(d.fields).filter(([, n]) => n.type === 'record').map(([k, n]) => ({ key: k, label: n.label ?? k, ...(n.entity ? { entity: n.entity } : {}) }))
    .sort((a, b) => Number(!!b.entity) - Number(!!a.entity));
}
/** The fields an entry of a collection (or of a nested record) has. */
export const itemBase = (collection: string | undefined): Addr => collection ? [...collection.split('.'), '*'] : [];
export const labelOf = (d: StructureDescription, base: Addr, rel: string): string | undefined => {
  const n = nodeAt(d, [...base, ...rel.split('.')]); return n?.label;
};

let ids = 0;
const useId = () => React.useMemo(() => 'bp-dl-' + (++ids), []);
/** A path: free text with suggestions (datalist), the field's display name shown beside it. */
export function PathInput({ value, onChange, options, label, placeholder, base, d }: {
  value: string | undefined; onChange: (v: string | undefined) => void; options: PathOption[]; label: string; placeholder?: string; base?: Addr; d?: StructureDescription;
}) {
  const id = useId();
  const [v, setV] = React.useState(value ?? '');
  React.useEffect(() => setV(value ?? ''), [value]);
  const done = () => { const t = v.trim(); if (t !== (value ?? '')) onChange(t || undefined); };
  const known = options.find(o => o.path === (value ?? ''));
  const name = known?.label ?? (d && base && value ? labelOf(d, base, value) : undefined);
  return (
    <span {...solve('builder-path')}>
      <input list={id} value={v} aria-label={label} placeholder={placeholder ?? '选择或输入路径'} data-mono="" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        onChange={e => setV(e.target.value)} onBlur={done} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(value ?? ''); }} />
      <datalist id={id}>{options.map(o => <option key={o.path} value={o.path}>{o.label}</option>)}</datalist>
      {value ? <small {...part('name')} data-unknown={!known && !name ? '' : undefined}>{name ?? (value.startsWith('$') || value.includes('{') ? '' : '（结构里没有这个字段）')}</small> : null}
    </span>
  );
}
/** Several paths, in order. */
export function PathsInput({ value, onChange, options, label, placeholder, d, base }: {
  value: string[] | string | undefined; onChange: (v: string[] | undefined) => void; options: PathOption[]; label: string; placeholder?: string; d?: StructureDescription; base?: Addr;
}) {
  const list = ([] as string[]).concat(value ?? []);
  const [adding, setAdding] = React.useState<string | undefined>();
  return (
    <div {...solve('builder-paths')}>
      <SortList ids={list} label={label} onMove={(from, to) => onChange(arrayMove(list, from, to))}
        render={(p, i) => (
          <span {...part('chip')}>
            <code>{p}</code>{d && base ? <small>{labelOf(d, base, p) ?? ''}</small> : null}
            <button type="button" onClick={() => { const next = list.filter((_, j) => j !== i); onChange(next.length ? next : undefined); }} aria-label={`去掉 ${p}`}>×</button>
          </span>
        )} />
      <PathInput value={adding} label={`添加到 ${label}`} placeholder={placeholder ?? '+ 添加路径'} options={options.filter(o => !list.includes(o.path))}
        onChange={v => { setAdding(undefined); if (v && !list.includes(v)) onChange([...list, v]); }} />
    </div>
  );
}

// ── conditions (src/interact.ts Cond) ──

const OPS: [string, string][] = [['eq', '等于'], ['ne', '不等于'], ['gt', '大于'], ['gte', '≥'], ['lt', '小于'], ['lte', '≤'], ['in', '属于（逗号分隔）'], ['exists', '存在'], ['empty', '为空']];
type CondValue = Record<string, unknown>;
const parseValue = (s: string): unknown => { const t = s.trim(); if (t === 'true') return true; if (t === 'false') return false; if (t !== '' && Number.isFinite(Number(t))) return Number(t); return s; };
const showValue = (v: unknown): string => typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v);
/** `{ 字段: 值 | { eq, ne, gt, … } }` as rows. Keys are fields of the entry, or `@path` for absolute paths. */
export function CondEditor({ value, onChange, options, label }: { value: CondValue | undefined; onChange: (v: CondValue | undefined) => void; options: PathOption[]; label: string }) {
  const K = useKit();
  const rows: { key: string; op: string; value: unknown }[] = Object.entries(value ?? {}).flatMap(([key, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v as object).map(([op, x]) => ({ key, op, value: x })) : [{ key, op: 'eq', value: v }]);
  const save = (next: typeof rows) => {
    const out: CondValue = {};
    for (const r of next) {
      if (!r.key) continue;
      if (r.op === 'eq' && !(r.key in out)) { out[r.key] = r.value; continue; }
      const cur = out[r.key], obj = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur as Record<string, unknown> : cur !== undefined ? { eq: cur } : {};
      out[r.key] = { ...obj, [r.op]: r.value };
    }
    onChange(Object.keys(out).length ? out : undefined);
  };
  const set = (i: number, p: Partial<typeof rows[number]>) => save(rows.map((r, j) => j === i ? { ...r, ...p } : r));
  return (
    <div {...solve('builder-cond')} role="group" aria-label={label}>
      {rows.map((r, i) => (
        <div key={i} {...part('row')}>
          <PathInput value={r.key} label="字段" options={options} placeholder="字段 / @路径" onChange={v => set(i, { key: v ?? '' })} />
          <select value={r.op} aria-label="比较" onChange={e => { const op = e.target.value; set(i, { op, value: op === 'exists' || op === 'empty' ? true : op === 'in' ? [] : r.value }); }}>
            {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {r.op === 'exists' || r.op === 'empty' ? (
            <select value={String(r.value)} aria-label="是否" onChange={e => set(i, { value: e.target.value === 'true' })}><option value="true">是</option><option value="false">否</option></select>
          ) : (
            <input aria-label="值" defaultValue={r.op === 'in' && Array.isArray(r.value) ? r.value.map(showValue).join(', ') : showValue(r.value)} key={r.op + showValue(r.value)}
              onBlur={e => set(i, { value: r.op === 'in' ? e.target.value.split(/[,，]/u).map(x => parseValue(x.trim())).filter(x => x !== '') : parseValue(e.target.value) })} />
          )}
          <button type="button" {...part('remove')} onClick={() => save(rows.filter((_, j) => j !== i))} aria-label="删除这条">×</button>
        </div>
      ))}
      <K.Button size="sm" variant="ghost" onClick={() => save([...rows, { key: options[0]?.path ?? '', op: 'eq', value: '' }])}>+ 条件</K.Button>
      {rows.length > 1 ? <small {...part('hint')}>几条要同时满足。</small> : null}
    </div>
  );
}

// ── sortable list ──

export function SortList<T>({ ids: items, render, onMove, label, keyOf }: { ids: T[]; render: (item: T, i: number, handle: React.ReactNode) => React.ReactNode; onMove: (from: number, to: number) => void; label: string; keyOf?: (item: T, i: number) => string }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const keys = items.map((x, i) => keyOf ? keyOf(x, i) : i + ':' + String(x));
  const onDragEnd = ({ active, over }: DragEndEvent) => { if (over && active.id !== over.id) onMove(keys.indexOf(String(active.id)), keys.indexOf(String(over.id))); };
  if (!items.length) return null;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <ol {...solve('builder-sort')} aria-label={label}>{items.map((x, i) => <SortRow key={keys[i]} id={keys[i]!} label={String(keyOf ? keyOf(x, i) : x)}>{handle => render(x, i, handle)}</SortRow>)}</ol>
      </SortableContext>
    </DndContext>
  );
}
function SortRow({ id, label, children }: { id: string; label: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = <button type="button" ref={setActivatorNodeRef} {...part('handle')} {...attributes} {...listeners} aria-label={`拖动 ${label} 调整顺序`}>⠿</button>;
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 3 : undefined }} data-dragging={isDragging ? '' : undefined}>{children(handle)}</li>;
}

// ── editor / preview split ──

/** Wide: editor and a sticky preview side by side. Narrow: one at a time, switched at the top. */
export function Split({ editor, preview, previewLabel = '预览', min = 980 }: { editor: React.ReactNode; preview: React.ReactNode; previewLabel?: string; min?: number }) {
  const K = useKit();
  const [box, wide] = useWide(min);
  const [view, setView] = React.useState<'edit' | 'preview'>('edit');
  const options = [{ value: 'edit', label: '编辑' }, { value: 'preview', label: previewLabel }];
  return (
    <div ref={box} {...solve('builder-split', { layout: wide ? 'side' : 'stack' })}>
      {wide ? null : (
        <div {...part('switch')}>
          {K.Segmented ? <K.Segmented label="编辑或预览" options={options} value={view} onValueChange={v => setView(v as 'edit' | 'preview')} />
            : options.map(o => <K.Button key={o.value} size="sm" variant={view === o.value ? 'primary' : 'ghost'} onClick={() => setView(o.value as 'edit' | 'preview')}>{o.label}</K.Button>)}
        </div>
      )}
      {wide || view === 'edit' ? <div {...part('editor')}>{editor}</div> : null}
      {wide || view === 'preview' ? <div {...part('preview')}>{preview}</div> : null}
    </div>
  );
}

// ── JSON ──

/** A small JSON text editor that applies on demand (for the rarely used, deeply nested settings). */
export function JsonBox({ value, onChange, label, rows = 6, validate }: { value: unknown; onChange: (v: unknown) => void; label: string; rows?: number; validate?: (v: unknown) => string | undefined }) {
  const K = useKit();
  const text = value === undefined ? '' : JSON.stringify(value, null, 2);
  const [v, setV] = React.useState(text), [err, setErr] = React.useState<string | undefined>();
  React.useEffect(() => { setV(text); setErr(undefined); }, [text]);
  const apply = () => {
    try { const parsed = v.trim() ? JSON.parse(v) : undefined; const e = validate?.(parsed); if (e) { setErr(e); return; } onChange(parsed); setErr(undefined); }
    catch (e: any) { setErr('JSON 有误：' + (e?.message ?? e)); }
  };
  return (
    <div {...solve('builder-jsonbox')}>
      <textarea {...solve('builder-json')} value={v} onChange={e => { setV(e.target.value); setErr(undefined); }} spellCheck={false} rows={Math.max(3, Math.min(rows, v.split('\n').length + 1))} aria-label={label} />
      {err ? <small {...part('error')}>{err}</small> : null}
      {v !== text ? <div {...part('actions')}><K.Button size="sm" onClick={apply}>应用</K.Button><K.Button size="sm" variant="ghost" onClick={() => { setV(text); setErr(undefined); }}>还原</K.Button></div> : null}
    </div>
  );
}

// ── live status bar ──

class Catch extends React.Component<{ children: React.ReactNode; reset: unknown }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  componentDidUpdate(prev: { reset: unknown }) { if (prev.reset !== this.props.reset && this.state.error) this.setState({ error: undefined }); }
  render() { return this.state.error ? <p {...part('broken')}>预览渲染出错：{this.state.error}</p> : this.props.children; }
}
/** The compiled draft and the current chat's state, when both are there. */
export function useDraftModel(): { def?: CompiledDefinition; state?: LogicalState; model?: StatusModel; why?: string } {
  const { check, host } = useB();
  const state = React.useMemo(() => host.sample?.(), [host]);
  const def = check?.compiled;
  const model = React.useMemo(() => { if (!def || !state) return undefined; try { return new StatusModel(def, state); } catch { return undefined; } }, [def, state]);
  const why = !check ? '检查中…' : !def ? '草稿有编译错误，修好后这里才会更新（见「检查与发布」）' : !state ? '没有可用的聊天数据' : undefined;
  return { ...(def ? { def } : {}), ...(state ? { state } : {}), ...(model ? { model } : {}), ...(why ? { why } : {}) };
}
/** The status bar as the player will see it, rendered from the draft. */
export function LiveStatus({ tab, onTab, interact, note }: { tab?: string; onTab?: (t: string) => void; interact?: Interact; note?: React.ReactNode }) {
  const { model, why, def } = useDraftModel();
  const last = React.useRef<StatusModel | undefined>(undefined);
  if (model) last.current = model;
  const shown = model ?? last.current;
  return (
    <section {...solve('builder-live')} aria-label="状态栏预览">
      <header><b>状态栏预览</b><small>{why ?? '用当前聊天的数据，按草稿渲染'}</small></header>
      {note}
      {shown ? <Catch reset={def}><div {...part('frame')} data-stale={model ? undefined : ''}><StatusPreview model={shown} {...(tab ? { tab } : {})} {...(onTab ? { onTab } : {})} {...(interact ? { interact } : {})} /></div></Catch> : null}
    </section>
  );
}
export { addrKey };
