/**
 * The component kit the SOLVE front end renders with.
 * Inside the Kami preset this is the Kami runtime's design system (same hooks, same skins);
 * standalone SOLVE provides its own implementation of the same contract.
 */
import * as React from 'react';

type Node = React.ReactNode;
export interface TabItem { value: string; label: Node; content: Node; disabled?: boolean }
export interface NavItem { id: string; label: Node; meta?: Node; icon?: Node }
export interface Kit {
  Panel(props: { title: Node; children?: Node; footer?: Node; actions?: Node; onClose: () => void; closeLabel?: string; geometry?: { x: number; y: number; w: number; h: number }; defaultSize?: { w: number; h: number }; minSize?: { w: number; h: number } }): React.JSX.Element;
  Tabs(props: { items: TabItem[]; value?: string; defaultValue?: string; onValueChange?: (v: string) => void; mode?: 'scroll' | 'fit'; label: string; swipe?: boolean; sticky?: boolean }): React.JSX.Element;
  Card(props: { title?: Node; meta?: Node; footer?: Node; children?: Node }): React.JSX.Element;
  CollapseCard(props: { title?: Node; meta?: Node; children?: Node; defaultOpen?: boolean; open?: boolean; onOpenChange?: (v: boolean) => void }): React.JSX.Element;
  Badge(props: { tone?: 'neutral' | 'accent' | 'danger' | 'warning' | 'success' | 'info'; children: Node }): React.JSX.Element;
  Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }): React.JSX.Element;
  IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: 'default' | 'ghost'; size?: 'sm' | 'md'; children: Node }): React.JSX.Element;
  Tooltip(props: { content: Node; children: React.ReactElement }): React.JSX.Element;
  TooltipProvider(props: { children: Node }): React.JSX.Element;
  InfoPopover(props: { label?: string; children: Node; trigger?: Node }): React.JSX.Element;
  Slider(props: { value: number; min: number; max: number; step?: number; onValueChange: (v: number) => void; format?: (v: number) => string; 'aria-label'?: string }): React.JSX.Element;
  Switch(props: { checked?: boolean; onCheckedChange?: (v: boolean) => void; 'aria-label'?: string }): React.JSX.Element;
  NavList(props: { items: NavItem[]; current?: string; onSelect: (id: string) => void; layout: 'sidebar' | 'list'; label: string }): React.JSX.Element;
  /** Optional: a single-choice segmented control (falls back to plain buttons). */
  Segmented?(props: { options: { value: string; label: Node }[]; value: string; onValueChange: (v: string) => void; label: string; size?: 'sm' | 'md' }): React.JSX.Element;
  Empty(props: { title: Node; description?: Node; actions?: Node; icon?: Node }): React.JSX.Element;
}
const KitContext = React.createContext<Kit | null>(null);
export const KitProvider = KitContext.Provider;
export function useKit(): Kit {
  const kit = React.useContext(KitContext);
  if (!kit) throw new Error('SOLVE 前端缺少组件套件');
  return kit;
}
