/**
 * 结构制作 · 提示词。字段说明（写进「数据结构」，按模块分组）、写给模型的规则（总规则、模块规则、条件指南）、
 * 投影规则（数据里给模型看哪些）、轮次字段。
 * 右边是模型实际收到的内容：用当前聊天的数据，按草稿生成的数据结构、指南和数据，带字数。
 */
import * as React from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useKit } from '../kit.js';
import { guide as guideText, toToon } from '../../projection.js';
import { schemaText } from '../../schema-text.js';
import type { FieldNode } from '../../structure.js';
import type { ProjectionRule } from '../../types.js';
import type { StructureDescription } from '../../structure.js';
import { Field, Select, TextInput, nameOf, part, solve, useB } from './builder.js';
import { update, type Addr } from './draft.js';
import { PathInput, PathsInput, SortList, Split, collections, itemBase, pathOptions, useDraftModel } from './common.js';

/** Long text that commits on blur, with a character count. */
function LongText({ value, onCommit, label, rows = 8, placeholder }: { value: string; onCommit: (v: string) => void; label: string; rows?: number; placeholder?: string }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  return (
    <span {...solve('builder-long')}>
      <textarea value={v} rows={rows} aria-label={label} placeholder={placeholder} onChange={e => setV(e.target.value)} onBlur={() => { if (v !== value) onCommit(v); }} />
      <small>{v.length} 字{v !== value ? ' · 离开输入框后保存' : ''}</small>
    </span>
  );
}

type Guide = NonNullable<StructureDescription['guides']>[number];
const RULES: { kind: ProjectionRule['kind']; label: string; text: string }[] = [
  { kind: 'present', label: '在场的完整，其余精简', text: '集合里只有在场名单上的实体给完整信息，其余只保留几个字段' },
  { kind: 'related', label: '关系只留在场者之间的', text: '每个实体下的关系字典，只保留指向在场者的条目' },
  { kind: 'neighborhood', label: '地点只留附近的', text: '当前地点、它的上级和相连地点完整，其余只保留几个字段' },
  { kind: 'referenced', label: '只有被引用的完整', text: '被持有 / 被引用的实体完整，其余只保留几个字段（物品、能力）' },
];

