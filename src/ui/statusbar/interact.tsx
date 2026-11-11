/**
 * Player interactions, rendered from the structure's `edit` / `actions` declarations (src/interact.ts).
 * The host supplies `Interact`: it submits the filled-in operations as a user action (the engine
 * validates them), queues the narration for the next prompt and can undo the latest one.
 * Without a host every view stays read-only.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { expand, fill, holds, pick, type ActionSpec, type AskSpec, type CreateSpec, type EditSpec, type Vars } from '../../interact.js';
import type { Json } from '../../types.js';
import type { Path, StatusModel } from './model.js';
import { part, solve } from './widgets.js';
import { ModelContext } from './fields.js';

/** `ops` may be empty: the action only tells the model something (use / train an ability) and changes nothing yet. */
export interface InteractRequest { ops: Json[]; title: string; narrate?: string }
export type InteractResult = { ok: true } | { ok: false; error: string };
export interface Interact {
  run(request: InteractRequest): Promise<InteractResult>;
  /** Revert the latest interaction while it is still the newest change; false when it no longer can. */
  undo?(): Promise<boolean>;
  /** Why interactions are paused right now (e.g. the model is writing). */
  locked?: string;
  /** Narrations waiting for the next turn (shown so the player knows what the model will be told). */
  pending?: string[];
}
interface Live { perform(request: InteractRequest): Promise<InteractResult>; locked?: string }
const LiveContext = React.createContext<Live | null>(null);
export const useInteract = (): Live | null => React.useContext(LiveContext);
/** What the next turn will tell the model about the player's actions. */
export function PendingNarration({ host }: { host?: Interact }) {
  const list = host?.pending ?? [];
  if (!list.length) return null;
  return (
    <details {...solve('pending')}>
      <summary><span {...part('label')}>下一轮告诉模型</span><span {...part('count')}>{list.length}</span><span {...part('last')}>{list.at(-1)}</span></summary>
      <ol>{list.map((t, i) => <li key={i}>{t}</li>)}</ol>
    </details>
  );
}
/** Read-only region (the codex: reference pages, prefab overlays). */
export function ReadOnly({ children }: { children: React.ReactNode }) { return <LiveContext.Provider value={null}>{children}</LiveContext.Provider>; }

/** Wraps the status bar: provides `perform` and shows the result toast with 撤销. */
export function InteractLayer({ host, children }: { host?: Interact; children: React.ReactNode }) {
  const [toast, setToast] = React.useState<{ id: number; text: string; undo: boolean; tone?: 'error' } | undefined>();
  const seq = React.useRef(0);
  React.useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(cur => cur?.id === toast.id ? undefined : cur), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const live = React.useMemo<Live | null>(() => host ? {
    ...(host.locked ? { locked: host.locked } : {}),
    async perform(request) {
      const result = await host.run(request);
      if (result.ok) setToast({ id: ++seq.current, text: request.narrate ?? `已${request.title}`, undo: !!host.undo });
      return result;
    },
  } : null, [host]);
  const undo = async () => {
    const ok = await host?.undo?.();
    setToast({ id: ++seq.current, text: ok ? '已撤销' : '无法撤销：之后已有新的变化', undo: false, ...(ok ? {} : { tone: 'error' as const }) });
  };
  return (
    <LiveContext.Provider value={live}>
      {children}
      {toast ? (
        <div {...solve('toast', { tone: toast.tone })} role="status">
          <span {...part('text')}>{toast.text}</span>
          {toast.undo ? <button type="button" {...part('undo')} onClick={() => void undo()}>撤销</button> : null}
          <button type="button" {...part('close')} aria-label="关闭" onClick={() => setToast(undefined)}>×</button>
        </div>
      ) : null}
    </LiveContext.Provider>
  );
}

// ── context of an entry: who holds it, what it is, the template variables ──

