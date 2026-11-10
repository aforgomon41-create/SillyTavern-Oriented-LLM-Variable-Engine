/**
 * 结构制作 · 状态栏布局（预览二）。左边是大纲（横条 · 页签 · 区块，拖动排序），中间是选中项的设置，右边是按草稿实时渲染的状态栏。
 * 布局写在 display 里，不进指纹：改了立即对所有聊天生效。
 */
import * as React from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useKit } from '../kit.js';
import { useWide } from '../statusbar/widgets.js';
import type { StructureDescription } from '../../structure.js';
import { Field, Select, TextInput, part, solve, useB } from './builder.js';
import { CondEditor, JsonBox, LiveStatus, PathInput, PathsInput, SortList, Split, collections, itemBase, pathOptions } from './common.js';

type Item = Record<string, any>;
type Tab = { tab: string; module?: string; items: (Item | string)[] };
type Sel = { kind: 'bar' } | { kind: 'general' } | { kind: 'tab'; t: number } | { kind: 'item'; t: number; i: number };

type PropKind = 'text' | 'bool' | 'abs' | 'rel' | 'rels' | 'select' | 'pages' | 'json' | 'aside' | 'module' | 'collection' | 'entityType' | 'holders';
interface Prop { key: string; label: string; hint?: string; kind: PropKind; options?: [string, string][]; deep?: boolean }
interface Kind { id: string; label: string; icon: string; main: string; mainLabel: string; mainKind: 'collection' | 'abs' | 'codex'; text: string; props: Prop[]; make: (d: StructureDescription) => Item }
const firstColl = (d: StructureDescription, prefer: string[]) => prefer.find(k => d.fields[k]?.type === 'record') ?? collections(d)[0]?.key ?? '';
const PAGES: Prop = { key: 'pages', label: '分页', hint: '展开后的小页签：每页显示哪些字段', kind: 'pages' };
export const KINDS: Kind[] = [
  { id: 'sheet', label: '角色卡', icon: '👤', main: 'sheet', mainLabel: '实体集合', mainKind: 'collection', text: '一个实体（通常是玩家角色）的整张卡：头部、量表、状态、货币和分页',
    make: d => ({ sheet: firstColl(d, ['characters']), id: '$user', pages: [{ label: '概况', paths: [] }] }),
    props: [
      { key: 'id', label: '哪个实体', hint: '$user = 玩家角色；也可以写实体 ID', kind: 'text' },
      { key: 'subtitle', label: '副标题', kind: 'rel' }, { key: 'badges', label: '徽章', kind: 'rels' }, { key: 'tags', label: '标签', kind: 'rel' },
      { key: 'vitals', label: '量表', hint: '多条时显示第一条开启的（数值 / 描述两种模式）', kind: 'rels' }, { key: 'status', label: '当前状态', kind: 'rel' },
      { key: 'effects', label: '效果', kind: 'rel' }, { key: 'currency', label: '货币来源', hint: '指向持有物（如 items）', kind: 'rel' },
      { key: 'currencyType', label: '算作货币的物品类型', kind: 'text' }, PAGES,
    ] },
  { id: 'list', label: '实体列表', icon: '☰', main: 'list', mainLabel: '列出哪个集合', mainKind: 'collection', text: '手机上是折叠卡片，电脑上左边目录、右边打开的条目',
    make: d => ({ list: firstColl(d, ['characters']), search: true }),
    props: [
      { key: 'title', label: '标题', kind: 'text' },
      { key: 'exclude', label: '排除', kind: 'select', options: [['', '不排除'], ['$user', '排除玩家角色']] },
      { key: 'present', label: '在场名单', hint: '在场的排在前面并加标记', kind: 'abs' },
      { key: 'order', label: '排序依据', hint: '按这个选项字段的声明顺序', kind: 'rel' }, { key: 'group', label: '分组依据', hint: '选项字段：加分类筛选与分组标题', kind: 'rel' },
      { key: 'badges', label: '徽章', kind: 'rels' }, { key: 'score', label: '分数', hint: '如 relations.$user.affection', kind: 'rel', deep: true },
      { key: 'scoreLabel', label: '分数前缀', kind: 'text' }, { key: 'search', label: '显示搜索框', kind: 'bool' },
      { key: 'wide', label: '电脑上', kind: 'select', options: [['', '左边目录、右边条目'], ['stack', '也用折叠卡片']] },
      { key: 'hide', label: '详情里不显示', kind: 'rels' }, { key: 'aside', label: '概况栏', hint: '电脑上在立绘下方，手机上作为第一页', kind: 'aside' },
      { key: 'backrefs', label: '反向引用', hint: '[{ collection, field, label }]：卡片底部列出引用了它的条目', kind: 'json' }, PAGES,
    ] },
  { id: 'graph', label: '关系图', icon: '⟁', main: 'graph', mainLabel: '画哪个集合', mainKind: 'collection', text: '力导向关系图，默认折叠',
    make: d => ({ graph: firstColl(d, ['characters']), title: '关系图' }),
    props: [
      { key: 'title', label: '标题', kind: 'text' }, { key: 'module', label: '所属模块', kind: 'module' },
      { key: 'edges', label: '连线来自', hint: '每个实体下的关系字典（如 relations）', kind: 'rel' },
      { key: 'weight', label: '粗细依据', kind: 'rel', deep: true }, { key: 'label', label: '线上文字', kind: 'rel', deep: true }, { key: 'tone', label: '颜色依据', kind: 'rel', deep: true },
      { key: 'tones', label: '颜色映射', hint: '{ 值: positive | negative | neutral | info }', kind: 'json' },
      { key: 'size', label: '节点大小依据', kind: 'rel' }, { key: 'present', label: '在场名单', kind: 'abs' }, { key: 'badges', label: '徽章', kind: 'rels' },
      { key: 'legend', label: '图例', hint: '{ positive: "友好", … }', kind: 'json' },
    ] },
  { id: 'map', label: '地图', icon: '⌖', main: 'map', mainLabel: '地点集合', mainKind: 'collection', text: '力导向地图；有下属地点的区域画成范围',
    make: d => ({ map: firstColl(d, ['places']) }),
    props: [
      { key: 'current', label: '当前地点', kind: 'abs' }, { key: 'parent', label: '上级地点字段', kind: 'rel' }, { key: 'links', label: '相连字段', kind: 'rel' },
      { key: 'discovered', label: '已发现字段', kind: 'rel' }, { key: 'backrefs', label: '反向引用', kind: 'json' },
    ] },
  { id: 'codex', label: '图鉴', icon: '❖', main: 'codex', mainLabel: '分类', mainKind: 'codex', text: '浏览实例（物品、能力…）或预制实体与模板', make: d => ({ codex: [{ label: d.fields[firstColl(d, ['items'])]?.label ?? '图鉴', collection: firstColl(d, ['items']) }] }), props: [] },
  { id: 'path', label: '字段区', icon: '▤', main: 'path', mainLabel: '显示哪个字段', mainKind: 'abs', text: '把一个字段（或一组字段）按默认方式显示', make: d => ({ path: Object.keys(d.fields)[0] ?? '' }), props: [] },
];
const kindOf = (item: Item | string): Kind => typeof item === 'string' ? KINDS.find(k => k.id === 'path')! : KINDS.find(k => item[k.main] !== undefined) ?? KINDS.find(k => k.id === 'path')!;
const clean = (o: Item): Item => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)));

