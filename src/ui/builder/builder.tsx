/**
 * SOLVE 结构制作页（给卡作者）。和状态栏、调试面板同一套组件与皮肤，在 SOLVE 层里打开。
 * 页面：字段 · 模块 · 状态栏布局 · 交互 · 提示词 · 开局数据 · 音乐 · 检查与发布。
 * 预览一实现字段、模块、检查与发布；其余页面在后续预览里做。电脑与手机都是完整功能（手机上字段树与属性表单分两屏）。
 */
import * as React from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { useKit } from '../kit.js';
import { useWide } from '../statusbar/widgets.js';
import { Json } from '../debug/shared.js';
import type { FieldNode, FieldType, SpoilerLevel, StructureDescription, StructureModule } from '../../structure.js';
import type { LogicalState } from '../../types.js';
import {
  KEY_RE, addField, addrKey, blankStructure, childrenOf, commit, diffFields, duplicate, entityTypes, fieldHost, freeKey, fromKey, history, hosts,
  mentions, moveTo, nodeAt, redo, remove, rename, reorder, replaceNode, retype, rootNode, undo, update, type Addr, type History,
} from './draft.js';
import { Blueprint } from './blueprint.js';
import { LayoutPage } from './layout.js';
import { InteractPage } from './interact.js';
import { PromptPage } from './prompt.js';
import { InitialPage } from './initial.js';
import { MusicPage } from './music.js';
import { ViewsPage } from './views.js';
import { checkStructure, scriptFor, worldEntries, type CheckResult, type Issue } from './check.js';

export interface BuilderHost {
  /** Where editing starts (the structure of the current chat, or the official one). */
  start: StructureDescription;
  /** The published version the draft is compared with (impact, changes). */
  published: StructureDescription;
  official: StructureDescription;
  /** Character the world-book entry goes to. */
  character?: string;
  /** State of the current chat: the status bar, prompt and music previews render the draft with it. */
  sample?(): LogicalState | undefined;
  /** Writes the world-book entries; absent in the preview (shows what would be written). */
  writeWorldBook?(entries: { comment: string; content: string }[]): Promise<void>;
}
type Page = 'fields' | 'modules' | 'layout' | 'interact' | 'prompt' | 'views' | 'initial' | 'music' | 'publish';
const PAGES: { id: Page; label: string; soon?: string }[] = [
  { id: 'fields', label: '字段蓝图' }, { id: 'modules', label: '模块' },
  { id: 'layout', label: '状态栏布局' }, { id: 'interact', label: '交互' }, { id: 'prompt', label: '提示词' }, { id: 'views', label: '视图' },
  { id: 'initial', label: '开局数据' }, { id: 'music', label: '音乐' }, { id: 'publish', label: '检查与发布' },
];
export const TYPES: { type: FieldType; label: string; tag: string }[] = [
  { type: 'string', label: '文字', tag: '文' }, { type: 'int', label: '整数', tag: '整' }, { type: 'number', label: '小数', tag: '数' },
  { type: 'bool', label: '开关（是 / 否）', tag: '开' }, { type: 'enum', label: '选项（单选）', tag: '选' }, { type: 'ladder', label: '等级（有高低的选项）', tag: '级' },
  { type: 'ref', label: '指向一个实体', tag: '→' }, { type: 'refs', label: '指向多个实体', tag: '⇉' }, { type: 'object', label: '一组字段', tag: '{}' },
  { type: 'record', label: '字典（按名字或 ID 存多条）', tag: '典' }, { type: 'array', label: '列表', tag: '[ ]' }, { type: 'oneOf', label: '多种写法（数值或描述）', tag: '或' },
];
export const typeInfo = (t: FieldType) => TYPES.find(x => x.type === t) ?? { type: t, label: t, tag: '?' };
const WIDGETS: [string, string][] = [
  ['paragraph', '段落'], ['tags', '标签'], ['chips', '小标签'], ['meters', '进度条组'], ['meter-center', '居中进度（−/+）'], ['stage', '阶段'], ['levels', '等级表'],
  ['checklist', '勾选清单'], ['timeline', '时间线'], ['quests', '任务日志'], ['inventory', '背包'], ['abilities', '能力'], ['datetime', '日期时间'], ['image', '图片'], ['bgm', '音乐'],
];
const FORMULAS: [string, string][] = [['wodTranscend', 'WOD 超凡（每 5 点一级）'], ['dndModifier', 'DND 调整值（(值−10)÷2）']];
const ON_DELETE: [string, string][] = [['', '默认（可空就置空，可省略就去掉，否则阻止）'], ['null', '置为空缺'], ['unset', '去掉这个字段'], ['remove', '移除这一条'], ['restrict', '阻止删除目标']];

export const solve = (name: string, extra: Record<string, string | undefined> = {}) => ({ 'data-solve': name, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined).map(([k, v]) => ['data-' + k, v])) });
export const part = (name: string) => ({ 'data-solve-part': name });
export const nameOf = (node: FieldNode | undefined, key: string, parent?: FieldNode) => key === '*' ? (parent?.entity && parent.label ? `每个${parent.label}` : '每一项') : node?.label || key;

export interface Ctx {
  d: StructureDescription; h: History; set: (next: StructureDescription) => void;
  selected?: Addr; select: (a: Addr | undefined, open?: boolean) => void; go: (p: Page) => void;
  check?: CheckResult; issuesAt: (a: Addr) => Issue[]; note: (text: string, tone?: 'error') => void; host: BuilderHost;
}
const BuilderContext = React.createContext<Ctx | null>(null);
export const useB = () => React.useContext(BuilderContext)!;

