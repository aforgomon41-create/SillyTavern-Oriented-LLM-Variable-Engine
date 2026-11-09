/**
 * Generic field rendering: the widget is chosen from the declared type and the optional `as`
 * override, so any structure described with compileStructure renders without custom code.
 */
import * as React from 'react';
import { useKit } from '../kit.js';
import { isEmpty, type Path, type StatusModel } from './model.js';
import { CenterMeter, Checklist, Chips, Facts, Ladder, Meter, Spoiler, Stat, Timeline, part, solve } from './widgets.js';
import { CurrencyList } from './currency.js';

export const ModelContext = React.createContext<StatusModel | null>(null);
export const useModel = (): StatusModel => { const m = React.useContext(ModelContext); if (!m) throw new Error('缺少状态模型'); return m; };
/** Navigation from reference chips (open a character, a place …). */
export const NavigateContext = React.createContext<(path: Path) => void>(() => undefined);

const FU_DICE: Record<string, string> = { 弱: 'd6', 普通: 'd8', 优秀: 'd10', 卓越: 'd12' };
export const isGauge = (v: any): boolean => v && typeof v === 'object' && !Array.isArray(v) && typeof v.value === 'number' && typeof v.max === 'number';

export function RefChip({ id }: { id: string }) {
  const m = useModel(), go = React.useContext(NavigateContext);
  const path = m.locate(id);
  return <button type="button" {...solve('ref')} onClick={() => path && go(path)} disabled={!path}>{m.entityName(id)}</button>;
}

/** Wrap content according to the field's spoiler level. */
export function Guarded({ path, children }: { path: Path; children: React.ReactNode }) {
  const level = useModel().spoiler(path);
  if (level === 'hidden') return null;
  return level === 'spoiler' ? <Spoiler>{children}</Spoiler> : <>{children}</>;
}

/** One value, inline. Returns null for empty or dormant values. */
export function Value({ path, value }: { path: Path; value: any }) {
  const m = useModel(), K = useKit(), meta = m.meta(path), as = m.widget(path);
  if (value === undefined || m.dormant(path)) return null;
  if (meta?.type === 'ref') return value === null ? <span {...solve('none')}>—</span> : <RefChip id={String(value)} />;
  if (meta?.type === 'refs') return <span {...solve('chips')}>{(value as string[]).map(id => <RefChip key={id} id={id} />)}</span>;
  if (meta?.type === 'enum') return <K.Badge tone="neutral">{String(value)}</K.Badge>;
  if (meta?.type === 'bool') return <span {...solve('bool', { on: value ? '' : undefined })}>{value ? '是' : '否'}</span>;
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) return <Chips items={value} />;
  if (value === null) return <span {...solve('none')}>—</span>;
  if (typeof value === 'string') return as === 'paragraph' ? <p {...solve('paragraph')}>{value}</p> : <span {...solve('text')}>{value}</span>;
  if (typeof value === 'number') return <span {...solve('number')}>{value}</span>;
  return <span {...solve('text')}>{JSON.stringify(value)}</span>;
}

/** A labelled field as a block: picks the richest widget for its type. */
export function Field({ path, compact = false }: { path: Path; compact?: boolean }) {
  const m = useModel(), K = useKit();
  const value = m.value(path), meta = m.meta(path), as = m.widget(path), label = m.label(path);
  if (value === undefined || m.dormant(path) || m.spoiler(path) === 'hidden') return null;
  if (compact && isEmpty(value)) return null;
  let body: React.ReactNode;
  if (typeof value === 'number' || (value === null && (meta?.type === 'int' || meta?.type === 'number'))) {
    const computed = m.computed(path, value);
    if (as === 'stat' || computed.length) return <Stat label={label} value={value} computed={computed} />;
    if (as === 'meter-center' && meta?.min !== undefined && meta.max !== undefined) return <CenterMeter label={label} value={value ?? 0} min={meta.min} max={meta.max} />;
    if (meta?.min !== undefined && meta.max !== undefined && value !== null) return <Meter label={label} value={value} min={meta.min} max={meta.max} />;
    return <Stat label={label} value={value} computed={[]} />;
  }
  if (meta?.type === 'ladder') return <Ladder label={label} values={meta.values ?? []} value={value} hint={v => FU_DICE[v] ? `${v}（${FU_DICE[v]}）` : undefined} />;
  if (isGauge(value)) return <Meter label={label} value={value.value} max={value.max} />;
  if (meta?.type === 'array' && meta.stamp) body = isEmpty(value) ? <span {...solve('none')}>暂无</span> : <Timeline entries={value} />;
  else if (meta?.type === 'array' && value.some?.((v: any) => v && typeof v === 'object' && 'text' in v)) body = <Checklist items={value} />;
  else if (meta?.type === 'record' || meta?.type === 'object') return <Section path={path} />;
  else body = <Value path={path} value={value} />;
  if (body === null) return null;
  const inline = ['enum', 'string', 'ref', 'bool', 'int', 'number'].includes(meta?.type ?? '') && as !== 'paragraph';
  return (
    <div {...solve('field', { layout: inline ? 'inline' : 'stack' })}>
      <span {...part('label')}>{label}</span>
      <div {...part('value')}><Guarded path={path}>{body}</Guarded></div>
    </div>
  );
  void K;
}

