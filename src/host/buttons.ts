/**
 * Quick buttons above the tavern's input (where 酒馆助手 puts script buttons, as MVU does): repair actions for the
 * current chat. Which ones show is a preference of this browser (⚙ 设置 › 快捷按钮).
 */

export type ButtonId = 'reprocess' | 'replay' | 'rebuild' | 'generate' | 'retry' | 'debug';
export interface ButtonSpec { id: ButtonId; label: string; icon: string; desc: string; on: boolean }
export const BUTTONS: ButtonSpec[] = [
  { id: 'reprocess', label: '重新处理变量', icon: 'fa-rotate-right', on: true, desc: '重新读取最新一条回复里的变量操作并计算。没处理到、处理出错时用。' },
  { id: 'replay', label: '重放', icon: 'fa-forward-step', on: true, desc: '输入楼层号，从那一楼往后按正文重新计算变量。改过早先的回复后用。' },
  { id: 'rebuild', label: '重建', icon: 'fa-screwdriver-wrench', on: true, desc: '放弃没保存的操作，按聊天记录重建当前变量，再补处理最新回复。卡住、反复报错时用。' },
  { id: 'generate', label: '单独生成变量', icon: 'fa-wand-magic-sparkles', on: true, desc: '让模型只根据最新回复写变量操作，写进这条回复后计算。正文模型忘了写操作块时用（用「变量更新」里选的模型，默认是当前连接）。' },
  { id: 'retry', label: '重试保存', icon: 'fa-floppy-disk', on: true, desc: '有操作没保存成功时出现。SOLVE 会先自动重试，仍不成功才需要点它。' },
  { id: 'debug', label: 'SOLVE 调试', icon: 'fa-bug', on: false, desc: '打开调试面板（也在魔法棒菜单里）。' },
];
export const BUTTON_PREFS = 'solve.buttons.v1';
export const BUTTONS_EVENT = 'solve:buttons-prefs';
export type ButtonPrefs = Partial<Record<ButtonId, boolean>>;

interface ControllerLike {
  getStatus(): { ready: boolean; busy: boolean; reason: string; pendingCount: number; generating?: boolean };
  subscribe(listener: () => void): () => void;
  reprocessLatest(): Promise<unknown>;
  replayFrom(index: number): Promise<void>;
  rebuild(): Promise<void>;
  retryPending(): Promise<unknown>;
  generateOperations(request?: (prompt: string, signal: AbortSignal) => Promise<string>, index?: number): Promise<{ operations: number }>;
}
export interface ButtonsHost { controller(): ControllerLike | undefined; onSessions(listener: () => void): () => void; openDebug(): void }

