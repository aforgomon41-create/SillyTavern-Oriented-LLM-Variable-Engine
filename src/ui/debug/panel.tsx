/**
 * SOLVE debug panel (for card authors). Same kit and skins as the status bar, opened in the same layer.
 * Pages: 概览 · 状态 · 历史 · 操作台 · 提示词 · 结构 · 日志. Reads never touch the chat; every write goes through
 * the controller (archived, replayable), and writes are disabled while the state is not ready.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { StatusModel } from '../statusbar/model.js';
import { useWide } from '../statusbar/widgets.js';
import { StateEditor } from './console.js';
import type { Feedback, LogicalState } from '../../types.js';
import { Diff, FeedbackBadges, FeedbackList, Json, brief, named, useStateBefore, describe, message, part, partsOf, short, size, solve, valueAt, type Controller, type DebugHost } from './shared.js';

type Page = 'overview' | 'state' | 'history' | 'console' | 'prompt' | 'structure' | 'logs';
const PAGES: { id: Page; label: string }[] = [
  { id: 'overview', label: '概览' }, { id: 'state', label: '状态' }, { id: 'history', label: '历史' }, { id: 'console', label: '操作台' },
  { id: 'prompt', label: '提示词' }, { id: 'structure', label: '结构' }, { id: 'logs', label: '日志' },
];
interface Ctx { c: Controller; m: StatusModel; state: LogicalState; status: any; ready: boolean; go: (p: Page, focus?: string) => void; focus?: string; run: (label: string, task: () => Promise<unknown>) => Promise<boolean>; busy: boolean }
const DebugContext = React.createContext<Ctx | null>(null);
const useDebug = () => React.useContext(DebugContext)!;

export function DebugPanel({ host, onClose, defaultPage }: { host: DebugHost; onClose: () => void; defaultPage?: Page }) {
  const K = useKit();
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  const c = host.sessions.controller;
  React.useEffect(() => host.sessions.subscribe(tick), [host]);
  React.useEffect(() => c?.subscribe(tick), [c]);
  let state: LogicalState | undefined;
  try { state = c?.getState(); } catch { state = undefined; }
  const title = <span {...solve('debug-title')}><b>SOLVE 调试</b><small>{host.version}{host.demo ? ' · 演示' : ''}</small></span>;
  return (
    <K.Panel title={title} onClose={onClose} closeLabel="关闭调试面板" defaultSize={{ w: 1180, h: 860 }} minSize={{ w: 560, h: 420 }}>
      {c && state ? <Bound host={host} c={c} state={state} {...(defaultPage ? { defaultPage } : {})} /> : <Unbound host={host} />}
    </K.Panel>
  );
}

function Bound({ host, c, state, defaultPage = 'overview' }: { host: DebugHost; c: Controller; state: LogicalState; defaultPage?: Page }) {
  const K = useKit();
  const [box, wide] = useWide(900);
  const [page, setPage] = React.useState<Page>(defaultPage);
  const [focus, setFocus] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ text: string; tone?: 'error' } | undefined>();
  const status = c.getStatus();
  const m = React.useMemo(() => new StatusModel(c.core.definition, state, { revealSpoilers: true }), [c, state]);
  const go = (p: Page, f?: string) => { setPage(p); setFocus(f); };
  const run = async (label: string, task: () => Promise<unknown>) => {
    setBusy(true); setNote(undefined);
    try { await task(); setNote({ text: label + '：完成' }); return true; } catch (error) { setNote({ text: label + '：' + message(error), tone: 'error' }); return false; } finally { setBusy(false); }
  };
  const ctx: Ctx = { c, m, state, status, ready: !!status.ready && !status.busy, go, ...(focus ? { focus } : {}), run, busy };
  const body = (id: Page) => (
    <div {...solve('debug-page', { page: id })}>
      {id === 'overview' ? <Overview host={host} /> : id === 'state' ? <StatePage /> : id === 'history' ? <History /> : id === 'console' ? <Console />
        : id === 'prompt' ? <Prompt /> : id === 'structure' ? <Structure /> : <Logs />}
    </div>
  );
  const issue = !status.ready || status.pendingCount;
  return (
    <DebugContext.Provider value={ctx}>
      <div ref={box} {...solve('debug', { layout: wide ? 'sidebar' : 'tabs' })}>
        <div {...solve('debug-status', { tone: issue ? 'warning' : 'ok' })} role="status">
          <i aria-hidden="true" />
          <span>{!status.ready ? status.reason || '尚未就绪' : status.busy ? '正在保存…' : status.pendingCount ? `有 ${status.pendingCount} 次操作没保存成功（见概览）` : '状态已同步'}</span>
          <small>{c.core.definition.id} · {c.core.definition.version}</small>
          {note ? <span {...part('note')} data-tone={note.tone}>{note.text}</span> : null}
        </div>
        {wide ? (
          <div {...part('split')}>
            <div {...part('nav')}><K.NavList layout="sidebar" label="调试" current={page} onSelect={id => go(id as Page)}
              items={PAGES.map(p => ({ id: p.id, label: p.label, ...(p.id === 'overview' && issue ? { meta: '!' } : {}) }))} /></div>
            <div {...part('main')}>{body(page)}</div>
          </div>
        ) : (
          <K.Tabs label="调试" mode="scroll" value={page} onValueChange={v => go(v as Page)} items={PAGES.map(p => ({ value: p.id, label: p.label, content: body(p.id) }))} />
        )}
      </div>
    </DebugContext.Provider>
  );
}

// ── 概览 ──

function Overview({ host }: { host: DebugHost }) {
  const K = useKit(), { c, m, state, status, ready, go, run, busy } = useDebug();
  const head = c.runtime.getCommit(), history = c.getHistory(), before = useStateBefore(c, head);
  const messages = c.getMessages(), floor = messages.findLastIndex(x => x.role === 'assistant');
  const pending = c.getPending();
  const [checked, setChecked] = React.useState<{ ok: number; bad: { head: string; error: string }[] } | undefined>();
  const validate = () => run('校验归档', async () => {
    const r: any[] = await c.validateArchive();
    setChecked({ ok: r.filter(x => x.valid).length, bad: r.filter(x => !x.valid).map(x => ({ head: x.commitId, error: x.message ?? x.code ?? '' })) });
  });
  const exportReport = () => {
    const report = c.exportDebugReport({ includeState: true });
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `solve-report-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const facts: [string, React.ReactNode][] = [
    ['当前楼层', floor >= 0 ? `#${floor} · 第 ${(state.data as any)?.meta?.round ?? '—'} 轮` : '—'],
    ['当前提交', <code key="c">{short(head?.id)}</code>],
    ['保留提交', `${history.length} 条（含旧版本）`],
    ['待保存', status.pendingCount ? <K.Badge key="p" tone="warning">{status.pendingCount}</K.Badge> : '无'],
    ['模式', status.mode === 'out-of-band' ? '独立操作模型' : '回复内操作块'],
    ['恢复来源', status.cache?.enabled ? (status.cache.source === 'archive' ? '聊天归档' : '浏览器快照') : '聊天归档（缓存关闭）'],
  ];
  return (
    <>
      {!status.ready || pending.length ? (
        <section {...solve('debug-alert')}>
          <h3>需要处理</h3>
          <p>{status.reason || (pending.length ? '有一次操作没有保存成功。可以重试保存（不会重新执行），或放弃这次操作。' : '')}</p>
          <div {...part('actions')}>
            {pending.length ? <>
              <K.Button size="sm" variant="primary" disabled={busy} onClick={() => void run('重试保存', () => c.retryPending())}>重试保存</K.Button>
              <K.Button size="sm" variant="ghost" disabled={busy} onClick={() => void run('放弃待保存', async () => c.discardPending())}>放弃这次操作</K.Button>
            </> : <>
              <K.Button size="sm" variant="primary" disabled={busy} onClick={() => void run('重新检查', () => c.refresh())}>重新检查</K.Button>
              <K.Button size="sm" disabled={busy} onClick={() => go('history')}>去历史里重放</K.Button>
            </>}
          </div>
        </section>
      ) : null}
      <section {...solve('debug-facts')}>
        {facts.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
      </section>
      <K.Card title="最近一次变化" meta={head ? `提交 ${short(head.id)}` : undefined}>
        {head ? <>
          <Actions actions={head.actions} />
          <h4 {...part('sub')}>反馈</h4>
          <FeedbackList items={head.feedback} m={m} empty="没有反馈：所有操作都按原样执行。" />
          <h4 {...part('sub')}>数据变化</h4>
          <Diff patch={head.dataPatch} before={before} m={m} />
          <div {...part('more')}><K.Button size="sm" variant="ghost" onClick={() => go('history')}>在历史里查看 ›</K.Button></div>
        </> : <p>还没有提交。</p>}
      </K.Card>
      <K.Card title="工具">
        <div {...solve('debug-tools')}>
          <div><b>校验归档</b><small>逐个核对每个保留版本能否从聊天里完整恢复。只读。</small>
            <K.Button size="sm" disabled={busy} onClick={() => void validate()}>校验</K.Button>
            {checked ? <span {...part('result')} data-tone={checked.bad.length ? 'error' : 'ok'}>{checked.bad.length ? `${checked.bad.length} 个版本有问题：${checked.bad[0]!.error}` : `${checked.ok} 个版本全部通过`}</span> : null}</div>
          <div><b>导出报告</b><small>下载一份本地 JSON（含状态、历史动作与日志，可能有角色变量值），用于反馈问题。不会自动上传。</small>
            <K.Button size="sm" onClick={exportReport}>下载</K.Button></div>
          {host.demo ? <div><b>演示：生成下一轮</b><small>模拟模型回复一条带操作块的消息。</small>
            <K.Button size="sm" disabled={busy || !ready} onClick={() => void run('生成下一轮', () => host.demo!.addReply())}>生成</K.Button></div> : null}
          {host.demo ? <div><b>演示：保存失败</b><small>打开后，下一次保存会失败并留下待保存操作，用来看「需要处理」的样子。</small>
            <FailureToggle host={host} /></div> : null}
        </div>
      </K.Card>
    </>
  );
}
function FailureToggle({ host }: { host: DebugHost }) {
  const K = useKit(); const [on, setOn] = React.useState(false);
  return <K.Switch checked={on} aria-label="模拟保存失败" onCheckedChange={v => { setOn(v); host.demo!.setFailure(v); }} />;
}
const SOURCE: Record<string, string> = { model: '模型', user: '玩家' };
function Actions({ actions }: { actions: any[] }) {
  const K = useKit(), modules = (React.useContext(DebugContext)?.c.core.definition.modules ?? {}) as Record<string, { label?: string }>;
  if (!actions.length) return <p {...part('none')}>开局状态（没有动作）</p>;
  return (
    <ol {...solve('debug-actions')}>
      {actions.map((a, i) => (
        <li key={i}>
          <K.Badge tone={a.source === 'user' ? 'accent' : 'neutral'}>{SOURCE[a.source] ?? a.source}</K.Badge>
          <span {...part('what')}>{a.kind === 'module' ? `${a.enabled ? '开启' : '关闭'}模块「${modules[a.module]?.label ?? a.module}」` : a.kind === 'settings' ? '修改设置' : `${countOps(a.operations)} 条操作`}</span>
          {a.authorInputs?.narrate ? <q>{a.authorInputs.narrate}</q> : null}
          <details><summary>原文</summary><Json value={a.kind === 'operations' ? a.operations : a} label="动作" max={260} /></details>
        </li>
      ))}
    </ol>
  );
}
const countOps = (ops: unknown): number => Array.isArray(ops) ? ops.reduce((n: number, o: any) => n + (o && typeof o === 'object' && Array.isArray(o.$group) ? countOps(o.$group) : 1), 0) : 1;

// ── 状态 ──

function StatePage() {
  const K = useKit(), { m, state, go, focus } = useDebug();
  const [mode, setMode] = React.useState<'tree' | 'json'>('tree');
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<string[]>(focus ? partsOf(focus) : ['meta']);
  const [box, wide] = useWide(760);
  const Text = K.TextField;
  return (
    <>
      <div {...solve('debug-bar')}>
        {Text ? <Text size="sm" placeholder="搜索名称、键或值（如 好感度、affection、米拉）" value={query} onChange={e => setQuery(e.target.value)} aria-label="搜索状态" />
          : <input placeholder="搜索" value={query} onChange={e => setQuery(e.target.value)} aria-label="搜索状态" />}
        {K.Segmented ? <K.Segmented size="sm" label="显示方式" value={mode} onValueChange={v => setMode(v as 'tree' | 'json')} options={[{ value: 'tree', label: '结构' }, { value: 'json', label: 'JSON' }]} /> : null}
      </div>
      {mode === 'json' ? <Json value={state.data} label="state.data（完整，不受剧透与模块影响）" /> : (
        <div ref={box} {...solve('debug-explorer', { layout: wide ? 'split' : 'stack' })}>
          <div {...part('tree')} role="tree" aria-label="状态树">
            <Tree parts={[]} value={state.data} m={m} query={query.trim().toLowerCase()} selected={selected} onSelect={setSelected} depth={0} />
          </div>
          <Inspector parts={selected} onEdit={p => go('console', p)} />
        </div>
      )}
    </>
  );
}
function matches(m: StatusModel, parts: string[], value: unknown, q: string): boolean {
  if (!q) return true;
  const here = (describe(m, parts) + ' ' + parts.join('.')).toLowerCase();
  if (here.includes(q)) return true;
  if (value !== null && typeof value === 'object') return Object.entries(value).some(([k, v]) => matches(m, [...parts, k], v, q));
  return String(value).toLowerCase().includes(q);
}
function Tree({ parts, value, m, query, selected, onSelect, depth }: { parts: string[]; value: unknown; m: StatusModel; query: string; selected: string[]; onSelect: (p: string[]) => void; depth: number }) {
  const entries = value && typeof value === 'object' ? Object.entries(value as object) : [];
  return (
    <ul {...solve('debug-tree')}>
      {entries.filter(([k, v]) => matches(m, [...parts, k], v, query)).map(([k, v]) => <Node key={k} parts={[...parts, k]} value={v} m={m} query={query} selected={selected} onSelect={onSelect} depth={depth} />)}
    </ul>
  );
}
function Node({ parts, value, m, query, selected, onSelect, depth }: { parts: string[]; value: unknown; m: StatusModel; query: string; selected: string[]; onSelect: (p: string[]) => void; depth: number }) {
  const branch = value !== null && typeof value === 'object';
  const onPath = selected.length > parts.length && parts.every((p, i) => selected[i] === p);
  const [open, setOpen] = React.useState(depth < 1 || onPath);
  React.useEffect(() => { if (query || onPath) setOpen(true); }, [query, onPath]);
  const key = parts.at(-1)!, pattern = m.pattern(parts).split('.');
  const name = pattern[parts.length - 1] === '*' ? (m.entityName(key) || key) : /^\d+$/u.test(key) ? '#' + (Number(key) + 1) : m.label(parts);
  const dormant = m.dormant(parts), spoil = m.spoiler(parts), current = selected.join('.') === parts.join('.');
  const count = branch ? Object.keys(value as object).length : 0;
  return (
    <li role="treeitem" aria-expanded={branch ? open : undefined} aria-selected={current}>
      <button type="button" {...part('row')} data-current={current ? '' : undefined} data-dormant={dormant ? '' : undefined} onClick={() => { onSelect(parts); if (branch) setOpen(o => !o || !current); }}>
        <span {...part('twist')} aria-hidden="true">{branch ? (open ? '▾' : '▸') : ''}</span>
        <span {...part('label')}>{name}</span>
        {name !== key ? <code>{key}</code> : null}
        {branch ? <small>{Array.isArray(value) ? `[${count}]` : `{${count}}`}</small> : <span {...part('value')}>{named(m, value)}</span>}
        {dormant ? <i data-tag="dormant">休眠</i> : spoil === 'hidden' ? <i data-tag="hidden">隐藏</i> : null}
      </button>
      {branch && open ? <Tree parts={parts} value={value} m={m} query={query} selected={selected} onSelect={onSelect} depth={depth + 1} /> : null}
    </li>
  );
}
function Inspector({ parts, onEdit }: { parts: string[]; onEdit: (path: string) => void }) {
  const K = useKit(), { m, state, c } = useDebug();
  const value = valueAt(state.data, parts), meta = (m.meta(parts) ?? {}) as Record<string, any>;
  const pattern = m.pattern(parts), dormant = m.dormant(parts), spoil = m.spoiler(parts);
  const modules = Object.entries(c.core.definition.modules ?? {}).filter(([, mod]) => mod.paths.some(p => pattern === p || pattern.startsWith(p + '.'))).map(([n, mod]) => mod.label ?? n);
  const numeric = (c.core.definition.numeric ?? {})[pattern] as any;
  const list = (c.core.definition.lists ?? {})[pattern] as any;
  const entity = (() => { for (let i = parts.length; i > 0; i--) { const p = m.pattern(parts.slice(0, i)).split('.'); if (p[i - 1] === '*') return parts[i - 1]; } return undefined; })();
  const path = entity ? '@' + entity + (parts.slice(parts.indexOf(entity) + 1).length ? '.' + parts.slice(parts.indexOf(entity) + 1).join('.') : '') : parts.join('.');
  const rows: [string, React.ReactNode][] = [
    ['路径', <code key="p">{parts.join('.') || '（根）'}</code>],
    ...(entity ? [['实体写法', <code key="e">{path}</code>] as [string, React.ReactNode]] : []),
    ['结构位置', <code key="s">{pattern || '（根）'}</code>],
    ...(meta.type ? [['类型', meta.type + (meta.values ? '：' + (meta.values as string[]).join(' / ') : '')] as [string, React.ReactNode]] : []),
    ...(numeric ? [['数值约束', [numeric.min !== undefined ? '最小 ' + numeric.min : '', numeric.max !== undefined ? '最大 ' + numeric.max : '', numeric.maxDelta !== undefined ? '单次 ±' + numeric.maxDelta : ''].filter(Boolean).join(' · ') || '—'] as [string, React.ReactNode]] : []),
    ...(list ? [['清单上限', `${list.warn} 预警 / ${list.max} 上限`] as [string, React.ReactNode]] : []),
    ['所属模块', modules.length ? modules.join('、') + (dormant ? '（已关闭，数据休眠）' : '') : '核心（始终开启）'],
    ['给玩家看', spoil === 'hidden' ? '隐藏（只在调试里可见）' : spoil === 'spoiler' ? '剧透（默认遮住）' : '公开'],
    ...(meta.readonly ? [['模型可写', '否（只读）'] as [string, React.ReactNode]] : []),
  ];
  return (
    <aside {...part('inspector')}>
      <h3>{parts.length ? describe(m, parts) : '整个状态'}</h3>
      <dl>{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
      <Json value={value} label="当前值" max={320} />
      <div {...part('actions')}><K.Button size="sm" onClick={() => onEdit(path)}>在操作台修改</K.Button></div>
    </aside>
  );
}

// ── 历史 ──

function History() {
  const K = useKit(), { c, m, ready, run, busy } = useDebug();
  const messages = c.getMessages(), history = c.getHistory();
  const byId = new Map(history.map(h => [h.id, h]));
  const floors = messages.filter(x => x.role === 'assistant').reverse();
  const [open, setOpen] = React.useState<string | undefined>(floors[0]?.headId);
  const [compare, setCompare] = React.useState<string[]>([]);
  const [diff, setDiff] = React.useState<{ a: string; b: string; patch: any[]; before: unknown } | undefined>();
  const pick = (id: string) => setCompare(cur => cur.includes(id) ? cur.filter(x => x !== id) : [...cur.slice(-1), id]);
  const doCompare = async () => {
    const [a, b] = compare; if (!a || !b) return;
    const [older, newer] = [a, b].sort((x, y) => history.findIndex(h => h.id === x) - history.findIndex(h => h.id === y));
    const r = await c.compareCommits(older!, newer!), before = (await c.inspectCommit(older!)).state.data;
    setDiff({ a: older!, b: newer!, patch: r.dataPatch, before });
  };
  return (
    <>
      <div {...solve('debug-bar')}>
        <span>{floors.length} 层回复 · {history.length} 条提交（含旧版本）</span>
        <K.Button size="sm" disabled={compare.length !== 2} onClick={() => void doCompare()}>{compare.length === 2 ? '比较所选两个版本' : `选两个版本比较（已选 ${compare.length}）`}</K.Button>
      </div>
      {diff ? (
        <K.Card title={`版本 ${short(diff.a)} → ${short(diff.b)}`} meta={<K.Button size="sm" variant="ghost" onClick={() => setDiff(undefined)}>关闭</K.Button>}>
          <Diff patch={diff.patch} before={diff.before} m={m} empty="两个版本的数据相同" />
        </K.Card>
      ) : null}
      <ol {...solve('debug-timeline')}>
        {floors.map(f => {
          const head = f.headId ? byId.get(f.headId) : undefined;
          const others = history.filter(h => h.binding.messageId === f.messageId && h.id !== f.headId);
          const isOpen = open === f.headId;
          return (
            <li key={f.index} data-open={isOpen ? '' : undefined} data-current={head?.current ? '' : undefined}>
              <button type="button" {...part('head')} onClick={() => setOpen(isOpen ? undefined : f.headId)} aria-expanded={isOpen}>
                <span {...part('floor')}>#{f.index}</span>
                <span {...part('excerpt')}>{f.text.replace(/<solve_[\s\S]*?<\/solve_[a-z_]+>/gu, '').trim().slice(0, 60) || '（空）'}</span>
                <span {...part('meta')}>
                  {f.swipeCount > 1 ? <K.Badge>版本 {f.swipeIndex + 1}/{f.swipeCount}</K.Badge> : null}
                  {head?.actions.some(a => a.source === 'user') ? <K.Badge tone="accent">玩家操作</K.Badge> : null}
                  {head ? <FeedbackBadges items={head.feedback} /> : <K.Badge tone="warning">未同步</K.Badge>}
                  {head?.current ? <K.Badge tone="success">当前</K.Badge> : null}
                </span>
              </button>
              {isOpen && head ? (
                <FloorBody c={c} m={m} head={head}>
                  <div {...part('actions')}>
                    <label><input type="checkbox" checked={compare.includes(head.id)} onChange={() => pick(head.id)} /> 选来比较</label>
                    <K.Button size="sm" variant="ghost" disabled={busy || !ready} onClick={() => void run(`重算第 ${f.index} 楼`, () => c.replayMessage(f.index))}>重算这一楼</K.Button>
                    <K.Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(`从第 ${f.index} 楼起重放`, () => c.replayFrom(f.index))}>从这里重放到最新</K.Button>
                    <code title={head.id}>{short(head.id)}</code>
                  </div>
                  {others.length ? (
                    <div {...part('others')}>
                      <h4 {...part('sub')}>这一楼的其他版本</h4>
                      <ul>{others.map(o => (
                        <li key={o.id}>
                          <label><input type="checkbox" checked={compare.includes(o.id)} onChange={() => pick(o.id)} /> <code>{short(o.id)}</code></label>
                          <span>{o.actions.map(a => SOURCE[a.source]).join(' + ') || '开局'} · {o.dataPatch.length} 处变化</span>
                          <FeedbackBadges items={o.feedback} />
                        </li>
                      ))}</ul>
                    </div>
                  ) : null}
                </FloorBody>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function FloorBody({ c, m, head, children }: { c: Controller; m: StatusModel; head: any; children?: React.ReactNode }) {
  const before = useStateBefore(c, head);
  return (
    <div {...part('body')}>
      <Actions actions={head.actions} />
      <FeedbackList items={head.feedback} m={m} />
      <Diff patch={head.dataPatch} before={before} m={m} />
      {children}
    </div>
  );
}

// ── 操作台 ──

const TEMPLATES = (path?: string): { label: string; ops: unknown }[] => [
  { label: '改一个值', ops: { $set: { [path ?? '@erin.condition']: '新的值' } } },
  { label: '加减数值', ops: { $inc: { [path ?? '@erin.rp.gauges.生命.value']: -5 } } },
  { label: '追加到清单', ops: { $push: { '@erin.tags': '新身份' } } },
  { label: '原子组（全成或全不成）', ops: { $group: [{ $inc: { '@erin.items.gold.count': -30 } }, { $inc: { '@erin.items.healing_draught.count': 1 } }] } },
  { label: '删除', ops: { $unset: [path ?? '@erin.condition'] } },
];
function AdvancedConsole() {
  const K = useKit(), { c, m, state, ready, run, busy, focus } = useDebug();
  const [text, setText] = React.useState(() => JSON.stringify(TEMPLATES(focus)[0]!.ops, null, 2));
  const [inputs, setInputs] = React.useState('');
  const [result, setResult] = React.useState<{ feedback: Feedback[]; patch: any[]; base: string } | { error: string } | undefined>();
  React.useEffect(() => { if (focus) setText(JSON.stringify({ $set: { [focus]: valueAt(state.data, partsOf(focus.replace(/^@[^.]+/u, m2 => '').replace(/^\./u, ''))) ?? '' } }, null, 2)); }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const parse = (): { ops: any; authorInputs?: any } | undefined => {
    try { return { ops: JSON.parse(text), ...(inputs.trim() ? { authorInputs: JSON.parse(inputs) } : {}) }; }
    catch (error) { setResult({ error: 'JSON 格式错误：' + message(error) }); return undefined; }
  };
  const preview = async () => {
    const p = parse(); if (!p) return;
    try { const r = await c.preview(p.ops, p.authorInputs); setResult({ feedback: r.feedback, patch: r.dataPatch, base: r.baseHeadId }); }
    catch (error) { setResult({ error: message(error) }); }
  };
  const submit = async () => {
    const p = parse(); if (!p || !result || 'error' in result) return;
    const ok = await run('提交', () => c.submit(p.ops, { expectedHead: result.base, ...(p.authorInputs ? { authorInputs: p.authorInputs } : {}) }));
    if (ok) setResult(undefined);
  };
  const floor = c.getMessages().findLast(x => x.role === 'assistant');
  const blocked = result && !('error' in result) && result.feedback.some(f => f.level === 'L3');
  return (
    <>
      <p {...part('intro')}>写一批操作，先<b>预演</b>（只计算，不写聊天），确认结果再<b>提交</b>：作为玩家动作存进第 {floor?.index ?? '—'} 楼，可在历史里看到、可撤销。路径可以用 <code>@实体ID.字段</code>。</p>
      <div {...solve('debug-templates')}>{TEMPLATES(focus).map(t => <button key={t.label} type="button" onClick={() => { setText(JSON.stringify(t.ops, null, 2)); setResult(undefined); }}>{t.label}</button>)}</div>
      <textarea {...solve('debug-editor')} value={text} spellCheck={false} aria-label="操作 JSON" onChange={e => { setText(e.target.value); setResult(undefined); }} rows={9} />
      <details {...solve('debug-inputs')}><summary>作者输入（authorInputs，可选）</summary>
        <textarea {...solve('debug-editor')} value={inputs} spellCheck={false} aria-label="作者输入 JSON" placeholder='{"narrate": "下一轮告诉模型的一句话"}' onChange={e => { setInputs(e.target.value); setResult(undefined); }} rows={3} />
      </details>
      <div {...solve('debug-bar')}>
        <K.Button size="sm" onClick={() => void preview()}>预演</K.Button>
        <K.Button size="sm" variant="primary" disabled={!result || 'error' in result || !!blocked || busy || !ready} onClick={() => void submit()}>提交</K.Button>
        {!ready ? <small>状态未就绪，暂不能提交</small> : blocked ? <small>有被拒绝的操作，修改后再预演</small> : null}
      </div>
      {result ? ('error' in result ? <p {...part('error')} role="alert">{result.error}</p> : (
        <K.Card title="预演结果" meta={`基于提交 ${short(result.base)}`}>
          <FeedbackList items={result.feedback} m={m} empty="没有反馈：所有操作都会按原样执行。" />
          <Diff patch={result.patch} before={state.data} m={m} />
        </K.Card>
      )) : null}
    </>
  );
}

function Console() {
  const { c, m, state, ready, run, busy, focus } = useDebug();
  return <StateEditor c={c} m={m} state={state} ready={ready} run={run} busy={busy} {...(focus ? { focus } : {})} advanced={<AdvancedConsole />} />;
}

// ── 提示词 ──

function Prompt() {
  const K = useKit(), { c } = useDebug();
  const views = ['narrative', 'operator', 'full', ...Object.keys(c.core.definition.views ?? {})];
  const [view, setView] = React.useState('narrative');
  const [format, setFormat] = React.useState<'toon' | 'json'>('toon');
  const [sub, setSub] = React.useState<'state' | 'guide' | 'sop' | 'feedback' | 'narration' | 'operator'>('state');
  let preview: any; try { preview = c.getContextPreview({ view }); } catch (error) { return <p {...part('error')}>{message(error)}</p>; }
  const narrations = (c.runtime.getCommit()?.actions ?? []).filter(a => a.source === 'user').map(a => (a.authorInputs as any)?.narrate).filter(Boolean) as string[];
  const tabs: { id: typeof sub; label: string; text: string; note: string }[] = [
    { id: 'state', label: '状态', text: format === 'toon' ? preview.toon : preview.json, note: '{{solve_toon}} / {{solve_json}}：按视图筛选后的状态（披露规则、休眠模块已剔除）。' },
    { id: 'guide', label: '指南', text: preview.guide, note: '{{solve_guide}}：全局指南 + 已开启模块的指南 + 当前条件成立的提示（如清单到预警线）。' },
    { id: 'sop', label: '操作说明', text: preview.sop, note: '{{solve_SOP}}：告诉模型怎样写操作块。' },
    { id: 'feedback', label: '反馈', text: preview.feedback.length ? JSON.stringify(preview.feedback, null, 2) : '', note: '{{solve_feedback}}：上一轮操作的反馈，让模型知道哪些被调整或拒绝。' },
    { id: 'narration', label: '玩家操作', text: narrations.length ? `（玩家在状态栏中：${narrations.join('；')}）` : '', note: '玩家在状态栏里的操作，下一轮以这一行附在当前回复后发给模型。' },
    ...(preview.operatorPrompt ? [{ id: 'operator' as const, label: '独立操作模型', text: preview.operatorPrompt, note: '独立操作模型模式下，单独发给操作模型的完整提示词。' }] : []),
  ];
  const cur = tabs.find(t => t.id === sub) ?? tabs[0]!;
  return (
    <>
      <div {...solve('debug-bar')}>
        {K.Segmented ? <K.Segmented size="sm" label="内容" value={cur.id} onValueChange={v => setSub(v as typeof sub)} options={tabs.map(t => ({ value: t.id, label: t.label }))} /> : null}
      </div>
      {cur.id === 'state' ? (
        <div {...solve('debug-bar')}>
          <label>视图 <select value={view} onChange={e => setView(e.target.value)}>{views.map(v => <option key={v} value={v}>{v === 'narrative' ? '叙事（给写作模型）' : v === 'operator' ? '操作（给操作模型）' : v === 'full' ? '完整' : v}</option>)}</select></label>
          {K.Segmented ? <K.Segmented size="sm" label="格式" value={format} onValueChange={v => setFormat(v as 'toon' | 'json')} options={[{ value: 'toon', label: 'TOON' }, { value: 'json', label: 'JSON' }]} /> : null}
        </div>
      ) : null}
      <p {...part('intro')}>{cur.note}<br /><small>{cur.text ? size(cur.text) + '（按字符与字节计，不是模型 token）' : ''}</small></p>
      {cur.text ? <Json value={cur.text} label={cur.label} /> : <p {...part('none')}>（空：这一轮不会发送这部分）</p>}
    </>
  );
}

// ── 结构 ──

function Structure() {
  const K = useKit(), { c, m, state } = useDebug();
  const def = c.core.definition, modules = c.getModules();
  const counts = (path: string) => { const v = valueAt(state.data, path.split('.')); return v && typeof v === 'object' ? Object.keys(v).length : 0; };
  const tree = (parent: string | undefined, depth: number): React.ReactNode => modules.filter(x => x.parent === parent).map(x => (
    <React.Fragment key={x.name}>
      <li style={{ '--depth': depth } as React.CSSProperties} data-on={x.enabled ? '' : undefined}>
        <span>{x.label ?? x.name}</span><code>{x.name}</code>
        {x.exclusive ? <K.Badge>{(def as any).groups?.[x.exclusive]?.label ?? x.exclusive}</K.Badge> : null}
        <K.Badge tone={x.enabled ? 'success' : 'neutral'}>{x.enabled ? '开启' : x.preference ? '上级关闭' : '关闭'}</K.Badge>
        <small>{x.paths.join('，')}</small>
      </li>
      {tree(x.name, depth + 1)}
    </React.Fragment>
  ));
  return (
    <>
      <p {...part('intro')}>当前绑定的结构定义（只读）。模块开关在状态栏的 ⚙ 设置里改；结构本身的编辑见以后的「结构制作」面板。</p>
      <section {...solve('debug-facts')}>
        <div><span>定义</span><b>{def.id}</b></div><div><span>版本</span><b>{def.version}</b></div>
        <div><span>指纹</span><b><code title={def.fingerprint}>{def.fingerprint.slice(0, 12)}</code></b></div>
        <div><span>实体类型</span><b>{new Set((def.entities ?? []).map(e => e.type)).size}</b></div>
      </section>
      <K.Card title="模块"><ul {...solve('debug-modules')}>{tree(undefined, 0)}</ul></K.Card>
      <K.Card title="实体与引用">
        <table {...solve('debug-table')}><thead><tr><th>类型</th><th>位置</th><th>现有</th></tr></thead>
          <tbody>{(def.entities ?? []).map(e => <tr key={e.path}><td>{e.type}</td><td><code>{e.path}</code> {describe(m, e.path.split('.').filter(p => p !== '*'))}</td><td>{e.path.includes('*') ? '—' : counts(e.path)}</td></tr>)}</tbody></table>
        <h4 {...part('sub')}>引用（{(def.refs ?? []).length}）</h4>
        <table {...solve('debug-table')}><thead><tr><th>字段</th><th>指向</th></tr></thead>
          <tbody>{(def.refs ?? []).map((r: any) => <tr key={r.path}><td><code>{r.path}</code></td><td>{[].concat(r.target ?? r.types ?? r.type ?? []).join(' / ') || '任意实体'}{r.onDelete ? ` · 删除时 ${r.onDelete}` : ''}</td></tr>)}</tbody></table>
      </K.Card>
      <K.Card title="数值与清单约束">
        <table {...solve('debug-table')}><thead><tr><th>字段</th><th>范围</th><th>单次变化</th></tr></thead>
          <tbody>{Object.entries(def.numeric ?? {}).map(([p, r]: [string, any]) => <tr key={p}><td><code>{p}</code></td><td>{r.min ?? '−∞'} ～ {r.max ?? '∞'}{r.integer ? '（整数）' : ''}</td><td>{r.maxDelta !== undefined ? '±' + r.maxDelta : '—'}</td></tr>)}</tbody></table>
        <h4 {...part('sub')}>清单</h4>
        <table {...solve('debug-table')}><thead><tr><th>清单</th><th>预警线 / 上限</th></tr></thead>
          <tbody>{Object.entries(def.lists ?? {}).map(([p, r]: [string, any]) => <tr key={p}><td>{r.label ?? ''} <code>{p}</code></td><td>{r.warn} / {r.max}</td></tr>)}</tbody></table>
      </K.Card>
    </>
  );
}

// ── 日志 ──

function Logs() {
  const K = useKit(), { c } = useDebug();
  const [level, setLevel] = React.useState<'all' | 'warning' | 'error'>('all');
  const logs = c.journal.read().reverse().filter(l => level === 'all' || (level === 'warning' ? l.level !== 'info' : l.level === 'error'));
  const perf = c.getPerformance();
  const phases = Object.entries(perf.reduce((acc: Record<string, number[]>, s: any) => { (acc[s.phase] ??= []).push(s.durationMs); return acc; }, {}))
    .map(([name, xs]) => ({ name, n: xs.length, avg: xs.reduce((a, b) => a + b, 0) / xs.length, max: Math.max(...xs) })).sort((a, b) => b.avg - a.avg).slice(0, 8);
  const caps = c.getStatus().capabilities ?? [];
  return (
    <>
      <div {...solve('debug-bar')}>
        {K.Segmented ? <K.Segmented size="sm" label="级别" value={level} onValueChange={v => setLevel(v as typeof level)} options={[{ value: 'all', label: '全部' }, { value: 'warning', label: '警告以上' }, { value: 'error', label: '错误' }]} /> : null}
        <K.Button size="sm" variant="ghost" onClick={() => c.clearDiagnostics()}>清空</K.Button>
      </div>
      <ol {...solve('debug-log')}>
        {logs.length ? logs.map(l => (
          <li key={l.sequence} data-level={l.level}>
            <time>{new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false })}</time>
            <code>{l.code}</code><span>{l.message}</span>{l.durationMs !== undefined ? <small>{Math.round(l.durationMs)} ms</small> : null}
          </li>
        )) : <li>没有记录</li>}
      </ol>
      <K.Card title="耗时（最近 160 次，按平均排序）">
        <table {...solve('debug-table')}><thead><tr><th>阶段</th><th>次数</th><th>平均</th><th>最长</th></tr></thead>
          <tbody>{phases.map(p => <tr key={p.name}><td><code>{p.name}</code></td><td>{p.n}</td><td>{p.avg.toFixed(1)} ms</td><td>{p.max.toFixed(1)} ms</td></tr>)}</tbody></table>
      </K.Card>
      <K.Card title="宿主能力">
        <ul {...solve('debug-caps')}>{caps.map((x: any) => <li key={x.id ?? x.label} data-ok={x.available ? '' : undefined}><span>{x.available ? '✓' : '✗'}</span>{x.label}{x.detail && x.detail !== x.label ? <small>{x.detail}</small> : null}</li>)}</ul>
      </K.Card>
    </>
  );
}

// ── 未绑定 ──

function Unbound({ host }: { host: DebugHost }) {
  const K = useKit();
  let s: any = {}; try { s = host.sessions.getStatus(); } catch { s = {}; }
  return (
    <div {...solve('debug-unbound')}>
      <K.Empty title="当前聊天没有绑定 SOLVE 结构" description={s.reason || '角色卡的脚本注册定义后，打开这个角色的聊天就会自动绑定。'} />
      <K.Card title="已注册的定义">
        {(s.registered ?? []).length ? <ul>{s.registered.map((r: any, i: number) => <li key={i}><code>{r.id}</code> {r.version} {r.characters ? '· ' + r.characters.join('、') : ''}</li>)}</ul> : <p>没有。</p>}
      </K.Card>
    </div>
  );
}
