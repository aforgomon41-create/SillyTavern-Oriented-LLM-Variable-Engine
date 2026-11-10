/**
 * 操作台：直接在状态树上改（json-edit-react），每处修改记进改动单，引擎实时预演，确认后作为一次玩家动作提交（全成或全不成）。
 * 按结构加了中文名、枚举 / 阶梯 / 引用的下拉；只读、媒体、休眠模块的字段锁定；实体集合不能在这里增删（会走实体操作）。
 */
import * as React from 'react';
import { JsonEditor, type CustomComponentProps, type CustomKeyProps, type CustomNodeDefinition, type JsonEditorHandle, type NodeData, type ThemeStyles, type UpdateFunctionProps } from 'json-edit-react';
import jerCss from 'json-edit-react/style.css';
import { useKit } from '../kit.js';
import type { StatusModel } from '../statusbar/model.js';
import type { Feedback, LogicalState } from '../../types.js';
import { Diff, FeedbackList, describe, message, named, part, partsOf, short, solve, valueAt, type Controller } from './shared.js';

/** json-edit-react's own stylesheet: the host adopts it in the SOLVE layer (the library only adds it to the page head). */
export { jerCss };

export interface ConsoleProps {
  c: Controller; m: StatusModel; state: LogicalState; ready: boolean; busy: boolean;
  run: (label: string, task: () => Promise<unknown>) => Promise<boolean>;
  /** Path to open (from 状态 › 在操作台修改): dotted, `@entity.field` or a pointer. */
  focus?: string;
  advanced?: React.ReactNode;
}
interface Change { parts: string[]; kind: 'set' | 'unset'; value?: unknown }
type Preview = { feedback: Feedback[]; patch: any[]; base: string } | { error: string };

const key = (parts: string[]) => parts.join('.');
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const startsWith = (parts: string[], prefix: string[]) => prefix.length <= parts.length && prefix.every((p, i) => parts[i] === p);
function setIn(data: any, parts: string[], value: unknown): any {
  if (!parts.length) return value;
  const out = Array.isArray(data) ? [...data] : { ...(data ?? {}) };
  out[parts[0]!] = setIn(out[parts[0]!], parts.slice(1), value);
  return out;
}
function unsetIn(data: any, parts: string[]): any {
  if (!parts.length || data === null || typeof data !== 'object') return data;
  const out = Array.isArray(data) ? [...data] : { ...data };
  if (parts.length === 1) { if (Array.isArray(out)) out.splice(Number(parts[0]), 1); else delete out[parts[0]!]; return out; }
  out[parts[0]!] = unsetIn(out[parts[0]!], parts.slice(1));
  return out;
}
const apply = (data: unknown, changes: Change[]) => changes.reduce((d, ch) => ch.kind === 'unset' ? unsetIn(d, ch.parts) : setIn(d, ch.parts, ch.value), data);
/**
 * Operations for the change list: one statement per change, so each one is clamped and reported on its own
 * (an atomic group would refuse any clamp). Submitting is blocked while any change is rejected, so the commit
 * never lands half-done.
 */
function batchOf(changes: Change[]): unknown[] {
  return changes.map(ch => ch.kind === 'set' ? { $set: { [key(ch.parts)]: ch.value } } : { $unset: [key(ch.parts)] });
}
/** Feedback of one change: rejections by statement number (1-based), adjustments by path. */
function feedbackOf(feedback: Feedback[], ch: Change, index: number): Feedback[] {
  return feedback.filter(f => (f as any).statement === index + 1 || (!(f as any).statement && f.path !== undefined && startsWith(partsOf(f.path), ch.parts)));
}
/** A list change of plain values, as removed / added items. */
function listDelta(before: unknown, after: unknown): { removed: unknown[]; added: unknown[] } | undefined {
  const plain = (v: unknown): v is unknown[] => Array.isArray(v) && v.every(x => x === null || typeof x !== 'object');
  if (!plain(before) || !plain(after)) return undefined;
  const left = [...after];
  const removed = before.filter(x => { const i = left.indexOf(x); if (i < 0) return true; left.splice(i, 1); return false; });
  return { removed, added: left };
}