export function PromptPage() {
  const K = useKit(), { d, set, note } = useB();
  const modules = Object.entries(d.modules ?? {});
  const guides: Guide[] = d.guides ?? [];
  const rules: ProjectionRule[] = d.projection ?? [];
  const setGuides = (g: Guide[]) => set({ ...d, guides: g.length ? g : undefined } as StructureDescription);
  const setRules = (r: ProjectionRule[]) => set({ ...d, projection: r.length ? r : undefined } as StructureDescription);
  const ints = pathOptions(d, []).filter(o => o.type === 'int');
  const editor = (
    <div {...solve('builder-prompt')}>
      <p {...part('intro')}>每个字段是什么、怎么填，写在字段说明里，SOLVE 自动整理成「数据结构」发给模型；跨好几个字段的规则写在总规则和模块规则里。投影规则决定数据里给模型看哪些，省字数。模块关闭时，它的字段、说明、规则和数据都不进提示词。</p>
      <FieldHints />
      <K.Card title="总规则" meta={<small>总是加入</small>}>
        <LongText label="总规则" rows={6} value={d.guide ?? ''} placeholder="跨字段的规则，如：先建实体再引用它；实体 ID 用简短英文" onCommit={v => set({ ...d, guide: v.trim() ? v : undefined } as StructureDescription)} />
      </K.Card>
      <K.Card title="模块规则" meta={<small>模块开启时才加入</small>}>
        {modules.length ? modules.map(([k, m]) => (
          <Field key={k} label={m.label ?? k}><LongText label={`${m.label ?? k} 的规则`} rows={3} value={m.guide ?? ''} onCommit={v => set({ ...d, modules: { ...d.modules, [k]: { ...m, guide: v.trim() ? v : undefined } } })} /></Field>
        )) : <p {...part('hint')}>还没有模块。</p>}
      </K.Card>
      <K.Card title="条件指南" meta={<small>满足条件时才加入</small>}>
        <SortList ids={guides} label="条件指南" keyOf={(g, i) => i + ':' + g.id} onMove={(a, b) => setGuides(arrayMove(guides, a, b))}
          render={(g, i, handle) => {
            const patch = (p: Partial<Guide>) => setGuides(guides.map((x, j) => j === i ? Object.fromEntries(Object.entries({ ...x, ...p }).filter(([, v]) => v !== undefined)) as Guide : x));
            return (
              <div {...solve('builder-guide')}>
                <div {...part('head')}>{handle}<TextInput label="规则名" mono value={g.id} validate={v => !v.trim() ? '不能为空' : guides.some((x, j) => j !== i && x.id === v.trim()) ? '重名' : undefined} onCommit={v => patch({ id: v.trim() })} />
                  <Select label="所属模块" value={g.module ?? ''} options={[['', '不限模块'], ...modules.map(([k, m]) => [k, m.label ?? k] as [string, string])]} onChange={v => patch({ module: v || undefined })} />
                  <button type="button" {...part('remove')} onClick={() => setGuides(guides.filter((_, j) => j !== i))} aria-label={`删除 ${g.id}`}>×</button></div>
                <Field label="条件" hint={'如 meta.weather == "暴雨" && meta.round > 3；可用 == != < > <= >= && || ! 和括号；不写就总是加入'}>
                  <TextInput label="条件" mono value={g.when ?? ''} placeholder="总是" onCommit={v => patch({ when: v.trim() || undefined })} />
                </Field>
                <Field label="内容"><LongText label={`${g.id} 的内容`} rows={3} value={g.text} onCommit={v => patch({ text: v })} /></Field>
              </div>
            );
          }} />
        <K.Button size="sm" variant="ghost" onClick={() => { let id = 'rule', n = 2; while (guides.some(g => g.id === id)) id = 'rule' + n++; setGuides([...guides, { id, text: '' }]); }}>+ 条件指南</K.Button>
      </K.Card>
      <K.Card title="投影规则" meta={<small>只影响给模型看的数据，不改存档</small>}>
        <SortList ids={rules} label="投影规则" keyOf={(r, i) => i + ':' + r.kind} onMove={(a, b) => setRules(arrayMove(rules, a, b))}
          render={(r, i, handle) => <RuleCard rule={r} handle={handle} onChange={nr => setRules(rules.map((x, j) => j === i ? nr : x))} onRemove={() => { setRules(rules.filter((_, j) => j !== i)); note('已删除投影规则（可撤销）'); }} />} />
        <select {...solve('builder-select')} value="" aria-label="添加投影规则" onChange={e => {
          const kind = e.target.value as ProjectionRule['kind'], c = collections(d)[0]?.key ?? '';
          const r: ProjectionRule = kind === 'present' ? { kind, collection: c, list: '', keep: [] } : kind === 'related' ? { kind, path: '', collection: c, list: '' }
            : kind === 'neighborhood' ? { kind, collection: c, current: '', keep: [] } : { kind, collection: c, from: [], keep: [] };
          setRules([...rules, r]);
        }}><option value="" disabled>+ 投影规则…</option>{RULES.map(r => <option key={r.kind} value={r.kind}>{r.label}</option>)}</select>
      </K.Card>
      <K.Card title="轮次字段">
        <Field label="引擎维护的轮次" hint="每次模型回复后自动加一，模型不能改"><PathInput label="轮次字段" value={d.round} options={ints} d={d} base={[]} onChange={v => set({ ...d, round: v } as StructureDescription)} /></Field>
      </K.Card>
    </div>
  );
  return <Split previewLabel="模型看到的" editor={editor} preview={<PromptPreview />} />;
}