/** The entity this path sits under (not the path itself): `characters.erin` for `characters.erin.items.potion`. */
export function holderOf(m: StatusModel, parts: Path): Path | undefined {
  for (let j = parts.length - 3; j >= 0; j--) if (m.meta(parts.slice(0, j + 1))?.entity) return parts.slice(0, j + 2);
  return undefined;
}
/** The entry merged with the entity it references (a held item: the item's name and type + own count). */
export function viewOf(m: StatusModel, parts: Path): Record<string, any> {
  const own = m.value(parts), parent = parts.length ? m.meta(parts.slice(0, -1)) : undefined;
  const base = parent?.keys ? (() => { const at = m.locate(parts.at(-1)!); return at ? m.value(at) : undefined; })() : undefined;
  const obj = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
  return { ...obj(base), ...obj(own) };
}
function varsOf(m: StatusModel, parts: Path, view: Record<string, any>): Vars {
  const holder = holderOf(m, parts), id = parts.at(-1)!;
  const vars: Vars = {};
  for (const [k, v] of Object.entries(view)) if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) vars[k] = v;
  Object.assign(vars, {
    self: parts.join('.'), id, name: typeof view.name === 'string' ? view.name : m.entityName(id),
    holderId: holder?.at(-1) ?? null, holder: holder ? m.entityName(holder.at(-1)!) : '',
    userId: m.userId ?? null, user: m.userId ? m.entityName(m.userId) : '你',
  });
  return vars;
}
const read = (m: StatusModel) => (path: string[]) => m.value(path) as Json | undefined;
function ownerOk(m: StatusModel, parts: Path, owner?: 'user'): boolean {
  if (owner !== 'user') return true;
  const holder = holderOf(m, parts);
  return !!m.userId && (holder?.at(-1) === m.userId || (m.meta(parts.slice(0, -1))?.entity !== undefined && parts.at(-1) === m.userId));
}

export interface Bound { name: string; spec: ActionSpec; label: string; on: boolean }
/** Actions that apply to this entry right now: declared on its collection (record / array) or on itself (object). */
export function actionsFor(m: StatusModel, parts: Path): Bound[] {
  const fromParent = parts.length ? (m.meta(parts.slice(0, -1)) as any)?.actions as Record<string, ActionSpec> | undefined : undefined;
  const own = m.meta(parts)?.type === 'object' ? (m.meta(parts) as any)?.actions as Record<string, ActionSpec> | undefined : undefined;
  const all = { ...(fromParent ?? {}), ...(own ?? {}) };
  if (!Object.keys(all).length || m.dormant(parts)) return [];
  const view = viewOf(m, parts), vars = varsOf(m, parts, view);
  return Object.entries(all).filter(([, a]) => ownerOk(m, parts, a.owner) && m.moduleOn(a.module) && holds(a.when, view, vars, read(m))).map(([name, spec]) => {
    const on = spec.toggle ? !view[spec.toggle] : true;
    return { name, spec, on, label: String(fill(pick(spec.label, on) ?? name, vars)) };
  });
}
/** The `edit` declaration of a field, if the player may edit it here. */
export function editFor(m: StatusModel, parts: Path): EditSpec | undefined {
  const edit = (m.meta(parts) as any)?.edit as EditSpec | undefined;
  if (!edit || m.dormant(parts) || !ownerOk(m, parts, edit.owner)) return undefined;
  if (edit.when) {
    const parent = parts.slice(0, -1), view = viewOf(m, parent);
    if (!holds(edit.when, view, varsOf(m, parent, view), read(m))) return undefined;
  }
  return edit;
}

