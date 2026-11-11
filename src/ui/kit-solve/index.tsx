/**
 * SOLVE's own implementation of the component kit (src/ui/kit.ts), used in the tavern.
 *
 * The markup follows the public hook contract the Kami preset documents for skins (data-k / data-k-part / variants /
 * data-k-level), so the same DOM can be styled two ways:
 *   · standalone: SOLVE's default skin (./tokens.ts + ./kit.css);
 *   · with the Kami preset loaded: Kami's design-system and skin sheets are attached to SOLVE's shadow root instead.
 * Behaviour comes from Radix primitives; nothing here is copied from the Kami preset (different licences).
 */
import * as React from 'react';
import { Collapsible as RCollapsible, Popover as RPopover, Switch as RSwitch, Tabs as RTabs, ToggleGroup as RToggle, Tooltip as RTooltip } from 'radix-ui';
import type { Kit, NavItem, TabItem } from '../kit.js';

type Level = 'bg' | 'surface-1' | 'surface-2' | 'surface-3' | 'sunken' | 'inverse';
const LevelContext = React.createContext<Level>('bg');
/** Where popovers and tooltips render: inside SOLVE's shadow root, so its sheets apply. */
export const PortalContext = React.createContext<HTMLElement | null>(null);
const next = (l: Level): Level => l === 'bg' || l === 'sunken' ? 'surface-1' : l === 'surface-1' ? 'surface-2' : l === 'inverse' ? 'inverse' : 'surface-3';
const k = (name: string, variants: Record<string, string | undefined> = {}) => {
  const out: Record<string, string> = { 'data-k': name };
  for (const [key, v] of Object.entries(variants)) if (v !== undefined) out['data-' + key] = v;
  return out;
};
const part = (name: string) => ({ 'data-k-part': name });
const usePortal = () => React.useContext(PortalContext);
const useWin = (): Window => usePortal()?.ownerDocument.defaultView ?? window;

const Close = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const Chevron = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;

// ── controls ──

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }>(
  function Button({ variant = 'default', size, type = 'button', children, ...rest }, ref) {
    return <button ref={ref} type={type} {...k('button', { variant, size })} {...rest}><span {...part('label')}>{children}</span></button>;
  });
const IconButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: 'default' | 'ghost'; size?: 'sm' | 'md' }>(
  function IconButton({ label, variant = 'default', size, children, ...rest }, ref) {
    return <button ref={ref} type="button" aria-label={label} title={label} {...k('icon-button', { variant, size })} {...rest}><span {...part('icon')}>{children}</span></button>;
  });
function Badge({ tone, children }: { tone?: 'neutral' | 'accent' | 'danger' | 'warning' | 'success' | 'info'; children: React.ReactNode }) {
  return <span {...k('badge', { tone: tone === 'neutral' ? undefined : tone })}>{children}</span>;
}
function Switch({ checked, onCheckedChange, ...rest }: { checked?: boolean; onCheckedChange?: (v: boolean) => void; 'aria-label'?: string }) {
  return <RSwitch.Root {...k('switch')} {...(checked !== undefined ? { checked } : {})} {...(onCheckedChange ? { onCheckedChange } : {})} {...rest}><RSwitch.Thumb {...part('thumb')} /></RSwitch.Root>;
}
function Slider({ value, min, max, step = 1, onValueChange, format, ...rest }: { value: number; min: number; max: number; step?: number; onValueChange: (v: number) => void; format?: (v: number) => string; 'aria-label'?: string }) {
  const track = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState(false);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const at = (x: number) => { const r = track.current!.getBoundingClientRect(); return clamp(min + ((x - r.left) / Math.max(1, r.width)) * (max - min)); };
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setDrag(true); onValueChange(at(e.clientX));
    const win = (e.currentTarget as HTMLElement).ownerDocument.defaultView ?? window;
    const move = (ev: PointerEvent) => onValueChange(at(ev.clientX));
    const up = () => { setDrag(false); win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', up); win.removeEventListener('pointercancel', up); };
    win.addEventListener('pointermove', move); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', up);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const d: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 };
    if (e.key === 'Home') { e.preventDefault(); onValueChange(min); } else if (e.key === 'End') { e.preventDefault(); onValueChange(max); }
    else if (d[e.key] !== undefined) { e.preventDefault(); onValueChange(clamp(value + d[e.key]!)); }
  };
  const text = format ? format(value) : String(value);
  return (
    <div {...k('slider')} data-dragging={drag ? '' : undefined}>
      <div {...part('track')} ref={track} onPointerDown={onDown}>
        <div {...part('range')} style={{ width: pct + '%' }} />
        <div {...part('thumb')} role="slider" tabIndex={0} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={text}
          aria-label={rest['aria-label']} style={{ left: pct + '%' }} onKeyDown={onKey} />
      </div>
      <output {...part('value')} aria-hidden="true">{text}</output>
    </div>
  );
}
const TextField = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: 'sm' | 'md' }>(
  function TextField({ size, ...rest }, ref) {
    return <div {...k('text-field', { size })}><input ref={ref} {...part('input')} {...rest} /></div>;
  });