export function StructureBuilder({ host, onClose, defaultPage = 'fields' }: { host: BuilderHost; onClose: () => void; defaultPage?: Page }) {
  const K = useKit();
  const [h, setH] = React.useState<History>(() => history(host.start));
  const [page, setPage] = React.useState<Page>(defaultPage);
  const [selected, setSelected] = React.useState<Addr | undefined>();
  const [check, setCheck] = React.useState<CheckResult | undefined>();
  const [notice, setNotice] = React.useState<{ text: string; tone?: 'error' } | undefined>();
  const [box, wide] = useWide(900);
  const d = h.present;
  React.useEffect(() => {
    let live = true; setCheck(undefined);
    const t = setTimeout(() => { void checkStructure(d, host.published).then(r => { if (live) setCheck(r); }); }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [d, host.published]);
  React.useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(undefined), 4000); return () => clearTimeout(t); }, [notice]);
  const ctx: Ctx = {
    d, h, set: next => setH(cur => commit(cur, next)),
    ...(selected ? { selected } : {}), select: a => setSelected(a),
    go: p => setPage(p), ...(check ? { check } : {}),
    issuesAt: a => (check?.issues ?? []).filter(i => i.addr && addrKey(i.addr) === addrKey(a)),
    note: (text, tone) => setNotice({ text, ...(tone ? { tone } : {}) }), host,
  };
  const errors = check?.issues.filter(i => i.level === 'error').length ?? 0, warnings = check?.issues.filter(i => i.level === 'warning').length ?? 0;
  const dirty = JSON.stringify(d) !== JSON.stringify(host.published);
  const [importing, setImporting] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const startFrom = (v: string) => {
    if (v === 'import') { fileRef.current?.click(); return; }
    if (dirty && !confirm('换一个起点会丢掉当前的修改（可以撤销）。继续？')) return;
    const next = v === 'official' ? host.official : v === 'blank' ? blankStructure() : host.published;
    setH(cur => commit(cur, JSON.parse(JSON.stringify(next)))); setSelected(undefined);
  };
  const onFile = async (file?: File) => {
    if (!file) return; setImporting(true);
    try { const json = JSON.parse(await file.text()); if (!json?.fields || !json.id) throw new Error('不是 SOLVE 结构描述（缺少 id 或 fields）'); setH(cur => commit(cur, json)); setNotice({ text: `已导入「${json.label ?? json.id}」` }); }
    catch (e: any) { setNotice({ text: '导入失败：' + (e?.message ?? e), tone: 'error' }); } finally { setImporting(false); }
  };
  const body = (id: Page) => (
    <div {...solve('builder-page', { page: id })}>
      {id === 'fields' ? <FieldsPage /> : id === 'modules' ? <ModulesPage /> : id === 'layout' ? <LayoutPage /> : id === 'interact' ? <InteractPage /> : id === 'prompt' ? <PromptPage /> : id === 'views' ? <ViewsPage /> : id === 'initial' ? <InitialPage /> : id === 'music' ? <MusicPage /> : <PublishPage />}
    </div>
  );
  const title = <span {...solve('debug-title')}><b>结构制作</b><small>{d.label ?? d.id} · {d.version}</small></span>;
  return (
    <K.Panel title={title} onClose={onClose} closeLabel="关闭结构制作" defaultSize={{ w: 1240, h: 880 }} minSize={{ w: 560, h: 440 }}>
      <BuilderContext.Provider value={ctx}>
        <div ref={box} {...solve('builder', { layout: wide ? 'sidebar' : 'tabs' })}>
          <div {...solve('builder-bar')}>
            <label {...part('start')}><span>起点</span>
              <select value="" onChange={e => { startFrom(e.target.value); e.target.value = ''; }} aria-label="换一个起点">
                <option value="" disabled>换一个…</option><option value="published">当前聊天的结构</option><option value="official">官方结构</option><option value="blank">空白结构</option><option value="import">导入 JSON 文件…</option>
              </select>
            </label>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={e => void onFile(e.target.files?.[0])} />
            <span {...part('history')}>
              <K.Button size="sm" variant="ghost" disabled={!h.past.length} onClick={() => setH(undo)} aria-label="撤销">↶<span data-text=""> 撤销</span></K.Button>
              <K.Button size="sm" variant="ghost" disabled={!h.future.length} onClick={() => setH(redo)} aria-label="重做">↷<span data-text=""> 重做</span></K.Button>
            </span>
            <button type="button" {...part('status')} data-tone={!check ? 'busy' : errors ? 'error' : warnings ? 'warning' : 'ok'} onClick={() => setPage('publish')}>
              {!check || importing ? '检查中…' : errors ? `${errors} 个错误` : '编译通过'}{check && warnings ? ` · ${warnings} 个提醒` : ''}{dirty ? (wide ? ' · 有未发布的修改' : ' · 未发布') : ''}
            </button>
            {notice ? <span {...part('notice')} data-tone={notice.tone} role="status">{notice.text}</span> : null}
          </div>
          {wide ? (
            <div {...part('split')}>
              <div {...part('nav')}><K.NavList layout="sidebar" label="结构制作" current={page} onSelect={id => setPage(id as Page)}
                items={PAGES.map(p => ({ id: p.id, label: p.label, ...(p.soon ? { meta: p.soon } : p.id === 'publish' && errors ? { meta: '!' } : {}) }))} /></div>
              <div {...part('main')}>{body(page)}</div>
            </div>
          ) : <K.Tabs label="结构制作" mode="scroll" value={page} onValueChange={v => setPage(v as Page)} items={PAGES.map(p => ({ value: p.id, label: p.label, content: body(p.id) }))} />}
        </div>
      </BuilderContext.Provider>
    </K.Panel>
  );
}

// ── 字段 ──

function FieldsPage() {
  return <Blueprint />;
}

/** Add a field under an object (or under each entry of a record / list of objects). */
function AddField({ host, compact, onAdded }: { host: Addr; compact?: boolean; onAdded?: (a: Addr) => void }) {
  const K = useKit(), { d, set, note } = useB();
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState(''), [key, setKey] = React.useState(''), [type, setType] = React.useState<FieldType>('string');
  const parent = nodeAt(d, host);
  const taken = !!key && !!parent?.fields && Object.hasOwn(parent.fields, key);
  const valid = KEY_RE.test(key) && !taken;
  if (!open) return <K.Button size="sm" variant={compact ? 'default' : 'ghost'} onClick={() => setOpen(true)}>+ 新字段</K.Button>;
  const add = () => {
    if (!valid) return;
    const node: FieldNode = { type, ...(label.trim() ? { label: label.trim() } : {}) } as FieldNode;
    const next = retype(addField(d, host, key, node), [...host, key], type).next;
    set(next); note(`已添加「${label.trim() || key}」`); setOpen(false); setLabel(''); setKey(''); onAdded?.([...host, key]);
  };
  return (
    <div {...solve('builder-add')}>
      <label><span>显示名</span><input value={label} onChange={e => { setLabel(e.target.value); if (!key) setKey(''); }} placeholder="如：好感度" /></label>
      <label><span>键名（英文）</span><input value={key} onChange={e => setKey(e.target.value.trim())} placeholder="如：affection" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>
      <label><span>类型</span><select value={type} onChange={e => setType(e.target.value as FieldType)}>{TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}</select></label>
      {key && !valid ? <small {...part('error')}>{taken ? '这一层已经有这个键名' : '键名只能用英文字母、数字和下划线，不能以数字开头'}</small> : null}
      <div {...part('actions')}><K.Button size="sm" variant="primary" disabled={!valid} onClick={add}>添加</K.Button><K.Button size="sm" variant="ghost" onClick={() => setOpen(false)}>取消</K.Button></div>
    </div>
  );
}

