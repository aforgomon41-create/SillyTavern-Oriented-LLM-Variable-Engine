/**
 * Codex (图鉴): browse ready-made and root things like a game encyclopedia.
 * Category switch → search + filter chips → entry grid → detail.
 * Two kinds of category in the layout item `{ codex: [...] }`:
 *   · instances: { collection: 'items', label, group?: 'type', holders: ['characters.*.items'] }
 *     root instances, with everyone holding each (and, for abilities, the per-level ladder);
 *   · prefabs:   { prefabs: 'character', into: 'characters', label, origin?: 'origin', badges?, pages? }
 *     the definition's prefabs and templates of that entity type: whether each has appeared,
 *     and which entities were spawned from it (their `origin` field).
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { isEmpty, StatusModel, type Path } from './model.js';
import { Field, ModelContext, NavigateContext, useModel } from './fields.js';
import { Pages, type PageSpec } from './body.js';
import { LevelLadder } from './levels.js';
import { part, solve } from './widgets.js';

export interface CodexCategory {
  label: string;
  collection?: string; group?: string; holders?: string[];
  prefabs?: string; into?: string; origin?: string; badges?: string[]; pages?: PageSpec[];
}
const rel = (s: string): Path => s.split('.');
/** Stable key of a category (instances by collection, prefabs by entity type). */
export const catKey = (c: CodexCategory): string => c.collection ?? '$prefab:' + (c.prefabs ?? '');

/** Everyone holding instance `id` through `a.*.b` patterns, with their own entry (count, level …). */
function holdersOf(m: StatusModel, c: CodexCategory, id: string): { owner: Path; entry: any }[] {
  const patterns = c.holders ?? [];
  const out: { owner: Path; entry: any }[] = [];
  for (const pattern of patterns) {
    const parts = rel(pattern), star = parts.indexOf('*');
    if (star < 0) { const v = m.value([...parts, id]); if (v !== undefined) out.push({ owner: parts, entry: v }); continue; }
    const base = parts.slice(0, star), rest = parts.slice(star + 1);
    for (const key of Object.keys(m.value(base) ?? {})) {
      const v = m.value([...base, key, ...rest, id]);
      if (v !== undefined) out.push({ owner: [...base, key], entry: v });
    }
  }
  return out;
}

/** One codex entry, whatever its source. */
interface Entry { id: string; data: Record<string, any>; group?: string; sub: string; dim?: boolean; state?: string }
type PrefabState = 'active' | 'dormant' | 'destroyed' | 'template';
const STATE_LABEL: Record<PrefabState, string> = { active: '已登场', dormant: '未登场', destroyed: '已退场', template: '模板' };
const STATE_ORDER: PrefabState[] = ['active', 'dormant', 'destroyed', 'template'];

function prefabEntries(m: StatusModel, c: CodexCategory): (Entry & { state: PrefabState })[] {
  const type = c.prefabs!, into = rel(c.into ?? '');
  const spawned = (id: string) => c.origin ? Object.values(m.value(into) ?? {}).filter((v: any) => v?.[c.origin!] === id).length : 0;
  const out: (Entry & { state: PrefabState })[] = [];
  const add = (id: string, data: Record<string, any>, state: PrefabState) => {
    const live = state === 'active' ? m.value([...into, id]) : undefined;
    const d = live ?? data, n = spawned(id);
    const role = c.badges?.[0] ? d[c.badges[0]] : undefined;
    out.push({ id, data: d, state, group: STATE_LABEL[state], dim: state === 'destroyed',
      sub: [role, STATE_LABEL[state], n ? `衍生 ${n}` : ''].filter(Boolean).join(' · ') });
  };
  for (const [id, p] of Object.entries(m.def.prefabs ?? {})) {
    if (p.type !== type) continue;
    const life = m.state.engineState.prefabLifecycle?.[id];
    add(id, (p.data ?? {}) as Record<string, any>, life === 'active' ? 'active' : life === 'destroyed' ? 'destroyed' : 'dormant');
  }
  for (const [id, p] of Object.entries(m.def.templates ?? {})) if (p.type === type) add(id, (p.data ?? {}) as Record<string, any>, 'template');
  return out;
}
function instanceEntries(m: StatusModel, c: CodexCategory): Entry[] {
  const all: Record<string, any> = m.value(rel(c.collection!)) ?? {};
  return Object.keys(all).map(id => {
    const v = all[id] ?? {}, owners = holdersOf(m, c, id), owned = owners.length;
    const group = c.group ? v[c.group] : undefined;
    const who = owned === 1 ? m.entityName(owners[0]!.owner.at(-1)!) : owned ? `${owned}人` : `无人${c.holders?.some(h => h.includes('abilities')) ? '掌握' : '持有'}`;
    return { id, data: v, ...(group ? { group } : {}), dim: !owned, sub: [group, who].filter(Boolean).join(' · ') };
  });
}
function entriesOf(m: StatusModel, c: CodexCategory): Entry[] { return c.prefabs ? prefabEntries(m, c) : instanceEntries(m, c); }
function available(m: StatusModel, c: CodexCategory): boolean {
  if (c.prefabs) return !!c.into && !m.dormant(rel(c.into)) && entriesOf(m, c).length > 0;
  return !!c.collection && !!m.meta(rel(c.collection)) && !m.dormant(rel(c.collection));
}

