/**
 * 结构制作 · 开局数据（预览三）。新聊天的开局数据、预制实体（以自己的 ID 登场一次）和模板（新实体的底子），
 * 用操作台同款的树形编辑器；草稿检查会用开局数据初始化一遍，不符合结构时在顶部报错。
 */
import * as React from 'react';
import { JsonEditor, type ThemeStyles } from 'json-edit-react';
import { useKit } from '../kit.js';
import { useWide } from '../statusbar/widgets.js';
import { jerZh } from '../debug/console.js';
import type { Json } from '../../types.js';
import type { StructureDescription } from '../../structure.js';
import { entityTypes, KEY_RE } from './draft.js';
import { Field, Select, TextInput, part, solve, useB } from './builder.js';
import { pathOptions, useDraftModel, PathInput } from './common.js';

const THEME: ThemeStyles = {
  container: { backgroundColor: 'transparent', color: 'var(--k-on)', fontFamily: 'inherit', fontSize: 'var(--k-fs-sm)', padding: 0, maxWidth: '100%' },
  property: 'var(--k-on)', bracket: { color: 'var(--k-on-subtle)' }, itemCount: { color: 'var(--k-on-subtle)', fontStyle: 'normal' },
  string: 'var(--k-on-muted)', number: { color: 'var(--k-accent)', fontWeight: 600 }, boolean: 'var(--k-info)', null: { color: 'var(--k-on-subtle)' },
  input: { color: 'var(--k-on)', backgroundColor: 'var(--k-surface-1)', border: '1px solid var(--k-accent)', borderRadius: 'var(--k-r-sm)', fontFamily: 'inherit' },
  inputHighlight: 'var(--k-accent-soft)', error: { color: 'var(--k-danger)', fontSize: 'var(--k-fs-xs)' },
  iconCollection: 'var(--k-on-subtle)', iconEdit: 'var(--k-accent)', iconDelete: 'var(--k-danger)', iconAdd: 'var(--k-success)', iconCopy: 'var(--k-on-subtle)', iconOk: 'var(--k-success)', iconCancel: 'var(--k-danger)',
};
/** Tree editor for a JSON value (add / rename / delete / drag; long-press friendly on phones). */
function Tree({ value, onChange, name, collapse = 2 }: { value: Json; onChange: (v: Json) => void; name: string; collapse?: number }) {
  const [box, wide] = useWide(560);
  return (
    <div ref={box} {...solve('builder-tree-json')}>
      <JsonEditor data={value as any} setData={v => onChange(v as Json)} rootName={name} collapse={collapse} translations={jerZh as never} theme={THEME}
        indent={wide ? 2 : 1} minWidth="100%" maxWidth="100%" showIconTooltips stringTruncateLength={wide ? 80 : 36} showClipboardButton={wide} />
    </div>
  );
}

type Store = Record<string, { type: string; data: Json }>;
export function InitialPage() {
  const K = useKit(), { d, set, check, note } = useB();
  const { state } = useDraftModel();
  const errors = (check?.issues ?? []).filter(i => i.code === 'INITIAL_DATA');
  const data = (d.initialData ?? {}) as Json;
  const setData = (v: Json) => set({ ...d, initialData: v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length ? undefined : v } as StructureDescription);
  return (
    <div {...solve('builder-initial')}>
      <p {...part('intro')}>开局数据只影响新开的聊天。数据要符合结构，「检查与发布」会用它初始化一遍；预制实体和模板供模型在剧情里取用（$createEntity / $from）。</p>
      <K.Card title="开局数据" meta={errors.length ? <K.Badge tone="danger">不符合结构</K.Badge> : <small>新聊天的第一份状态</small>}>
        {errors.map((e, i) => <p key={i} {...part('error')} role="alert">{e.message}</p>)}
        <Tree name="开局" value={data} onChange={setData} />
        <div {...part('actions')}>
          {state ? <K.Button size="sm" onClick={() => { setData(JSON.parse(JSON.stringify(state.data))); note('已用当前聊天的数据作为开局（可撤销）'); }}>用当前聊天的数据作开局</K.Button> : null}
          <K.Button size="sm" variant="ghost" onClick={() => { setData({}); note('已清空开局数据（可撤销）'); }}>清空</K.Button>
        </div>
      </K.Card>
      <StoreCard title="预制实体" hint="以自己的 ID 登场一次，如固定的 NPC" value={(d.prefabs ?? {}) as Store} onChange={v => set({ ...d, prefabs: Object.keys(v).length ? v : undefined } as StructureDescription)} />
      <StoreCard title="模板" hint="新实体的底子，可以用很多次，如「狂信徒」" value={(d.templates ?? {}) as Store} onChange={v => set({ ...d, templates: Object.keys(v).length ? v : undefined } as StructureDescription)} />
      <K.Card title="其他">
        <Field label="轮次字段" hint="引擎维护；在「提示词」页也能改"><PathInput label="轮次字段" value={d.round} options={pathOptions(d, []).filter(o => o.type === 'int')} d={d} base={[]} onChange={v => set({ ...d, round: v } as StructureDescription)} /></Field>
      </K.Card>
    </div>
  );
}