export function LayoutPage() {
  const K = useKit(), { d, set, note } = useB();
  const display = (d.display ?? {}) as Record<string, any>;
  const tabs: Tab[] = Array.isArray(display.layout) ? display.layout : [];
  const [sel, setSel] = React.useState<Sel>(tabs.length ? { kind: 'tab', t: 0 } : { kind: 'bar' });
  const [box, roomy] = useWide(600);
  const setDisplay = (patch: Record<string, any>) => set({ ...d, display: clean({ ...display, ...patch }) as StructureDescription['display'] });
  const setTabs = (next: Tab[]) => setDisplay({ layout: next });
  const patchTab = (t: number, p: Partial<Tab>) => setTabs(tabs.map((x, j) => j === t ? clean({ ...x, ...p }) as Tab : x));
  const patchItem = (t: number, i: number, item: Item | string) => patchTab(t, { items: tabs[t]!.items.map((x, j) => j === i ? item : x) });
  const tabName = sel.kind === 'tab' || sel.kind === 'item' ? tabs[sel.t]?.tab : undefined;
  const [adding, setAdding] = React.useState<number | undefined>();

  const outline = (
    <nav {...solve('builder-outline')} aria-label="布局大纲">
      <button type="button" {...part('node')} aria-current={sel.kind === 'bar' ? 'true' : undefined} onClick={() => setSel({ kind: 'bar' })}>
        <i>▭</i><span>顶部横条</span><small>{([] as unknown[]).concat(display.bar ?? []).length} 项</small>
      </button>
      <h4>页签</h4>
      <SortList ids={tabs} label="页签" keyOf={(x, i) => i + ':' + x.tab} onMove={(a, b) => { setTabs(arrayMove(tabs, a, b)); setSel({ kind: 'tab', t: b }); }}
        render={(tab, t, handle) => (
          <div {...part('tab')} data-open={tabName === tab.tab ? '' : undefined}>
            <div {...part('row')}>
              {handle}
              <button type="button" {...part('node')} aria-current={sel.kind === 'tab' && sel.t === t ? 'true' : undefined} onClick={() => setSel({ kind: 'tab', t })}>
                <b>{tab.tab}</b>{tab.module ? <small {...part('mod')}>{d.modules?.[tab.module]?.label ?? tab.module}</small> : null}<small>{tab.items.length} 个区块</small>
              </button>
            </div>
            {tabName === tab.tab ? (
              <div {...part('items')}>
                <SortList ids={tab.items} label={`「${tab.tab}」的区块`} keyOf={(x, i) => i + ':' + kindOf(x).id}
                  onMove={(a, b) => { patchTab(t, { items: arrayMove(tab.items, a, b) }); setSel({ kind: 'item', t, i: b }); }}
                  render={(item, i, h) => {
                    const k = kindOf(item), main = typeof item === 'string' ? item : item[k.main];
                    return (
                      <div {...part('row')}>
                        {h}
                        <button type="button" {...part('node')} data-item="" aria-current={sel.kind === 'item' && sel.t === t && sel.i === i ? 'true' : undefined} onClick={() => setSel({ kind: 'item', t, i })}>
                          <i aria-hidden="true">{k.icon}</i><span>{typeof item !== 'string' && item.title ? item.title : k.label}</span>
                          <small>{k.mainKind === 'codex' ? `${(main as unknown[]).length} 类` : String(main ?? '')}</small>
                          {typeof item !== 'string' && item.render === false ? <small {...part('mod')}>不渲染</small> : null}
                        </button>
                      </div>
                    );
                  }} />
                {adding === t ? (
                  <div {...solve('builder-kinds')} role="menu" aria-label="选择区块类型">
                    {KINDS.map(k => (
                      <button type="button" role="menuitem" key={k.id} onClick={() => { patchTab(t, { items: [...tab.items, k.make(d)] }); setSel({ kind: 'item', t, i: tab.items.length }); setAdding(undefined); note(`已添加「${k.label}」`); }}>
                        <i aria-hidden="true">{k.icon}</i><b>{k.label}</b><small>{k.text}</small>
                      </button>
                    ))}
                    <K.Button size="sm" variant="ghost" onClick={() => setAdding(undefined)}>取消</K.Button>
                  </div>
                ) : <K.Button size="sm" variant="ghost" onClick={() => setAdding(t)}>+ 区块</K.Button>}
              </div>
            ) : null}
          </div>
        )} />
      <K.Button size="sm" variant="ghost" onClick={() => {
        let name = '新页签', n = 2; while (tabs.some(x => x.tab === name)) name = `新页签 ${n++}`;
        setTabs([...tabs, { tab: name, items: [] }]); setSel({ kind: 'tab', t: tabs.length }); note('已添加页签');
      }}>+ 页签</K.Button>
      <h4>其他</h4>
      <button type="button" {...part('node')} aria-current={sel.kind === 'general' ? 'true' : undefined} onClick={() => setSel({ kind: 'general' })}><i>⚙</i><span>渲染与剧透</span></button>
    </nav>
  );

  const form = sel.kind === 'bar' ? <BarForm display={display} setDisplay={setDisplay} />
    : sel.kind === 'general' ? <GeneralForm display={display} setDisplay={setDisplay} />
    : sel.kind === 'tab' && tabs[sel.t] ? <TabForm tab={tabs[sel.t]!} tabs={tabs} onChange={p => patchTab(sel.t, p)} onRemove={() => { setTabs(tabs.filter((_, j) => j !== sel.t)); setSel(tabs.length > 1 ? { kind: 'tab', t: Math.max(0, sel.t - 1) } : { kind: 'bar' }); note('已删除页签（可撤销）'); }} />
    : sel.kind === 'item' && tabs[sel.t]?.items[sel.i] !== undefined ? (
      <ItemForm item={tabs[sel.t]!.items[sel.i]!} tabs={tabs} t={sel.t} onChange={it => patchItem(sel.t, sel.i, it)}
        onMove={to => { const it = tabs[sel.t]!.items[sel.i]!; const next = tabs.map((x, j) => j === sel.t ? { ...x, items: x.items.filter((_, k) => k !== sel.i) } : j === to ? { ...x, items: [...x.items, it] } : x); setTabs(next); setSel({ kind: 'item', t: to, i: next[to]!.items.length - 1 }); note(`已移到「${tabs[to]!.tab}」`); }}
        onRemove={() => { patchTab(sel.t, { items: tabs[sel.t]!.items.filter((_, j) => j !== sel.i) }); setSel({ kind: 'tab', t: sel.t }); note('已删除区块（可撤销）'); }} />
    ) : <p {...part('hint')}>在左边选一项。</p>;

  return (
    <Split previewLabel="状态栏预览" editor={
      <div ref={box} {...solve('builder-layout', { layout: roomy ? 'side' : 'stack' })}>
        <p {...part('intro')}>布局只影响显示，不进结构指纹：发布后所有聊天立即生效。拖 ⠿ 调整页签和区块的顺序。</p>
        <div {...part('cols')}>{outline}<div {...part('form')}>{form}</div></div>
      </div>
    } preview={<LiveStatus {...(tabName ? { tab: tabName } : {})} onTab={name => { const t = tabs.findIndex(x => x.tab === name); if (t >= 0) setSel({ kind: 'tab', t }); }} />} />
  );
}

