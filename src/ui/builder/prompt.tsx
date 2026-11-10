/**
 * 结构制作 · 提示词（预览三）。写给模型的指南（总指南、模块指南、条件指南）、投影规则（数据里给模型看哪些）、轮次字段。
 * 右边是模型实际收到的内容：用当前聊天的数据，按草稿生成的指南和数据，带字数。
 */
import * as React from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useKit } from '../kit.js';
import { guide as guideText, toToon } from '../../projection.js';
import type { ProjectionRule } from '../../types.js';
import type { StructureDescription } from '../../structure.js';
import { Field, Select, TextInput, part, solve, useB } from './builder.js';
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
      <p {...part('intro')}>指南告诉模型怎么写操作；投影规则决定数据里给模型看哪些，省字数。模块关闭时它的指南和数据都不进提示词。</p>
      <K.Card title="总指南">
        <LongText label="总指南" rows={10} value={d.guide ?? ''} placeholder="写给模型：怎么用 <solve_operate> 更新变量、各字段怎么写…" onCommit={v => set({ ...d, guide: v.trim() ? v : undefined } as StructureDescription)} />
      </K.Card>
      <K.Card title="模块指南" meta={<small>模块开启时才加入</small>}>
        {modules.length ? modules.map(([k, m]) => (
          <Field key={k} label={m.label ?? k}><LongText label={`${m.label ?? k} 的指南`} rows={3} value={m.guide ?? ''} onCommit={v => set({ ...d, modules: { ...d.modules, [k]: { ...m, guide: v.trim() ? v : undefined } } })} /></Field>
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
  const [tab, setTab] = React.useState<'guide' | 'data'>('guide');
  const out = React.useMemo(() => {
    if (!def || !state) return undefined;
    try { return { guide: guideText(def, state), data: toToon(def, state) }; } catch (e: any) { return { error: e?.message ?? String(e) }; }
  }, [def, state]);
  const text = out && !('error' in out) ? (tab === 'guide' ? out.guide : out.data) : '';
  return (
    <section {...solve('builder-live')} aria-label="模型看到的内容">
      <header><b>模型看到的</b><small>{why ?? '当前聊天的数据，按草稿生成'}</small></header>
      {K.Segmented ? <K.Segmented label="内容" value={tab} onValueChange={v => setTab(v as 'guide' | 'data')} options={[{ value: 'guide', label: `指南${out && 'guide' in out ? ` · ${out.guide!.length} 字` : ''}` }, { value: 'data', label: `数据${out && 'data' in out ? ` · ${out.data!.length} 字` : ''}` }]} /> : null}
      {out && 'error' in out ? <p {...part('broken')}>生成出错：{out.error}</p> : <pre {...part('text')}>{text}</pre>}
    </section>
  );
}