/** The `create` form of a record: a button that opens the declared fields; the entry gets a fresh ID. */
export function CreateForm({ path }: { path: Path }) {
  const m = useModelSafe(), live = useInteract(), K = useKit();
  const spec = (m?.meta(path) as any)?.create as CreateSpec | undefined;
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, Json>>({});
  const [error, setError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  if (!m || !live || !spec || m.dormant(path)) return null;
  const metaOf = (f: string) => m.meta([...path, '*', f]);
  const initial = () => Object.fromEntries(spec.fields.map(f => { const t = metaOf(f); return [f, t?.type === 'bool' ? false : t?.type === 'enum' || t?.type === 'ladder' ? t.values?.[0] ?? '' : t?.type === 'int' || t?.type === 'number' ? t.min ?? 0 : '']; }));
  const required = (f: string) => metaOf(f)?.type === 'string';
  const missing = spec.fields.some(f => required(f) && !String(draft[f] ?? '').trim());
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (missing) return;
    const id = 'p' + Date.now().toString(36);
    const value = { ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])), ...(spec.set ?? {}) };
    setBusy(true);
    const result = await live.perform({ ops: [{ $set: { [[...path, id].join('.')]: value } }], title: spec.label,
      ...(spec.narrate ? { narrate: String(fill(spec.narrate, value as Vars)) } : {}) });
    setBusy(false);
    if (result.ok) { setOpen(false); setError(undefined); } else setError(result.error);
  };
  if (!open) return <div {...solve('create')}><K.Button size="sm" disabled={!!live.locked} title={live.locked} onClick={() => { setDraft(initial()); setOpen(true); }}>＋ {spec.label}</K.Button></div>;
  return (
    <form {...solve('create', { open: '' })} onSubmit={e => void submit(e)}>
      {spec.fields.map(f => {
        const t = metaOf(f), label = m.label([...path, '*', f]), v = draft[f];
        const set = (x: Json) => setDraft(d => ({ ...d, [f]: x }));
        const input = t?.type === 'enum' || t?.type === 'ladder' ? <select value={String(v ?? '')} onChange={e => set(e.target.value)}>{(t.values ?? []).map(x => <option key={x} value={x}>{x}</option>)}</select>
          : t?.type === 'bool' ? <K.Switch checked={!!v} onCheckedChange={set} aria-label={label} />
          : t?.type === 'int' || t?.type === 'number' ? <input type="number" value={Number(v)} onChange={e => set(Number(e.target.value))} />
          : m.widgets[m.pattern([...path, '*', f])] === 'paragraph' ? <textarea rows={3} value={String(v ?? '')} onChange={e => set(e.target.value)} />
          : <input type="text" value={String(v ?? '')} onChange={e => set(e.target.value)} />;
        return <label key={f} {...part('field')}><span>{label}</span>{input}</label>;
      })}
      <div {...part('row')}>
        <K.Button type="submit" size="sm" variant="primary" disabled={busy || missing || !!live.locked}>{spec.label}</K.Button>
        <K.Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>取消</K.Button>
      </div>
      {spec.narrate ? <p {...part('hint')}>提交后会在下一轮告诉模型。</p> : null}
      {error ? <p {...part('error')} role="alert">没有添加：{error}</p> : null}
    </form>
  );
}

// ── actions ──