// ── 字段设置 ──

/** Text that commits on blur / Enter (one history step per edit, not per keystroke). */
export function TextInput({ value, onCommit, multiline, placeholder, label, mono, validate }: { value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string; label: string; mono?: boolean; validate?: (v: string) => string | undefined }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => setV(value), [value]);
  const err = v !== value ? validate?.(v) : undefined;
  const done = () => { if (v !== value && !validate?.(v)) onCommit(v); else if (err) setV(value); };
  const props = { value: v, placeholder, 'aria-label': label, onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setV(e.target.value), onBlur: done, 'data-mono': mono ? '' : undefined, spellCheck: !mono };
  return (
    <span {...solve('builder-input')}>
      {multiline ? <textarea {...props} rows={3} /> : <input {...props} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(value); }} autoCapitalize={mono ? 'off' : undefined} />}
      {err ? <small {...part('error')}>{err}</small> : null}
    </span>
  );
}
export function NumberInput({ value, onCommit, label, placeholder }: { value?: number; onCommit: (v: number | undefined) => void; label: string; placeholder?: string }) {
  return <TextInput label={label} value={value === undefined ? '' : String(value)} placeholder={placeholder ?? '不限'} mono
    validate={v => v.trim() === '' || Number.isFinite(Number(v)) ? undefined : '请填数字'} onCommit={v => onCommit(v.trim() === '' ? undefined : Number(v))} />;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div {...solve('builder-field')}><span {...part('label')}>{label}{hint ? <small>{hint}</small> : null}</span><div {...part('control')}>{children}</div></div>;
}
export function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return <select {...solve('builder-select')} value={value} aria-label={label} onChange={e => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}
export function Chips({ options, value, onChange, label }: { options: [string, string][]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div {...solve('builder-chips')} role="group" aria-label={label}>
      {options.map(([v, l]) => <button type="button" key={v} aria-pressed={value.includes(v)} onClick={() => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])}>{l}</button>)}
      {!options.length ? <small>（没有可选的）</small> : null}
    </div>
  );
}

