/** Small value widgets. Hooks: [data-solve="<widget>"] with [data-solve-part="<part>"]. */
import * as React from 'react';
import { useKit } from '../kit.js';

export const solve = (name: string, extra: Record<string, string | undefined> = {}) => ({ 'data-solve': name, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined).map(([k, v]) => ['data-' + k, v])) });
export const part = (name: string) => ({ 'data-solve-part': name });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmt = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(1);

/** Horizontal gauge: value/max with optional tone by ratio. */
export function Meter({ label, value, max, min = 0, unit }: { label: React.ReactNode; value: number; max: number; min?: number; unit?: string }) {
  const ratio = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
  const tone = ratio <= 0.25 ? 'danger' : ratio <= 0.5 ? 'warning' : 'ok';
  return (
    <div {...solve('meter', { tone })} role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-label={typeof label === 'string' ? label : undefined}>
      <div {...part('head')}><span {...part('label')}>{label}</span><span {...part('value')}>{fmt(value)}<small>/{fmt(max)}{unit ?? ''}</small></span></div>
      <div {...part('track')}><div {...part('fill')} style={{ '--solve-ratio': ratio } as React.CSSProperties} /></div>
    </div>
  );
}
/** Centered meter for −N…N values such as affection. */
export function CenterMeter({ label, value, min, max }: { label?: React.ReactNode; value: number; min: number; max: number }) {
  const mid = (min + max) / 2, half = (max - min) / 2 || 1;
  const ratio = clamp((value - mid) / half, -1, 1);
  return (
    <div {...solve('center-meter', { sign: value > mid ? 'positive' : value < mid ? 'negative' : 'zero' })} role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}>
      {label ? <span {...part('label')}>{label}</span> : null}
      <div {...part('track')}><span {...part('axis')} /><div {...part('fill')} style={{ '--solve-ratio': Math.abs(ratio), '--solve-dir': ratio < 0 ? -1 : 1 } as React.CSSProperties} /></div>
      <span {...part('value')}>{value > mid ? '+' : ''}{fmt(value)}</span>
    </div>
  );
}
/** Attribute value with computed badges (WOD transcendence progress, DND modifier). */
export function Stat({ label, value, computed }: { label: string; value: number | null | undefined; computed: { label: string; value: number; formula: string }[] }) {
  const empty = value === null || value === undefined;
  const transcend = computed.find(c => c.formula === 'wodTranscend');
  const modifier = computed.find(c => c.formula === 'dndModifier');
  const step = !empty && transcend && value! >= 1 ? ((value! - 1) % 5) + 1 : 0;
  return (
    <div {...solve('stat', { empty: empty ? '' : undefined })}>
      <span {...part('label')}>{label}</span>
      <span {...part('value')}>{empty ? '—' : fmt(value!)}</span>
      {modifier && !empty ? <span {...part('modifier')}>{modifier.value >= 0 ? '+' : ''}{modifier.value}</span> : null}
      {transcend && !empty ? (
        <>
          {transcend.value > 0 ? <span {...part('transcend')} title={`${transcend.label} ${transcend.value}`}>✦{transcend.value}</span> : null}
          <span {...part('steps')} aria-label={`距下一点${transcend.label}还差 ${6 - step} 点`} title={`距下一点${transcend.label}还差 ${6 - step} 点`}>
            {[1, 2, 3, 4, 5].map(i => <i key={i} data-on={i <= step ? '' : undefined} />)}
          </span>
        </>
      ) : null}
      {computed.filter(c => c !== transcend && c !== modifier).map(c => <span key={c.label} {...part('computed')}>{c.label} {c.value}</span>)}
    </div>
  );
}
/** Ordered enum (FATE ladder, FU tiers): every step, current one marked. */
export function Ladder({ label, values, value, hint }: { label: string; values: string[]; value: string | null | undefined; hint?: (v: string) => string | undefined }) {
  const index = value ? values.indexOf(value) : -1;
  const short = values.length > 6;
  return (
    <div {...solve('ladder', { empty: index < 0 ? '' : undefined, compact: short ? '' : undefined })}>
      <span {...part('label')}>{label}</span>
      {short ? (
        <span {...part('value')}>{index < 0 ? '—' : value}<span {...part('track')} style={{ '--solve-ratio': index < 0 ? 0 : (index + 1) / values.length } as React.CSSProperties}><i /></span></span>
      ) : (
        <span {...part('steps')}>{values.map((v, i) => <i key={v} data-on={i <= index ? '' : undefined} data-current={i === index ? '' : undefined} title={hint?.(v) ?? v}>{i === index ? v : ''}</i>)}{index < 0 ? <em>—</em> : null}</span>
      )}
    </div>
  );
}
export function Chips({ items, tone }: { items: React.ReactNode[]; tone?: 'neutral' | 'accent' }) {
  const K = useKit();
  return <span {...solve('chips')}>{items.map((item, i) => <K.Badge key={i} tone={tone ?? 'neutral'}>{item}</K.Badge>)}</span>;
}
/** Spoiler: a small inline tag until the player reveals it (no blurred blocks cluttering the card). */
export function Spoiler({ children, label = '剧透' }: { children: React.ReactNode; label?: string }) {
  const [shown, setShown] = React.useState(false);
  if (shown) return <span {...solve('spoiler', { state: 'shown' })}>{children}</span>;
  return <button type="button" {...solve('spoiler', { state: 'hidden' })} onClick={() => setShown(true)} aria-label={`${label}内容，点击查看`}><i aria-hidden="true" />{label} · 点击查看</button>;
}
export function Timeline({ entries }: { entries: { round: number; text: string }[] }) {
  return <ol {...solve('timeline')}>{entries.map((e, i) => <li key={i}><span {...part('round')}>#{e.round}</span><span {...part('text')}>{e.text}</span></li>)}</ol>;
}
export function Checklist({ items }: { items: { text: string; done?: boolean }[] }) {
  return <ul {...solve('checklist')}>{items.map((item, i) => <li key={i} data-done={item.done ? '' : undefined}><span {...part('mark')} aria-label={item.done ? '已完成' : '未完成'} />{item.text}</li>)}</ul>;
}
export function Facts({ items }: { items: { label: React.ReactNode; value: React.ReactNode }[] }) {
  return <dl {...solve('facts')}>{items.map((item, i) => <div key={i}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

/** Picture or monogram: an image when the entity has one (and it loads), else its first character. */
export function Mono({ name, src }: { name: string; src?: unknown }) {
  const [bad, setBad] = React.useState(false);
  React.useEffect(() => setBad(false), [src]);
  return typeof src === 'string' && src && !bad
    ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setBad(true)} />
    : <>{[...name][0]}</>;
}