function useWide(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [wide, setWide] = React.useState(true);
  React.useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= 620)); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, wide];
}

export function Codex({ categories, focus }: { categories: CodexCategory[]; focus?: { path: Path; at: number } }) {
  const m = useModel(), K = useKit();
  const cats = categories.filter(c => available(m, c));
  const [cat, setCat] = React.useState(cats[0] ? catKey(cats[0]) : '');
  const [query, setQuery] = React.useState('');
  const [group, setGroup] = React.useState('');
  const [sel, setSel] = React.useState<string | undefined>();
  const [foldOpen, setFoldOpen] = React.useState(false);
  const [ref, wide] = useWide();
  // Arriving from elsewhere (an item tile, an ability name): open that category and entry.
  React.useEffect(() => {
    if (!focus) return;
    const c = cats.find(x => x.collection && focus.path.slice(0, rel(x.collection).length).join('.') === x.collection);
    const id = c ? focus.path[rel(c.collection!).length] : undefined;
    if (c && id) { setCat(catKey(c)); setGroup(''); setQuery(''); setSel(id); }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = cats.find(c => catKey(c) === cat) ?? cats[0];
  if (!current) return <K.Empty title="图鉴是空的" description="还没有可以收录的条目。" />;
  const all = entriesOf(m, current);
  // Filter chips: the instance's own grouping field, in declared order (prefab categories have none).
  const order = (!current.prefabs && current.group ? m.meta([...rel(current.collection!), '*', current.group])?.values : undefined) ?? [];
  const groups = current.prefabs ? [] : [...new Set(all.map(e => e.group).filter(Boolean))] as string[];
  groups.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const q = query.trim().toLowerCase();
  const shown = all.filter(e => (!group || e.group === group)
    && (!q || [e.data.name, e.id, e.data.desc, e.data.intro].some(t => typeof t === 'string' && t.toLowerCase().includes(q))));
  const pick = sel ? all.find(e => e.id === sel) : undefined;
  const switchCat = (c: string) => { setCat(c); setGroup(''); setQuery(''); setSel(undefined); setFoldOpen(false); };
  // Prefab categories: templates are always listed; prefabs sit in one folded group (opened by a search hit too).
  const main = current.prefabs ? shown.filter(e => e.state === 'template') : shown;
  const folded = current.prefabs ? shown.filter(e => e.state !== 'template')
    .sort((a, b) => STATE_ORDER.indexOf(a.state as PrefabState) - STATE_ORDER.indexOf(b.state as PrefabState)) : [];
  const foldShown = foldOpen || (!!q && folded.length > 0) || (!!pick && pick.state !== undefined && pick.state !== 'template');
  const tile = (e: Entry) => (
    <button key={e.id} type="button" {...solve('codex-entry', { kind: current.prefabs ? undefined : e.group, state: e.state, unowned: e.dim ? '' : undefined })} aria-pressed={e.id === pick?.id} onClick={() => setSel(e.id)}>
      <span {...part('glyph')} aria-hidden="true">{[...(e.data.name ?? e.id)][0]}</span>
      <span {...part('name')}>{e.data.name ?? e.id}</span>
      <span {...part('sub')}>{e.sub}</span>
    </button>
  );
  const count = (c: CodexCategory) => entriesOf(m, c).length;

  const list = (
    <div {...part('browse')}>
      <div {...part('tools')}>
        {K.TextField ? <K.TextField size="sm" type="search" placeholder={`搜索${current.label}`} value={query} onChange={e => setQuery(e.target.value)} aria-label={`搜索${current.label}`} />
          : <input type="search" {...part('search')} placeholder={`搜索${current.label}`} value={query} onChange={e => setQuery(e.target.value)} aria-label={`搜索${current.label}`} />}
        {groups.length > 1 ? (
          <div {...part('filters')} role="group" aria-label="分类">
            {['', ...groups].map(g => <button key={g || '*'} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>{g || '全部'}<small>{g ? all.filter(e => e.group === g).length : all.length}</small></button>)}
          </div>
        ) : null}
      </div>
      {main.length ? <div {...part('grid')}>{main.map(tile)}</div>
        : !folded.length ? <span {...solve('none')}>没有符合的条目</span>
        : current.prefabs ? <span {...solve('none')}>没有{q ? '符合的' : ''}模板</span> : null}
      {folded.length ? (
        <section {...solve('codex-fold', { open: foldShown ? '' : undefined })}>
          <button type="button" {...part('toggle')} aria-expanded={foldShown} onClick={() => setFoldOpen(!foldShown)}>
            <span {...part('chev')} aria-hidden="true">›</span>预制{current.label}<small>{folded.length}</small>
            <span {...part('hint')}>{STATE_ORDER.filter(st => st !== 'template').map(st => [st, folded.filter(e => e.state === st).length] as const).filter(([, n]) => n).map(([st, n]) => `${STATE_LABEL[st]} ${n}`).join(' · ')}</span>
          </button>
          {foldShown ? <div {...part('grid')}>{folded.map(tile)}</div> : null}
        </section>
      ) : null}
    </div>
  );
  const back = wide ? undefined : () => setSel(undefined);
  const detail = !pick ? <div {...part('placeholder')}>选择一个条目查看详情</div>
    : current.prefabs ? <PrefabDetail key={pick.id} entry={pick as Entry & { state: PrefabState }} category={current} {...(back ? { onBack: back } : {})} />
    : <InstanceDetail path={[...rel(current.collection!), pick.id]} category={current} {...(back ? { onBack: back } : {})} />;
  return (
    <div ref={ref} {...solve('codex', { layout: wide ? 'wide' : 'narrow' })}>
      {cats.length > 1 ? (
        <div {...part('cats')}>
          {K.Segmented ? <K.Segmented label="图鉴分类" value={catKey(current)} onValueChange={switchCat}
            options={cats.map(c => ({ value: catKey(c), label: <>{c.label}<small>{count(c)}</small></> }))} />
            : cats.map(c => <button key={catKey(c)} type="button" onClick={() => switchCat(catKey(c))}>{c.label}</button>)}
        </div>
      ) : null}
      {wide ? <div {...part('split')}>{list}<div {...part('detail')}>{detail}</div></div> : pick ? detail : list}
    </div>
  );
}

function Head({ name, onBack, label, children }: { name: string; onBack?: (() => void) | undefined; label: string; children?: React.ReactNode }) {
  return (
    <>
      {onBack ? <button type="button" {...part('back')} onClick={onBack}>‹ 返回{label}列表</button> : null}
      <header {...part('head')}>
        <span {...part('glyph')} aria-hidden="true">{[...name][0]}</span>
        <div><h3 {...part('name')}>{name}</h3>{children ? <div {...part('badges')}>{children}</div> : null}</div>
      </header>
    </>
  );
}
function Avatar({ m, id }: { m: StatusModel; id: string }) {
  return <span {...part('avatar')} aria-hidden="true">{[...m.entityName(id)][0]}</span>;
}

function InstanceDetail({ path, category, onBack }: { path: Path; category: CodexCategory; onBack?: () => void }) {
  const m = useModel(), K = useKit(), go = React.useContext(NavigateContext);
  const v = m.value(path) ?? {}, id = path.at(-1)!;
  const holders = holdersOf(m, category, id);
  const ladder = m.widget([...path, 'levels']) === 'levels' && !isEmpty(v.levels);
  const fields = m.children(path).filter(k => !['name', 'desc', 'unique', category.group ?? '', ...(ladder ? ['levels'] : [])].includes(k) && !isEmpty(v[k]) && m.spoiler([...path, k]) !== 'hidden');
  const skill = category.holders?.some(h => h.includes('abilities'));
  const describe = (entry: any) => entry && typeof entry === 'object'
    ? Object.entries(entry).filter(([, x]) => x !== false && x !== undefined && !(typeof x === 'number' && x === 1 && 'equipped' in entry))
      .map(([k, x]) => k === 'equipped' ? '装备中' : k === 'count' ? `×${x}` : k === 'level' ? `Lv.${x}` : `${k} ${x}`).join(' · ')
    : '';
  return (
    <article {...solve('codex-detail')}>
      <Head name={v.name ?? id} onBack={onBack} label={category.label}>
        {category.group && v[category.group] ? <K.Badge tone="accent">{v[category.group]}</K.Badge> : null}
        {v.unique === true ? <K.Badge tone="warning">独一无二</K.Badge> : null}
      </Head>
      {v.desc ? <p {...part('desc')}>{v.desc}</p> : null}
      {fields.length ? <div {...solve('fields')}>{fields.map(k => <Field key={k} path={[...path, k]} compact />)}</div> : null}
      {ladder ? <LevelLadder levels={v.levels} holders={holders.map(h => {
        const who = h.owner.at(-1)!;
        return { key: h.owner.join('.'), ...(typeof h.entry?.level === 'number' ? { level: h.entry.level } : {}),
          mark: <button type="button" {...part('mark')} onClick={() => go(h.owner)} title={`${m.entityName(who)} · Lv.${h.entry?.level ?? '?'}`}><Avatar m={m} id={who} />{m.entityName(who)}</button> };
      })} /> : null}
      <section {...part('holders')}>
        <h4 {...part('title')}>{skill ? '掌握者' : '持有者'}<small>{holders.length}</small></h4>
        {holders.length ? (
          <ul>{holders.map(h => (
            <li key={h.owner.join('.')}>
              <button type="button" onClick={() => go(h.owner)}><Avatar m={m} id={h.owner.at(-1)!} />{m.entityName(h.owner.at(-1)!)}</button>
              <span {...part('entry')}>{describe(h.entry)}</span>
            </li>))}
          </ul>
        ) : <span {...solve('none')}>目前无人{skill ? '掌握' : '持有'}</span>}
      </section>
    </article>
  );
}

const STATE_NOTE: Record<PrefabState, string> = {
  active: '预制角色，已经登场，下面是此刻的状态。',
  dormant: '预制角色，还没有在故事里出现。',
  destroyed: '预制角色，登场过，已经退场（预制角色只会登场一次）。',
  template: '模板：可以据此生成任意多个独立的角色。',
};
const STATE_TONE: Record<PrefabState, string> = { active: 'success', dormant: 'neutral', destroyed: 'danger', template: 'info' };

function PrefabDetail({ entry, category, onBack }: { entry: Entry & { state: PrefabState }; category: CodexCategory; onBack?: () => void }) {
  const m = useModel(), K = useKit(), go = React.useContext(NavigateContext);
  const into = rel(category.into ?? ''), { id, data, state } = entry;
  const spawned = category.origin ? Object.entries(m.value(into) ?? {}).filter(([, v]: [string, any]) => v?.[category.origin!] === id).map(([k]) => k) : [];
  // Prefab data is not in the chat state: show it through a model where it sits at its would-be place.
  const view = React.useMemo(() => state === 'active' ? m
    : new StatusModel(m.def, { ...m.state, data: { ...m.data, [into[0]!]: { ...(m.value(into) ?? {}), [id]: data } } } as typeof m.state), [m, state, id, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = [...into, id];
  const [shown, setShown] = React.useState(state !== 'dormant');
  return (
    <article {...solve('codex-detail', { state })}>
      <Head name={data.name ?? id} onBack={onBack} label={category.label}>
        {(category.badges ?? []).map(b => data[b] ? <K.Badge key={b} tone="accent">{String(data[b])}</K.Badge> : null)}
        <K.Badge tone={STATE_TONE[state] as never}>{STATE_LABEL[state]}</K.Badge>
      </Head>
      <p {...part('note')}>{STATE_NOTE[state]}</p>
      {state === 'active' ? <div {...part('more')}><K.Button size="sm" variant="default" onClick={() => go(base)}>查看这个角色 ›</K.Button></div> : null}
      {category.origin ? (
        <section {...part('holders')}>
          <h4 {...part('title')}>由此生成<small>{spawned.length}</small></h4>
          {spawned.length ? (
            <ul>{spawned.map(k => (
              <li key={k}>
                <button type="button" onClick={() => go([...into, k])}><Avatar m={m} id={k} />{m.entityName(k)}</button>
                <span {...part('entry')}>{String(m.value([...into, k, 'condition']) ?? '')}</span>
              </li>))}
            </ul>
          ) : <span {...solve('none')}>{state === 'template' ? '还没有用这个模板生成过角色' : '还没有以它为原型的角色'}</span>}
        </section>
      ) : null}
      {category.pages?.length ? (
        shown ? (
          <ModelContext.Provider value={view}>
            <Pages base={base} pages={category.pages} label={`${data.name ?? id}资料`} compact />
          </ModelContext.Provider>
        ) : <button type="button" {...solve('spoiler', { state: 'hidden' })} onClick={() => setShown(true)}><i aria-hidden="true" />未登场 · 点击查看资料</button>
      ) : null}
    </article>
  );
}
