/**
 * 结构制作 · 交互（预览三）。玩家在状态栏里能做什么：原地修改字段（edit）、条目上的按钮（actions）、列表的新增表单（create）。
 * 右边是按草稿渲染的状态栏，按钮能真点：不改数据，只把会提交的操作记在「试运行」里。
 */
import * as React from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useKit } from '../kit.js';
import type { Interact, InteractRequest } from '../statusbar/interact.js';
import type { ActionSpec, AskSpec, CreateSpec, EditSpec } from '../../interact.js';
import type { FieldNode } from '../../structure.js';
import { addrKey, childrenOf, nodeAt, rootNode, update, KEY_RE, freeKey, type Addr } from './draft.js';
import { Field, Select, TextInput, nameOf, part, solve, typeInfo, useB } from './builder.js';
import { CondEditor, JsonBox, LiveStatus, PathInput, SortList, Split, pathOptions } from './common.js';

const hasInteract = (n: FieldNode) => !!(n.edit || n.actions || n.create);
const canAct = (n: FieldNode) => n.type === 'record' || n.type === 'array' || n.type === 'object';
const canCreate = (n: FieldNode) => n.type === 'record' && n.of?.type === 'object';
/** Fields of one entry (actions, create) or of the surrounding object (edit). */
const entryBase = (addr: Addr, n: FieldNode): Addr => n.type === 'object' ? addr : [...addr, '*'];

export function InteractPage() {
  const K = useKit(), { d } = useB();
  const [all, setAll] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const rows: { addr: Addr; node: FieldNode; depth: number }[] = [];
  const walk = (n: FieldNode, a: Addr, depth: number) => { for (const [k, c] of childrenOf(n)) { const x = [...a, k]; if (k !== '*') rows.push({ addr: x, node: c, depth }); walk(c, x, k === '*' ? depth : depth + 1); } };
  walk(rootNode(d), [], 0);
  const q = query.trim().toLowerCase();
  const shown = rows.filter(r => (all || hasInteract(r.node)) && (!q || (r.node.label ?? '').toLowerCase().includes(q) || addrKey(r.addr).toLowerCase().includes(q)));
  const [sel, setSel] = React.useState<string | undefined>(() => shown[0] ? addrKey(shown[0].addr) : undefined);
  const current = rows.find(r => addrKey(r.addr) === sel);
  // Dry run: buttons in the preview are real, nothing is written.
  const [log, setLog] = React.useState<InteractRequest[]>([]);
  const dry: Interact = React.useMemo(() => ({
    run: async req => { setLog(l => [req, ...l].slice(0, 6)); return { ok: true }; },
    pending: log.filter(x => x.narrate).map(x => x.narrate!).slice(0, 3),
  }), [log]);
  const chain = (a: Addr) => a.filter(k => k !== '*').map((_, i, arr) => arr[i]).length;
  void chain;

  const list = (
    <div {...solve('builder-ilist')}>
      <div {...part('tools')}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索字段" aria-label="搜索字段" />
        <label {...part('all')}><K.Switch checked={all} aria-label="显示全部字段" onCheckedChange={setAll} /><span>全部字段</span></label>
      </div>
      <ul role="listbox" aria-label="字段">
        {shown.map(r => {
          const k = addrKey(r.addr), n = r.node, acts = Object.keys(n.actions ?? {}).length;
          return (
            <li key={k}>
              <button type="button" role="option" aria-selected={sel === k} onClick={() => setSel(k)} style={{ paddingInlineStart: 8 + r.depth * 12 }}>
                <i {...part('type')} data-type={n.type}>{typeInfo(n.type).tag}</i>
                <span {...part('label')}>{nameOf(n, r.addr.at(-1)!)}</span><code>{k}</code>
                <span {...part('marks')}>{n.edit ? <small data-kind="edit">可改</small> : null}{acts ? <small data-kind="act">{acts} 个按钮</small> : null}{n.create ? <small data-kind="create">新增</small> : null}</span>
              </button>
            </li>
          );
        })}
        {!shown.length ? <li {...part('none')}>{all ? '没有匹配的字段' : '还没有字段声明交互。打开「全部字段」挑一个开始。'}</li> : null}
      </ul>
    </div>
  );
  const note = log.length ? (
    <div {...solve('builder-dryrun')} role="log" aria-label="试运行记录">
      <header><b>试运行</b><small>按钮不会改数据，这里列出会提交的操作</small><button type="button" onClick={() => setLog([])}>清空</button></header>
      <ol>{log.map((x, i) => <li key={i}><b>{x.title}</b>{x.narrate ? <q>{x.narrate}</q> : null}<code>{x.ops.length ? JSON.stringify(x.ops) : '（不改数据，只告诉模型）'}</code></li>)}</ol>
    </div>
  ) : <p {...solve('builder-dryrun')} data-empty=""><small>在预览里点按钮试试：不会改数据，会在这里列出要提交的操作。</small></p>;
  return (
    <Split previewLabel="状态栏预览" editor={
      <div {...solve('builder-interact')}>
        <p {...part('intro')}>交互只靠结构声明：状态栏按这里的设置生成按钮和编辑器。模型生成期间交互暂停；玩家的操作经引擎同样校验。</p>
        <div {...part('cols')}>{list}<div {...part('form')}>{current ? <InteractForm key={sel} addr={current.addr} node={current.node} /> : <p {...part('hint')}>在左边选一个字段。</p>}</div></div>
      </div>
    } preview={<LiveStatus interact={dry} note={note} />} />
  );
}