function RuleCard({ rule, handle, onChange, onRemove }: { rule: ProjectionRule; handle: React.ReactNode; onChange: (r: ProjectionRule) => void; onRemove: () => void }) {
  const { d } = useB();
  const info = RULES.find(r => r.kind === rule.kind)!;
  const r = rule as Record<string, any>;
  const patch = (p: Record<string, any>) => onChange(Object.fromEntries(Object.entries({ ...r, ...p }).filter(([, v]) => v !== undefined)) as ProjectionRule);
  const colls = collections(d), base = itemBase(r.collection), rel = pathOptions(d, base), abs = pathOptions(d, []);
  const coll = <Field label="集合"><Select label="集合" value={r.collection ?? ''} options={colls.map(c => [c.key, c.label] as [string, string])} onChange={v => patch({ collection: v })} /></Field>;
  const keep = <Field label="其余保留" hint="不完整的实体只留这些字段"><PathsInput label="保留字段" value={r.keep} options={rel} d={d} base={base} onChange={v => patch({ keep: v ?? [] })} /></Field>;
  const always = (
    <Field label="总是完整" hint="满足条件的实体总是给完整信息（如玩家角色）">
      <div {...part('pair')}>
        <PathInput label="字段" value={r.always?.field} options={rel} d={d} base={base} onChange={v => patch({ always: v ? { field: v, equals: r.always?.equals ?? '' } : undefined })} />
        <TextInput label="等于" value={String(r.always?.equals ?? '')} onCommit={v => patch({ always: r.always ? { ...r.always, equals: v } : undefined })} />
      </div>
    </Field>
  );
  return (
    <div {...solve('builder-rule')}>
      <div {...part('head')}>{handle}<b>{info.label}</b><button type="button" {...part('remove')} onClick={onRemove} aria-label={`删除规则 ${info.label}`}>×</button></div>
      <p {...part('hint')}>{info.text}</p>
      {rule.kind === 'present' ? <>{coll}<Field label="在场名单"><PathInput label="在场名单" value={r.list} options={abs} d={d} base={[]} onChange={v => patch({ list: v ?? '' })} /></Field>{keep}{always}</>
        : rule.kind === 'related' ? <>
          <Field label="关系字典" hint="如 characters.*.relations"><PathInput label="关系字典" value={r.path} options={pathOptions(d, [], true).filter(o => o.type === 'record' && o.path.includes('*'))} onChange={v => patch({ path: v ?? '' })} /></Field>
          {coll}<Field label="在场名单"><PathInput label="在场名单" value={r.list} options={abs} d={d} base={[]} onChange={v => patch({ list: v ?? '' })} /></Field>{always}
        </> : rule.kind === 'neighborhood' ? <>
          {coll}<Field label="当前地点"><PathInput label="当前地点" value={r.current} options={abs} d={d} base={[]} onChange={v => patch({ current: v ?? '' })} /></Field>
          <Field label="上级字段"><PathInput label="上级字段" value={r.parent} options={rel} d={d} base={base} onChange={v => patch({ parent: v })} /></Field>
          <Field label="相连字段"><PathInput label="相连字段" value={r.links} options={rel} d={d} base={base} onChange={v => patch({ links: v })} /></Field>{keep}
        </> : <>
          {coll}<Field label="被谁引用" hint="如 characters.*.items"><PathsInput label="被谁引用" value={r.from} options={pathOptions(d, [], true).filter(o => o.path.includes('*'))} onChange={v => patch({ from: v ?? [] })} /></Field>{keep}
        </>}
    </div>
  );
}

function PromptPreview() {
  const K = useKit();
  const { def, state, why } = useDraftModel();
  const [tab, setTab] = React.useState<'schema' | 'guide' | 'data'>('schema');
  const out = React.useMemo((): Record<'schema' | 'guide' | 'data', string> | { error: string } | undefined => {
    if (!def || !state) return undefined;
    try { return { schema: schemaText(def, state), guide: guideText(def, state), data: toToon(def, state) }; } catch (e: any) { return { error: e?.message ?? String(e) }; }
  }, [def, state]);
  const ok = out && !('error' in out) ? out : undefined;
  const text = ok ? ok[tab] : '';
  const tabs = ([['schema', '数据结构'], ['guide', '规则'], ['data', '数据']] as const).map(([value, label]) => ({ value, label: `${label}${ok ? ` · ${ok[value].length} 字` : ''}` }));
  return (
    <section {...solve('builder-live')} aria-label="模型看到的内容">
      <header><b>模型看到的</b><small>{why ?? '当前聊天的数据，按草稿生成'}</small></header>
      {K.Segmented ? <K.Segmented label="内容" value={tab} onValueChange={v => setTab(v as typeof tab)} options={tabs} /> : null}
      {out && 'error' in out ? <p {...part('broken')}>生成出错：{out.error}</p> : <pre {...part('text')}>{text}</pre>}
    </section>
  );
}

