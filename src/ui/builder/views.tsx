/**
 * 结构制作 · 视图（预览三）。视图决定 {{solve_json::视图}} / {{solve_toon::视图}} 输出哪些数据。
 * 三个内置视图（完整 / 叙事 / 操作）由字段上的「不给模型看」「模型只能看不能改」决定；作者还可以自制视图：
 * 以某个内置视图为底，只保留几处、再去掉几处。右边是用当前聊天的数据按草稿输出的结果，带字数。
 *
 * 自制视图的声明格式（`views: { 名字: { label, desc, base, include, exclude } }`）是这一版预览提出的，引擎还没有读取它；
 * 预览里的输出由下面的 `runView` 在界面里算出，确认后再由 compileStructure 编译成视图函数。
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { project } from '../../projection.js';
import { encode } from '@toon-format/toon';
import type { FieldNode, StructureDescription } from '../../structure.js';
import type { CompiledDefinition, Json, LogicalState } from '../../types.js';
import { KEY_RE, childrenOf, rootNode, update } from './draft.js';
import { Field, Select, TextInput, part, solve, useB } from './builder.js';
import { PathInput, PathsInput, Split, pathOptions, useDraftModel } from './common.js';

type Base = 'full' | 'narrative' | 'operator';
export interface ViewSpec { label?: string; desc?: string; base?: Base; include?: string[]; exclude?: string[] }
type Views = Record<string, ViewSpec>;
const BUILT_IN: { id: Base; label: string; text: string; flag?: 'internal' | 'readonly'; flagLabel?: string }[] = [
  { id: 'full', label: '完整', text: '全部数据（已关闭模块的除外）。' },
  { id: 'narrative', label: '叙事', text: '去掉「不给模型看」的字段，给写正文的模型。', flag: 'internal', flagLabel: '不给模型看' },
  { id: 'operator', label: '操作', text: '去掉「模型只能看不能改」的字段，给只写变量的操作模型。', flag: 'readonly', flagLabel: '模型只能看不能改' },
];
const viewsOf = (d: StructureDescription): Views => ((d as unknown as { views?: Views }).views ?? {});
const withViews = (d: StructureDescription, v: Views): StructureDescription => {
  const { views: _, ...rest } = d as StructureDescription & { views?: Views };
  return (Object.keys(v).length ? { ...rest, views: v } : rest) as StructureDescription;
};

/** Fields carrying a flag, as dotted paths (`characters.*.thumb`). */
function flagged(d: StructureDescription, flag: 'internal' | 'readonly'): string[] {
  const out: string[] = [];
  const walk = (n: FieldNode, at: string[]) => { for (const [k, c] of childrenOf(n)) { const p = [...at, k]; if (c[flag]) out.push(p.join('.')); walk(c, p); } };
  walk(rootNode(d), []);
  return out;
}
/** Removes a dotted path (`*` = every key) from projected data; entity keys there carry `@`. */
function strip(data: Json, parts: string[]): void {
  if (!data || typeof data !== 'object' || !parts.length) return;
  const [head, ...rest] = parts, obj = data as Record<string, Json>;
  const keys = head === '*' ? Object.keys(obj) : [head!, '@' + head!].filter(k => Object.hasOwn(obj, k));
  for (const k of keys) { if (rest.length) strip(obj[k]!, rest); else delete obj[k]; }
}
/** What a view outputs for the draft: the base view (narrowed to `include`), minus `exclude`. */
export function runView(def: CompiledDefinition, state: LogicalState, name: string, views: Views): Json {
  const spec = views[name];
  if (!spec) return project(def, state, { view: name });
  const out = project(def, state, { view: spec.base ?? 'full', ...(spec.include?.length ? { paths: spec.include } : {}) });
  for (const p of spec.exclude ?? []) strip(out, p.split('.'));
  return out;
}

