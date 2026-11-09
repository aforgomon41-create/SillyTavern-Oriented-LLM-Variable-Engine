/**
 * Codex (图鉴): browse the root instances (items, abilities …) like a game encyclopedia.
 * Category switch → search + type filter → entry grid → detail with every holder.
 * Layout item: { codex: [{ collection, label, group?, holders: ['characters.*.items', …] }] }
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { isEmpty, type Path, type StatusModel } from './model.js';
import { Field, NavigateContext, useModel } from './fields.js';
import { part, solve } from './widgets.js';

export interface CodexCategory { collection: string; label: string; group?: string; holders?: string[] }
const rel = (s: string): Path => s.split('.');

/** Everyone holding `id` through a `a.*.b` pattern, with their own entry (count, level …). */
function holdersOf(m: StatusModel, patterns: string[], id: string): { owner: Path; entry: any }[] {
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
  const cats = categories.filter(c => m.meta(rel(c.collection)) && !m.dormant(rel(c.collection)));
  const [cat, setCat] = React.useState(cats[0]?.collection ?? '');
  const [query, setQuery] = React.useState('');
  const [group, setGroup] = React.useState('');
  const [sel, setSel] = React.useState<string | undefined>();
  const [ref, wide] = useWide();
  // Arriving from elsewhere (an item tile, an ability name): open that category and entry.
  React.useEffect(() => {
    if (!focus) return;
    const c = cats.find(x => focus.path.slice(0, rel(x.collection).length).join('.') === x.collection);
    const id = c ? focus.path[rel(c.collection).length] : undefined;
    if (c && id) { setCat(c.collection); setGroup(''); setQuery(''); setSel(id); }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = cats.find(c => c.collection === cat) ?? cats[0];
  if (!current) return <K.Empty title="图鉴是空的" description="还没有可以收录的条目。" />;
  const base = rel(current.collection);
  const all: Record<string, any> = m.value(base) ?? {};
  const groupMeta = current.group ? m.meta([...base, '*', current.group]) : undefined;
  const groups = current.group ? [...new Set(Object.values(all).map(v => v?.[current.group!]).filter(Boolean))] as string[] : [];
  groups.sort((a, b) => (groupMeta?.values?.indexOf(a) ?? 0) - (groupMeta?.values?.indexOf(b) ?? 0));
  const q = query.trim().toLowerCase();
  const ids = Object.keys(all).filter(id => (!group || all[id]?.[current.group!] === group)
    && (!q || [all[id]?.name, id, all[id]?.desc].some(t => typeof t === 'string' && t.toLowerCase().includes(q))));
  const pick = sel && all[sel] ? sel : undefined;
  const switchCat = (c: string) => { setCat(c); setGroup(''); setQuery(''); setSel(undefined); };

  const list = (
    <div {...part('browse')}>
      <div {...part('tools')}>
        {K.TextField ? <K.TextField size="sm" type="search" placeholder={`搜索${current.label}`} value={query} onChange={e => setQuery(e.target.value)} aria-label={`搜索${current.label}`} />
          : <input type="search" {...part('search')} placeholder={`搜索${current.label}`} value={query} onChange={e => setQuery(e.target.value)} aria-label={`搜索${current.label}`} />}
        {groups.length > 1 ? (
          <div {...part('filters')} role="group" aria-label="分类">
            {['', ...groups].map(g => <button key={g || '*'} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>{g || '全部'}<small>{g ? Object.values(all).filter(v => v?.[current.group!] === g).length : Object.keys(all).length}</small></button>)}
          </div>
        ) : null}
      </div>
      {ids.length ? (
        <div {...part('grid')}>
          {ids.map(id => {
            const v = all[id] ?? {}, owned = holdersOf(m, current.holders ?? [], id).length;
            return (
              <button key={id} type="button" {...solve('codex-entry', { kind: v[current.group ?? ''], unowned: owned ? undefined : '' })} aria-pressed={id === pick} onClick={() => setSel(id)}>
                <span {...part('glyph')} aria-hidden="true">{[...(v.name ?? id)][0]}</span>
                <span {...part('name')}>{v.name ?? id}</span>
                <span {...part('sub')}>{current.group ? v[current.group] : ''}{owned ? ` · ${owned}人` : ' · 无人持有'}</span>
              </button>
            );
          })}
        </div>
      ) : <span {...solve('none')}>没有符合的条目</span>}
    </div>
  );
  const detail = pick ? <CodexDetail path={[...base, pick]} category={current} onBack={wide ? undefined : () => setSel(undefined)} /> : (
    <div {...part('placeholder')}>选择一个条目查看详情</div>
  );
  return (
    <div ref={ref} {...solve('codex', { layout: wide ? 'wide' : 'narrow' })}>
      {cats.length > 1 ? (
        <div {...part('cats')}>
          {K.Segmented ? <K.Segmented label="图鉴分类" value={current.collection} onValueChange={switchCat}
            options={cats.map(c => ({ value: c.collection, label: <>{c.label}<small>{Object.keys(m.value(rel(c.collection)) ?? {}).length}</small></> }))} />
            : cats.map(c => <button key={c.collection} type="button" onClick={() => switchCat(c.collection)}>{c.label}</button>)}
        </div>
      ) : null}
      {wide ? <div {...part('split')}>{list}<div {...part('detail')}>{detail}</div></div> : pick ? detail : list}
    </div>
  );
}

function CodexDetail({ path, category, onBack }: { path: Path; category: CodexCategory; onBack?: () => void }) {
  const m = useModel(), K = useKit(), go = React.useContext(NavigateContext);
  const v = m.value(path) ?? {}, id = path.at(-1)!;
  const holders = holdersOf(m, category.holders ?? [], id);
  const fields = m.children(path).filter(k => !['name', 'desc', category.group ?? ''].includes(k) && !isEmpty(v[k]) && m.spoiler([...path, k]) !== 'hidden');
  const describe = (entry: any) => entry && typeof entry === 'object'
    ? Object.entries(entry).filter(([, x]) => x !== false && x !== undefined && !(typeof x === 'number' && x === 1 && 'equipped' in entry))
      .map(([k, x]) => k === 'equipped' ? '装备中' : k === 'count' ? `×${x}` : k === 'level' ? `Lv.${x}` : `${k} ${x}`).join(' · ')
    : '';
  return (
    <article {...solve('codex-detail')}>
      {onBack ? <button type="button" {...part('back')} onClick={onBack}>‹ 返回{category.label}列表</button> : null}
      <header {...part('head')}>
        <span {...part('glyph')} aria-hidden="true">{[...(v.name ?? id)][0]}</span>
        <div>
          <h3 {...part('name')}>{v.name ?? id}</h3>
          {category.group && v[category.group] ? <K.Badge tone="accent">{v[category.group]}</K.Badge> : null}
        </div>
      </header>
      {v.desc ? <p {...part('desc')}>{v.desc}</p> : null}
      {fields.length ? <div {...solve('fields')}>{fields.map(k => <Field key={k} path={[...path, k]} compact />)}</div> : null}
      <section {...part('holders')}>
        <h4 {...part('title')}>{category.label === '能力' ? '掌握者' : '持有者'}<small>{holders.length}</small></h4>
        {holders.length ? (
          <ul>{holders.map(h => (
            <li key={h.owner.join('.')}>
              <button type="button" onClick={() => go(h.owner)}><span {...part('avatar')} aria-hidden="true">{[...m.entityName(h.owner.at(-1)!)][0]}</span>{m.entityName(h.owner.at(-1)!)}</button>
              <span {...part('entry')}>{describe(h.entry)}</span>
            </li>))}
          </ul>
        ) : <span {...solve('none')}>目前无人{category.label === '能力' ? '掌握' : '持有'}</span>}
      </section>
    </article>
  );
}
