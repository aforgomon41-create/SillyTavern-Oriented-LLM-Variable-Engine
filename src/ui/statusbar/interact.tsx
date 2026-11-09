/**
 * Player interactions, rendered from the structure's `edit` / `actions` declarations (src/interact.ts).
 * The host supplies `Interact`: it submits the filled-in operations as a user action (the engine
 * validates them), queues the narration for the next prompt and can undo the latest one.
 * Without a host every view stays read-only.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { expand, fill, holds, pick, type ActionSpec, type AskSpec, type EditSpec, type Vars } from '../../interact.js';
import type { Json } from '../../types.js';
import type { Path, StatusModel } from './model.js';
import { part, solve } from './widgets.js';
import { ModelContext } from './fields.js';

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
  return Object.entries(all).filter(([, a]) => ownerOk(m, parts, a.owner) && holds(a.when, view, vars, read(m))).map(([name, spec]) => {
    const on = spec.toggle ? !view[spec.toggle] : true;
    return { name, spec, on, label: String(fill(pick(spec.label, on) ?? name, vars)) };
  });
}
/** The `edit` declaration of a field, if the player may edit it here. */
export function editFor(m: StatusModel, parts: Path): EditSpec | undefined {
  const edit = (m.meta(parts) as any)?.edit as EditSpec | undefined;
  return edit && !m.dormant(parts) && ownerOk(m, parts, edit.owner) ? edit : undefined;
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
  const defaults = (a: Bound): Record<string, Json> => Object.fromEntries(Object.entries(a.spec.ask ?? {}).map(([k, q]) => [k, q.number ? fill(q.number.default ?? 1, base) : (choices(m, q, base)[0] ?? null)]));
  const go = async (a: Bound, given: Record<string, Json>) => {
    const vars: Vars = { ...base };
    for (const [k, v] of Object.entries({ ...defaults(a), ...given })) {
      vars[k] = v;
      if (Object.keys(a.spec.ask?.[k] ?? {}).includes('pick') && typeof v === 'string') vars[`${k}.name`] = m.entityName(v);
    }
    const ops = a.spec.toggle ? [{ $set: { [`${key}.${a.spec.toggle}`]: a.on } }] : expand(a.spec.ops ?? [], view, vars, read(m));
    const narrate = pick(a.spec.narrate, a.on);
    setBusy(true); setError(undefined);
    const result = await live.perform({ ops, title: a.label, ...(narrate ? { narrate: String(fill(narrate, vars)) } : {}) });
    setBusy(false);
    if (result.ok) setOpen(undefined); else setError(result.error);
  };
  const click = (a: Bound) => {
    setError(undefined);
    if (asks(a).length || a.spec.confirm) { setAnswers(defaults(a)); setOpen(open === a.name ? undefined : a.name); return; }
    void go(a, {});
  };
  const current = list.find(a => a.name === open);
  const missing = current ? asks(current).some(([k, q]) => q.pick && !answers[k]) : false;
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
          {asks(current).map(([k, q]) => <AskField key={k} q={q} vars={base} value={answers[k]} onChange={v => setAnswers(s => ({ ...s, [k]: v }))} />)}
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
  const all = Object.keys(m.value(q.pick.split('.')) ?? {});
  const within = q.within ? m.value(q.within.split('.')) : undefined;
  const not = q.not ? String(fill(q.not, vars)) : undefined;
  const pool = Array.isArray(within) && within.length ? all.filter(id => within.includes(id)) : all;
  return pool.filter(id => id !== not);
}
function AskField({ q, vars, value, onChange }: { q: AskSpec; vars: Vars; value: Json | undefined; onChange: (v: Json) => void }) {
  const m = useModelSafe()!;
  if (q.number) {
    const min = Number(fill(q.number.min ?? 1, vars)), max = Number(fill(q.number.max ?? 99, vars));
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
/** A checklist ({text, done}[]) whose `done` the player may tick, when declared editable. */
export function TickList({ path, items }: { path: Path; items: { text: string; done?: boolean }[] }) {
  const m = useModelSafe(), live = useInteract();
  const [error, setError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const edit = m && live && items.length ? editFor(m, [...path, '0', 'done']) : undefined;
  const tick = async (i: number) => {
    if (!m || !live || !edit) return;
    setBusy(true); setError(await saveValue(m, live, [...path, String(i), 'done'], !items[i]!.done, edit)); setBusy(false);
  };
  return (
    <>
      <ul {...solve('checklist', { editable: edit ? '' : undefined })}>{items.map((item, i) => (
        <li key={i} data-done={item.done ? '' : undefined}>
          {edit ? <button type="button" {...part('mark')} role="checkbox" aria-checked={!!item.done} aria-label={item.text} disabled={busy || !!live?.locked} onClick={() => void tick(i)} />
            : <span {...part('mark')} aria-label={item.done ? '已完成' : '未完成'} />}
          {item.text}
        </li>
      ))}</ul>
      {error ? <p {...solve('inline-error')} role="alert">没有保存：{error}</p> : null}
    </>
  );
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
