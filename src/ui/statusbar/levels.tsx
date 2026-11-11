/**
 * Per-level ability effects. The instance keeps `levels: { "1": "…", "3": "…" }` (gaps allowed);
 * a holder at level n gets the highest step ≤ n. Holders see their current step and the next one,
 * the codex shows the whole ladder with who stands where.
 */
import * as React from 'react';
import { part, solve } from './widgets.js';

export interface Step { level: number; text: string }
/** Level → effect, sorted; non-numeric keys and empty texts are ignored. */
export function steps(levels: unknown): Step[] {
  if (!levels || typeof levels !== 'object') return [];
  return Object.entries(levels as Record<string, unknown>)
    .map(([k, v]) => ({ level: Number(k), text: typeof v === 'string' ? v : '' }))
    .filter(s => Number.isFinite(s.level) && s.text)
    .sort((a, b) => a.level - b.level);
}
/** The step in effect at `level`, and the next one to reach. */
export function stepAt(list: Step[], level: number | undefined): { current?: Step; next?: Step } {
  if (level === undefined) return list[0] ? { next: list[0] } : {};
  const current = [...list].reverse().find(s => s.level <= level);
  const next = list.find(s => s.level > level);
  return { ...(current ? { current } : {}), ...(next ? { next } : {}) };
}

/** Pips: filled up to the holder's level, out of the top step. */
export function LevelPips({ level, max }: { level: number; max: number }) {
  if (max < 2 || max > 10) return null;
  return (
    <span {...solve('level-pips')} role="img" aria-label={`等级 ${level} / ${max}`}>
      {Array.from({ length: max }, (_, i) => <i key={i} data-on={i < level ? '' : undefined} />)}
    </span>
  );
}

/** Holder view: what this level does now, and what the next step adds. */
export function LevelNow({ levels, level }: { levels: unknown; level: number | undefined }) {
  const list = steps(levels);
  if (!list.length) return null;
  const { current, next } = stepAt(list, level);
  return (
    <div {...solve('levels', { compact: '' })}>
      {current ? <div {...part('row')} data-state="current"><span {...part('lv')}>Lv.{current.level}</span><span {...part('text')}>{current.text}</span></div>
        : <div {...part('row')} data-state="locked"><span {...part('lv')}>—</span><span {...part('text')}>尚未达到第一级效果</span></div>}
      {next ? <div {...part('row')} data-state="next"><span {...part('lv')}>Lv.{next.level}</span><span {...part('text')}><small>下一级 · </small>{next.text}</span></div> : null}
    </div>
  );
}

/** Codex view: the whole ladder; each holder is marked on the step that applies to them. */
export function LevelLadder({ levels, holders = [] }: { levels: unknown; holders?: { key: string; level?: number; mark: React.ReactNode }[] }) {
  const list = steps(levels);
  if (!list.length) return null;
  const at = (s: Step) => holders.filter(h => stepAt(list, h.level).current === s);
  return (
    <section {...solve('levels')}>
      <h4 {...part('title')}>等级效果<small>{list.length} 级</small></h4>
      <ol>
        {list.map(s => {
          const here = at(s);
          return (
            <li key={s.level} {...part('row')} data-state={here.length ? 'held' : undefined}>
              <span {...part('lv')}>Lv.{s.level}</span>
              <span {...part('text')}>{s.text}</span>
              {here.length ? <span {...part('who')}>{here.map(h => <React.Fragment key={h.key}>{h.mark}</React.Fragment>)}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
