/**
 * Holdings that reference root instances (items, abilities): the instance data lives once at the root,
 * the holder keeps only its own state (count / equipped, level). Shared by the player sheet and NPC cards.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { artOf, isEmpty, thumbOf, type Path, type StatusModel } from './model.js';
import { Field, NavigateContext, RefChip, useModel } from './fields.js';
import { Art, Meter, Mono, Spoiler, part, solve } from './widgets.js';
import { ActionBar } from './interact.js';
import { LevelNow, LevelPips, steps } from './levels.js';
import { CurrencyIcon } from './currency.js';

interface Held { id: string; at?: Path; data: Record<string, any> }
/** Join each referenced id with its root instance. */
function held(m: StatusModel, path: Path): Held[] {
  const holder: Record<string, any> = m.value(path) ?? {};
  return Object.keys(holder).map(id => {
    const at = m.locate(id);
    const inst = at ? m.value(at) ?? {} : {};
    return { id, ...(at ? { at } : {}), data: { ...inst, ...(holder[id] && typeof holder[id] === 'object' ? holder[id] : {}) } };
  });
}
/** Other entities of the same collection holding the same instance (e.g. who else knows this ability). */
function others(m: StatusModel, path: Path, id: string): string[] {
  const [collection, self, ...rest] = path;
  if (!collection || !self) return [];
  const all: Record<string, any> = m.value([collection]) ?? {};
  return Object.keys(all).filter(k => k !== self && m.value([collection, k, ...rest, id]) !== undefined);
}
const nameOf = (h: Held) => h.data.name ?? h.id;

/** Item type shown as money (counted coins with their own icons) rather than as bag tiles. */
const MONEY = '货币';
/** The holding field that records amounts kept elsewhere: a record keyed by entity references (官方结构：stored → 建筑). */
function storageKey(m: StatusModel, path: Path, sample?: string): string | undefined {
  if (!sample) return undefined;
  return m.children([...path, sample]).find(k => { const meta = m.meta([...path, sample, k]); return meta?.type === 'record' && !!meta.keys; });
}