/** The entry's action buttons; asks / confirmations open inline below them. */
export function ActionBar({ path }: { path: Path }) {
  const m = useModelSafe(), live = useInteract(), K = useKit();
  const [open, setOpen] = React.useState<string | undefined>();
  const [answers, setAnswers] = React.useState<Record<string, Json>>({});
  const [error, setError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const key = path.join('.');
  React.useEffect(() => { setOpen(undefined); setError(undefined); }, [key]);
  if (!m || !live) return null;
  const list = actionsFor(m, path);
  if (!list.length) return null;
  const view = viewOf(m, path), base = varsOf(m, path, view);
  const asks = (a: Bound) => Object.entries(a.spec.ask ?? {}).filter(([, q]) => holds(q.when, view, base, read(m)));
  // Answers in declaration order, so a later ask can use an earlier one (the amount to take out of the chosen building).
  const resolve = (a: Bound, given: Record<string, Json>): { vars: Vars; answers: Record<string, Json> } => {
    const vars: Vars = { ...base }, answers: Record<string, Json> = {};
    for (const [k, q] of Object.entries(a.spec.ask ?? {})) {
      let v = given[k];
      if (q.number) {
        const { min, max } = bounds(q, vars);
        v = Math.min(max, Math.max(min, typeof v === 'number' ? v : Number(fill(q.number.default ?? 1, vars))));
      } else if (q.text) v = typeof v === 'string' ? v : '';
      else { const options = choices(m, q, vars); if (typeof v !== 'string' || !options.includes(v)) v = options[0] ?? null; }
      answers[k] = v as Json; vars[k] = v as Json;
      if (q.pick && typeof v === 'string') {
        vars[`${k}.name`] = m.entityName(v);
        const at = m.value([...String(fill(q.pick, base)).split('.'), v]);
        if (at === null || ['string', 'number', 'boolean'].includes(typeof at)) vars[`${k}.value`] = at;
      }
    }
    return { vars, answers };
  };
  const go = async (a: Bound, given: Record<string, Json>) => {
    const { vars } = resolve(a, given);
    const ops = a.spec.toggle ? [{ $set: { [`${key}.${a.spec.toggle}`]: a.on } }] : expand(a.spec.ops ?? [], view, vars, read(m));
    const narrate = pick(a.spec.narrate, a.on);
    setBusy(true); setError(undefined);
    const result = await live.perform({ ops, title: a.label, ...(narrate ? { narrate: String(fill(narrate, vars)).replace(/[：:，,]\s*$/u, '') } : {}) });
    setBusy(false);
    if (result.ok) setOpen(undefined); else setError(result.error);
  };
  const click = (a: Bound) => {
    setError(undefined);
    if (asks(a).length || a.spec.confirm) { setAnswers(resolve(a, {}).answers); setOpen(open === a.name ? undefined : a.name); return; }
    void go(a, {});
  };
  const current = list.find(a => a.name === open);
  const live_ = current ? resolve(current, answers) : undefined;
  const missing = current ? asks(current).some(([k, q]) => (q.pick && !live_!.answers[k]) || (q.text && !q.text.optional && !String(live_!.answers[k] ?? '').trim())) : false;
  return (
    <div {...solve('actions')}>
      <div {...part('row')}>
        {list.map(a => (
          <K.Button key={a.name} size="sm" variant={a.spec.tone === 'danger' && a.name !== open ? 'danger' : a.name === open ? 'ghost' : 'default'}
            disabled={busy || !!live.locked} title={live.locked} aria-expanded={a.spec.ask || a.spec.confirm ? a.name === open : undefined} onClick={() => click(a)}>{a.label}</K.Button>
        ))}
      </div>
      {current ? (
        <form {...part('ask')} onSubmit={e => { e.preventDefault(); if (!missing) void go(current, answers); }}>
          {current.spec.confirm ? <p {...part('confirm')}>{String(fill(current.spec.confirm, base))}</p> : null}
          {asks(current).map(([k, q]) => <AskField key={k} q={q} vars={live_!.vars} value={live_!.answers[k]} onChange={v => setAnswers(s => ({ ...s, [k]: v }))} />)}
          <div {...part('row')}>
            <K.Button type="submit" size="sm" variant={current.spec.tone === 'danger' ? 'danger' : 'primary'} disabled={busy || missing || !!live.locked}>{current.spec.confirm && !asks(current).length ? '确定' : current.label.replace(/…$/u, '')}</K.Button>
            <K.Button type="button" size="sm" variant="ghost" onClick={() => setOpen(undefined)}>取消</K.Button>
          </div>
        </form>
      ) : null}
      {live.locked ? <p {...part('locked')}>{live.locked}</p> : null}
      {error ? <p {...part('error')} role="alert">没有执行：{error}</p> : null}
    </div>
  );
}
function choices(m: StatusModel, q: AskSpec, vars: Vars): string[] {
  if (!q.pick) return [];
  const at = String(fill(q.pick, vars)).split('.');
  const record = m.value(at) ?? {};
  const all = Object.keys(record);
  const within = q.within ? m.value(q.within.split('.')) : undefined;
  const not = q.not ? String(fill(q.not, vars)) : undefined;
  const pool = Array.isArray(within) && within.length ? all.filter(id => within.includes(id)) : all;
  // Entity candidates (a collection): filter on their fields; keyed records: on the entity the key points to.
  const entity = (id: string) => { const own = record[id]; if (own && typeof own === 'object') return own; const p = m.locate(id); return p ? m.value(p) ?? {} : {}; };
  return pool.filter(id => id !== not && (!q.filter?.length || q.filter.some(c => holds(c, entity(id), vars, read(m)))));
}
function bounds(q: AskSpec, vars: Vars): { min: number; max: number } {
  const min = Number(fill(q.number?.min ?? 1, vars)), max = Number(fill(q.number?.max ?? 99, vars));
  return { min: Number.isFinite(min) ? min : 1, max: Number.isFinite(max) ? Math.max(max, Number.isFinite(min) ? min : 1) : 99 };
}
function AskField({ q, vars, value, onChange }: { q: AskSpec; vars: Vars; value: Json | undefined; onChange: (v: Json) => void }) {
  const m = useModelSafe()!;
  if (q.text) {
    return (
      <label {...part('field')}><span>{q.label}{q.text.optional ? <small>（可不填）</small> : null}</span>
        <textarea rows={2} value={String(value ?? '')} placeholder={q.text.placeholder ? String(fill(q.text.placeholder, vars)) : undefined} onChange={e => onChange(e.target.value)} />
      </label>
    );
  }
  if (q.number) {
    const { min, max } = bounds(q, vars);
    return (
      <label {...part('field')}><span>{q.label}</span>
        <span {...solve('stepper')}>
          <button type="button" aria-label="减少" disabled={Number(value) <= min} onClick={() => onChange(Math.max(min, Number(value) - 1))}>−</button>
          <input type="number" inputMode="numeric" min={min} max={max} value={Number(value)} onChange={e => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value) || min))))} />
          <button type="button" aria-label="增加" disabled={Number(value) >= max} onClick={() => onChange(Math.min(max, Number(value) + 1))}>+</button>
          <small>/ {max}</small>
        </span>
      </label>
    );
  }
  const options = choices(m, q, vars);
  return (
    <fieldset {...part('field')}><legend>{q.label}</legend>
      {options.length ? <span {...part('picks')}>{options.map(id => (
        <button key={id} type="button" {...solve('pick')} aria-pressed={value === id} onClick={() => onChange(id)}>{m.entityName(id)}</button>
      ))}</span> : <span {...solve('none')}>没有可选的对象</span>}
    </fieldset>
  );
}