function InteractForm({ addr, node }: { addr: Addr; node: FieldNode }) {
  const K = useKit(), { d, set, note } = useB();
  const patch = (p: Partial<FieldNode>) => set(update(d, addr, p));
  const parent = addr.slice(0, -1).at(-1) === '*' ? addr.slice(0, -1) : addr.slice(0, -1);
  const editSpec: EditSpec | undefined = node.edit === true ? {} : node.edit || undefined;
  const sibling = pathOptions(d, parent);
  const actions = Object.entries(node.actions ?? {});
  const base = entryBase(addr, node);
  const entry = pathOptions(d, base);
  const setActions = (list: [string, ActionSpec][]) => patch({ actions: list.length ? Object.fromEntries(list) : undefined });
  return (
    <section {...solve('builder-iform')} aria-label={`交互：${nameOf(node, addr.at(-1)!)}`}>
      <header><h3><i {...part('type')} data-type={node.type}>{typeInfo(node.type).tag}</i>{nameOf(node, addr.at(-1)!)}</h3><code>{addrKey(addr)}</code></header>

      <K.Card title="玩家可以修改">
        <Field label="允许在状态栏里改" hint={node.type === 'array' ? '清单：可以改写、删除、添加条目；写在清单元素的 done 上则只能勾选' : '按类型给出编辑器（文字、数字、选项、开关）'}>
          <K.Switch checked={!!node.edit} aria-label="允许修改" onCheckedChange={v => patch({ edit: v ? true : undefined })} />
        </Field>
        {node.edit ? <>
          <Field label="只在玩家角色名下"><K.Switch checked={editSpec?.owner === 'user'} aria-label="只在玩家角色名下" onCheckedChange={v => patch({ edit: tidyEdit({ ...editSpec, owner: v ? 'user' : undefined }) })} /></Field>
          <Field label="条件" hint="所在对象要满足的条件，如只有玩家写的设定能改：source = 玩家"><CondEditor label="修改条件" value={editSpec?.when as Record<string, unknown>} options={sibling} onChange={v => patch({ edit: tidyEdit({ ...editSpec, when: v as EditSpec['when'] }) })} /></Field>
          <Narrate value={editSpec?.narrate} pair={node.type === 'bool'} hint="改了以后告诉模型的话；不写就是静默修正。可用 {value} {old} {label}" onChange={v => patch({ edit: tidyEdit({ ...editSpec, narrate: v }) })} />
        </> : null}
      </K.Card>

      {canAct(node) ? (
        <K.Card title={node.type === 'object' ? '按钮（这个对象上）' : '按钮（每一项上）'}>
          <SortList ids={actions} label="按钮" keyOf={([k]) => k} onMove={(a, b) => setActions(arrayMove(actions, a, b))}
            render={([key, spec], i, handle) => (
              <ActionCard handle={handle} name={key} spec={spec} entry={entry} taken={n => n !== key && actions.some(([k]) => k === n)}
                onChange={(name, s) => setActions(actions.map((x, j) => j === i ? [name, s] : x))} onRemove={() => { setActions(actions.filter((_, j) => j !== i)); note(`已删除按钮「${labelText(spec.label)}」`); }} />
            )} />
          <K.Button size="sm" variant="ghost" onClick={() => { const k = freeKey(node.actions, 'action'); setActions([...actions, [k, { label: '新按钮', ops: [] }]]); }}>+ 按钮</K.Button>
        </K.Card>
      ) : null}

      {canCreate(node) ? <CreateCard spec={node.create} entry={entry} onChange={v => patch({ create: v })} /> : null}

      <K.CollapseCard title="占位符" meta={<small>按钮操作、询问和告知里能用</small>}>
        <ul {...part('ph')}>
          <li><code>{'{self}'}</code> 这一项的路径；<code>{'{id}'}</code> 它的键；<code>{'{name}'}</code></li>
          <li><code>{'{holder}'}</code> / <code>{'{holderId}'}</code> 它所在的实体；<code>{'{user}'}</code> / <code>{'{userId}'}</code> 玩家角色</li>
          <li>这一项的字段，如 <code>{'{count}'}</code>；询问的答案，如 <code>{'{to}'}</code> <code>{'{to.name}'}</code> <code>{'{n}'}</code></li>
          <li>整串只有 <code>{'{x}'}</code> 或 <code>{'-{x}'}</code> 时保留原类型（数字仍是数字）</li>
        </ul>
      </K.CollapseCard>
    </section>
  );
}
const tidyEdit = (e: EditSpec): true | EditSpec => { const o = Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)) as EditSpec; return Object.keys(o).length ? o : true; };
const labelText = (l: string | [string, string]) => Array.isArray(l) ? l.join(' / ') : l;

