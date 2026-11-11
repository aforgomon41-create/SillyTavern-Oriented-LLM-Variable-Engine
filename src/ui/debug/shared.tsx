/**
 * Shared pieces of the debug panel: the host contract, structure-aware names for paths, value formatting,
 * JSON blocks and the labelled diff of a JSON Patch.
 */
import * as React from 'react';
import type { SillyTavernController } from '../../host/controller.js';
import type { Operation as JsonPatch } from 'fast-json-patch';
import type { Feedback } from '../../types.js';
import { StatusModel } from '../statusbar/model.js';
import { useKit } from '../kit.js';

export type Controller = SillyTavernController;
export interface DebugHost {
  version: string;
  sessions: {
    controller?: Controller;
    subscribe(listener: () => void): () => void;
    getStatus(): any;
    inspectArchive?(commitId?: string): Promise<any>;
  };
  /** In-memory demo (preview): offers failure simulation and a scripted next reply. */
  demo?: { setFailure(v: boolean): void; addReply(): Promise<void> };
}

export const solve = (name: string, extra: Record<string, string | undefined> = {}) => ({ 'data-solve': name, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined).map(([k, v]) => ['data-' + k, v])) });
export const part = (name: string) => ({ 'data-solve-part': name });
export const short = (id?: string | null) => id ? id.replace(/^commit_/u, '').slice(0, 8) : '—';
export const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Pointer or dotted path → parts. */
export const partsOf = (path: string): string[] => path.startsWith('/') ? path.slice(1).split('/').map(p => p.replace(/~1/gu, '/').replace(/~0/gu, '~')) : path.split('.').filter(Boolean);
/** Readable name of a path: declared labels for keys, entity names for record keys (角色 › 艾琳 › 关系 › 米拉 › 好感度). */
export function describe(m: StatusModel, parts: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const sub = parts.slice(0, i + 1), pattern = m.pattern(sub).split('.');
    const key = parts[i]!;
    if (pattern[i] === '*') { const name = m.entityName(key); out.push(name && name !== key ? name : key); }
    else if (/^\d+$/u.test(key)) out.push('#' + (Number(key) + 1));
    else out.push(m.label(sub) || key);
  }
  return out.join(' › ');
}
export function brief(value: unknown, max = 60): string {
  if (value === undefined) return '（无）';
  if (value === null) return 'null';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
/** Value at parts of a plain object (undefined when missing). */
export function valueAt(data: unknown, parts: string[]): unknown {
  let cur: any = data;
  for (const p of parts) { if (cur === null || typeof cur !== 'object') return undefined; cur = cur[p]; }
  return cur;
}

export function Json({ value, label = '数据', max }: { value: unknown; label?: string; max?: number }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'undefined';
  const [copied, setCopied] = React.useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard blocked */ } };
  return (
    <div {...solve('code')}>
      <div {...part('bar')}><span>{label}</span><small>{text.length.toLocaleString()} 字</small><button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制'}</button></div>
      <pre style={max ? { maxHeight: max } : undefined}>{text}</pre>
    </div>
  );
}

const LEVEL: Record<string, { tone: 'info' | 'warning' | 'danger'; text: string }> = {
  L1: { tone: 'info', text: '提示' }, L2: { tone: 'warning', text: '已调整' }, L3: { tone: 'danger', text: '被拒绝' },
};
export function FeedbackList({ items, m, empty = '没有反馈' }: { items: Feedback[]; m?: StatusModel; empty?: string }) {
  const K = useKit();
  if (!items.length) return <p {...part('none')}>{empty}</p>;
  return (
    <ul {...solve('feedback')}>
      {items.map((f, i) => (
        <li key={i} data-level={f.level}>
          <K.Badge tone={LEVEL[f.level]?.tone ?? 'neutral'}>{LEVEL[f.level]?.text ?? f.level}</K.Badge>
          <span {...part('text')}>{f.message}</span>
          <span {...part('where')}>{f.path && m ? describe(m, partsOf(f.path)) : f.path ?? ''}<code>{f.code}</code></span>
        </li>
      ))}
    </ul>
  );
}
export function feedbackCounts(items: Feedback[]) {
  return { L1: items.filter(f => f.level === 'L1').length, L2: items.filter(f => f.level === 'L2').length, L3: items.filter(f => f.level === 'L3').length };
}
export function FeedbackBadges({ items }: { items: Feedback[] }) {
  const K = useKit(), n = feedbackCounts(items);
  return <>{n.L3 ? <K.Badge tone="danger">{n.L3} 拒绝</K.Badge> : null}{n.L2 ? <K.Badge tone="warning">{n.L2} 调整</K.Badge> : null}</>;
}

/** JSON Patch as labelled before → after rows. `before` is the state the patch applies to. */
export function Diff({ patch, before, m, empty = '没有数据变化' }: { patch: JsonPatch[]; before?: unknown; m: StatusModel; empty?: string }) {
  if (!patch.length) return <p {...part('none')}>{empty}</p>;
  return (
    <ul {...solve('diff')}>
      {patch.map((p: any, i) => {
        const parts = partsOf(p.path), old = before !== undefined ? valueAt(before, parts) : undefined;
        const kind = p.op === 'add' ? (old === undefined ? 'add' : 'replace') : p.op;
        return (
          <li key={i} data-op={kind}>
            <span {...part('op')}>{kind === 'add' ? '新增' : kind === 'remove' ? '删除' : kind === 'replace' ? '修改' : p.op}</span>
            <span {...part('name')} title={p.path}>{describe(m, parts)}<code>{parts.join('.')}</code></span>
            <span {...part('change')}>
              {kind !== 'add' && before !== undefined ? <del>{named(m, old)}</del> : null}
              {kind === 'replace' && before !== undefined ? <span aria-hidden="true">→</span> : null}
              {kind !== 'remove' ? <ins>{named(m, p.value)}</ins> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A value for display; entity ids (and lists of them) also show the entity's name. */
export function named(m: StatusModel, value: unknown): string {
  const one = (v: unknown) => { if (typeof v !== 'string') return undefined; const n = m.entityName(v); return n && n !== v ? `${n}（${v}）` : undefined; };
  if (Array.isArray(value) && value.length && value.every(v => typeof v === 'string' && one(v))) return brief(value.map(v => m.entityName(v as string)).join('、'), 80);
  return one(value) ?? brief(value);
}
/** State the given commit starts from (its parent's state); undefined while loading or for the opening commit. */
export function useStateBefore(c: Controller, commit: { id: string; parentId: string | null } | undefined): unknown {
  const [state, setState] = React.useState<{ id: string; data: unknown } | undefined>();
  React.useEffect(() => {
    let live = true; const parent = commit?.parentId;
    if (!commit || !parent) { setState(commit ? { id: commit.id, data: {} } : undefined); return undefined; }
    c.inspectCommit(parent).then(r => { if (live) setState({ id: commit.id, data: r.state.data }); }, () => undefined);
    return () => { live = false; };
  }, [c, commit?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return state && state.id === commit?.id ? state.data : undefined;
}
/** Text size in characters and UTF-8 bytes (not model tokens). */
export const size = (text: string) => `${text.length.toLocaleString()} 字 · ${new TextEncoder().encode(text).length.toLocaleString()} 字节`;