function Empty({ title, description, actions, icon }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div {...k('empty')}>
      {icon ? <div {...part('icon')} aria-hidden="true">{icon}</div> : null}
      <div {...part('title')}>{title}</div>
      {description ? <div {...part('description')}>{description}</div> : null}
      {actions ? <div {...part('actions')}>{actions}</div> : null}
    </div>
  );
}

// ── composites ──

function Card({ title, meta, footer, children }: { title?: React.ReactNode; meta?: React.ReactNode; footer?: React.ReactNode; children?: React.ReactNode }) {
  const lv = next(React.useContext(LevelContext));
  return (
    <section {...k('card', { role: 'container' })} data-k-level={lv}>
      <LevelContext.Provider value={lv}>
        {title || meta ? <header {...part('head')}>{title ? <h3 {...part('title')}>{title}</h3> : null}{meta ? <span {...part('meta')}>{meta}</span> : null}</header> : null}
        {children !== undefined ? <div {...part('body')}>{children}</div> : null}
        {footer ? <footer {...part('foot')}>{footer}</footer> : null}
      </LevelContext.Provider>
    </section>
  );
}
function CollapseCard({ title, meta, children, open, defaultOpen, onOpenChange }: { title?: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (v: boolean) => void }) {
  const lv = next(React.useContext(LevelContext));
  const control = { ...(open !== undefined ? { open } : {}), ...(defaultOpen !== undefined ? { defaultOpen } : {}), ...(onOpenChange ? { onOpenChange } : {}) };
  return (
    <RCollapsible.Root {...k('card', { role: 'collapse' })} data-k-level={lv} {...control}>
      <LevelContext.Provider value={lv}>
        <RCollapsible.Trigger {...part('head')}>
          <span {...part('indicator')}><Chevron /></span>
          {title ? <span {...part('title')}>{title}</span> : null}
          {meta ? <span {...part('meta')}>{meta}</span> : null}
        </RCollapsible.Trigger>
        <RCollapsible.Content {...part('body')}>{children}</RCollapsible.Content>
      </LevelContext.Provider>
    </RCollapsible.Root>
  );
}
function Tabs({ items, value, defaultValue, onValueChange, mode = 'scroll', label, sticky }: { items: TabItem[]; value?: string; defaultValue?: string; onValueChange?: (v: string) => void; mode?: 'scroll' | 'fit'; label: string; swipe?: boolean; sticky?: boolean }) {
  const [own, setOwn] = React.useState(defaultValue ?? items[0]?.value ?? '');
  const current = value ?? own;
  const list = React.useRef<HTMLDivElement>(null);
  const change = (v: string) => { if (value === undefined) setOwn(v); onValueChange?.(v); };
  // Keep the active tab in view when the strip scrolls sideways.
  React.useEffect(() => {
    const bar = list.current, tab = bar?.querySelector<HTMLElement>('[data-state="active"]');
    if (bar && tab && bar.scrollWidth > bar.clientWidth) {
      const left = tab.offsetLeft - bar.offsetLeft, right = left + tab.offsetWidth;
      if (left < bar.scrollLeft || right > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' });
    }
  }, [current]);
  return (
    <RTabs.Root {...k('tabs', { mode })} data-sticky={sticky ? '' : undefined} value={current} onValueChange={change}>
      <RTabs.List ref={list} {...part('list')} aria-label={label}>
        {items.map(it => <RTabs.Trigger key={it.value} value={it.value} disabled={!!it.disabled} {...part('tab')}>{it.label}</RTabs.Trigger>)}
      </RTabs.List>
      <div {...part('panels')}>
        {items.map(it => <RTabs.Content key={it.value} value={it.value} {...part('panel')}>{it.content}</RTabs.Content>)}
      </div>
    </RTabs.Root>
  );
}
function NavList({ items, current, onSelect, layout, label }: { items: NavItem[]; current?: string; onSelect: (id: string) => void; layout: 'sidebar' | 'list'; label: string }) {
  return (
    <nav {...k('nav', { layout })} aria-label={label}>
      {items.map(it => {
        const active = it.id === current;
        return (
          <button key={it.id} type="button" {...part('item')} aria-current={active ? 'page' : undefined} data-state={active ? 'active' : undefined} onClick={() => onSelect(it.id)}>
            {it.icon ? <span {...part('icon')} aria-hidden="true">{it.icon}</span> : null}
            <span {...part('label')}>{it.label}</span>
            {it.meta !== undefined ? <span {...part('meta')}>{it.meta}</span> : null}
            {layout === 'list' ? <span {...part('chevron')} aria-hidden="true"><Chevron /></span> : null}
          </button>
        );
      })}
    </nav>
  );
}
function Segmented({ options, value, onValueChange, label, size }: { options: { value: string; label: React.ReactNode }[]; value: string; onValueChange: (v: string) => void; label: string; size?: 'sm' | 'md' }) {
  return (
    <RToggle.Root type="single" {...k('segmented', { size })} value={value} aria-label={label} onValueChange={(v: string) => { if (v) onValueChange(v); }}>
      {options.map(o => <RToggle.Item key={o.value} value={o.value} {...part('item')}>{o.label}</RToggle.Item>)}
    </RToggle.Root>
  );
}
function TooltipProvider({ children }: { children: React.ReactNode }) { return <RTooltip.Provider delayDuration={300}>{children}</RTooltip.Provider>; }
function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactElement }) {
  const portal = usePortal();
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal {...(portal ? { container: portal } : {})}>
        <RTooltip.Content {...k('tooltip')} {...part('content')} data-k-level="inverse" sideOffset={6} collisionPadding={8}>{content}</RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
function InfoPopover({ label = '说明', children, trigger }: { label?: string; children: React.ReactNode; trigger?: React.ReactNode }) {
  const portal = usePortal();
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>
        {trigger ?? <button type="button" {...k('info-button')} aria-label={label} title={label}>i</button>}
      </RPopover.Trigger>
      <RPopover.Portal {...(portal ? { container: portal } : {})}>
        <RPopover.Content {...k('popover')} {...part('content')} data-k-level="surface-1" sideOffset={6} collisionPadding={10}>
          <LevelContext.Provider value="surface-1">{children}</LevelContext.Provider>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

// ── panel: a floating window on wide screens, a bottom sheet on narrow ones ──

const SHEET_MAX = 1000;
interface Rect { x: number; y: number; w: number; h: number }
const clampRect = (r: Rect, vw: number, vh: number, min: { w: number; h: number }): Rect => {
  const w = Math.max(Math.min(min.w, vw - 16), Math.min(r.w, vw - 16)), h = Math.max(Math.min(min.h, vh - 16), Math.min(r.h, vh - 16));
  return { w, h, x: Math.min(Math.max(8, r.x), vw - w - 8), y: Math.min(Math.max(8, r.y), vh - h - 8) };
};
function Panel({ title, children, footer, actions, onClose, closeLabel = '关闭', geometry, defaultSize = { w: 720, h: 640 }, minSize = { w: 320, h: 240 } }: {
  title: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; actions?: React.ReactNode; onClose: () => void; closeLabel?: string;
  geometry?: Rect; defaultSize?: { w: number; h: number }; minSize?: { w: number; h: number };
}) {
  const win = useWin();
  const [vp, setVp] = React.useState({ w: win.innerWidth, h: win.innerHeight });
  React.useEffect(() => { const on = () => setVp({ w: win.innerWidth, h: win.innerHeight }); win.addEventListener('resize', on); return () => win.removeEventListener('resize', on); }, [win]);
  const sheet = vp.w <= SHEET_MAX;
  const [rect, setRect] = React.useState<Rect>(() => clampRect(geometry ?? { ...defaultSize, x: (vp.w - defaultSize.w) / 2, y: (vp.h - defaultSize.h) / 2 }, vp.w, vp.h, minSize));
  React.useEffect(() => setRect(r => clampRect(r, vp.w, vp.h, minSize)), [vp.w, vp.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = React.useRef<HTMLDivElement>(null), titleId = React.useId();
  const [dragY, setDragY] = React.useState(0);
  React.useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const track = (e: React.PointerEvent, move: (dx: number, dy: number) => void, end: (dx: number, dy: number) => void) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY; let started = false;
    const onMove = (ev: PointerEvent) => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (!started && Math.hypot(dx, dy) < 4) return; started = true; ev.preventDefault(); move(dx, dy); };
    const onUp = (ev: PointerEvent) => { win.removeEventListener('pointermove', onMove); win.removeEventListener('pointerup', onUp); win.removeEventListener('pointercancel', onUp); if (started) end(ev.clientX - sx, ev.clientY - sy); };
    win.addEventListener('pointermove', onMove, { passive: false }); win.addEventListener('pointerup', onUp); win.addEventListener('pointercancel', onUp);
  };
  const onHead = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="tab"]')) return;
    if (sheet) {
      // Pull the sheet down to close it (past a quarter of its height).
      track(e, (_dx, dy) => setDragY(Math.max(0, dy)), (_dx, dy) => { setDragY(0); if (dy > (ref.current?.offsetHeight ?? vp.h) / 4) onClose(); });
      return;
    }
    const start = rect;
    track(e, (dx, dy) => setRect(clampRect({ ...start, x: start.x + dx, y: start.y + dy }, vp.w, vp.h, minSize)), () => undefined);
  };
  const onResize = (e: React.PointerEvent) => {
    const start = rect;
    track(e, (dx, dy) => setRect(clampRect({ ...start, w: start.w + dx, h: start.h + dy }, vp.w, vp.h, minSize)), () => undefined);
  };
  const onResizeKey = (e: React.KeyboardEvent) => {
    const s = e.shiftKey ? 48 : 16, d: Record<string, [number, number]> = { ArrowRight: [s, 0], ArrowLeft: [-s, 0], ArrowDown: [0, s], ArrowUp: [0, -s] };
    const v = d[e.key]; if (!v) return;
    e.preventDefault(); setRect(r => clampRect({ ...r, w: r.w + v[0], h: r.h + v[1] }, vp.w, vp.h, minSize));
  };
  const style = (sheet ? (dragY ? { '--k-sheet-drag': dragY + 'px' } : {})
    : { '--k-panel-x': rect.x + 'px', '--k-panel-y': rect.y + 'px', '--k-panel-w': rect.w + 'px', '--k-panel-h': rect.h + 'px' }) as React.CSSProperties;
  return (
    <div ref={ref} {...k('panel')} data-layout={sheet ? 'sheet' : 'floating'} data-k-width={!sheet && rect.w >= 900 ? 'wide' : 'narrow'} data-k-level="surface-1"
      data-dragging={dragY ? '' : undefined} role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1} style={style}
      onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); onClose(); } }}>
      <LevelContext.Provider value="surface-1">
        <div {...part('head')} onPointerDown={onHead}>
          {sheet ? <span {...part('grip')} aria-hidden="true" /> : null}
          <h2 {...part('title')} id={titleId}>{title}</h2>
          {actions ? <div {...part('actions')}>{actions}</div> : null}
          <IconButton label={closeLabel} variant="ghost" onClick={onClose} {...part('close')}><Close /></IconButton>
        </div>
        <div {...part('body')}>{children}</div>
        {footer ? <div {...part('foot')}>{footer}</div> : null}
        {sheet ? null : <div {...part('resize')} role="separator" aria-orientation="vertical" aria-label="调整大小（方向键）" tabIndex={0} onPointerDown={onResize} onKeyDown={onResizeKey} />}
      </LevelContext.Provider>
    </div>
  );
}

export const solveKit: Kit = {
  Panel, Tabs, Card, CollapseCard, Badge, Button, IconButton, Tooltip, TooltipProvider, InfoPopover, Slider, Switch, NavList, Segmented, TextField, Empty,
} as unknown as Kit;