const read = <T,>(scope: any, key: string, fallback: T): T => { try { return JSON.parse(scope.localStorage?.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
export const buttonPrefs = (scope: any): ButtonPrefs => read<ButtonPrefs>(scope, BUTTON_PREFS, {});
export const shown = (prefs: ButtonPrefs, b: ButtonSpec) => prefs[b.id] ?? b.on;
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Mount the button row; follows the bound controller and the preferences. Returns a disposer. */
export function installButtons(scope: any, host: ButtonsHost): () => void {
  const doc: Document = scope.document;
  let bar: HTMLElement | undefined, timer: any, unsub: (() => void) | undefined, current: ControllerLike | undefined;
  const busy = new Set<ButtonId>();
  const toast = (kind: 'success' | 'error' | 'info', text: string) => { try { scope.toastr?.[kind](text, 'SOLVE'); } catch { /* no toasts */ } };
  const run = async (id: ButtonId) => {
    const c = host.controller();
    if (id === 'debug') { host.openDebug(); return; }
    if (!c) { toast('info', '当前聊天没有启用 SOLVE'); return; }
    if (busy.has(id)) return;
    let index: number | undefined;
    if (id === 'replay') {
      const chat = scope.SillyTavern.getContext().chat as unknown[];
      const answer = scope.prompt?.(`从第几楼开始重放？（0 – ${chat.length - 1}，这一楼和之后的回复会按正文重新计算变量）`, String(Math.max(0, chat.length - 1)));
      if (answer === null || answer === undefined) return;
      index = Number(String(answer).trim());
      if (!Number.isInteger(index) || index < 0 || index >= chat.length) { toast('error', '楼层号无效'); return; }
    }
    busy.add(id); render();
    try {
      if (id === 'reprocess') { await c.reprocessLatest(); toast('success', '已重新处理最新回复的变量'); }
      else if (id === 'replay') { await c.replayFrom(index!); toast('success', `已从第 ${index} 楼重放`); }
      else if (id === 'rebuild') { await c.rebuild(); const s = c.getStatus(); s.ready ? toast('success', '已按聊天记录重建变量') : toast('info', `已重建，但还需要处理：${s.reason}`); }
      else if (id === 'retry') { await c.retryPending(); toast('success', '已保存'); }
      else if (id === 'generate') { const r = await c.generateOperations(); toast('success', `已生成并写入 ${r.operations} 组变量操作`); }
    } catch (e) { toast('error', `${BUTTONS.find(b => b.id === id)!.label}没有完成：${message(e)}`); }
    finally { busy.delete(id); render(); }
  };
  const render = () => {
    const form = doc.getElementById('send_form');
    if (!form) return;
    const c = host.controller();
    if (c !== current) { unsub?.(); unsub = c?.subscribe(render); current = c; }
    const prefs = buttonPrefs(scope);
    // A controller left behind by a chat switch throws on every read until the new one is attached: show nothing meanwhile.
    let status: ReturnType<ControllerLike['getStatus']> | undefined;
    try { status = c?.getStatus(); } catch { status = undefined; }
    // 重试保存 only while something is unsaved, and then first: it is the one that matters.
    const list = c && status ? BUTTONS.filter(b => shown(prefs, b) && (b.id !== 'retry' || !!status?.pendingCount)).sort((x, y) => Number(y.id === 'retry') - Number(x.id === 'retry')) : [];
    if (!list.length) { bar?.remove(); bar = undefined; return; }
    if (!bar || !bar.isConnected) {
      bar = doc.createElement('div'); bar.id = 'solve_buttons'; bar.className = 'flex-container flexGap5';
      // One line that scrolls sideways on narrow screens (a second line would sit under floating bars).
      bar.setAttribute('style', 'flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding:2px 4px;');
      const qr = doc.getElementById('qr--bar');
      if (qr && qr.parentElement === form) qr.after(bar); else form.prepend(bar);
    }
    const sig = list.map(b => b.id + (busy.has(b.id) ? '*' : '') + (status?.generating ? 'g' : '')).join(',');
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    bar.replaceChildren(...list.map(b => {
      const el = doc.createElement('div');
      el.className = 'menu_button menu_button_icon interactable'; el.tabIndex = 0; el.setAttribute('role', 'button');
      el.dataset.solveButton = b.id; el.title = b.desc;
      const off = busy.has(b.id) || (!!status?.generating && b.id !== 'debug');
      if (off) el.setAttribute('aria-disabled', 'true');
      el.setAttribute('style', `flex:none;white-space:nowrap;margin:0;padding:3px 8px;min-height:unset;font-size:calc(var(--mainFontSize) * .85);${off ? 'opacity:.5;pointer-events:none;' : ''}`);
      const i = doc.createElement('i'); i.className = `fa-solid ${busy.has(b.id) ? 'fa-spinner fa-spin' : b.icon}`;
      const span = doc.createElement('span'); span.textContent = b.label;
      el.append(i, span);
      el.addEventListener('click', () => void run(b.id));
      el.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void run(b.id); } });
      return el;
    }));
  };
  const offSessions = host.onSessions(render);
  doc.addEventListener(BUTTONS_EVENT, render);
  // The input form appears after the tavern finishes loading; keep the row in place if it is re-rendered.
  timer = scope.setInterval(render, 2000);
  render();
  return () => { scope.clearInterval(timer); offSessions(); unsub?.(); doc.removeEventListener(BUTTONS_EVENT, render); bar?.remove(); };
}