/** Every field the model can write, grouped by the module that owns it, with its 给模型的说明 (hint). */
interface HintRow { addr: Addr; path: string; name: string; node: FieldNode; depth: number }
function hintRows(d: StructureDescription): { module: string; rows: HintRow[] }[] {
  const groups = new Map<string, HintRow[]>();
  const walk = (node: FieldNode, addr: Addr, names: string[], module: string, parent: FieldNode | undefined) => {
    for (const [key, child] of node.fields ? Object.entries(node.fields) : node.of ? [['*', node.of] as const] : []) {
      const a = [...addr, key];
      // Not the model's to write: media, engine-kept fields.
      if (child.readonly || child.internal || a.join('.') === d.round) continue;
      const own = Array.isArray(child.module) ? child.module.at(-1)! : child.module ?? module;
      const name = nameOf(child, key, node);
      const label = key === '*' ? names : [...names, name];
      if (key !== '*') {
        const list = groups.get(own) ?? []; groups.set(own, list);
        list.push({ addr: a, path: a.join('.'), name: label.join(' › '), node: child, depth: a.filter(k => k !== '*').length - 1 });
      }
      walk(child, a, label, own, node);
    }
    void parent;
  };
  walk({ type: 'object', fields: d.fields }, [], [], '', undefined);
  return [...groups].map(([module, rows]) => ({ module, rows }));
}
function FieldHints() {
  const K = useKit(), { d, set } = useB();
  const groups = React.useMemo(() => hintRows(d), [d]);
  const [q, setQ] = React.useState('');
  const [onlyEmpty, setOnlyEmpty] = React.useState(false);
  const total = groups.reduce((n, g) => n + g.rows.length, 0), written = groups.reduce((n, g) => n + g.rows.filter(r => r.node.hint || r.node.desc).length, 0);
  const query = q.trim().toLowerCase();
  const show = (r: HintRow) => (!onlyEmpty || !(r.node.hint || r.node.desc)) && (!query || r.name.toLowerCase().includes(query) || r.path.toLowerCase().includes(query));
  return (
    <K.Card title="字段说明" meta={<small>{written} / {total} 个字段写了说明</small>}>
      <div {...solve('builder-hints')}>
        <div {...part('tools')}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索字段" aria-label="搜索字段说明" />
          <label><input type="checkbox" checked={onlyEmpty} onChange={e => setOnlyEmpty(e.target.checked)} /> 只看没写的</label>
        </div>
        {groups.map(g => {
          const rows = g.rows.filter(show);
          if (!rows.length) return null;
          const label = g.module ? d.modules?.[g.module]?.label ?? g.module : '通用';
          return (
            <section key={g.module || '-'} {...part('group')} aria-label={`${label}的字段说明`}>
              <h5>{label}{g.module ? <small>模块关闭时这些字段和说明都不发给模型</small> : <small>总是发给模型</small>}</h5>
              {rows.map(r => (
                <div key={r.path} {...part('row')} style={{ '--depth': Math.min(r.depth, 4) } as React.CSSProperties}>
                  <span {...part('name')}><b>{r.name}</b><code>{r.path.replace(/\.\*/gu, '.<ID>')}</code></span>
                  <TextInput label={`${r.name} 给模型的说明`} value={r.node.hint ?? ''} placeholder={r.node.desc ? `用给玩家的说明：${r.node.desc}` : '不写就只给键名和类型'}
                    onCommit={v => set(update(d, r.addr, { hint: v.trim() || undefined }))} />
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </K.Card>
  );
}
