/**
 * Player character sheet, RPG style: a hero card (portrait, name, rank, vitals, status, effects,
 * money) and paged sections (attributes, skills, inventory, quests, profile).
 * Which field plays which role is declared by the structure author in the layout item:
 *   { sheet: 'characters', id: '$user', subtitle, badges, tags, vitals, status, effects, currency, pages: [{ label, paths, as }] }
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { isEmpty, type Path } from './model.js';
import { Field, Section, useModel } from './fields.js';
import { Meter, part, solve } from './widgets.js';

export interface SheetItem {
  sheet: string; id: string; subtitle?: string; badges?: string[]; tags?: string; vitals?: string; status?: string;
  effects?: string; currency?: string; pages: { label: string; paths: string[]; as?: string }[];
}
const rel = (s: string): Path => s.split('.');

export function PlayerSheet({ item }: { item: SheetItem }) {
  const m = useModel(), K = useKit();
  const id = item.id === '$user' ? m.userId : item.id;
  const path = id ? [...rel(item.sheet), id] : undefined;
  const pages = path ? item.pages.filter(p => p.paths.some(r => visible(m, [...path, ...rel(r)]))) : [];
  const [page, setPage] = React.useState(pages[0]?.label ?? '');
  if (!path || !m.value(path)) return <K.Empty title="还没有玩家角色" description="角色定位为「用户角色」的角色会显示在这里。" />;
  const current = pages.find(p => p.label === page) ?? pages[0];
  return (
    <div {...solve('sheet')}>
      <div {...part('layout')}>
        <Hero path={path} item={item} />
        <div {...part('pages')}>
          {pages.length > 1 ? (
            K.Segmented
              ? <div {...part('switch')}><K.Segmented label="角色页" value={current?.label ?? ''} onValueChange={setPage} options={pages.map(p => ({ value: p.label, label: p.label }))} /></div>
              : <div {...part('switch')} role="tablist">{pages.map(p => <button key={p.label} type="button" role="tab" aria-selected={p === current} onClick={() => setPage(p.label)}>{p.label}</button>)}</div>
          ) : null}
          {current ? <div {...part('page')} data-page={current.as ?? 'default'}>{current.paths.map(r => <PagePart key={r} path={[...path, ...rel(r)]} as={current.as} />)}</div> : null}
        </div>
      </div>
    </div>
  );
}
function visible(m: ReturnType<typeof useModel>, path: Path): boolean {
  return m.meta(path) !== undefined && !m.dormant(path) && m.spoiler(path) !== 'hidden' && !isEmpty(m.value(path));
}
function PagePart({ path, as }: { path: Path; as?: string }) {
  const m = useModel();
  if (!visible(m, path)) return null;
  const meta = m.meta(path);
  if (as === 'inventory' && meta?.type === 'record') return <Inventory path={path} />;
  if (meta?.type === 'object' || meta?.type === 'record') return <Section path={path} />;
  return <Field path={path} />;
}

function Hero({ path, item }: { path: Path; item: SheetItem }) {
  const m = useModel(), K = useKit(), v = m.value(path) ?? {};
  const at = (r?: string) => r ? m.value([...path, ...rel(r)]) : undefined;
  const on = (r?: string) => !!r && visible(m, [...path, ...rel(r)]);
  const name: string = v.name ?? path.at(-1);
  const vitals = on(item.vitals) ? Object.entries(at(item.vitals) as Record<string, { value: number; max: number }>) : [];
  const effects = on(item.effects) ? Object.entries(at(item.effects) as Record<string, any>) : [];
  const money = on(item.currency) ? Object.entries(at(item.currency) as Record<string, number>) : [];
  return (
    <section {...solve('hero')} data-k-level="surface-1">
      <div {...part('top')}>
        <div {...part('portrait')} aria-hidden="true"><span>{[...name][0]}</span></div>
        <div {...part('ident')}>
          <h3 {...part('name')}>{name}{item.subtitle && at(item.subtitle) ? <small>「{at(item.subtitle)}」</small> : null}</h3>
          <div {...part('badges')}>{(item.badges ?? []).filter(on).map((b, i) => <K.Badge key={b} tone={i === 0 ? 'accent' : 'neutral'}>{String(at(b))}</K.Badge>)}</div>
          {on(item.tags) ? <div {...part('tags')}>{(at(item.tags) as string[]).join(' · ')}</div> : null}
        </div>
      </div>
      {vitals.length ? <div {...part('vitals')}>{vitals.map(([k, g], i) => <div key={k} data-slot={i % 4}><Meter label={k} value={g.value} max={g.max} /></div>)}</div> : null}
      {on(item.status) ? <div {...part('status')}><span {...part('label')}>{m.label([...path, ...rel(item.status!)])}</span><span>{String(at(item.status))}</span></div> : null}
      {effects.length ? (
        <div {...part('effects')}>
          <span {...part('label')}>{m.label([...path, ...rel(item.effects!)])}</span>
          <ul>{effects.map(([k, e]) => <li key={k}><b>{k}</b><span>{e?.desc}{e?.until ? <small>（直到{e.until}）</small> : null}</span></li>)}</ul>
        </div>
      ) : null}
      {money.length ? <div {...part('currency')} aria-label={m.label([...path, ...rel(item.currency!)])}>{money.map(([k, n]) => <span key={k}><i aria-hidden="true" />{k}<b>{n}</b></span>)}</div> : null}
    </section>
  );
}

/** Inventory: equipped slots, bag grid and an item description box. */
function Inventory({ path }: { path: Path }) {
  const m = useModel(), K = useKit(), items: Record<string, any> = m.value(path) ?? {};
  const ids = Object.keys(items);
  const equipped = ids.filter(id => items[id]?.equipped), bag = ids.filter(id => !items[id]?.equipped);
  const [sel, setSel] = React.useState<string | undefined>(ids[0]);
  const it = sel ? items[sel] : undefined;
  const tile = (id: string) => (
    <button key={id} type="button" {...solve('slot', { kind: items[id]?.type, equipped: items[id]?.equipped ? '' : undefined })} aria-pressed={id === sel} onClick={() => setSel(id)}>
      <span {...part('glyph')} aria-hidden="true">{[...(items[id]?.name ?? id)][0]}</span>
      <span {...part('name')}>{items[id]?.name ?? id}</span>
      {typeof items[id]?.count === 'number' && items[id].count !== 1 ? <span {...part('count')}>×{items[id].count}</span> : null}
    </button>
  );
  const detailKeys = it ? m.children([...path, sel!]).filter(k => !['name', 'type', 'count', 'equipped'].includes(k) && !isEmpty(it[k])) : [];
  return (
    <div {...solve('inventory')}>
      {equipped.length ? <section {...part('equipped')}><h4 {...part('title')}>装备中</h4><div {...part('grid')}>{equipped.map(tile)}</div></section> : null}
      <section {...part('bag')}><h4 {...part('title')}>{m.label(path)}<small>{bag.length}</small></h4>
        {bag.length ? <div {...part('grid')}>{bag.map(tile)}</div> : <span {...solve('none')}>空</span>}</section>
      {it ? (
        <div {...part('detail')} aria-live="polite">
          <div {...part('head')}><b>{it.name ?? sel}</b>{it.type ? <K.Badge tone="neutral">{it.type}</K.Badge> : null}{it.equipped ? <K.Badge tone="accent">已装备</K.Badge> : null}{typeof it.count === 'number' ? <span {...part('count')}>数量 {it.count}</span> : null}</div>
          {detailKeys.map(k => <Field key={k} path={[...path, sel!, k]} compact />)}
        </div>
      ) : null}
    </div>
  );
}