export function Inspector({ addr, onBack, backLabel = '‹ 字段树' }: { addr: Addr; onBack?: () => void; backLabel?: string }) {
  const K = useKit(), { d, set, select, issuesAt, note, go } = useB();
  const node = nodeAt(d, addr);
  if (!node) return <aside {...part('placeholder')}><p>这个字段已经不在了。</p>{onBack ? <K.Button size="sm" onClick={onBack}>‹ 字段树</K.Button> : null}</aside>;
  const key = addr.at(-1)!, star = key === '*', parentAddr = addr.slice(0, -1), parent = nodeAt(d, parentAddr);
  const patch = (p: Partial<FieldNode>) => set(update(d, addr, p));
  const issues = issuesAt(addr);
  const modules = Object.entries(d.modules ?? {});
  const types = entityTypes(d);
  const crumbs = addr.map((_, i) => addr.slice(0, i + 1));
  const host = fieldHost(d, addr);
  const childList = host ? childrenOf(nodeAt(d, host)) : [];
  const spoiler = node.spoiler ?? '';
  return (
    <section {...solve('builder-inspector')} aria-label={`字段设置：${nameOf(node, key)}`}>
      <header>
        {onBack ? <K.Button size="sm" variant="ghost" onClick={onBack}>{backLabel}</K.Button> : null}
        <nav {...part('crumbs')} aria-label="位置">{crumbs.map(c => <button type="button" key={addrKey(c)} onClick={() => select(c)} aria-current={c.length === addr.length ? 'true' : undefined}>{nameOf(nodeAt(d, c), c.at(-1)!, nodeAt(d, c.slice(0, -1)))}</button>)}</nav>
        <h3><i {...part('type')} data-type={node.type}>{typeInfo(node.type).tag}</i>{nameOf(node, key, parent)}</h3>
        <code>{addrKey(addr)}</code>
      </header>
      {issues.length ? <ul {...solve('builder-issues')}>{issues.map((i, n) => <li key={n} data-level={i.level}>{i.level === 'error' ? '错误' : '提醒'}：{i.message}</li>)}</ul> : null}

      <K.Card title="基本">
        <Field label="显示名" hint="状态栏和调试面板里显示的名字"><TextInput label="显示名" value={node.label ?? ''} placeholder={star ? '（可选）' : key} onCommit={v => patch({ label: v.trim() || undefined })} /></Field>
        {!star ? (
          <Field label="键名" hint="英文；模型写操作时用它。改名会同步开局数据、布局与指南里的路径">
            <TextInput label="键名" value={key} mono validate={v => !KEY_RE.test(v) ? '只能用英文字母、数字和下划线，不能以数字开头' : parent?.fields && Object.hasOwn(parent.fields, v) && v !== key ? '这一层已经有这个键名' : undefined}
              onCommit={v => { set(rename(d, addr, v)); select([...parentAddr, v], !!onBack); note(`键名改为 ${v}`); }} />
          </Field>
        ) : null}
        <Field label="给模型的说明" hint="写进提示词的「数据结构」，跟在这个字段后面：填什么、怎么填（可选）"><TextInput label="给模型的说明" value={node.hint ?? ''} multiline placeholder={node.desc ? `不写就用给玩家的说明：${node.desc}` : '如：此刻的身体与精神状况，一句话'} onCommit={v => patch({ hint: v.trim() || undefined })} /></Field>
        <Field label="给玩家的说明" hint="状态栏、调试面板里显示（可选）"><TextInput label="给玩家的说明" value={node.desc ?? ''} multiline onCommit={v => patch({ desc: v.trim() || undefined })} /></Field>
        <Field label="类型">
          <Select label="类型" value={node.type} options={TYPES.map(t => [t.type, t.label])} onChange={v => {
            const { next, dropped } = retype(d, addr, v as FieldType); set(next);
            if (dropped.length) note(`类型改为「${typeInfo(v as FieldType).label}」，去掉了不适用的设置：${dropped.join('、')}（可撤销）`);
          }} />
        </Field>
      </K.Card>

      {node.type === 'int' || node.type === 'number' ? (
        <K.Card title="数值">
          <div {...part('grid')}>
            <Field label="最小"><NumberInput label="最小" value={node.min} onCommit={v => patch({ min: v })} /></Field>
            <Field label="最大"><NumberInput label="最大" value={node.max} onCommit={v => patch({ max: v })} /></Field>
            <Field label="单次变化上限" hint="超出时引擎截断并告诉模型；玩家可在设置里改"><NumberInput label="单次变化上限" value={node.maxDelta} onCommit={v => patch({ maxDelta: v })} /></Field>
          </div>
          <Field label="计算值" hint="由这个数算出，显示给玩家、写进提示词，模型不能写">
            <Chips label="计算值" options={FORMULAS} value={(node.computed ?? []).map(c => String(c.formula))}
              onChange={v => patch({ computed: v.length ? v.map(f => ({ label: FORMULAS.find(x => x[0] === f)![1].split('（')[0]!, formula: f as never })) : undefined })} />
          </Field>
        </K.Card>
      ) : null}
      {node.type === 'enum' || node.type === 'ladder' ? (
        <K.Card title={node.type === 'ladder' ? '等级（从低到高）' : '可选的值'}>
          <ValuesEditor values={node.values ?? []} onChange={v => patch({ values: v })} ordered={node.type === 'ladder'} />
        </K.Card>
      ) : null}
      {node.type === 'ref' || node.type === 'refs' ? (
        <K.Card title="指向">
          <Field label="实体类型" hint="不选就是任何实体都行"><Chips label="实体类型" options={types.map(t => [t, t])} value={([] as string[]).concat(node.to ?? [])} onChange={v => patch({ to: v.length === 0 ? undefined : v.length === 1 ? v[0] : v })} /></Field>
          <Field label="目标被删除时"><Select label="目标被删除时" value={node.onDelete ?? ''} options={ON_DELETE} onChange={v => patch({ onDelete: (v || undefined) as never })} /></Field>
        </K.Card>
      ) : null}
      {node.type === 'record' || node.type === 'array' ? (
        <K.Card title={node.type === 'record' ? '字典' : '列表'}>
          {node.type === 'record' ? <>
            <Field label="实体集合" hint="填实体类型，每一条就是一个实体，键是它的 ID（全局唯一）"><TextInput label="实体类型" value={node.entity ?? ''} mono placeholder="不是实体集合" onCommit={v => patch({ entity: v.trim() || undefined })} /></Field>
            <Field label="键指向实体" hint="键是某类实体的 ID，目标删除时整条移除（如社交关系、持有物品）"><Select label="键指向实体" value={node.keys ?? ''} options={[['', '不是'], ...types.map(t => [t, t] as [string, string])]} onChange={v => patch({ keys: v || undefined })} /></Field>
            {node.keys ? <Field label="独一无二字段" hint="目标的这个开关为真时，只能在一处出现（如独一无二的物品）"><TextInput label="独一无二字段" value={node.uniqueBy ?? ''} mono placeholder="如：unique" onCommit={v => patch({ uniqueBy: v.trim() || undefined })} /></Field> : null}
          </> : <Field label="自动记轮次" hint="每一项是 {round, text}，引擎自动填 round；模型可以只写一句话"><K.Switch checked={!!node.stamp} aria-label="自动记轮次" onCheckedChange={v => patch({ stamp: v || undefined })} /></Field>}
          {!node.entity ? (
            <div {...part('grid')}>
              <Field label="上限" hint="到上限时拒绝新增"><NumberInput label="上限" value={node.list?.max} onCommit={v => patch({ list: v === undefined ? undefined : { max: v, warn: Math.min(node.list?.warn ?? v, v) } })} /></Field>
              <Field label="预警线" hint="到这里提醒模型合并整理"><NumberInput label="预警线" value={node.list?.warn} onCommit={v => node.list ? patch({ list: { ...node.list, warn: v ?? node.list.max } }) : undefined} /></Field>
            </div>
          ) : null}
          <Field label="每一项的类型">
            <span {...part('inline')}><Select label="每一项的类型" value={node.of?.type ?? 'string'} options={TYPES.filter(t => t.type !== 'oneOf').map(t => [t.type, t.label])} onChange={v => set(retype(d, [...addr, '*'], v as FieldType).next)} />
              <K.Button size="sm" variant="ghost" onClick={() => select([...addr, '*'], !!onBack)}>编辑每一项 ›</K.Button></span>
          </Field>
        </K.Card>
      ) : null}
      {host ? (
        <K.Card title={`子字段（${childList.length}）`}>
          <ul {...solve('builder-children')}>{childList.map(([k, c]) => <li key={k}><button type="button" onClick={() => select([...host, k], !!onBack)}><i {...part('type')} data-type={c.type}>{typeInfo(c.type).tag}</i>{nameOf(c, k)}<code>{k}</code></button></li>)}</ul>
          <AddField host={host} onAdded={a => select(a, !!onBack)} />
          {node.type === 'object' ? <SectionsEditor addr={addr} node={node} /> : null}
        </K.Card>
      ) : null}
      {node.type === 'oneOf' ? <K.Card title="多种写法"><p {...part('hint')}>模型可以按其中任一种写（如数值 {'{value, max}'} 或一句描述）。各写法的细节目前在下方 JSON 里改。</p></K.Card> : null}

      <K.Card title="归属与可见">
        <Field label="所属模块" hint="模块关闭时字段休眠、不进提示词；选多个表示都开启才生效">
          <Chips label="所属模块" options={modules.map(([n, m]) => [n, m.label ?? n])} value={([] as string[]).concat(node.module ?? [])} onChange={v => patch({ module: v.length === 0 ? undefined : v.length === 1 ? v[0] : v })} />
        </Field>
        <Field label="给玩家看" hint="剧透：状态栏里遮住，点一下才显示；隐藏：只在调试面板可见。模型照常看到">
          {K.Segmented ? <K.Segmented size="sm" label="给玩家看" value={spoiler || 'inherit'} onValueChange={v => patch({ spoiler: v === 'inherit' ? undefined : v as SpoilerLevel })}
            options={[{ value: 'inherit', label: '跟随上级' }, { value: 'public', label: '公开' }, { value: 'spoiler', label: '剧透' }, { value: 'hidden', label: '隐藏' }]} /> : null}
        </Field>
        <Field label="模型只能看不能改" hint="readonly：不出现在给操作模型的视图里"><K.Switch checked={!!node.readonly} aria-label="模型只能看不能改" onCheckedChange={v => patch({ readonly: v || undefined })} /></Field>
        <Field label="不给模型看" hint="internal：不进叙事提示词（如图片链接）"><K.Switch checked={!!node.internal} aria-label="不给模型看" onCheckedChange={v => patch({ internal: v || undefined })} /></Field>
      </K.Card>

      <K.Card title="取值">
        <Field label="可以空缺" hint="nullable：没有这项（如亡灵没有体质），状态栏显示「—」"><K.Switch checked={!!node.nullable} aria-label="可以空缺" onCheckedChange={v => patch({ nullable: v || undefined })} /></Field>
        <Field label="可以省略" hint="optional：数据里可以没有这个键"><K.Switch checked={!!node.optional} aria-label="可以省略" onCheckedChange={v => patch({ optional: v || undefined })} /></Field>
        <Field label="默认值" hint="不填时自动给：文字为空、数字为 0 或下限、选项为第一个">
          <TextInput label="默认值" mono value={node.default === undefined ? '' : JSON.stringify(node.default)} placeholder="自动"
            validate={v => { if (!v.trim()) return undefined; try { JSON.parse(v); return undefined; } catch { return node.type === 'string' || node.type === 'enum' || node.type === 'ladder' ? undefined : '请填 JSON（文字可以直接写）'; } }}
            onCommit={v => { if (!v.trim()) return patch({ default: undefined }); try { patch({ default: JSON.parse(v) }); } catch { patch({ default: v }); } }} />
        </Field>
      </K.Card>

      <K.Card title="状态栏显示">
        <Field label="控件" hint="默认按类型推断"><Select label="控件" value={node.as ?? ''} options={[['', '自动'], ...WIDGETS]} onChange={v => patch({ as: v || undefined })} /></Field>
        <Field label="玩家交互" hint="玩家能不能改、有哪些按钮">
          <span {...part('inline')}><span>{node.edit ? '玩家可修改' : '只读'}{node.actions ? ` · ${Object.keys(node.actions).length} 个按钮` : ''}{node.create ? ' · 可新增' : ''}</span>
            <K.Button size="sm" variant="ghost" onClick={() => go('interact')}>在「交互」页编辑 ›</K.Button></span>
        </Field>
      </K.Card>

      <NodeJson addr={addr} node={node} />

      {!star ? (
        <K.Card title="整理">
          <div {...part('actions')}>
            <K.Button size="sm" onClick={() => { const r = duplicate(d, addr); set(r.next); select([...parentAddr, r.key], !!onBack); note('已复制一份'); }}>复制一份</K.Button>
            <MoveTo addr={addr} onMoved={a => select(a, !!onBack)} />
            <DeleteField addr={addr} onDeleted={() => select(parentAddr.length ? parentAddr : undefined, !!onBack && parentAddr.length > 0)} />
          </div>
        </K.Card>
      ) : null}
    </section>
  );
}

