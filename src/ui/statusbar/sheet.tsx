/**
 * Player character sheet, RPG style: a hero card (portrait, name, rank, vitals, status, effects,
 * money) and paged sections (attributes, skills, inventory, quests, profile).
 * Which field plays which role is declared by the structure author in the layout item:
 *   { sheet: 'characters', id: '$user', subtitle, badges, tags, vitals, status, effects, currency, pages: [{ label, paths, as }] }
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { type Path } from './model.js';
import { Mixed, useModel } from './fields.js';
import { Pages, visible } from './body.js';
import { CurrencyList } from './currency.js';
import { part, solve } from './widgets.js';

export interface SheetItem {
  sheet: string; id: string; subtitle?: string; badges?: string[]; tags?: string; vitals?: string; status?: string;
  effects?: string; currency?: string; pages: { label: string; paths: string[]; as?: string }[];
}
const rel = (s: string): Path => s.split('.');

export function PlayerSheet({ item, page, onPage }: { item: SheetItem; page?: string; onPage?: (p: string) => void }) {
  const m = useModel(), K = useKit();
  const id = item.id === '$user' ? m.userId : item.id;
  const path = id ? [...rel(item.sheet), id] : undefined;
  if (!path || !m.value(path)) return <K.Empty title="还没有玩家角色" description="角色定位为「用户角色」的角色会显示在这里。" />;
  return (
    <div {...solve('sheet')}>
      <div {...part('layout')}>
        <Hero path={path} item={item} />
        <Pages base={path} pages={item.pages} label="角色页" {...(page !== undefined ? { page } : {})} {...(onPage ? { onPage } : {})} />
      </div>
    </div>
  );
}

function Hero({ path, item }: { path: Path; item: SheetItem }) {
  const m = useModel(), K = useKit(), v = m.value(path) ?? {};
  const at = (r?: string) => r ? m.value([...path, ...rel(r)]) : undefined;
  const on = (r?: string) => !!r && visible(m, [...path, ...rel(r)]);
  const name: string = v.name ?? path.at(-1);
  const vitals = on(item.vitals) ? Object.entries(at(item.vitals) as Record<string, unknown>) : [];
  const effects = on(item.effects) ? Object.entries(at(item.effects) as Record<string, any>) : [];
  const money = on(item.currency) ? Object.entries(at(item.currency) as Record<string, unknown>) : [];
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
      {vitals.length ? <div {...part('vitals')}><Mixed entries={vitals} /></div> : null}
      {on(item.status) ? <div {...part('status')}><span {...part('label')}>{m.label([...path, ...rel(item.status!)])}</span><span>{String(at(item.status))}</span></div> : null}
      {effects.length ? (
        <div {...part('effects')}>
          <span {...part('label')}>{m.label([...path, ...rel(item.effects!)])}</span>
          <ul>{effects.map(([k, e]) => <li key={k}><b>{k}</b><span>{e?.desc}{e?.until ? <small>（直到{e.until}）</small> : null}</span></li>)}</ul>
        </div>
      ) : null}
      {money.length ? <div {...part('money')}><CurrencyList entries={money} label={m.label([...path, ...rel(item.currency!)])} /></div> : null}
    </section>
  );
}