/** Records and objects: cards, grids, relation rows or a simple fact list. */
export function Section({ path, title }: { path: Path; title?: React.ReactNode }) {
  const m = useModel(), K = useKit();
  const value = m.value(path), meta = m.meta(path), as = m.widget(path), label = title ?? m.label(path);
  if (value === undefined || value === null || m.dormant(path) || m.spoiler(path) === 'hidden') return null;
  if (meta?.type === 'record') {
    const keys = Object.keys(value);
    const element = m.fields[m.pattern([...path, '*'])];
    let content: React.ReactNode;
    if (!keys.length) content = <span {...solve('none')}>暂无</span>;
    else if (meta.entity) content = <EntityGrid path={path} grid={as === 'grid'} />;
    else if (meta.keys) content = <div {...solve('relations')}>{keys.map(key => <RelationRow key={key} path={[...path, key]} />)}</div>;
    else if (as === 'currency') content = <CurrencyList entries={keys.map(key => [key, value[key]])} label={String(label)} />;
    else if (as === 'meters' || element?.type === 'oneOf' || keys.every(key => isGauge(value[key]))) content = <Mixed entries={keys.map(key => [key, value[key]])} />;
    else if (as === 'chips') content = <span {...solve('chips')}>{keys.map(key => <K.Tooltip key={key} content={<EffectTip value={value[key]} />}><span {...solve('chip')} tabIndex={0}>{key}</span></K.Tooltip>)}</span>;
    else if (element?.type === 'object') content = <div {...solve('entries')}>{keys.map(key => <Entry key={key} path={[...path, key]} />)}</div>;
    else content = <Facts items={keys.map(key => ({ label: key, value: <Value path={[...path, key]} value={value[key]} /> }))} />;
    return <Block title={label} meta={keys.length ? String(keys.length) : undefined} path={path}>{content}</Block>;
  }
  // object
  const children = m.children(path).filter(key => !m.dormant([...path, key]));
  const scalar = (p: Path) => ['int', 'number', 'ladder'].includes(m.meta(p)?.type ?? '');
  const stats = children.filter(key => m.meta([...path, key])?.type === 'object' && m.children([...path, key]).every(k => scalar([...path, key, k])));
  if (children.length && stats.length === children.length) {
    // e.g. attributes → only the active system object
    return <>{stats.map(key => <Block key={key} title={`${label} · ${m.label([...path, key])}`} path={[...path, key]}><div {...solve('stats')}>{m.children([...path, key]).map(k => <Field key={k} path={[...path, key, k]} />)}</div></Block>)}</>;
  }
  const allStats = children.length > 0 && children.every(key => { const mm = m.meta([...path, key]); return mm?.type === 'ladder' || mm?.type === 'int' || mm?.type === 'number'; });
  return (
    <Block title={label} path={path}>
      <div {...solve(allStats ? 'stats' : 'fields')}>{children.map(key => <Field key={key} path={[...path, key]} compact />)}</div>
    </Block>
  );
}
function Block({ title, meta, path, children }: { title: React.ReactNode; meta?: string; path: Path; children: React.ReactNode }) {
  const K = useKit();
  return <K.Card title={title} meta={meta}><Guarded path={path}>{children}</Guarded></K.Card>;
  void path;
}
function EffectTip({ value }: { value: any }) {
  if (!value || typeof value !== 'object') return <>{String(value)}</>;
  return <span {...solve('tip')}>{value.desc}{value.source ? <><br />来源：{value.source}</> : null}{value.until ? <><br />持续到：{value.until}</> : null}</span>;
}
/** A keyed object entry (skills, …): title row + its fields. */
function Entry({ path }: { path: Path }) {
  const m = useModel(), K = useKit(), value = m.value(path) ?? {};
  const keys = m.children(path).filter(k => !isEmpty(value[k]));
  const badgeKey = keys.find(k => typeof value[k] === 'number');
  return (
    <div {...solve('entry')}>
      <div {...part('head')}><span {...part('title')}>{path.at(-1)}</span>{badgeKey ? <K.Badge tone="accent">{m.label([...path, badgeKey])} {value[badgeKey]}</K.Badge> : null}</div>
      {keys.filter(k => k !== badgeKey).map(k => <div key={k} {...part('line')}><Guarded path={[...path, k]}><Value path={[...path, k]} value={value[k]} /></Guarded></div>)}
    </div>
  );
}
/** keyed-by-reference rows (relations, reputation): target, meter, tags, details. */
function RelationRow({ path }: { path: Path }) {
  const m = useModel(), value = m.value(path) ?? {};
  const keys = m.children(path);
  const meterKey = keys.find(k => typeof value[k] === 'number');
  const meterMeta = meterKey ? m.meta([...path, meterKey]) : undefined;
  const rest = keys.filter(k => k !== meterKey && !isEmpty(value[k]));
  return (
    <div {...solve('relation')}>
      <div {...part('head')}>
        <RefChip id={path.at(-1)!} />
        {meterKey && meterMeta?.min !== undefined && meterMeta.max !== undefined ? <CenterMeter label={m.label([...path, meterKey])} value={value[meterKey]} min={meterMeta.min} max={meterMeta.max} /> : null}
      </div>
      <div {...part('body')}>{rest.map(k => <Field key={k} path={[...path, k]} compact />)}</div>
    </div>
  );
}
/** Entity collections: cards (characters, factions) or a tile grid (items). */
export function EntityGrid({ path, grid }: { path: Path; grid?: boolean }) {
  const m = useModel(), value = m.value(path) ?? {};
  return <div {...solve(grid ? 'tiles' : 'cards')}>{Object.keys(value).map(id => grid ? <ItemTile key={id} path={[...path, id]} /> : <EntityCard key={id} path={[...path, id]} />)}</div>;
}
function ItemTile({ path }: { path: Path }) {
  const m = useModel(), K = useKit(), v = m.value(path) ?? {};
  const tip = <span {...solve('tip')}>{v.desc}{v.condition ? <><br />状态：{v.condition}</> : null}</span>;
  return (
    <K.Tooltip content={tip}>
      <div {...solve('tile', { kind: v.type, equipped: v.equipped ? '' : undefined })} tabIndex={0}>
        <span {...part('kind')}>{v.type}</span>
        <span {...part('name')}>{v.name ?? path.at(-1)}</span>
        {typeof v.count === 'number' && v.count !== 1 ? <span {...part('count')}>×{v.count}</span> : null}
        {v.equipped ? <span {...part('equipped')}>已装备</span> : null}
      </div>
    </K.Tooltip>
  );
}
/** Compact entity summary; `summary` lists relative paths ($user = the player's id). */
export function EntityCard({ path, summary, onOpen }: { path: Path; summary?: string[]; onOpen?: () => void }) {
  const m = useModel(), K = useKit(), v = m.value(path) ?? {};
  const user = m.userId;
  const resolve = (rel: string): Path => rel.split('.').map(k => k === '$user' ? user ?? '$user' : k);
  const fields = summary ?? m.children(path).filter(k => ['enum', 'string'].includes(m.meta([...path, k])?.type ?? '') && k !== 'name').slice(0, 3);
  const badges = fields.filter(f => m.meta([...path, ...resolve(f)])?.type === 'enum');
  const others = fields.filter(f => !badges.includes(f));
  return (
    <div {...solve('entity-card')}>
      <K.Card title={<button type="button" {...solve('entity-title')} onClick={onOpen} disabled={!onOpen}>{v.name ?? path.at(-1)}{v.alias ? <small>「{v.alias}」</small> : null}</button>}
        meta={badges.map(b => <K.Badge key={b} tone="accent">{String(m.value([...path, ...resolve(b)]))}</K.Badge>)}>
        <div {...solve('summary')}>
          {others.map(rel => {
            const full = [...path, ...resolve(rel)], value = m.value(full);
            if (value === undefined || isEmpty(value)) return null;
            const meta = m.meta(full);
            if (meta?.type === 'record' && (m.widget(full) === 'meters' || Object.values(value).every(isGauge))) return <Mixed key={rel} entries={Object.entries(value).slice(0, 2)} />;
            if (typeof value === 'number' && meta?.min !== undefined && meta.max !== undefined && rel.includes('$user')) return <CenterMeter key={rel} label={`对${m.entityName(user ?? '')}${m.label(full)}`} value={value} min={meta.min} max={meta.max} />;
            return <Field key={rel} path={full} compact />;
          })}
        </div>
      </K.Card>
    </div>
  );
}

/** Named values that may each be a gauge {value, max}, a number or a sentence (oneOf records). */
export function Mixed({ entries }: { entries: [string, unknown][] }) {
  return (
    <div {...solve('meters')}>
      {entries.map(([key, v], i) => isGauge(v) ? <div key={key} data-slot={i % 4}><Meter label={key} value={(v as any).value} max={(v as any).max} /></div>
        : <div key={key} {...solve('note', { kind: typeof v === 'number' ? 'number' : 'text' })}><span {...part('label')}>{key}</span><span {...part('value')}>{typeof v === 'string' || typeof v === 'number' ? v : JSON.stringify(v)}</span></div>)}
    </div>
  );
}