function Narrate({ value, pair, hint, onChange }: { value: string | [string, string] | undefined; pair?: boolean; hint: string; onChange: (v: string | [string, string] | undefined) => void }) {
  const two: [string, string] = Array.isArray(value) ? [value[0] ?? '', value[1] ?? ''] : [value ?? '', ''];
  if (!pair) return <Field label="告诉模型" hint={hint}><TextInput label="告诉模型" value={typeof value === 'string' ? value : two[0]} onCommit={v => onChange(v.trim() || undefined)} /></Field>;
  return (
    <Field label="告诉模型" hint={hint + '（两句：变成「是」时 / 变成「否」时）'}>
      <div {...part('pair')}>
        <TextInput label="变成是时" placeholder="变成「是」时" value={two[0]} onCommit={v => onChange(v.trim() || two[1] ? [v.trim(), two[1]] : undefined)} />
        <TextInput label="变成否时" placeholder="变成「否」时" value={two[1]} onCommit={v => onChange(two[0] || v.trim() ? [two[0], v.trim()] : undefined)} />
      </div>
    </Field>
  );
}

type Mode = 'toggle' | 'ops' | 'tell';
function ActionCard({ handle, name, spec, entry, taken, onChange, onRemove }: {
  handle: React.ReactNode; name: string; spec: ActionSpec; entry: { path: string; label: string; type: string }[]; taken: (n: string) => boolean;
  onChange: (name: string, s: ActionSpec) => void; onRemove: () => void;
}) {
  const K = useKit(), { d } = useB();
  const mode: Mode = spec.toggle ? 'toggle' : spec.ops && spec.ops.length ? 'ops' : 'tell';
  const set = (p: Partial<ActionSpec>) => onChange(name, Object.fromEntries(Object.entries({ ...spec, ...p }).filter(([, v]) => v !== undefined)) as unknown as ActionSpec);
  const bools = entry.filter(o => o.type === 'bool');
  const [open, setOpen] = React.useState(false);
  const label = (spec.label ?? '') as string | [string, string];
  return (
    <div {...solve('builder-action')} data-danger={spec.tone === 'danger' ? '' : undefined}>
      <div {...part('head')}>
        {handle}
        <button type="button" {...part('preview')} onClick={() => setOpen(v => !v)} aria-expanded={open}>{labelText(label) || '（没有文字）'}</button>
        <small>{mode === 'toggle' ? `翻转 ${spec.toggle}` : mode === 'ops' ? `${spec.ops!.length} 条操作` : '只告诉模型'}{spec.ask ? ` · 询问 ${Object.keys(spec.ask).length}` : ''}{spec.when ? ' · 有条件' : ''}</small>
        <button type="button" {...part('remove')} onClick={onRemove} aria-label={`删除按钮 ${labelText(label)}`}>×</button>
      </div>
      {open ? (
        <div {...part('body')}>
          <Field label="键名" hint="英文，在这一项的按钮里唯一"><TextInput label="按钮键名" value={name} mono validate={v => !KEY_RE.test(v) ? '只能用英文字母、数字和下划线' : taken(v) ? '已经有这个按钮' : undefined} onCommit={v => onChange(v, spec)} /></Field>
          <Field label="做什么">
            <Select label="做什么" value={mode} options={[['toggle', '翻转一个开关字段（装备 / 卸下）'], ['ops', '执行操作'], ['tell', '只告诉模型（不改数据）']]}
              onChange={v => set(v === 'toggle' ? { toggle: bools[0]?.path ?? '', ops: undefined, label: Array.isArray(label) ? label : [label || '打开', '关闭'] } : v === 'ops' ? { toggle: undefined, ops: [{ $set: { '{self}.field': '值' } }], label: Array.isArray(label) ? label[0] : label } : { toggle: undefined, ops: [], label: Array.isArray(label) ? label[0] : label })} />
          </Field>
          {mode === 'toggle' ? <>
            <Field label="翻转哪个字段"><Select label="翻转哪个字段" value={spec.toggle ?? ''} options={bools.map(b => [b.path, b.label] as [string, string])} onChange={v => set({ toggle: v })} /></Field>
            <Field label="按钮文字" hint="两句：打开时 / 关闭时">
              <div {...part('pair')}>
                <TextInput label="打开" value={Array.isArray(label) ? label[0] : label} onCommit={v => set({ label: [v, Array.isArray(label) ? label[1] : ''] })} />
                <TextInput label="关闭" value={Array.isArray(label) ? label[1] : ''} onCommit={v => set({ label: [Array.isArray(label) ? label[0] : label, v] })} />
              </div>
            </Field>
          </> : <Field label="按钮文字"><TextInput label="按钮文字" value={labelText(label)} onCommit={v => set({ label: v })} /></Field>}
          {mode === 'ops' ? (
            <Field label="操作" hint="普通 SOLVE 操作，可用占位符；{ $if: 条件, then: [...], else: [...] } 按条件选">
              <JsonBox label="操作" rows={8} value={spec.ops} onChange={v => set({ ops: v as ActionSpec['ops'] })} validate={v => Array.isArray(v) ? undefined : '需要一个数组'} />
            </Field>
          ) : null}
          <AskEditor value={spec.ask} onChange={v => set({ ask: v })} />
          <Field label="显示条件" hint="键是这一项的字段，@路径 读绝对路径"><CondEditor label="显示条件" value={spec.when as Record<string, unknown>} options={entry} onChange={v => set({ when: v as ActionSpec['when'] })} /></Field>
          <Field label="只在玩家角色名下"><K.Switch checked={spec.owner === 'user'} aria-label="只在玩家角色名下" onCheckedChange={v => set({ owner: v ? 'user' : undefined })} /></Field>
          <Field label="只在模块开启时"><Select label="只在模块开启时" value={spec.module ?? ''} options={[['', '始终'], ...Object.entries(d.modules ?? {}).map(([k, m]) => [k, m.label ?? k] as [string, string])]} onChange={v => set({ module: v || undefined })} /></Field>
          <Field label="先确认" hint="破坏性操作：写下确认时显示的话"><TextInput label="确认文字" value={spec.confirm ?? ''} onCommit={v => set({ confirm: v.trim() || undefined })} /></Field>
          <Narrate value={spec.narrate} pair={mode === 'toggle'} hint="下一轮告诉模型的话，可用占位符" onChange={v => set({ narrate: v })} />
          <Field label="警示色"><K.Switch checked={spec.tone === 'danger'} aria-label="警示色" onCheckedChange={v => set({ tone: v ? 'danger' : undefined })} /></Field>
        </div>
      ) : null}
    </div>
  );
}