type Sel = { kind: 'built'; id: Base } | { kind: 'custom'; id: string };
export function ViewsPage() {
  const K = useKit(), { d, set, note } = useB();
  const views = viewsOf(d);
  const [sel, setSel] = React.useState<Sel>({ kind: 'built', id: 'narrative' });
  const setViews = (v: Views) => set(withViews(d, v));
  const patchView = (name: string, p: Partial<ViewSpec>) => setViews({ ...views, [name]: Object.fromEntries(Object.entries({ ...views[name], ...p }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as ViewSpec });
  const add = () => { let k = 'view', n = 2; while (Object.hasOwn(views, k)) k = 'view' + n++; setViews({ ...views, [k]: { label: '新视图', base: 'full' } }); setSel({ kind: 'custom', id: k }); };
  const deep = pathOptions(d, [], true);
  const editor = (
    <div {...solve('builder-views')}>
      <p {...part('intro')}>视图决定 <code>{'{{solve_json::视图}}'}</code> / <code>{'{{solve_toon::视图}}'}</code> 给模型哪些数据。已关闭模块的字段在任何视图里都没有；「提示词」页的投影规则对所有视图生效（写了「只保留」的视图除外）。</p>
      <K.Card title="内置视图" meta={<small>由字段上的开关决定</small>}>
        <ul {...solve('builder-vlist')}>
          {BUILT_IN.map(v => {
            const paths = v.flag ? flagged(d, v.flag) : [];
            const on = sel.kind === 'built' && sel.id === v.id;
            return (
              <li key={v.id} data-selected={on ? '' : undefined}>
                <button type="button" {...part('head')} onClick={() => setSel({ kind: 'built', id: v.id })} aria-pressed={on}>
                  <b>{v.label}</b><code>{v.id}</code><small>{v.text}</small>
                </button>
                {v.flag ? (
                  <div {...part('body')}>
                    <small {...part('hint')}>{paths.length ? `去掉 ${paths.length} 个字段：` : '没有字段打开这个开关，和完整视图一样。'}</small>
                    <div {...solve('builder-flags')}>
                      {paths.map(p => (
                        <span key={p} {...part('chip')}><code>{p}</code>
                          <button type="button" aria-label={`${p} 不再「${v.flagLabel}」`} onClick={() => { set(update(d, p.split('.'), { [v.flag!]: undefined } as Partial<FieldNode>)); note(`${p} 已关掉「${v.flagLabel}」（可撤销）`); }}>×</button>
                        </span>
                      ))}
                      <PathInput key={paths.join()} value={undefined} label={`给字段打开「${v.flagLabel}」`} placeholder="+ 添加字段" options={deep.filter(o => !paths.includes(o.path))}
                        onChange={p => { if (p) set(update(d, p.split('.'), { [v.flag!]: true } as Partial<FieldNode>)); }} />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p {...part('hint')}>这两个开关也在「字段蓝图」里每个字段的设置中。</p>
      </K.Card>
      <K.Card title="自制视图" meta={<small>{Object.keys(views).length} 个</small>}>
        {Object.keys(views).length ? null : <p {...part('hint')}>例如只给总结模型看人物和关键事件，或给生图模型只看外貌。</p>}
        <ul {...solve('builder-vlist')}>
          {Object.entries(views).map(([name, v]) => {
            const on = sel.kind === 'custom' && sel.id === name;
            return (
              <li key={name} data-selected={on ? '' : undefined}>
                <button type="button" {...part('head')} onClick={() => setSel({ kind: 'custom', id: name })} aria-pressed={on}>
                  <b>{v.label ?? name}</b><code>{name}</code><small>{v.desc ?? `以${BUILT_IN.find(b => b.id === (v.base ?? 'full'))!.label}视图为底`}</small>
                </button>
                {on ? <ViewForm name={name} spec={v} views={views} onPatch={p => patchView(name, p)}
                  onRename={to => { setViews(Object.fromEntries(Object.entries(views).map(([k, x]) => [k === name ? to : k, x]))); setSel({ kind: 'custom', id: to }); }}
                  onRemove={() => { const { [name]: _, ...rest } = views; setViews(rest); setSel({ kind: 'built', id: 'full' }); note(`已删除视图 ${name}（可撤销）`); }} /> : null}
              </li>
            );
          })}
        </ul>
        <K.Button size="sm" variant="ghost" onClick={add}>+ 视图</K.Button>
      </K.Card>
    </div>
  );
  return <Split previewLabel="视图输出" editor={editor} preview={<ViewPreview sel={sel} onSel={setSel} views={views} />} />;
}

function ViewForm({ name, spec, views, onPatch, onRename, onRemove }: { name: string; spec: ViewSpec; views: Views; onPatch: (p: Partial<ViewSpec>) => void; onRename: (to: string) => void; onRemove: () => void }) {
  const { d } = useB();
  const deep = pathOptions(d, [], true);
  return (
    <div {...part('body')}>
      <div {...part('grid')}>
        <Field label="名字" hint="宏里用的英文名"><TextInput label="名字" mono value={name}
          validate={v => !KEY_RE.test(v) ? '英文字母、数字、下划线' : ['full', 'narrative', 'operator'].includes(v) ? '和内置视图重名' : v !== name && Object.hasOwn(views, v) ? '重名' : undefined} onCommit={onRename} /></Field>
        <Field label="显示名"><TextInput label="显示名" value={spec.label ?? ''} onCommit={v => onPatch({ label: v.trim() || undefined })} /></Field>
      </div>
      <Field label="说明"><TextInput label="说明" value={spec.desc ?? ''} placeholder="给谁用、看什么" onCommit={v => onPatch({ desc: v.trim() || undefined })} /></Field>
      <Field label="基于" hint="先按这个内置视图去掉字段">
        <Select label="基于" value={spec.base ?? 'full'} options={BUILT_IN.map(b => [b.id, `${b.label}（${b.id}）`] as [string, string])} onChange={v => onPatch({ base: v as Base })} />
      </Field>
      <Field label="只保留" hint="不写就是全部。写了以后投影规则不再生效，按路径原样输出；* 表示每一项">
        <PathsInput label="只保留" value={spec.include} options={deep} onChange={v => onPatch({ include: v })} />
      </Field>
      <Field label="再去掉" hint="如 characters.*.appearance">
        <PathsInput label="再去掉" value={spec.exclude} options={deep} onChange={v => onPatch({ exclude: v })} />
      </Field>
      <div {...part('foot')}>
        <span {...part('macros')}><code>{`{{solve_toon::${name}}}`}</code><code>{`{{solve_json::${name}}}`}</code></span>
        <button type="button" {...part('remove')} onClick={onRemove} aria-label={`删除视图 ${name}`}>删除</button>
      </div>
    </div>
  );
}

function ViewPreview({ sel, onSel, views }: { sel: Sel; onSel: (s: Sel) => void; views: Views }) {
  const K = useKit();
  const { def, state, why } = useDraftModel();
  const [fmt, setFmt] = React.useState<'toon' | 'json'>('toon');
  const names: [string, string][] = [...BUILT_IN.map(b => [b.id, b.label] as [string, string]), ...Object.entries(views).map(([k, v]) => [k, v.label ?? k] as [string, string])];
  const scripted = Object.keys(def?.views ?? {}).filter(k => !Object.hasOwn(views, k));
  const out = React.useMemo(() => {
    if (!def || !state) return undefined;
    const text = (name: string) => { const data = runView(def, state, name, views); return fmt === 'toon' ? encode(data as never) : JSON.stringify(data, null, 1); };
    try { return { text: text(sel.id), full: text('full').length }; } catch (e: any) { return { error: e?.message ?? String(e) }; }
  }, [def, state, sel.id, views, fmt]);
  return (
    <section {...solve('builder-live')} aria-label="视图输出">
      <header><b>视图输出</b><small>{why ?? '当前聊天的数据，按草稿生成'}</small></header>
      <div {...part('bar')}>
        <Select label="视图" value={sel.id} options={names} onChange={v => onSel(BUILT_IN.some(b => b.id === v) ? { kind: 'built', id: v as Base } : { kind: 'custom', id: v })} />
        {K.Segmented ? <K.Segmented label="格式" value={fmt} onValueChange={v => setFmt(v as 'toon' | 'json')} options={[{ value: 'toon', label: 'TOON' }, { value: 'json', label: 'JSON' }]} /> : null}
      </div>
      {out && 'error' in out ? <p {...part('broken')}>生成出错：{out.error}</p> : out ? <>
        <small {...part('count')}>{out.text!.length} 字{sel.id !== 'full' ? ` · 比完整视图少 ${out.full! - out.text!.length} 字` : ''}</small>
        <pre {...part('text')}>{out.text}</pre>
      </> : null}
      {scripted.length ? <p {...part('hint')}>作者脚本里还定义了视图：{scripted.join('、')}（只能在脚本里改）。</p> : null}
    </section>
  );
}