/** Where a path may be edited, and why not. */
function lockOf(c: Controller, m: StatusModel, parts: string[]): string | undefined {
  if (!parts.length) return '整个状态不能一次改';
  const pattern = m.pattern(parts), def = c.core.definition as any;
  const hit = (list?: string[]) => (list ?? []).some(p => pattern === p || pattern.startsWith(p + '.'));
  if (m.dormant(parts)) return '所属模块已关闭（数据休眠）';
  if (hit(def.internal)) return '图片 / 音乐链接，在结构里设置';
  if (hit(def.readonly)) return '只读字段';
  return undefined;
}
const isEntityCollection = (m: StatusModel, parts: string[]) => !!m.meta(parts)?.entity;
const isRecord = (m: StatusModel, parts: string[], value: unknown) =>
  !!value && typeof value === 'object' && !Array.isArray(value) && m.pattern([...parts, '\u0000']).endsWith('.*');
/** Entities of the given type(s), as [id, name]. */
function entitiesOf(c: Controller, m: StatusModel, data: any, to?: string | string[]): [string, string][] {
  const types = to === undefined ? undefined : ([] as string[]).concat(to);
  const out: [string, string][] = [];
  for (const e of (c.core.definition.entities ?? []) as { type: string; path: string }[]) {
    if (types && !types.includes(e.type)) continue;
    const coll = valueAt(data, e.path.replace(/\.\*$/u, '').split('.'));
    if (coll && typeof coll === 'object') for (const id of Object.keys(coll)) out.push([id, m.entityName(id) || id]);
  }
  return out;
}

const ZH = {
  ITEM_SINGLE: '{{count}} 项', ITEMS_MULTIPLE: '{{count}} 项', ITEMS_FILTERED: '{{visible}} / {{total}} 项', KEY_NEW: '输入新键名', KEY_SELECT: '选择键',
  NO_KEY_OPTIONS: '没有可加的项', ERROR_KEY_EXISTS: '这个键已存在', ERROR_INVALID_JSON: 'JSON 格式错误', ERROR_UPDATE: '修改失败', ERROR_DELETE: '删除失败',
  ERROR_ADD: '添加失败', ERROR_RENAME: '不能改键名', ERROR_MOVE: '移动失败', DEFAULT_NEW_KEY: '新键', SHOW_LESS: '（收起）', SHOW_MORE: '展开', EMPTY_STRING: '（空字符串）',
  TOOLTIP_COPY: '复制', TOOLTIP_EDIT: '修改', TOOLTIP_DELETE: '删除', TOOLTIP_ADD: '添加', TOOLTIP_OK: '确定', TOOLTIP_CANCEL: '取消', TOOLTIP_COLLAPSE: '收起', TOOLTIP_EXPAND: '展开',
};