// ── in-place editing ──

/** Pencil next to an editable field's label; the editor replaces the value until saved. */
export function useEditing(path: Path): { edit?: EditSpec; editing: boolean; start: () => void; stop: () => void; save: (v: Json) => Promise<string | undefined> } {
  const m = useModelSafe(), live = useInteract();
  const [editing, setEditing] = React.useState(false);
  const edit = m && live ? editFor(m, path) : undefined;
  return {
    ...(edit ? { edit } : {}), editing: editing && !!edit,
    start: () => setEditing(true), stop: () => setEditing(false),
    save: async (v: Json) => {
      if (!m || !live || !edit) return '不可编辑';
      const error = await saveValue(m, live, path, v, edit);
      if (!error) setEditing(false);
      return error;
    },
  };
}
async function saveValue(m: StatusModel, live: Live, path: Path, v: Json, edit: EditSpec): Promise<string | undefined> {
  const parent = path.slice(0, -1), view = { ...viewOf(m, parent), [path.at(-1)!]: v };
  const vars: Vars = { ...varsOf(m, parent, view), value: v, old: (m.value(path) ?? null) as Json, label: m.label(path) };
  const narrate = pick(edit.narrate, v === true);
  const result = await live.perform({ ops: [{ $set: { [path.join('.')]: v } }], title: `修改${m.label(path)}`, ...(narrate ? { narrate: String(fill(narrate, vars)) } : {}) });
  return result.ok ? undefined : result.error;
}
/**
 * A checklist ({text, done}[]): `done` ticks when that field is editable; with the list itself editable
 * the player can also reword, remove and add entries (saved as one $set of the whole list).
 */