// ── forms ──

function BarForm({ display, setDisplay }: { display: Record<string, any>; setDisplay: (p: Record<string, any>) => void }) {
  const K = useKit(), { d } = useB();
  const bar = ([] as unknown[]).concat(display.bar ?? []);
  const simple = bar.every(x => typeof x === 'string');
  return (
    <K.Card title="顶部横条">
      <p {...part('hint')}>收起时浮在聊天上的那一条，也是展开后面板的标题栏。手机上只显示前三项。可以写 $user.字段 指玩家角色。</p>
      {simple ? <PathsInput label="横条字段" value={bar as string[]} options={pathOptions(d, [])} d={d} base={[]} onChange={v => setDisplay({ bar: v })} />
        : <JsonBox label="横条（含高级写法）" value={bar} onChange={v => setDisplay({ bar: v })} />}
    </K.Card>
  );
}
function GeneralForm({ display, setDisplay }: { display: Record<string, any>; setDisplay: (p: Record<string, any>) => void }) {
  const K = useKit(), { d } = useB();
  const ex = display.spoilerExempt as { collection?: string; field?: string; equals?: unknown } | undefined;
  const colls = collections(d);
  return (
    <>
      <K.Card title="自动渲染">
        <Field label="由 SOLVE 渲染状态栏" hint="关闭后不显示状态栏，作者自己渲染；数据和接口照常提供">
          <K.Switch checked={display.render !== false} aria-label="自动渲染" onCheckedChange={v => setDisplay({ render: v ? undefined : false })} />
        </Field>
      </K.Card>
      <K.Card title="不受剧透遮挡的实体">
        <p {...part('hint')}>满足条件的实体，标了剧透的字段也直接显示（官方结构：玩家角色）。</p>
        <Field label="集合"><Select label="集合" value={ex?.collection ?? ''} options={[['', '（不设置）'], ...colls.map(c => [c.key, c.label] as [string, string])]}
          onChange={v => setDisplay({ spoilerExempt: v ? { ...ex, collection: v } : undefined })} /></Field>
        {ex?.collection ? <>
          <Field label="字段"><PathInput label="字段" value={ex.field} options={pathOptions(d, itemBase(ex.collection))} d={d} base={itemBase(ex.collection)} onChange={v => setDisplay({ spoilerExempt: { ...ex, field: v } })} /></Field>
          <Field label="等于"><TextInput label="等于" value={String(ex.equals ?? '')} onCommit={v => setDisplay({ spoilerExempt: { ...ex, equals: v } })} /></Field>
        </> : null}
      </K.Card>
    </>
  );
}
function TabForm({ tab, tabs, onChange, onRemove }: { tab: Tab; tabs: Tab[]; onChange: (p: Partial<Tab>) => void; onRemove: () => void }) {
  const K = useKit(), { d } = useB();
  return (
    <K.Card title={`页签 · ${tab.tab}`}>
      <Field label="名字"><TextInput label="页签名字" value={tab.tab} validate={v => !v.trim() ? '不能为空' : tabs.some(x => x !== tab && x.tab === v.trim()) ? '已经有这个页签' : undefined} onCommit={v => onChange({ tab: v.trim() })} /></Field>
      <Field label="所属模块" hint="模块关闭时整个页签不显示"><Select label="所属模块" value={tab.module ?? ''} options={[['', '始终显示'], ...Object.entries(d.modules ?? {}).map(([k, m]) => [k, m.label ?? k] as [string, string])]} onChange={v => onChange({ module: v || undefined })} /></Field>
      <div {...part('actions')}><K.Button size="sm" variant="danger" onClick={onRemove}>删除页签</K.Button><small>{tab.items.length} 个区块一起删除，可撤销</small></div>
    </K.Card>
  );
}
function ItemForm({ item, tabs, t, onChange, onMove, onRemove }: { item: Item | string; tabs: Tab[]; t: number; onChange: (it: Item | string) => void; onMove: (to: number) => void; onRemove: () => void }) {
  const K = useKit(), { d } = useB();
  const k = kindOf(item);
  const obj: Item = typeof item === 'string' ? { path: item } : item;
  const patch = (p: Item) => onChange(clean({ ...obj, ...p }));
  const main = obj[k.main];
  const base = k.mainKind === 'collection' ? itemBase(main) : [];
  const colls = collections(d);
  return (
    <>
      <K.Card title={<span {...part('kind')}><i aria-hidden="true">{k.icon}</i>{k.label}</span>}>
        <p {...part('hint')}>{k.text}</p>
        {k.mainKind === 'collection' ? (
          <Field label={k.mainLabel}><Select label={k.mainLabel} value={main ?? ''} options={colls.map(c => [c.key, c.label + (c.entity ? '' : '（字典）')] as [string, string])} onChange={v => patch({ [k.main]: v })} /></Field>
        ) : k.mainKind === 'abs' ? (
          <Field label={k.mainLabel}><PathInput label={k.mainLabel} value={main} options={pathOptions(d, [])} d={d} base={[]} onChange={v => patch({ [k.main]: v ?? '' })} /></Field>
        ) : null}
        {k.props.map(p => <PropRow key={p.key} p={p} value={obj[p.key]} base={base} onChange={v => patch({ [p.key]: v })} />)}
        <Field label="自动渲染" hint="关闭后留出挂载点，由作者自己渲染这一块"><K.Switch checked={obj.render !== false} aria-label="自动渲染" onCheckedChange={v => patch({ render: v ? undefined : false })} /></Field>
      </K.Card>
      {k.mainKind === 'codex' ? <CodexEditor value={main ?? []} onChange={v => patch({ codex: v })} /> : null}
      <K.CollapseCard title="JSON（高级）" meta={<small>这个区块的完整声明</small>}><JsonBox label="区块 JSON" rows={14} value={obj} onChange={v => onChange(v as Item)} validate={v => !v || typeof v !== 'object' ? '需要一个对象' : undefined} /></K.CollapseCard>
      <K.Card title="整理">
        <div {...part('actions')}>
          {tabs.length > 1 ? <select {...solve('builder-select')} value="" aria-label="移到页签" onChange={e => onMove(Number(e.target.value))}>
            <option value="" disabled>移到页签…</option>{tabs.map((x, j) => j === t ? null : <option key={j} value={j}>{x.tab}</option>)}
          </select> : null}
          <K.Button size="sm" variant="danger" onClick={onRemove}>删除区块</K.Button>
        </div>
      </K.Card>
    </>
  );
}
function PropRow({ p, value, base, onChange }: { p: Prop; value: any; base: string[]; onChange: (v: any) => void }) {
  const K = useKit(), { d } = useB();
  const rel = pathOptions(d, base, p.deep);
  const control = (() => {
    switch (p.kind) {
      case 'text': return <TextInput label={p.label} value={value === undefined ? '' : String(value)} onCommit={v => onChange(v.trim() || undefined)} />;
      case 'bool': return <K.Switch checked={!!value} aria-label={p.label} onCheckedChange={v => onChange(v || undefined)} />;
      case 'select': return <Select label={p.label} value={value ?? ''} options={p.options!} onChange={v => onChange(v || undefined)} />;
      case 'module': return <Select label={p.label} value={value ?? ''} options={[['', '始终显示'], ...Object.entries(d.modules ?? {}).map(([k, m]) => [k, m.label ?? k] as [string, string])]} onChange={v => onChange(v || undefined)} />;
      case 'abs': return <PathInput label={p.label} value={value} options={pathOptions(d, [])} d={d} base={[]} onChange={onChange} />;
      case 'rel': return <PathInput label={p.label} value={value} options={rel} d={d} base={base} onChange={onChange} />;
      case 'rels': return <PathsInput label={p.label} value={value} options={rel} d={d} base={base} onChange={onChange} />;
      case 'pages': return <PagesEditor value={value ?? []} base={base} onChange={v => onChange(v.length ? v : undefined)} />;
      case 'aside': return (
        <div {...solve('builder-aside')}>
          <TextInput label="概况栏标题" placeholder="标题（如：概况）" value={value?.label ?? ''} onCommit={v => onChange(v.trim() || value?.paths?.length ? { ...value, label: v.trim() || '概况' } : undefined)} />
          <PathsInput label="概况栏字段" value={value?.paths} options={rel} d={d} base={base} onChange={v => onChange(v ? { label: value?.label ?? '概况', paths: v } : undefined)} />
        </div>
      );
      case 'json': return <JsonBox label={p.label} value={value} onChange={onChange} />;
      default: return null;
    }
  })();
  return <Field label={p.label} {...(p.hint ? { hint: p.hint } : {})}>{control}</Field>;
}
const AS: [string, string][] = [['', '默认'], ['quests', '任务日志'], ['inventory', '背包'], ['abilities', '能力']];
function PagesEditor({ value, base, onChange }: { value: { label: string; paths: string[]; as?: string }[]; base: string[]; onChange: (v: { label: string; paths: string[]; as?: string }[]) => void }) {
  const K = useKit(), { d } = useB();
  const rel = pathOptions(d, base, true);
  const set = (i: number, p: Partial<{ label: string; paths: string[]; as?: string }>) => onChange(value.map((x, j) => j === i ? clean({ ...x, ...p }) as typeof x : x));
  return (
    <div {...solve('builder-pages')}>
      <SortList ids={value} label="分页" keyOf={(x, i) => i + ':' + x.label} onMove={(a, b) => onChange(arrayMove(value, a, b))}
        render={(pg, i, handle) => (
          <div {...part('page')}>
            <div {...part('head')}>{handle}<TextInput label="分页名" value={pg.label} onCommit={v => set(i, { label: v.trim() || pg.label })} />
              <Select label="显示为" value={pg.as ?? ''} options={AS} onChange={v => set(i, { as: v || undefined })} />
              <button type="button" {...part('remove')} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`删除分页 ${pg.label}`}>×</button></div>
            <PathsInput label={`分页「${pg.label}」的字段`} value={pg.paths} options={rel} d={d} base={base} onChange={v => set(i, { paths: v ?? [] })} />
          </div>
        )} />
      <K.Button size="sm" variant="ghost" onClick={() => onChange([...value, { label: `第 ${value.length + 1} 页`, paths: [] }])}>+ 分页</K.Button>
    </div>
  );
}
type Cat = { label: string; collection?: string; group?: string; holders?: string[]; prefabs?: string; into?: string; origin?: string; badges?: string[]; pages?: { label: string; paths: string[]; as?: string }[] };
function CodexEditor({ value, onChange }: { value: Cat[]; onChange: (v: Cat[]) => void }) {
  const K = useKit(), { d } = useB();
  const colls = collections(d), types = colls.filter(c => c.entity);
  const set = (i: number, p: Partial<Cat>) => onChange(value.map((x, j) => j === i ? clean({ ...x, ...p }) as Cat : x));
  return (
    <K.Card title="图鉴分类">
      <SortList ids={value} label="图鉴分类" keyOf={(x, i) => i + ':' + x.label} onMove={(a, b) => onChange(arrayMove(value, a, b))}
        render={(c, i, handle) => {
          const prefab = c.prefabs !== undefined, base = itemBase(prefab ? c.into : c.collection);
          return (
            <div {...part('cat')}>
              <div {...part('head')}>{handle}<TextInput label="分类名" value={c.label} onCommit={v => set(i, { label: v.trim() || c.label })} />
                <Select label="浏览什么" value={prefab ? 'prefab' : 'instance'} options={[['instance', '实例（物品、能力…）'], ['prefab', '预制实体与模板']]}
                  onChange={v => set(i, v === 'prefab' ? { collection: undefined, group: undefined, holders: undefined, prefabs: types[0]?.entity ?? '', into: types[0]?.key ?? '' } : { prefabs: undefined, into: undefined, origin: undefined, collection: colls[0]?.key ?? '' })} />
                <button type="button" {...part('remove')} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`删除分类 ${c.label}`}>×</button></div>
              {prefab ? <>
                <Field label="实体类型"><Select label="实体类型" value={c.prefabs ?? ''} options={types.map(x => [x.entity!, `${x.entity}（${x.label}）`] as [string, string])} onChange={v => set(i, { prefabs: v, into: types.find(x => x.entity === v)?.key })} /></Field>
                <Field label="来源字段" hint="新实体写明从哪个模板来"><PathInput label="来源字段" value={c.origin} options={pathOptions(d, base)} d={d} base={base} onChange={v => set(i, { origin: v })} /></Field>
                <Field label="徽章"><PathsInput label="徽章" value={c.badges} options={pathOptions(d, base)} d={d} base={base} onChange={v => set(i, { badges: v })} /></Field>
                <Field label="分页"><PagesEditor value={c.pages ?? []} base={base} onChange={v => set(i, { pages: v.length ? v : undefined })} /></Field>
              </> : <>
                <Field label="集合"><Select label="集合" value={c.collection ?? ''} options={colls.map(x => [x.key, x.label] as [string, string])} onChange={v => set(i, { collection: v })} /></Field>
                <Field label="分组依据"><PathInput label="分组依据" value={c.group} options={pathOptions(d, base)} d={d} base={base} onChange={v => set(i, { group: v })} /></Field>
                <Field label="持有者" hint="谁持有它，如 characters.*.items"><PathsInput label="持有者" value={c.holders} options={pathOptions(d, [], true).filter(o => o.type === 'record')} onChange={v => set(i, { holders: v })} /></Field>
              </>}
            </div>
          );
        }} />
      <K.Button size="sm" variant="ghost" onClick={() => onChange([...value, { label: '新分类', collection: colls[0]?.key ?? '' }])}>+ 分类</K.Button>
    </K.Card>
  );
}
export { CondEditor };
