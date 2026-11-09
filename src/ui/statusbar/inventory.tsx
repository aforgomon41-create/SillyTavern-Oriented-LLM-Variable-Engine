/** Inventory: equipped slots, bag grid and an item description box (shared by the player sheet and NPC cards). */
import * as React from 'react';
import { useKit } from '../kit.js';
import { isEmpty, type Path } from './model.js';
import { Field, useModel } from './fields.js';
import { part, solve } from './widgets.js';

export function Inventory({ path }: { path: Path }) {
  const m = useModel(), K = useKit(), items: Record<string, any> = m.value(path) ?? {};
  const ids = Object.keys(items);
  const equipped = ids.filter(id => items[id]?.equipped), bag = ids.filter(id => !items[id]?.equipped);
  const [sel, setSel] = React.useState<string | undefined>(ids[0]);
  const it = sel ? items[sel] : undefined;
  const tile = (id: string) => (
    <button key={id} type="button" {...solve('slot', { kind: items[id]?.type, equipped: items[id]?.equipped ? '' : undefined })} aria-pressed={id === sel} onClick={() => setSel(id)}
      title={items[id]?.name ?? id}>
      <span {...part('glyph')} aria-hidden="true">{[...(items[id]?.name ?? id)][0]}</span>
      <span {...part('name')}>{items[id]?.name ?? id}</span>
      {typeof items[id]?.count === 'number' && items[id].count !== 1 ? <span {...part('count')}>×{items[id].count}</span> : null}
    </button>
  );
  const fixed = ['name', 'type', 'count', 'equipped', 'desc'];
  const detailKeys = it ? m.children([...path, sel!]).filter(k => !fixed.includes(k) && !isEmpty(it[k]) && m.spoiler([...path, sel!, k]) !== 'hidden') : [];
  return (
    <div {...solve('inventory')}>
      {equipped.length ? <section {...part('equipped')}><h5 {...part('title')}>装备中<small>{equipped.length}</small></h5><div {...part('grid')}>{equipped.map(tile)}</div></section> : null}
      <section {...part('bag')}><h5 {...part('title')}>背包<small>{bag.length}</small></h5>
        {bag.length ? <div {...part('grid')}>{bag.map(tile)}</div> : <span {...solve('none')}>空空如也</span>}</section>
      {it ? (
        <div {...part('detail')} aria-live="polite">
          <div {...part('head')}>
            <span {...part('glyph')} aria-hidden="true">{[...(it.name ?? sel)][0]}</span>
            <b>{it.name ?? sel}</b>
            {it.type ? <K.Badge tone="neutral">{it.type}</K.Badge> : null}
            {it.equipped ? <K.Badge tone="accent">已装备</K.Badge> : null}
            {typeof it.count === 'number' && it.count !== 1 ? <span {...part('count')}>×{it.count}</span> : null}
          </div>
          {it.desc ? <p {...part('desc')}>{it.desc}</p> : null}
          {detailKeys.map(k => <Field key={k} path={[...path, sel!, k]} compact />)}
        </div>
      ) : null}
    </div>
  );
}