function ValuesEditor({ values, onChange, ordered }: { values: string[]; onChange: (v: string[]) => void; ordered: boolean }) {
  const K = useKit();
  const [draft, setDraft] = React.useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = values.map((v, i) => i + ':' + v);
  const onDragEnd = ({ active, over }: DragEndEvent) => { if (over && active.id !== over.id) onChange(arrayMove(values, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))); };
  const add = () => { const v = draft.trim(); if (v && !values.includes(v)) { onChange([...values, v]); setDraft(''); } };
  return (
    <div {...solve('builder-values')}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol>{values.map((v, i) => <ValueRow key={ids[i]} id={ids[i]!} index={i} value={v} ordered={ordered}
            onRename={n => onChange(values.map((x, j) => j === i ? n : x))} onRemove={() => onChange(values.filter((_, j) => j !== i))} taken={n => n !== v && values.includes(n)} />)}</ol>
        </SortableContext>
      </DndContext>
      <div {...part('add')}><input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="新的值" aria-label="新的值" /><K.Button size="sm" disabled={!draft.trim() || values.includes(draft.trim())} onClick={add}>添加</K.Button></div>
      <p {...part('hint')}>改名不会自动改已有数据里的旧值。{ordered ? '按住 ⠿ 拖动调整高低。' : '按住 ⠿ 拖动调整顺序。'}</p>
    </div>
  );
}
function ValueRow({ id, index, value, ordered, onRename, onRemove, taken }: { id: string; index: number; value: string; ordered: boolean; onRename: (v: string) => void; onRemove: () => void; taken: (v: string) => boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <button type="button" ref={setActivatorNodeRef} {...part('handle')} {...attributes} {...listeners} aria-label={`拖动 ${value}`}>⠿</button>
      {ordered ? <small>{index + 1}</small> : null}
      <TextInput label={`值 ${index + 1}`} value={value} validate={v => !v.trim() ? '不能为空' : taken(v.trim()) ? '重复了' : undefined} onCommit={v => onRename(v.trim())} />
      <button type="button" {...part('remove')} onClick={onRemove} aria-label={`删除 ${value}`}>×</button>
    </li>
  );
}
function SectionsEditor({ addr, node }: { addr: Addr; node: FieldNode }) {
  const K = useKit(), { d, set } = useB();
  const keys = Object.keys(node.fields ?? {}), sections = node.sections ?? [];
  const save = (s: NonNullable<FieldNode['sections']>) => set(update(d, addr, { sections: s.length ? s : undefined }));
  return (
    <div {...solve('builder-sections')}>
      <h4>分组 <small>只影响状态栏排版（如 WOD 分身体 / 心智 / 社交）</small></h4>
      {sections.map((s, i) => (
        <div key={i} {...part('section')}>
          <TextInput label="分组名" value={s.label} onCommit={v => save(sections.map((x, j) => j === i ? { ...x, label: v } : x))} />
          <Chips label={`分组「${s.label}」的字段`} options={keys.filter(k => s.keys.includes(k) || !sections.some(x => x.keys.includes(k))).map(k => [k, node.fields![k]!.label ?? k])} value={s.keys}
            onChange={v => save(sections.map((x, j) => j === i ? { ...x, keys: v } : x))} />
          <K.Button size="sm" variant="ghost" onClick={() => save(sections.filter((_, j) => j !== i))}>删除分组</K.Button>
        </div>
      ))}
      <K.Button size="sm" variant="ghost" onClick={() => save([...sections, { label: `分组 ${sections.length + 1}`, keys: [] }])}>+ 分组</K.Button>
    </div>
  );
}
function NodeJson({ addr, node }: { addr: Addr; node: FieldNode }) {
  const K = useKit(), { d, set, note } = useB();
  const text = JSON.stringify(node, null, 2);
  const [v, setV] = React.useState(text), [err, setErr] = React.useState<string | undefined>();
  React.useEffect(() => { setV(text); setErr(undefined); }, [text]);
  return (
    <K.CollapseCard title="JSON（高级）" meta={<small>这个字段的完整描述，含子字段</small>}>
      <textarea {...solve('builder-json')} value={v} onChange={e => { setV(e.target.value); setErr(undefined); }} spellCheck={false} rows={Math.min(18, text.split('\n').length + 1)} aria-label="字段 JSON" />
      {err ? <small {...part('error')}>{err}</small> : null}
      <div {...part('actions')}>
        <K.Button size="sm" disabled={v === text} onClick={() => { try { const n = JSON.parse(v); if (!n || typeof n !== 'object' || !n.type) throw new Error('需要一个带 type 的对象'); set(replaceNode(d, addr, n)); note('已应用 JSON'); } catch (e: any) { setErr('JSON 有误：' + (e?.message ?? e)); } }}>应用</K.Button>
        <K.Button size="sm" variant="ghost" disabled={v === text} onClick={() => setV(text)}>还原</K.Button>
      </div>
    </K.CollapseCard>
  );
}
function MoveTo({ addr, onMoved }: { addr: Addr; onMoved: (a: Addr) => void }) {
  const { d, set, note } = useB();
  const options = hosts(d, addr).filter(h => addrKey(h.addr) !== addrKey(addr.slice(0, -1)));
  return (
    <select {...solve('builder-select')} value="" aria-label="移动到" onChange={e => {
      const target = options.find(o => addrKey(o.addr) === e.target.value); if (!target) return;
      const r = moveTo(d, addr, target.addr); set(r.next); onMoved(r.addr); note(`已移动到「${target.label}」，开局数据里的旧值没有搬过去`);
    }}>
      <option value="" disabled>移动到…</option>{options.map(o => <option key={addrKey(o.addr)} value={addrKey(o.addr)}>{o.label}</option>)}
    </select>
  );
}
function DeleteField({ addr, onDeleted }: { addr: Addr; onDeleted: () => void }) {
  const K = useKit(), { d, set, note } = useB();
  const [asking, setAsking] = React.useState(false);
  const node = nodeAt(d, addr), where = mentions(d, addr), kids = childrenOf(node).length;
  if (!asking) return <K.Button size="sm" variant="danger" onClick={() => setAsking(true)}>删除</K.Button>;
  return (
    <div {...solve('builder-confirm')} role="alertdialog" aria-label="确认删除">
      <p>删除「{nameOf(node, addr.at(-1)!)}」{kids ? `和它下面的字段` : ''}，开局数据里的值一起删除。{where.length ? `${where.join('、')}里还提到了它，需要你去改。` : ''}可以撤销。</p>
      <div {...part('actions')}><K.Button size="sm" variant="danger" onClick={() => { set(remove(d, addr)); note('已删除（可撤销）'); onDeleted(); }}>删除</K.Button><K.Button size="sm" variant="ghost" onClick={() => setAsking(false)}>取消</K.Button></div>
    </div>
  );
}