export function StateEditor({ c, m, state, ready, busy, run, focus, advanced }: ConsoleProps) {
  const K = useKit();
  const data = state.data as Record<string, any>;
  // Scopes: the meta block, every entity on its own, the other top-level parts.
  const scopes = React.useMemo(() => {
    const out: { id: string; label: string; parts: string[] }[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (isEntityCollection(m, [k]) && v && typeof v === 'object') for (const id of Object.keys(v)) out.push({ id: k + '.' + id, label: `${m.label([k])} › ${m.entityName(id) || id}`, parts: [k, id] });
      else out.push({ id: k, label: m.label([k]) || k, parts: [k] });
    }
    return out;
  }, [m, data]);
  const resolve = (path: string): string[] => {
    const p = path.startsWith('@') ? (() => { const [id, ...rest] = path.slice(1).split('.'); const s = scopes.find(x => x.parts.length === 2 && x.parts[1] === id); return s ? [...s.parts, ...rest] : partsOf(path.slice(1)); })() : partsOf(path);
    return p;
  };
  const focusParts = focus ? resolve(focus) : undefined;
  const [scopeId, setScopeId] = React.useState(() => (focusParts && scopes.filter(s => startsWith(focusParts, s.parts)).sort((a, b) => b.parts.length - a.parts.length)[0]?.id) || scopes.find(s => s.parts[0] === 'characters')?.id || scopes[0]?.id || '');
  const scope = scopes.find(s => s.id === scopeId) ?? scopes[0]!;
  const [changes, setChanges] = React.useState<Change[]>([]);
  const [search, setSearch] = React.useState('');
  const [narrate, setNarrate] = React.useState('');
  const [result, setResult] = React.useState<Preview | undefined>();
  const editor = React.useRef<JsonEditorHandle>(null);
  const draft = React.useMemo(() => apply(data, changes), [data, changes]);
  // A new head (after a submit, a reply or an undo) starts a fresh change list.
  const head = c.runtime.getCommit()?.id;
  React.useEffect(() => { setChanges([]); setResult(undefined); }, [head]);
  // Open the focused field for editing.
  React.useEffect(() => {
    if (!focusParts) return;
    const s = scopes.filter(x => startsWith(focusParts, x.parts)).sort((a, b) => b.parts.length - a.parts.length)[0];
    if (s) setScopeId(s.id);
    const t = setTimeout(() => { if (s) editor.current?.startEdit({ path: focusParts.slice(s.parts.length) }); }, 60);
    return () => clearTimeout(t);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live preview of the whole change list.
  const batch = React.useMemo(() => batchOf(changes), [changes]);
  React.useEffect(() => {
    if (!changes.length) { setResult(undefined); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      c.preview(batch as never, narrate.trim() ? { narrate: narrate.trim() } : undefined)
        .then(r => { if (live) setResult({ feedback: r.feedback, patch: r.dataPatch, base: r.baseHeadId }); }, e => { if (live) setResult({ error: message(e) }); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [batch, narrate]); // eslint-disable-line react-hooks/exhaustive-deps

  const full = (node: { path: (string | number)[] }) => [...scope.parts, ...node.path.map(String)];
  const record = (target: string[], kind: 'set' | 'unset', value?: unknown) => setChanges(list => {
    // An earlier change covering this path absorbs it; changes below it are replaced.
    const cover = list.find(ch => ch.kind === 'set' && startsWith(target, ch.parts) && ch.parts.length < target.length);
    if (cover) {
      const next = apply(draft, []); const v = kind === 'unset' ? valueAt(unsetIn(next, target), cover.parts) : valueAt(setIn(next, target, value), cover.parts);
      return list.map(ch => ch === cover ? { ...ch, value: clone(v) } : ch).filter(ch => ch.kind === 'unset' || !same(ch.value, valueAt(data, ch.parts)) || !startsWith(ch.parts, cover.parts));
    }
    const rest = list.filter(ch => !startsWith(ch.parts, target));
    const base = valueAt(data, target);
    if (kind === 'unset') return base === undefined ? rest : [...rest, { parts: target, kind }];
    if (same(value, base)) return rest;
    return [...rest, { parts: target, kind, value: clone(value) }];
  });
  const onUpdate = (props: UpdateFunctionProps<any>) => {
    if (props.event === 'rename') return { error: '不能改键名' };
    const parts = full(props);
    const lock = lockOf(c, m, parts);
    if (lock) return { error: lock };
    const nextScoped = props.newData;
    const nextFull = setIn(draft, scope.parts, nextScoped);
    // Inside a list the whole list is written (indices shift on insert / delete / move).
    let target = props.event === 'move' ? parts.slice(0, -1) : parts;
    for (let i = scope.parts.length; i < target.length; i++) if (Array.isArray(valueAt(data, target.slice(0, i)))) { target = target.slice(0, i); break; }
    if (props.event === 'delete' && target === parts) record(target, 'unset');
    else record(target, 'set', valueAt(nextFull, target));
    // A new list item comes in empty: open it for typing.
    if (props.event === 'add' && Array.isArray(valueAt(draft, parts.slice(0, -1)))) setTimeout(() => editor.current?.startEdit({ path: props.path }), 50);
    return true;
  };
  const allowEdit = (n: NodeData) => !lockOf(c, m, full(n)) && !isEntityCollection(m, full(n)) && n.level > 0;
  const allowDelete = (n: NodeData) => {
    const parts = full(n), parent = parts.slice(0, -1);
    if (lockOf(c, m, parts) || n.level === 0) return false;
    return Array.isArray(n.parentData) || (isRecord(m, parent, n.parentData) && !isEntityCollection(m, parent));
  };
  const allowAdd = (n: NodeData) => {
    const parts = full(n);
    if (lockOf(c, m, parts)) return false;
    return Array.isArray(n.value) || (isRecord(m, parts, n.value) && !isEntityCollection(m, parts));
  };
  // New keys of an entity-keyed record (relations, holdings…) come from the entities of that type.
  const newKeyOptions = (n: NodeData) => {
    const parts = full(n), meta = m.meta(parts);
    if (!meta?.keys) return null;
    return entitiesOf(c, m, draft, meta.keys).map(([id]) => id).filter(id => !(n.value as object)?.hasOwnProperty(id));
  };
  const defaultValue = (n: NodeData) => {
    const v = n.value as any;
    if (Array.isArray(v) && v.length) return blank(v[0]);
    if (v && typeof v === 'object') { const first = Object.values(v)[0]; return first === undefined ? '' : blank(first); }
    return '';
  };

  // Structure-aware nodes: Chinese labels on every key, choices for enum / ladder / ref.
  const changed = React.useMemo(() => new Set(changes.map(ch => key(ch.parts))), [changes]);
  const Label = React.useCallback(({ name, path, handleClick, styles }: CustomKeyProps) => {
    const parts = [...scope.parts, ...path.map(String)], k = String(name);
    const pattern = m.pattern(parts).split('.'), star = pattern[parts.length - 1] === '*';
    const text = /^\d+$/u.test(k) && Array.isArray(valueAt(draft, parts.slice(0, -1))) ? '#' + (Number(k) + 1) : star ? (m.entityName(k) || k) : (m.label(parts) || k);
    const lock = lockOf(c, m, parts);
    return (
      <span {...solve('jer-key')} style={styles} onClick={handleClick} data-changed={changed.has(key(parts)) ? '' : undefined} title={lock ? `${key(parts)} · ${lock}` : key(parts)}>
        {text}{text !== k ? <code>{k}</code> : null}{lock ? <i aria-label={lock}>🔒</i> : null}
      </span>
    );
  }, [scope, m, draft, changed]); // eslint-disable-line react-hooks/exhaustive-deps
  const Choice = React.useCallback(({ value, nodeData, isEditing, setIsEditing, handleEdit, handleCancel, canEdit }: CustomComponentProps) => {
    const parts = [...scope.parts, ...nodeData.path.map(String)], meta = choiceMeta(m, parts);
    const ref = meta?.type === 'ref' || meta?.type === 'refs';
    const options: [string, string][] = ref ? entitiesOf(c, m, draft, meta!.to) : (meta?.values ?? []).map(v => [v, v]);
    const shown = value === null ? '（空）' : ref ? named(m, value) : String(value);
    if (!isEditing) return <button type="button" {...solve('jer-choice')} disabled={!canEdit} onDoubleClick={() => canEdit && setIsEditing(true)} onClick={() => canEdit && setIsEditing(true)}>{shown}{meta?.type === 'ladder' ? <small>{(meta.values ?? []).indexOf(String(value)) + 1}/{meta.values?.length}</small> : null}</button>;
    return (
      <select {...solve('jer-select')} autoFocus defaultValue={value === null ? '' : String(value)} aria-label={m.label(parts)}
        onChange={e => handleEdit(e.target.value === '' ? null : e.target.value)} onKeyDown={e => { if (e.key === 'Escape') handleCancel(); }} onBlur={() => handleCancel()}>
        {value === null ? <option value="">（空）</option> : null}
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    );
  }, [scope, m, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodes = React.useMemo<CustomNodeDefinition[]>(() => [
    { condition: n => !!choiceMeta(m, full(n)) && (n.value === null || typeof n.value === 'string'),
      component: Choice as never, keyComponent: Label as never, showOnEdit: true, showOnView: true, showEditTools: false, name: 'choice' },
    // Labels only: no `component`, so the library keeps its own value / collection rendering.
    { condition: () => true, keyComponent: Label as never, name: 'label' },
  ], [Choice, Label, scope, m]); // eslint-disable-line react-hooks/exhaustive-deps
  const theme = React.useMemo<ThemeStyles>(() => {
    const mark = (n: NodeData) => changed.has(key(full(n))) ? { backgroundColor: 'var(--k-accent-soft)', borderRadius: 'var(--k-r-sm)' } : null;
    return {
      container: { backgroundColor: 'transparent', color: 'var(--k-on)', fontFamily: 'inherit', fontSize: 'var(--k-fs-sm)', padding: 0, maxWidth: '100%' },
      property: 'var(--k-on)', bracket: { color: 'var(--k-on-subtle)' }, itemCount: { color: 'var(--k-on-subtle)', fontStyle: 'normal' },
      string: ['var(--k-on-muted)', mark], number: [{ color: 'var(--k-accent)', fontWeight: 600 }, mark], boolean: ['var(--k-info)', mark], null: [{ color: 'var(--k-on-subtle)' }, mark],
      input: { color: 'var(--k-on)', backgroundColor: 'var(--k-surface-1)', border: '1px solid var(--k-accent)', borderRadius: 'var(--k-r-sm)', fontFamily: 'inherit' },
      inputHighlight: 'var(--k-accent-soft)', error: { color: 'var(--k-danger)', fontSize: 'var(--k-fs-xs)' },
      iconCollection: 'var(--k-on-subtle)', iconEdit: 'var(--k-accent)', iconDelete: 'var(--k-danger)', iconAdd: 'var(--k-success)', iconCopy: 'var(--k-on-subtle)', iconOk: 'var(--k-success)', iconCancel: 'var(--k-danger)',
    };
  }, [changed, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = !!result && !('error' in result) && result.feedback.some(f => f.level === 'L3');
  const submit = async () => {
    if (!result || 'error' in result) return;
    const ok = await run(`提交 ${changes.length} 处修改`, () => c.submit(batch as never, { expectedHead: result.base, ...(narrate.trim() ? { authorInputs: { narrate: narrate.trim() } } : {}) }));
    if (ok) { setChanges([]); setNarrate(''); }
  };
  const floor = c.getMessages().findLast(x => x.role === 'assistant');
  const scoped = valueAt(draft, scope.parts);
  const Text = K.TextField;
  const field = (props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>) => Text ? <Text size="sm" {...props} /> : <input {...props} />;
  return (
    <div {...solve('debug-console')}>
      <p {...part('intro')}>点值就能改（数字可用 ↑↓ 加减，Tab 跳到下一个）。每处修改先记进右边的<b>改动单</b>，引擎实时预演；确认后一次<b>提交</b>，作为玩家动作存进第 {floor?.index ?? '—'} 楼，可在历史里撤销。🔒 是不能在这里改的字段。</p>
      <div {...solve('debug-bar')}>
        <label {...part('scope')}>改哪里 <select value={scope.id} onChange={e => setScopeId(e.target.value)}>{scopes.map(s => <option key={s.id} value={s.id}>{s.label}{changes.some(ch => startsWith(ch.parts, s.parts)) ? ' ●' : ''}</option>)}</select></label>
        {field({ placeholder: '在这一块里搜索（键或值）', value: search, onChange: e => setSearch(e.target.value), 'aria-label': '搜索' })}
      </div>
      <div {...part('split')}>
        <div {...part('editor')}>
          <JsonEditor data={scoped as any} setData={() => undefined} onUpdate={onUpdate as never} editorRef={editor} rootName={scope.label}
            allowEdit={allowEdit} allowDelete={allowDelete} allowAdd={allowAdd} allowDrag={(n: NodeData) => Array.isArray(n.parentData) && !lockOf(c, m, full(n))}
            allowTypeSelection={false} newKeyOptions={newKeyOptions as never} defaultValue={defaultValue as never}
            collapse={(n: NodeData) => n.level >= 2} searchText={search} searchFilter="all" showStringQuotes={false} showArrayIndexes={false}
            stringTruncateLength={80} showIconTooltips translations={ZH} customNodeDefinitions={nodes} theme={theme} indent={2} minWidth="100%" maxWidth="100%" />
        </div>
        <aside {...part('changes')} aria-label="改动单">
          <h3>改动单 <small>{changes.length ? `${changes.length} 处` : '还没有修改'}</small></h3>
          {changes.length ? (
            <ul {...solve('debug-changes')}>
              {changes.map((ch, i) => {
                const before = valueAt(data, ch.parts), list = ch.kind === 'set' ? listDelta(before, ch.value) : undefined;
                const notes = result && !('error' in result) ? feedbackOf(result.feedback, ch, i) : [];
                const level = notes.some(f => f.level === 'L3') ? 'L3' : notes.some(f => f.level === 'L2' || f.level === 'L1') ? 'L2' : undefined;
                return (
                  <li key={key(ch.parts)} data-kind={ch.kind} data-level={level}>
                    <span {...part('name')}>{describe(m, ch.parts)}<code>{key(ch.parts)}</code></span>
                    <span {...part('change')}>{list ? <>
                      {list.removed.map((x, j) => <del key={'r' + j}>{named(m, x)}</del>)}
                      {list.added.map((x, j) => <ins key={'a' + j}>+ {x === '' ? '（空，待填写）' : named(m, x)}</ins>)}
                      {!list.removed.length && !list.added.length ? <em>调整顺序</em> : null}
                    </> : <>{before !== undefined ? <del>{named(m, before)}</del> : null}{ch.kind === 'set' ? <>{before !== undefined ? <span aria-hidden="true">→</span> : <em>新增</em>}<ins>{named(m, ch.value)}</ins></> : <em>删除</em>}</>}</span>
                    {notes.length ? <span {...part('notes')}>{notes.map((f, j) => <K.Badge key={j} tone={f.level === 'L3' ? 'danger' : 'warning'}>{f.level === 'L3' ? '被拒绝' : '已调整'}：{f.message}</K.Badge>)}</span> : null}
                    <button type="button" {...part('undo')} aria-label={`撤掉 ${describe(m, ch.parts)} 的修改`} onClick={() => setChanges(list => list.filter(x => x !== ch))}>撤掉</button>
                  </li>
                );
              })}
            </ul>
          ) : <p {...part('none')}>在左边改一个值试试。</p>}
          {changes.length ? (
            <>
              {field({ placeholder: '告诉模型的一句话（可选，如：艾琳喝下了药剂）', value: narrate, onChange: e => setNarrate(e.target.value), 'aria-label': '旁白' })}
              <h4 {...part('sub')}>预演结果</h4>
              {!result ? <p {...part('none')}>计算中…</p> : 'error' in result ? <p {...part('error')} role="alert">{result.error}</p> : (() => {
                const rows = changes.map((ch, i) => feedbackOf(result.feedback, ch, i));
                const rejected = rows.filter(r => r.some(f => f.level === 'L3')).length, adjusted = rows.filter(r => r.length && !r.some(f => f.level === 'L3')).length;
                const other = result.feedback.filter(f => !rows.some(r => r.includes(f)));
                return <>
                  <p {...part('summary')} data-tone={rejected ? 'error' : adjusted ? 'warning' : 'ok'}>{rejected ? `${rejected} 处被拒绝，` : ''}{adjusted ? `${adjusted} 处会被引擎调整，` : ''}{changes.length - rejected - adjusted} 处按原样生效</p>
                  {other.length ? <FeedbackList items={other} m={m} /> : null}
                </>;
              })()}
              <div {...solve('debug-bar')}>
                <K.Button size="sm" variant="primary" disabled={!result || 'error' in result || blocked || busy || !ready} onClick={() => void submit()}>提交 {changes.length} 处</K.Button>
                <K.Button size="sm" variant="ghost" onClick={() => setChanges([])}>全部撤掉</K.Button>
              </div>
              {!ready ? <small {...part('hint')}>状态未就绪，暂不能提交</small> : blocked ? <small {...part('hint')}>有被拒绝的修改，撤掉或改正后再提交</small> : null}
              {result && !('error' in result) && result.patch.length ? (
                <details {...part('effect')}><summary>实际写入（{result.patch.length} 处，基于提交 {short(result.base)}）</summary><Diff patch={result.patch} before={data} m={m} /></details>
              ) : null}
            </>
          ) : null}
        </aside>
      </div>
      {advanced ? <details {...solve('debug-advanced')}><summary>高级：直接写操作 JSON（$inc、$push、实体操作…）</summary>{advanced}</details> : null}
    </div>
  );
}
/** Choice field: enum / ladder / ref, or an item of a refs list. */
function choiceMeta(m: StatusModel, parts: string[]) {
  const own = m.meta(parts);
  if (own && ['enum', 'ladder', 'ref'].includes(own.type) && (own.values || own.to)) return own;
  const parent = parts.length > 1 ? m.meta(parts.slice(0, -1)) : undefined;
  if (parent?.type === 'refs' && /^\d+$/u.test(parts.at(-1)!)) return parent;
  return undefined;
}
/** An empty value of the same shape (new list items, new record entries). */
function blank(v: unknown): unknown {
  if (Array.isArray(v)) return [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)]));
  return typeof v === 'number' ? 0 : typeof v === 'boolean' ? false : v === null ? null : '';
}
