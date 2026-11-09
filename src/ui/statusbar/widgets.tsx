/** Small value widgets. Hooks: [data-solve="<widget>"] with [data-solve-part="<part>"]. */
import * as React from 'react';
import { createPortal } from 'react-dom';
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
          {transcend.value > 0 ? <span {...part('transcend')} title={`${transcend.label} ${transcend.value}：每满 5 点属性获得 1 点`}><i aria-hidden="true">✦</i>{transcend.label} {transcend.value}</span> : null}
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

/** Media-fragment crop `#xywh=percent:x,y,w,h` (a square face crop out of a larger picture). */
export function parseCrop(src: string): { url: string; x: number; y: number; w: number; h: number } | undefined {
  const m = /#xywh=percent:([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/u.exec(src);
  if (!m) return undefined;
  const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
  return w > 0 && h > 0 ? { url: src.slice(0, m.index), x, y, w, h } : undefined;
}
/** The picture without any crop fragment (for full views). */
export const uncropped = (src: string): string => parseCrop(src)?.url ?? src;

/** Picture or monogram: the thumbnail (cropped when the link says so) if it loads, else the first character. */
export function Mono({ name, src }: { name: string; src?: unknown }) {
  const [bad, setBad] = React.useState(false);
  React.useEffect(() => setBad(false), [src]);
  if (typeof src !== 'string' || !src || bad) return <>{[...name][0]}</>;
  const crop = parseCrop(src);
  const img = <img src={crop?.url ?? src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={() => setBad(true)}
    style={crop ? { position: 'absolute', maxWidth: 'none', objectFit: 'fill', width: `${10000 / crop.w}%`, height: `${10000 / crop.h}%`, left: `${-crop.x * 100 / crop.w}%`, top: `${-crop.y * 100 / crop.h}%` } : undefined} />;
  return crop ? <span {...solve('crop')}>{img}</span> : img;
}

/**
 * Full picture (立绘 / scene / item photo). Click opens it full screen. Falls back to nothing when it fails to load.
 * variant: hero (tall portrait) · side (card column) · banner (wide) · item (contained photo).
 */
export function Art({ src, alt, variant }: { src: string; alt: string; variant: 'hero' | 'side' | 'banner' | 'item' }) {
  const [state, setState] = React.useState<'loading' | 'ok' | 'bad'>('loading');
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => setState('loading'), [src]);
  if (state === 'bad') return null;
  const url = uncropped(src);
  return (
    <>
      <button ref={ref} type="button" {...solve('art', { variant, state })} onClick={() => setOpen(true)} aria-label={`查看${alt}的大图`} title="点击查看大图">
        <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onLoad={() => setState('ok')} onError={() => setState('bad')} />
      </button>
      {open ? <Lightbox src={url} alt={alt} anchor={ref} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
function Lightbox({ src, alt, anchor, onClose }: { src: string; alt: string; anchor: React.RefObject<HTMLElement | null>; onClose: () => void }) {
  // Portal to the root (the panel may be transformed, which would trap position: fixed).
  const root = anchor.current?.getRootNode();
  const host = root instanceof ShadowRoot ? root : document.body;
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return createPortal(
    // The panel is a modal layer: it turns pointer events off outside itself and closes on outside presses.
    // Take pointer events back, and keep presses here from reaching the panel's outside-press handler.
    <div {...solve('lightbox')} role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}
      onPointerDown={e => e.stopPropagation()} onPointerDownCapture={e => e.nativeEvent.stopImmediatePropagation?.()} onTouchStart={e => e.stopPropagation()}>
      <img src={src} alt={alt} referrerPolicy="no-referrer" onClick={e => e.stopPropagation()} />
      <div {...part('bar')}><span>{alt}</span><button type="button" onClick={onClose} aria-label="关闭">✕</button></div>
    </div>, host as unknown as Element);
}

/** Is the element at least `min` px wide? (layouts that change structure, not only style, by width) */
export function useWide(min = 620): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [wide, setWide] = React.useState(true);
  React.useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= min)); ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, wide];
}
