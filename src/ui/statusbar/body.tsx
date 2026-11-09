/**
 * Entity bodies: the flat body (facts → paragraphs → sections) and the paged body used by the player
 * sheet and by collapsed cards, so long entities read in layers instead of one long dump.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { isEmpty, type Path, type StatusModel } from './model.js';
import { Field, RelationRow, Section, useModel } from './fields.js';
import { Abilities, Inventory } from './inventory.js';
import { Checklist, part, solve } from './widgets.js';
import { TickList } from './interact.js';

export interface PageSpec { label: string; paths: string[]; as?: string }
const rel = (s: string): Path => s.split('.');
export function resolveUser(m: StatusModel, base: Path, r: string): Path | undefined {
  const out = [...base, ...rel(r).map(k => k === '$user' ? m.userId ?? '' : k)];
  return out.includes('') ? undefined : out;
}
export function visible(m: StatusModel, path: Path | undefined): path is Path {
  return !!path && m.meta(path) !== undefined && !m.dormant(path) && m.spoiler(path) !== 'hidden' && !isEmpty(m.value(path)) && m.value(path) !== null;
}

/** Paged entity: a small switch on top, one page at a time; empty pages are left out. */
export function Pages({ base, pages, label, compact = false, page: controlled, onPage }: {
  base: Path; pages: PageSpec[]; label: string; compact?: boolean; page?: string; onPage?: (p: string) => void;
}) {
  const m = useModel(), K = useKit();
  const shown = pages.filter(p => p.paths.some(r => visible(m, resolveUser(m, base, r))));
  const [inner, setInner] = React.useState(shown[0]?.label ?? '');
  const page = controlled ?? inner, setPage = (v: string) => { setInner(v); onPage?.(v); };
  const current = shown.find(p => p.label === page) ?? shown[0];
  if (!current) return <span {...solve('none')}>暂无内容</span>;
  return (
    <div {...solve('pages', { compact: compact ? '' : undefined })}>
      {shown.length > 1 ? (
        <div {...part('switch')}>
          {K.Segmented
            ? <K.Segmented size={compact ? 'sm' : 'md'} label={label} value={current.label} onValueChange={setPage} options={shown.map(p => ({ value: p.label, label: p.label }))} />
            : <div role="tablist">{shown.map(p => <button key={p.label} type="button" role="tab" aria-selected={p === current} onClick={() => setPage(p.label)}>{p.label}</button>)}</div>}
        </div>
      ) : null}
      <div {...part('page')} data-page={current.as ?? 'default'}>
        {current.as === 'quests' ? <QuestLog paths={current.paths.map(r => resolveUser(m, base, r)).filter(p => visible(m, p)) as Path[]} />
          : <PageBody base={base} paths={current.paths} as={current.as} />}
      </div>
    </div>
  );
}

/** One page: loose scalar fields are gathered into one fact grid, bigger parts follow in order. */
function PageBody({ base, paths, as }: { base: Path; paths: string[]; as?: string }) {
  const m = useModel();
  const items = paths.map(r => ({ r, path: resolveUser(m, base, r) })).filter((x): x is { r: string; path: Path } => visible(m, x.path));
  const scalar = (p: Path) => ['string', 'enum', 'int', 'number', 'bool', 'ref', 'refs', 'ladder'].includes(m.meta(p)?.type ?? '') && m.widget(p) !== 'paragraph'
    || (m.meta(p)?.type === 'array' && (m.value(p) as unknown[]).every(x => typeof x === 'string'));
  const facts = items.filter(x => scalar(x.path));
  const rest = items.filter(x => !scalar(x.path));
  const parent = (p: Path) => m.meta(p.slice(0, -1));
  return (
    <>
      {rest.filter(x => parent(x.path)?.keys).map(x => <AboutYou key={x.r} path={x.path} />)}
      {facts.length ? <div {...solve('fields')}>{facts.map(x => <Field key={x.r} path={x.path} compact />)}</div> : null}
      {rest.filter(x => !parent(x.path)?.keys).map(x => <Part key={x.r} path={x.path} as={as} />)}
    </>
  );
}
/** A keyed-by-reference entry about the player (e.g. relations.$user): "how they see you". */
function AboutYou({ path }: { path: Path }) {
  const m = useModel();
  const label = m.label(path.slice(0, -1));
  return <section {...solve('about-you')}><RelationRow path={path} title={<span {...part('who')}>{label === '声望' ? '你的声望' : '对你'}</span>} /></section>;
}
function Part({ path, as }: { path: Path; as?: string }) {
  const m = useModel(), meta = m.meta(path);
  const widget = as ?? m.widget(path);
  if (meta?.type === 'record' && (meta.entity || meta.keys) && widget === 'inventory') return <Inventory path={path} />;
  if (meta?.type === 'record' && meta.keys && widget === 'abilities') return <Abilities path={path} />;
  if (meta?.type === 'object') {
    // attribute blocks keep their stat grid; other objects are flattened so cards are not nested in cards
    const kids = m.children(path).filter(k => !m.dormant([...path, k]));
    const stat = (p: Path) => m.meta(p)?.type === 'object' && m.children(p).every(k => ['int', 'number', 'ladder'].includes(m.meta([...p, k])?.type ?? ''));
    if (kids.length && kids.every(k => stat([...path, k]))) return <Section path={path} />;
    return <EntityBody path={path} />;
  }
  if (meta?.type === 'record') return <Section path={path} />;
  return <Field path={path} />;
}

