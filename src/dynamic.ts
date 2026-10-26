import { VERSION } from './version.js';
import { hostWindow } from './host/install.js';
import type { Carrier } from './host/install.js';

/** Import in a Tavern Helper script, then register the card definition on this lease. */
export async function install(options: { kind?: Exclude<Carrier, 'native'> } = {}) {
  const host = hostWindow();
  if (!host.document || !host.SillyTavern?.getContext) throw new Error('请从酒馆助手脚本中加载SOLVE');
  let disposed = false;
  let lease: ReturnType<ReturnType<typeof import('./host/install.js').installRuntime>['use']> | undefined;
  const abort = new AbortController();
  const cleanup = () => { disposed = true; abort.abort(); void lease?.dispose(); };
  window.addEventListener('pagehide', cleanup, { once: true });
  try {
    if (!host.SOLVE) {
      const key = '__SOLVE_LOADING__';
      host[key] ??= new Promise<void>((resolve, reject) => {
        const script = host.document.createElement('script'); script.type = 'module';
        script.src = new URL('./runtime.js', import.meta.url).href;
        script.onload = () => { script.remove(); resolve(); };
        script.onerror = () => { script.remove(); delete host[key]; reject(new Error('SOLVE动态模块加载失败，请检查地址和CORS设置')); };
        host.document.head.append(script);
      });
      await host[key];
    }
    if (!host.SOLVE?.use) throw new Error('SOLVE共享运行时启动失败，请检查酒馆控制台');
    if (host.SOLVE.version !== VERSION) throw new Error(`SOLVE版本冲突：需要${VERSION}，页面为${host.SOLVE.version}`);
    const panel = await fetch(new URL('./debug-inline.html', import.meta.url), { signal: abort.signal });
    if (!panel.ok) throw new Error(`SOLVE调试面板加载失败（${panel.status}）`);
    const html = await panel.text();
    if (disposed) throw new Error('SOLVE加载期间脚本已停用');
    lease = host.SOLVE.use({ kind: options.kind ?? 'dynamic', debugger: { html } });
    return lease;
  } catch (error) { window.removeEventListener('pagehide', cleanup); throw error; }
}