type AskKind = 'pick' | 'number' | 'text';
function AskEditor({ value, onChange }: { value: Record<string, AskSpec> | undefined; onChange: (v: Record<string, AskSpec> | undefined) => void }) {
  const K = useKit(), { d } = useB();
  const list = Object.entries(value ?? {});
  const save = (l: [string, AskSpec][]) => onChange(l.length ? Object.fromEntries(l) : undefined);
  const set = (i: number, key: string, s: AskSpec) => save(list.map((x, j) => j === i ? [key, s] : x));
  const roots = pathOptions(d, []).filter(o => o.type === 'record' || o.type === 'refs');
  return (
    <Field label="执行前询问" hint="按顺序问；后面的可以用前面的答案，如 {to}、{to.name}、{n}">
      <div {...solve('builder-ask')}>
        <SortList ids={list} label="询问" keyOf={([k]) => k} onMove={(a, b) => save(arrayMove(list, a, b))} render={([key, a], i, handle) => {
          const kind: AskKind = a.number ? 'number' : a.text ? 'text' : 'pick';
          const clean = (s: AskSpec) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as AskSpec;
          return (
            <div {...part('ask')}>
              <div {...part('head')}>{handle}
                <TextInput label="答案名" mono value={key} validate={v => !KEY_RE.test(v) ? '英文' : list.some(([k], j) => j !== i && k === v) ? '重复' : undefined} onCommit={v => set(i, v, a)} />
                <TextInput label="问题" value={a.label} onCommit={v => set(i, key, { ...a, label: v })} />
                <Select label="答案类型" value={kind} options={[['pick', '选一项'], ['number', '填数量'], ['text', '写一句话']]}
                  onChange={v => set(i, key, clean({ label: a.label, ...(a.when ? { when: a.when } : {}), ...(v === 'pick' ? { pick: roots[0]?.path ?? 'characters' } : v === 'number' ? { number: { min: 1 } } : { text: {} }) }))} />
                <button type="button" {...part('remove')} onClick={() => save(list.filter((_, j) => j !== i))} aria-label={`删除询问 ${a.label}`}>×</button>
              </div>
              {kind === 'pick' ? <div {...part('grid')}>
                <Field label="从哪里选" hint="实体集合，或 {self}.stored 这样的引用字典"><PathInput label="从哪里选" value={a.pick} options={roots} onChange={v => set(i, key, clean({ ...a, pick: v }))} /></Field>
                <Field label="限定在" hint="如 meta.present（为空时退回整个集合）"><PathInput label="限定在" value={a.within} options={pathOptions(d, [])} onChange={v => set(i, key, clean({ ...a, within: v }))} /></Field>
                <Field label="排除"><TextInput label="排除" mono placeholder="如 {holderId}" value={a.not ?? ''} onCommit={v => set(i, key, clean({ ...a, not: v.trim() || undefined }))} /></Field>
              </div> : kind === 'number' ? <div {...part('grid')}>
                {(['min', 'max', 'default'] as const).map(k => <Field key={k} label={{ min: '最少', max: '最多', default: '默认' }[k]}><TextInput label={k} mono placeholder={k === 'max' ? '如 {count}' : ''} value={a.number?.[k] === undefined ? '' : String(a.number[k])}
                  onCommit={v => set(i, key, { ...a, number: Object.fromEntries(Object.entries({ ...a.number, [k]: v.trim() === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : v.trim() }).filter(([, x]) => x !== undefined)) })} /></Field>)}
              </div> : <div {...part('grid')}>
                <Field label="提示文字"><TextInput label="提示文字" value={a.text?.placeholder ?? ''} onCommit={v => set(i, key, { ...a, text: { ...a.text, placeholder: v || undefined } as AskSpec['text'] })} /></Field>
                <Field label="可以不写"><K.Switch checked={!!a.text?.optional} aria-label="可以不写" onCheckedChange={v => set(i, key, { ...a, text: { ...a.text, optional: v || undefined } as AskSpec['text'] })} /></Field>
              </div>}
            </div>
          );
        }} />
        <K.Button size="sm" variant="ghost" onClick={() => { let k = 'to', n = 2; while (list.some(([x]) => x === k)) k = 'to' + n++; save([...list, [k, { label: '选谁？', pick: 'characters', within: 'meta.present' }]]); }}>+ 询问</K.Button>
      </div>
    </Field>
  );
}