/** Quest log: objective groups as quest entries, a sentence as the inner voice, checklists as steps. */
function QuestLog({ paths }: { paths: Path[] }) {
  const m = useModel();
  const rows: React.ReactNode[] = [];
  const walk = (p: Path) => {
    const meta = m.meta(p), v = m.value(p);
    if (!visible(m, p)) return;
    if (meta?.type === 'object') {
      const kids = m.children(p);
      if (kids.every(k => m.meta([...p, k])?.type === 'string')) {
        rows.push(<section key={p.join('.')} {...solve('quests')}><h5 {...part('title')}>{m.label(p)}</h5>
          <Guard path={p}><ul>{kids.filter(k => !isEmpty(v[k])).map((k, i) => <li key={k} data-tier={i}><span {...part('tier')}>{m.label([...p, k])}</span><span {...part('text')}>{v[k]}</span></li>)}</ul></Guard></section>);
      } else kids.forEach(k => walk([...p, k]));
    } else if (meta?.type === 'array' && Array.isArray(v) && v.some(x => x && typeof x === 'object' && 'text' in x)) {
      const done = v.filter((x: any) => x.done).length;
      rows.push(<section key={p.join('.')} {...solve('quests')}><h5 {...part('title')}>{m.label(p)}<small>{done}/{v.length}</small></h5><Guard path={p}><TickList path={p} items={v} /></Guard></section>);
    } else if (typeof v === 'string') {
      rows.push(<figure key={p.join('.')} {...solve('inner-voice')}><figcaption>{m.label(p)}</figcaption><Guard path={p}><blockquote>{v}</blockquote></Guard></figure>);
    } else rows.push(<Field key={p.join('.')} path={p} />);
  };
  paths.forEach(walk);
  return <div {...solve('quest-log')}>{rows}</div>;
}
function Guard({ path, children }: { path: Path; children: React.ReactNode }) {
  const level = useModel().spoiler(path);
  return level === 'spoiler' ? <SpoilerBlock>{children}</SpoilerBlock> : <>{children}</>;
}
function SpoilerBlock({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = React.useState(false);
  return shown ? <>{children}</> : <button type="button" {...solve('spoiler', { state: 'hidden' })} onClick={() => setShown(true)}><i aria-hidden="true" />剧透 · 点击查看</button>;
}

/** Full entity: facts, paragraphs, then sections; composite groups (e.g. roleplay) are flattened one level. Empty values are skipped. */
export function EntityBody({ path, skip = [] }: { path: Path; skip?: string[] }) {
  const m = useModel(), v = m.value(path) ?? {};
  const keys = m.children(path).filter(k => !skip.includes(k) && !['image', 'bgm'].includes(m.widget([...path, k]) ?? '') && !m.dormant([...path, k]) && m.spoiler([...path, k]) !== 'hidden' && !isEmpty(v[k]) && v[k] !== null);
  const type = (k: string) => m.meta([...path, k])?.type ?? '';
  const isStringList = (k: string) => type(k) === 'array' && !m.meta([...path, k])?.stamp && (v[k] ?? []).every((x: unknown) => typeof x === 'string');
  const scalar = keys.filter(k => ['string', 'enum', 'int', 'number', 'bool', 'ref', 'refs', 'ladder'].includes(type(k)) || isStringList(k));
  const composite = keys.filter(k => !scalar.includes(k));
  const paragraphs = scalar.filter(k => m.widget([...path, k]) === 'paragraph');
  const facts = scalar.filter(k => !paragraphs.includes(k) && k !== 'name' && k !== 'alias');
  const flatten = (k: string) => type(k) === 'object' && m.children([...path, k]).some(c => ['object', 'record'].includes(m.meta([...path, k, c])?.type ?? '') && m.children([...path, k, c]).length > 1 || m.meta([...path, k, c])?.type === 'record');
  return (
    <div {...solve('entity')}>
      {facts.length ? <div {...solve('fields')}>{facts.map(k => <Field key={k} path={[...path, k]} compact />)}</div> : null}
      {paragraphs.map(k => <Field key={k} path={[...path, k]} compact />)}
      {composite.map(k => flatten(k) ? <Group key={k} path={[...path, k]} />
        : ['object', 'record'].includes(type(k)) ? <Section key={k} path={[...path, k]} /> : <Field key={k} path={[...path, k]} />)}
    </div>
  );
}
function Group({ path }: { path: Path }) {
  const m = useModel();
  const keys = m.children(path).filter(k => !m.dormant([...path, k]) && !isEmpty(m.value([...path, k])) && m.value([...path, k]) !== null);
  const scalar = keys.filter(k => ['string', 'enum', 'int', 'number', 'ladder'].includes(m.meta([...path, k])?.type ?? ''));
  return (
    <section {...solve('group')}>
      <h4 {...part('title')}>{m.label(path)}</h4>
      {scalar.length ? <div {...solve('fields')}>{scalar.map(k => <Field key={k} path={[...path, k]} compact />)}</div> : null}
      {keys.filter(k => !scalar.includes(k)).map(k => ['object', 'record'].includes(m.meta([...path, k])?.type ?? '')
        ? <Section key={k} path={[...path, k]} /> : <Field key={k} path={[...path, k]} />)}
    </section>
  );
}