// ── 模块 ──

function ModulesPage() {
  const K = useKit(), { d, set, note } = useB();
  const modules = d.modules ?? {}, groups = d.groups ?? {};
  const counts: Record<string, number> = {};
  const walk = (n: FieldNode) => { for (const [, c] of childrenOf(n)) { for (const m of ([] as string[]).concat(c.module ?? [])) counts[m] = (counts[m] ?? 0) + 1; walk(c); } };
  walk(rootNode(d));
  const setModules = (next: Record<string, StructureModule>) => set({ ...d, modules: next });
  const patch = (name: string, p: Partial<StructureModule>) => setModules(Object.fromEntries(Object.entries(modules).map(([n, m]) => [n, n === name ? clean({ ...m, ...p }) : m])));
  const order: [string, number][] = [];
  const place = (parent: string | undefined, depth: number) => { for (const [n, m] of Object.entries(modules)) if ((m.parent || undefined) === parent) { order.push([n, depth]); place(n, depth + 1); } };
  place(undefined, 0);
  for (const n of Object.keys(modules)) if (!order.some(([x]) => x === n)) order.push([n, 0]);
  const [adding, setAdding] = React.useState(false), [key, setKey] = React.useState(''), [label, setLabel] = React.useState('');
  const [groupKey, setGroupKey] = React.useState('');
  const groupOptions: [string, string][] = [['', '不在互斥组里'], ...Object.entries(groups).map(([g, x]) => [g, x.label ?? g] as [string, string])];
  return (
    <>
      <p {...part('intro')}>核心字段始终开启；其余字段挂在模块上，玩家可在状态栏 ⚙ 里开关。关闭时数据保留、不进提示词。互斥组里同一时间只开一个（如属性体系），切换时让模型按新规则换算旧数据。</p>
      <ul {...solve('builder-modules')}>
        {order.map(([name, depth]) => {
          const m = modules[name]!;
          return (
            <li key={name} style={{ '--depth': depth } as React.CSSProperties}>
              <K.CollapseCard title={<span {...part('title')}>{m.label ?? name}<code>{name}</code></span>}
                meta={<span {...part('meta')}>{m.exclusive ? <K.Badge>{groups[m.exclusive]?.label ?? m.exclusive}</K.Badge> : null}<K.Badge tone={m.enabled === false ? 'neutral' : 'success'}>{m.enabled === false ? '默认关' : '默认开'}</K.Badge><small>{counts[name] ?? 0} 个字段</small></span>}>
                <ModuleEditor name={name} />
              </K.CollapseCard>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <div {...solve('builder-add')}>
          <label><span>显示名</span><input value={label} onChange={e => setLabel(e.target.value)} placeholder="如：战斗" /></label>
          <label><span>键名（英文）</span><input value={key} onChange={e => setKey(e.target.value.trim())} placeholder="如：combat" autoCapitalize="off" spellCheck={false} /></label>
          <div {...part('actions')}><K.Button size="sm" variant="primary" disabled={!KEY_RE.test(key) || Object.hasOwn(modules, key)} onClick={() => { setModules({ ...modules, [key]: clean({ label: label.trim() || undefined }) }); setAdding(false); setKey(''); setLabel(''); note('已添加模块'); }}>添加</K.Button><K.Button size="sm" variant="ghost" onClick={() => setAdding(false)}>取消</K.Button></div>
        </div>
      ) : <K.Button size="sm" onClick={() => setAdding(true)}>+ 新模块</K.Button>}
      <K.Card title="互斥组">
        <ul {...solve('builder-groups')}>
          {Object.entries(groups).map(([g, x]) => (
            <li key={g}>
              <Field label={g}><TextInput label="互斥组显示名" value={x.label ?? ''} placeholder={g} onCommit={v => set({ ...d, groups: { ...groups, [g]: clean({ ...x, label: v.trim() || undefined }) } })} /></Field>
              <Field label="切换时让模型换算" hint="关闭后切换只改开关，不给模型迁移指令"><K.Switch checked={x.migrate !== false} aria-label="切换时让模型换算" onCheckedChange={v => set({ ...d, groups: { ...groups, [g]: clean({ ...x, migrate: v ? undefined : false }) } })} /></Field>
              <small>成员：{Object.entries(modules).filter(([, m]) => m.exclusive === g).map(([n, m]) => m.label ?? n).join('、') || '（没有）'}</small>
            </li>
          ))}
        </ul>
        <div {...part('add')}><input value={groupKey} onChange={e => setGroupKey(e.target.value.trim())} placeholder="新互斥组键名（英文）" aria-label="新互斥组键名" />
          <K.Button size="sm" disabled={!KEY_RE.test(groupKey) || Object.hasOwn(groups, groupKey)} onClick={() => { set({ ...d, groups: { ...groups, [groupKey]: {} } }); setGroupKey(''); }}>添加</K.Button></div>
      </K.Card>
    </>
  );
}
/** Settings of one module (modules page and the blueprint side panel). */
export function ModuleEditor({ name, onDeleted }: { name: string; onDeleted?: () => void }) {
  const K = useKit(), { d, set, note } = useB();
  const modules = d.modules ?? {}, groups = d.groups ?? {}, m = modules[name];
  if (!m) return null;
  const counts: Record<string, number> = {};
  const walk = (n: FieldNode) => { for (const [, c] of childrenOf(n)) { for (const x of ([] as string[]).concat(c.module ?? [])) counts[x] = (counts[x] ?? 0) + 1; walk(c); } };
  walk(rootNode(d));
  const setModules = (next: Record<string, StructureModule>) => set({ ...d, modules: next });
  const patch = (n: string, p: Partial<StructureModule>) => setModules(Object.fromEntries(Object.entries(modules).map(([k, x]) => [k, k === n ? clean({ ...x, ...p }) : x])));
  const groupOptions: [string, string][] = [['', '不在互斥组里'], ...Object.entries(groups).map(([g, x]) => [g, x.label ?? g] as [string, string])];
  return (
    <>
                <Field label="显示名"><TextInput label="显示名" value={m.label ?? ''} placeholder={name} onCommit={v => patch(name, { label: v.trim() || undefined })} /></Field>
                <Field label="上级模块" hint="上级关闭时它也不生效"><Select label="上级模块" value={m.parent ?? ''} options={[['', '无'], ...Object.keys(modules).filter(n => n !== name).map(n => [n, modules[n]!.label ?? n] as [string, string])]} onChange={v => patch(name, { parent: v || undefined })} /></Field>
                <Field label="互斥组"><Select label="互斥组" value={m.exclusive ?? ''} options={groupOptions} onChange={v => patch(name, { exclusive: v || undefined })} /></Field>
                <Field label="新聊天默认开启" hint={m.exclusive ? '同一互斥组只能有一个默认开启' : undefined}><K.Switch checked={m.enabled !== false} aria-label="默认开启" onCheckedChange={v => patch(name, { enabled: v ? undefined : false })} /></Field>
                <Field label="模块规则" hint="开启时发给模型；只写跨字段的规则，字段各自的含义写在字段的「给模型的说明」里"><TextInput label="模块规则" value={m.guide ?? ''} multiline onCommit={v => patch(name, { guide: v.trim() || undefined })} /></Field>
                <div {...part('actions')}>
                  <K.Button size="sm" variant="danger" disabled={!!counts[name] || Object.values(modules).some(x => x.parent === name)}
                    onClick={() => { const { [name]: _, ...rest } = modules; setModules(rest); onDeleted?.(); note(`已删除模块「${m.label ?? name}」`); }}>删除模块</K.Button>
                  {counts[name] || Object.values(modules).some(x => x.parent === name) ? <small>还有字段或下级模块用着它，先把它们移走</small> : null}
                </div>
    </>
  );
}
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

// ── 检查与发布 ──

function PublishPage() {
  const K = useKit(), { d, set, check, select, go, host, note } = useB();
  const errors = check?.issues.filter(i => i.level === 'error') ?? [], warnings = check?.issues.filter(i => i.level === 'warning') ?? [];
  const changes = React.useMemo(() => diffFields(host.published, d), [host.published, d]);
  const [showAll, setShowAll] = React.useState(false);
  const [entries, setEntries] = React.useState<{ comment: string; content: string }[] | undefined>();
  const download = (name: string, text: string, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const jump = (i: Issue) => { if (i.addr) { go('fields'); select(i.addr); } else if (i.where === '模块') go('modules'); };
  const impact = !check ? '检查中…' : check.impact === 'structure' ? '改了字段、模块或约束：已有聊天继续用旧版本，新开的聊天用这一版。记得提高版本号。'
    : check.impact === 'display' ? '只改了显示（布局、显示名、剧透、控件、曲库）：发布后所有聊天立即生效。' : check.impact === 'none' ? '和已发布的版本相同。' : '有错误，暂时算不出影响。';
  const label = (p: string) => { const a = p.split('.'), at = (x: Addr) => nodeAt(d, x) ?? nodeAt(host.published, x); return a.map((_, i) => nameOf(at(a.slice(0, i + 1)), a[i]!, at(a.slice(0, i)))).join(' › '); };
  const changeRows: [string, string][] = [...changes.renamed.map(([f, t]) => ['改名', `${f} → ${t}`] as [string, string]), ...changes.added.map(p => ['新增', p] as [string, string]), ...changes.removed.map(p => ['删除', p] as [string, string]), ...changes.changed.map(p => ['修改', p] as [string, string])];
  const issueList = (list: Issue[]) => (
    <ul {...solve('builder-issue-list')}>{list.map((i, n) => (
      <li key={n} data-level={i.level}><button type="button" onClick={() => jump(i)} disabled={!i.addr && !i.where}>
        <span>{i.addr ? label(addrKey(i.addr)) : i.where ?? '结构'}</span><small>{i.message}</small></button></li>
    ))}</ul>
  );
  return (
    <>
      <section {...solve('debug-facts')}>
        <div><span>状态</span><b data-tone={errors.length ? 'error' : 'ok'}>{!check ? '检查中…' : errors.length ? `${errors.length} 个错误` : '编译通过'}</b></div>
        <div><span>字段</span><b>{check?.fieldCount ?? '—'}</b></div>
        <div><span>模块</span><b>{Object.keys(d.modules ?? {}).length}</b></div>
        <div><span>指纹</span><b><code>{check?.fingerprint?.replace(/^sha256:/u, '').slice(0, 10) ?? '—'}</code></b></div>
      </section>
      <K.Card title="发布的影响"><p {...part('impact')} data-impact={check?.impact}>{impact}</p></K.Card>
      {errors.length ? <K.Card title={`错误（${errors.length}）`} meta={<small>改好之前不能发布</small>}>{issueList(errors)}</K.Card> : null}
      <K.Card title={`提醒（${warnings.length}）`} meta={<small>能用，但多半值得看一眼</small>}>
        {warnings.length ? <>{issueList(showAll ? warnings : warnings.slice(0, 8))}{warnings.length > 8 ? <K.Button size="sm" variant="ghost" onClick={() => setShowAll(v => !v)}>{showAll ? '收起' : `显示全部 ${warnings.length} 条`}</K.Button> : null}</> : <p {...part('none')}>没有提醒。</p>}
      </K.Card>
      <K.Card title={`和已发布版本相比（${changeRows.length} 处）`}>
        {changeRows.length ? <ul {...solve('builder-changes')}>{changeRows.slice(0, 40).map(([kind, p]) => <li key={kind + p} data-kind={kind}><em>{kind}</em><span>{label(p.split(' → ').at(-1)!)}</span><code>{p}</code></li>)}</ul> : <p {...part('none')}>字段没有变化{JSON.stringify(d) !== JSON.stringify(host.published) ? '（改了模块或其他设置）' : ''}。</p>}
      </K.Card>
      <K.Card title="名称与版本">
        <Field label="结构 ID" hint="英文，发布后不要再改"><TextInput label="结构 ID" mono value={d.id} validate={v => /^[a-z0-9][a-z0-9_-]*$/iu.test(v) ? undefined : '只用英文字母、数字、- 和 _'} onCommit={v => set({ ...d, id: v })} /></Field>
        <Field label="显示名"><TextInput label="显示名" value={d.label ?? ''} onCommit={v => set({ ...d, label: v.trim() || undefined } as StructureDescription)} /></Field>
        <Field label="版本号" hint={check?.impact === 'structure' && d.version === host.published.version ? '改了结构，建议提高版本号' : '如 1.0.1'}><TextInput label="版本号" mono value={d.version} validate={v => v.trim() ? undefined : '不能为空'} onCommit={v => set({ ...d, version: v.trim() })} /></Field>
      </K.Card>
      <K.Card title="发布">
        <div {...solve('debug-tools')}>
          <div><b>写进角色世界书</b><small>自动在{host.character ? `「${host.character}」的` : '角色'}世界书里创建或更新 [SOLVE:STRUCTURE] 条目（较大时分成几条），跟着角色卡导出、分享。</small>
            <K.Button size="sm" variant="primary" disabled={!!errors.length || !check} onClick={() => setEntries(worldEntries(d))}>写入…</K.Button></div>
          <div><b>导出 JS 脚本</b><small>放进角色卡的酒馆助手脚本（加载 SOLVE 之后）。</small>
            <K.Button size="sm" disabled={!!errors.length || !check} onClick={() => download(`${d.id}-${d.version}.js`, scriptFor(d), 'text/javascript')}>下载 .js</K.Button></div>
          <div><b>导出 JSON</b><small>结构描述本身，用于备份或分享给别的作者导入。</small>
            <K.Button size="sm" onClick={() => download(`${d.id}-${d.version}.json`, JSON.stringify(d, null, 2), 'application/json')}>下载 .json</K.Button></div>
        </div>
      </K.Card>
      {entries ? (
        <K.Card title={`将写入 ${entries.length} 条世界书条目`} meta={<K.Button size="sm" variant="ghost" onClick={() => setEntries(undefined)}>关闭</K.Button>}>
          <ul {...solve('builder-entries')}>{entries.map(e => <li key={e.comment}><code>{e.comment}</code><small>{e.content.length.toLocaleString()} 字</small></li>)}</ul>
          {host.writeWorldBook ? <K.Button variant="primary" onClick={() => void host.writeWorldBook!(entries).then(() => { note('已写入世界书'); setEntries(undefined); }, e => note('写入失败：' + (e?.message ?? e), 'error'))}>确认写入</K.Button>
            : <p {...part('hint')}>还不能直接写进世界书：SOLVE 目前还不读取这种条目。请先用上面的「下载 .js」，放进角色卡的酒馆助手脚本。</p>}
        </K.Card>
      ) : null}
    </>
  );
}

// ── 以后的页面 ──

export { freeKey };