function StoreCard({ title, hint, value, onChange }: { title: string; hint: string; value: Store; onChange: (v: Store) => void }) {
  const K = useKit(), { d, note } = useB();
  const { state } = useDraftModel();
  const types = entityTypes(d);
  const entries = Object.entries(value);
  const [open, setOpen] = React.useState<string | undefined>();
  const [copy, setCopy] = React.useState('');
  // Entities of the current chat, to copy one in as a starting point.
  const live = React.useMemo(() => {
    const out: { id: string; type: string; name: string; data: Json }[] = [];
    if (!state) return out;
    for (const t of types) {
      const coll = Object.entries(d.fields).find(([, n]) => n.entity === t)?.[0];
      const rec = coll ? (state.data as Record<string, any>)[coll] : undefined;
      if (rec && typeof rec === 'object') for (const [id, v] of Object.entries(rec)) out.push({ id, type: t, name: String((v as any)?.name ?? (v as any)?.title ?? id), data: v as Json });
    }
    return out;
  }, [state, d]); // eslint-disable-line react-hooks/exhaustive-deps
  const rename = (from: string, to: string) => onChange(Object.fromEntries(entries.map(([k, v]) => [k === from ? to : k, v])));
  return (
    <K.Card title={title} meta={<small>{entries.length} 个 · {hint}</small>}>
      <ul {...solve('builder-store')}>
        {entries.map(([id, x]) => (
          <li key={id}>
            <div {...part('head')}>
              <button type="button" {...part('twist')} onClick={() => setOpen(o => o === id ? undefined : id)} aria-expanded={open === id}>{open === id ? '▾' : '▸'}</button>
              <TextInput label="ID" mono value={id} validate={v => !KEY_RE.test(v) ? '英文字母、数字、下划线' : v !== id && Object.hasOwn(value, v) ? '重复' : undefined} onCommit={v => rename(id, v)} />
              <Select label="类型" value={x.type} options={types.map(t => [t, t] as [string, string])} onChange={t => onChange({ ...value, [id]: { ...x, type: t } })} />
              <small>{String((x.data as any)?.name ?? '')}</small>
              <button type="button" {...part('remove')} onClick={() => { const { [id]: _, ...rest } = value; onChange(rest); note(`已删除 ${id}（可撤销）`); }} aria-label={`删除 ${id}`}>×</button>
            </div>
            {open === id ? <Tree name={id} value={x.data} collapse={1} onChange={v => onChange({ ...value, [id]: { ...x, data: v } })} /> : null}
          </li>
        ))}
      </ul>
      <div {...part('actions')}>
        <K.Button size="sm" variant="ghost" onClick={() => { let id = 'new_entity', n = 2; while (Object.hasOwn(value, id)) id = 'new_entity' + n++; onChange({ ...value, [id]: { type: types[0] ?? 'character', data: { name: '新实体' } } }); setOpen(id); }}>+ 空白的</K.Button>
        {live.length ? (
          <select {...solve('builder-select')} value={copy} aria-label="从当前聊天复制" onChange={e => {
            const hit = live.find(l => l.type + ':' + l.id === e.target.value); setCopy('');
            if (!hit) return; let id = hit.id, n = 2; while (Object.hasOwn(value, id)) id = hit.id + n++;
            onChange({ ...value, [id]: { type: hit.type, data: JSON.parse(JSON.stringify(hit.data)) } }); setOpen(id); note(`已从当前聊天复制「${hit.name}」`);
          }}>
            <option value="" disabled>从当前聊天复制…</option>
            {types.map(t => <optgroup key={t} label={t}>{live.filter(l => l.type === t).map(l => <option key={l.id} value={t + ':' + l.id}>{l.name}（{l.id}）</option>)}</optgroup>)}
          </select>
        ) : null}
      </div>
    </K.Card>
  );
}
