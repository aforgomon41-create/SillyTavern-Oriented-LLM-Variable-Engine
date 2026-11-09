/**
 * Holdings that reference root instances (items, abilities): the instance data lives once at the root,
 * the holder keeps only its own state (count / equipped, level). Shared by the player sheet and NPC cards.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { isEmpty, type Path, type StatusModel } from './model.js';
import { Field, NavigateContext, RefChip, useModel } from './fields.js';
import { part, solve } from './widgets.js';
import { LevelNow, LevelPips, steps } from './levels.js';

export interface Held { id: string; at?: Path; data: Record<string, any> }
/** Join each referenced id with its root instance. */
function held(m: StatusModel, path: Path): Held[] {
  const holder: Record<string, any> = m.value(path) ?? {};
  return Object.keys(holder).map(id => {
    const at = m.locate(id);
    const inst = at ? m.value(at) ?? {} : {};
    return { id, ...(at ? { at } : {}), data: { ...inst, ...(holder[id] && typeof holder[id] === 'object' ? holder[id] : {}) } };
  });
}
/** Backward reference: instances of a root `collection` whose `field` points at `owner` (e.g. items.*.holder). */
export function heldBy(m: StatusModel, collection: string, field: string, owner: string): Held[] {
  const base = collection.split('.');
  const all: Record<string, any> = m.value(base) ?? {};
  return Object.keys(all).filter(id => all[id]?.[field] === owner).map(id => ({ id, at: [...base, id], data: all[id] ?? {} }));
}
/** `items@holder` in a page's paths: the backward reference above. */
export function parseBackref(r: string): { collection: string; field: string } | undefined {
  const at = r.indexOf('@');
  return at > 0 ? { collection: r.slice(0, at), field: r.slice(at + 1) } : undefined;
}
/** Other entities of the same collection holding the same instance (e.g. who else knows this ability). */
function others(m: StatusModel, path: Path, id: string): string[] {
  const [collection, self, ...rest] = path;
  if (!collection || !self) return [];
  const all: Record<string, any> = m.value([collection]) ?? {};
  return Object.keys(all).filter(k => k !== self && m.value([collection, k, ...rest, id]) !== undefined);
}
const nameOf = (h: Held) => h.data.name ?? h.id;

export function Inventory({ path, items }: { path?: Path; items?: Held[] }) {
  const m = useModel(), K = useKit(), go = React.useContext(NavigateContext);
  const list = items ?? (path ? held(m, path) : []);
  const equipped = list.filter(h => h.data.equipped), bag = list.filter(h => !h.data.equipped);
  const [sel, setSel] = React.useState<string | undefined>(list[0]?.id);
  const it = list.find(h => h.id === sel);
  const tile = (h: Held) => (
    <button key={h.id} type="button" {...solve('slot', { kind: h.data.type, equipped: h.data.equipped ? '' : undefined })} aria-pressed={h.id === sel} onClick={() => setSel(h.id)} title={nameOf(h)}>
      <span {...part('glyph')} aria-hidden="true">{[...nameOf(h)][0]}</span>
      <span {...part('name')}>{nameOf(h)}</span>
      {typeof h.data.count === 'number' && h.data.count !== 1 ? <span {...part('count')}>×{h.data.count}</span> : null}
    </button>
  );
  const fixed = ['name', 'type', 'count', 'equipped', 'desc', 'holder'];
  const detail = it?.at ? m.children(it.at).filter(k => !fixed.includes(k) && !isEmpty(it.data[k]) && m.spoiler([...it.at!, k]) !== 'hidden') : [];
  return (
    <div {...solve('inventory')}>
      {equipped.length ? <section {...part('equipped')}><h5 {...part('title')}>装备中<small>{equipped.length}</small></h5><div {...part('grid')}>{equipped.map(tile)}</div></section> : null}
      <section {...part('bag')}><h5 {...part('title')}>背包<small>{bag.length}</small></h5>
        {bag.length ? <div {...part('grid')}>{bag.map(tile)}</div> : <span {...solve('none')}>空空如也</span>}</section>
      {it ? (
        <div {...part('detail')} aria-live="polite">
          <div {...part('head')}>
            <span {...part('glyph')} aria-hidden="true">{[...nameOf(it)][0]}</span>
            <b>{nameOf(it)}</b>
            {it.data.type ? <K.Badge tone="neutral">{it.data.type}</K.Badge> : null}
            {it.data.equipped ? <K.Badge tone="accent">已装备</K.Badge> : null}
            {typeof it.data.count === 'number' && it.data.count !== 1 ? <span {...part('count')}>×{it.data.count}</span> : null}
          </div>
          {it.data.desc ? <p {...part('desc')}>{it.data.desc}</p> : null}
          {detail.map(k => <Field key={k} path={[...it.at!, k]} compact />)}
          {!it.at ? <span {...solve('none')}>这件物品的资料缺失</span> : <div {...part('more')}><K.Button size="sm" variant="ghost" onClick={() => go(it.at!)}>在图鉴中查看</K.Button></div>}
        </div>
      ) : null}
    </div>
  );
}

/** Abilities grouped by kind (traits, skills …): name, own level, description, who else has it. */
export function Abilities({ path }: { path: Path }) {
  const m = useModel(), K = useKit(), go = React.useContext(NavigateContext);
  const list = held(m, path);
  const kindOf = (h: Held) => (typeof h.data.kind === 'string' && h.data.kind) || '能力';
  const kinds = [...new Set(list.map(kindOf))];
  const kindValues: string[] = (list[0]?.at ? m.meta([...list[0].at, 'kind'])?.values : undefined) ?? [];
  kinds.sort((a, b) => (kindValues.indexOf(a) + 1 || 99) - (kindValues.indexOf(b) + 1 || 99));
  return (
    <div {...solve('abilities')}>
      {kinds.map(kind => (
        <section key={kind} {...part('group')}>
          <h5 {...part('title')}>{kind}<small>{list.filter(h => kindOf(h) === kind).length}</small></h5>
          <ul>
            {list.filter(h => kindOf(h) === kind).map(h => {
              const share = others(m, path, h.id);
              return (
                <li key={h.id} {...solve('ability')}>
                  <div {...part('head')}>
                    {h.at ? <button type="button" {...part('name')} onClick={() => go(h.at!)} title="在图鉴中查看">{nameOf(h)}</button> : <b {...part('name')}>{nameOf(h)}</b>}
                    {typeof h.data.level === 'number' ? <K.Badge tone="accent">Lv.{h.data.level}</K.Badge> : null}
                    {typeof h.data.level === 'number' ? <LevelPips level={h.data.level} max={steps(h.data.levels).at(-1)?.level ?? 0} /> : null}
                  </div>
                  {h.data.desc ? <p {...part('desc')}>{h.data.desc}</p> : null}
                  <LevelNow levels={h.data.levels} level={typeof h.data.level === 'number' ? h.data.level : undefined} />
                  {share.length ? <div {...part('share')}>同样拥有：{share.map((id, i) => <React.Fragment key={id}>{i ? '、' : ''}<RefChip id={id} /></React.Fragment>)}</div> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