function CreateCard({ spec, entry, onChange }: { spec: CreateSpec | undefined; entry: { path: string; label: string; type: string }[]; onChange: (v: CreateSpec | undefined) => void }) {
  const K = useKit();
  const ask = entry.filter(o => !o.path.includes('.') && ['string', 'enum', 'bool', 'int', 'number'].includes(o.type));
  const set = (p: Partial<CreateSpec>) => onChange(Object.fromEntries(Object.entries({ ...spec!, ...p }).filter(([, v]) => v !== undefined)) as unknown as CreateSpec);
  const fixed = Object.entries(spec?.set ?? {});
  return (
    <K.Card title="新增表单">
      <Field label="列表上方显示「新增」表单" hint="玩家填写后新建一项（如玩家确立的设定）">
        <K.Switch checked={!!spec} aria-label="新增表单" onCheckedChange={v => onChange(v ? { label: '新增', fields: ask.slice(0, 2).map(o => o.path) } : undefined)} />
      </Field>
      {spec ? <>
        <Field label="按钮文字"><TextInput label="按钮文字" value={spec.label} onCommit={v => set({ label: v || '新增' })} /></Field>
        <Field label="要填的字段" hint="按顺序"><div {...solve('builder-chips')} role="group" aria-label="要填的字段">
          {ask.map(o => <button type="button" key={o.path} aria-pressed={spec.fields.includes(o.path)} onClick={() => set({ fields: spec.fields.includes(o.path) ? spec.fields.filter(x => x !== o.path) : [...spec.fields, o.path] })}>{o.label}</button>)}
        </div></Field>
        <Field label="固定写入" hint="每次新增都带上的值，如 source = 玩家">
          <div {...solve('builder-cond')}>
            {fixed.map(([k, v], i) => (
              <div key={i} {...part('row')}>
                <PathInput label="字段" value={k} options={entry} onChange={nk => set({ set: Object.fromEntries(fixed.map((x, j) => j === i ? [nk ?? '', x[1]] : x).filter(([x]) => x)) })} />
                <input aria-label="值" defaultValue={typeof v === 'string' ? v : JSON.stringify(v)} onBlur={e => set({ set: Object.fromEntries(fixed.map((x, j) => j === i ? [x[0], e.target.value] : x)) })} />
                <button type="button" {...part('remove')} onClick={() => { const rest = fixed.filter((_, j) => j !== i); set({ set: rest.length ? Object.fromEntries(rest) : undefined }); }} aria-label="删除">×</button>
              </div>
            ))}
            <K.Button size="sm" variant="ghost" onClick={() => set({ set: { ...spec.set, [entry.find(o => !(o.path in (spec.set ?? {})))?.path ?? 'source']: '' } })}>+ 固定值</K.Button>
          </div>
        </Field>
        <Field label="告诉模型" hint="可用新条目的字段，如 {title}"><TextInput label="告诉模型" value={spec.narrate ?? ''} onCommit={v => set({ narrate: v.trim() || undefined })} /></Field>
      </> : null}
    </K.Card>
  );
}
export { nodeAt };