export function TickList({ path, items }: { path: Path; items: { text: string; done?: boolean }[] }) {
  const m = useModelSafe(), live = useInteract(), K = useKit();
  const [error, setError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<number | undefined>();
  const [draft, setDraft] = React.useState('');
  const [adding, setAdding] = React.useState('');
  const tickEdit = m && live ? editFor(m, [...path, '0', 'done']) : undefined;
  const listEdit = m && live ? editFor(m, path) : undefined;
  const locked = busy || !!live?.locked;
  const run = async (f: () => Promise<string | undefined>) => { setBusy(true); const e = await f(); setBusy(false); setError(e); return !e; };
  const tick = (i: number) => m && live && tickEdit ? run(() => saveValue(m, live, [...path, String(i), 'done'], !items[i]!.done, tickEdit)) : undefined;
  const saveList = (next: { text: string; done?: boolean }[]) => run(() => saveValue(m!, live!, path, next as unknown as Json, listEdit!));
  const reword = async (i: number) => { if (draft.trim() && await saveList(items.map((it, k) => k === i ? { ...it, text: draft.trim() } : it))) setEditing(undefined); };
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (adding.trim() && await saveList([...items, { text: adding.trim(), done: false }])) setAdding(''); };
  return (
    <>
      <ul {...solve('checklist', { editable: tickEdit ? '' : undefined, list: listEdit ? '' : undefined })}>{items.map((item, i) => (
        <li key={i} data-done={item.done ? '' : undefined} data-editing={editing === i ? '' : undefined}>
          {tickEdit ? <button type="button" {...part('mark')} role="checkbox" aria-checked={!!item.done} aria-label={item.text} disabled={locked} onClick={() => void tick(i)} />
            : <span {...part('mark')} aria-label={item.done ? '已完成' : '未完成'} />}
          {editing === i ? (
            <form {...solve('editor', { inline: '' })} onSubmit={e => { e.preventDefault(); void reword(i); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(undefined); } }}>
              <input type="text" value={draft} onChange={e => setDraft(e.target.value)} aria-label="规划内容" autoFocus />
              <div {...part('row')}>
                <K.Button type="submit" size="sm" variant="primary" disabled={locked || !draft.trim()}>保存</K.Button>
                <K.Button type="button" size="sm" variant="ghost" onClick={() => setEditing(undefined)}>取消</K.Button>
              </div>
            </form>
          ) : <span {...part('text')}>{item.text}</span>}
          {listEdit && editing !== i ? (
            <span {...part('tools')}>
              <EditButton label="这一条" disabled={locked} onClick={() => { setDraft(item.text); setEditing(i); }} />
              <button type="button" {...solve('edit-btn', { tone: 'danger' })} aria-label={`删除：${item.text}`} title="删除" disabled={locked} onClick={() => void saveList(items.filter((_, k) => k !== i))}>×</button>
            </span>
          ) : null}
        </li>
      ))}</ul>
      {listEdit ? (
        <form {...solve('add-row')} onSubmit={e => void add(e)}>
          <input type="text" value={adding} placeholder="添加一条…" aria-label="添加一条" onChange={e => setAdding(e.target.value)} />
          <K.Button type="submit" size="sm" disabled={locked || !adding.trim()}>添加</K.Button>
        </form>
      ) : null}
      {error ? <p {...solve('inline-error')} role="alert">没有保存：{error}</p> : null}
    </>
  );
}
/** A single text value with a pencil (quest-log lines, inner voice); renders `children` while not editing. */
export function EditableText({ path, children }: { path: Path; children: React.ReactNode }) {
  const e = useEditing(path), live = useInteract(), m = useModelSafe();
  if (!e.edit || !m) return <>{children}</>;
  if (e.editing) return <Editor path={path} onSave={e.save} onCancel={e.stop} />;
  return <span {...solve('editable')}>{children}<EditButton label={m.label(path)} onClick={e.start} disabled={!!live?.locked} /></span>;
}
export function EditButton({ label, onClick, disabled, title }: { label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return <button type="button" {...solve('edit-btn')} aria-label={`编辑${label}`} title={title ?? `编辑${label}`} disabled={disabled} onClick={onClick}>✎</button>;
}
/** Editor for a single value, chosen from the field type. */
export function Editor({ path, onSave, onCancel }: { path: Path; onSave: (v: Json) => Promise<string | undefined>; onCancel: () => void }) {
  const m = useModelSafe()!, K = useKit(), live = useInteract();
  const meta = m.meta(path), type = meta?.type ?? 'string', initial = m.value(path);
  const [draft, setDraft] = React.useState<Json>(initial ?? (type === 'bool' ? false : type === 'int' || type === 'number' ? (meta?.min ?? 0) : ''));
  const [error, setError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    const err = await onSave(type === 'int' ? Math.round(Number(draft)) : type === 'number' ? Number(draft) : draft);
    setBusy(false); setError(err);
  };
  let input: React.ReactNode;
  if (type === 'enum' || type === 'ladder') input = <select value={String(draft ?? '')} onChange={e => setDraft(e.target.value)}>{(meta?.values ?? []).map(v => <option key={v} value={v}>{v}</option>)}</select>;
  else if (type === 'int' || type === 'number') input = <input type="number" inputMode="decimal" value={Number(draft)} {...(meta?.min !== undefined ? { min: meta.min } : {})} {...(meta?.max !== undefined ? { max: meta.max } : {})} onChange={e => setDraft(Number(e.target.value))} />;
  else if (type === 'bool') input = <K.Switch checked={!!draft} onCheckedChange={setDraft} aria-label={m.label(path)} />;
  else if (m.widget(path) === 'paragraph') input = <textarea rows={4} value={String(draft ?? '')} onChange={e => setDraft(e.target.value)} />;
  else input = <input type="text" value={String(draft ?? '')} onChange={e => setDraft(e.target.value)} />;
  return (
    <form {...solve('editor')} onSubmit={e => void submit(e)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      {input}
      <div {...part('row')}>
        <K.Button type="submit" size="sm" variant="primary" disabled={busy || !!live?.locked || JSON.stringify(draft) === JSON.stringify(initial)}>保存</K.Button>
        <K.Button type="button" size="sm" variant="ghost" onClick={onCancel}>取消</K.Button>
      </div>
      {error ? <p {...part('error')} role="alert">没有保存：{error}</p> : null}
    </form>
  );
}

function useModelSafe(): StatusModel | null { return React.useContext(ModelContext); }