export function Inventory({ path }: { path: Path }) {
  const m = useModel(), K = useKit(), go = React.useContext(NavigateContext);
  const list = held(m, path);
  const store = storageKey(m, path, list[0]?.id);
  const carried = (h: Held) => typeof h.data.count !== 'number' || h.data.count > 0;
  const kept = (h: Held): Record<string, number> => (store && h.data[store] && typeof h.data[store] === 'object' && !m.dormant([...path, h.id, store]) ? h.data[store] : {});
  const money = list.filter(h => carried(h) && h.data.type === MONEY);
  const equipped = list.filter(h => carried(h) && h.data.equipped && h.data.type !== MONEY);
  const bag = list.filter(h => carried(h) && !h.data.equipped && h.data.type !== MONEY);
  const places = [...new Set(list.flatMap(h => Object.keys(kept(h))))];
  // Someone else's belongings: only what can be seen from outside (equipped gear) is open; the rest sits behind a spoiler.
  const open = (h: Held) => m.spoiler([...path, h.id]) === 'public';
  const [sel, setSel] = React.useState<string | undefined>(list.find(open)?.id);
  const it = list.find(h => h.id === sel) ?? list.find(open);
  const tile = (h: Held, count = h.data.count, where = '') => (
    <button key={h.id + where} type="button" {...solve('slot', { kind: h.data.type, equipped: h.data.equipped && !where ? '' : undefined })} aria-pressed={h.id === it?.id} onClick={() => setSel(h.id)} title={nameOf(h)}>
      <span {...part('glyph')} aria-hidden="true">{h.data.type === MONEY && !thumbOf(h.data) ? <CurrencyIcon name={nameOf(h)} size={28} /> : <Mono name={nameOf(h)} src={thumbOf(h.data)} />}</span>
      <span {...part('name')}>{nameOf(h)}</span>
      {typeof count === 'number' && (count !== 1 || h.data.type === MONEY) ? <span {...part('count')}>{h.data.type === MONEY ? count.toLocaleString('zh-CN') : `×${count}`}</span> : null}
    </button>
  );
  const fixed = ['name', 'type', 'count', 'equipped', 'desc', 'unique', 'image', 'thumb', 'note', ...(store ? [store] : [])];
  const detail = it?.at ? m.children(it.at).filter(k => !fixed.includes(k) && !isEmpty(it.data[k]) && m.spoiler([...it.at!, k]) !== 'hidden') : [];
  const section = (key: string, title: React.ReactNode, entries: Held[], make: (h: Held) => React.ReactNode, empty?: string) => {
    const shown = entries.filter(open), folded = entries.filter(h => !open(h));
    return (
      <section key={key} {...part(key === 'bag' ? 'bag' : key === 'equipped' ? 'equipped' : 'group')}><h5 {...part('title')}>{title}<small>{entries.length}</small></h5>
        {shown.length ? <div {...part('grid')}>{shown.map(make)}</div> : null}
        {folded.length ? <Spoiler label={`${folded.length} 件不外露的东西`}><div {...part('grid')}>{folded.map(make)}</div></Spoiler> : null}
        {!entries.length ? <span {...solve('none')}>{empty}</span> : null}</section>
    );
  };
  const keptHere = it ? Object.entries(kept(it)).filter(([, n]) => typeof n === 'number' && n > 0) : [];
  return (
    <div {...solve('inventory')}>
      {equipped.length ? section('equipped', '装备中', equipped, h => tile(h)) : null}
      {section('bag', '背包', bag, h => tile(h), '空空如也')}
      {money.length ? section('money', MONEY, money, h => tile(h)) : null}
      {places.map(b => section('kept-' + b, <>存放于 <RefChip id={b} /></>, list.filter(h => (kept(h)[b] ?? 0) > 0), h => tile(h, kept(h)[b], b)))}
      {it ? (
        <div {...part('detail')} aria-live="polite">
          {artOf(it.data) ? <Art key={it.id} src={artOf(it.data)!} alt={nameOf(it)} variant="item" /> : null}
          <div {...part('head')}>
            {artOf(it.data) ? null : <span {...part('glyph')} aria-hidden="true">{it.data.type === MONEY && !thumbOf(it.data) ? <CurrencyIcon name={nameOf(it)} size={28} /> : <Mono name={nameOf(it)} src={thumbOf(it.data)} />}</span>}
            <b>{nameOf(it)}</b>
            {it.data.type ? <K.Badge tone="neutral">{it.data.type}</K.Badge> : null}
            {it.data.unique ? <K.Badge tone="warning">独一无二</K.Badge> : null}
            {it.data.equipped ? <K.Badge tone="accent">已装备</K.Badge> : null}
            {typeof it.data.count === 'number' && (it.data.count !== 1 || keptHere.length) ? <span {...part('count')}>{keptHere.length ? '随身 ' : ''}×{it.data.count}</span> : null}
          </div>
          {it.data.desc ? <p {...part('desc')}>{it.data.desc}</p> : null}
          {it.data.note ? <p {...part('note')}>{it.data.note}</p> : null}
          {keptHere.length ? <div {...part('kept')}><span {...part('label')}>{m.label([...path, it.id, store!])}</span>{keptHere.map(([b, n]) => <span key={b}><RefChip id={b} /> ×{n}</span>)}</div> : null}
          <ActionBar path={[...path, it.id]} />
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
  const body = (
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
                  {typeof h.data.progress === 'number' && !m.dormant([...path, h.id, 'progress']) ? <div {...part('progress')}><Meter label={`${m.label([...path, h.id, 'progress'])}（满 100 升一级）`} value={h.data.progress} min={0} max={100} /></div> : null}
                  {typeof h.data.progressText === 'string' && h.data.progressText && !m.dormant([...path, h.id, 'progressText']) ? <p {...part('progress-text')}><span>{m.label([...path, h.id, 'progressText'])}</span>{h.data.progressText}</p> : null}
                  <ActionBar path={[...path, h.id]} />
                  {share.length ? <div {...part('share')}>同样拥有：{share.map((id, i) => <React.Fragment key={id}>{i ? '、' : ''}<RefChip id={id} /></React.Fragment>)}</div> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
  // Someone else's abilities are not visible from outside.
  return m.spoiler(path) === 'spoiler' ? <Spoiler label={`${list.length} 项能力`}>{body}</Spoiler> : body;
}
