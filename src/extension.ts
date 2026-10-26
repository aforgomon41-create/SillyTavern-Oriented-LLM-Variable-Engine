import * as engine from './index.js';
import { SolveSessionManager } from './host/sessions.js';
import type { AttachOptions } from './host/controller.js';
import type { RegistrationOptions } from './host/sessions.js';
import type { Definition } from './types.js';
import { closeDebugger, installLauncher, openDebugger } from './debug/launcher.js';

const scope = globalThis as any;
const debuggerUrl = typeof document !== 'undefined' ? new URL('./debug.html', import.meta.url).href : '';
let sessions: SolveSessionManager | undefined;
const manager = () => {
  if (!scope.SillyTavern?.getContext) throw new Error('SOLVE需要在SillyTavern 1.19页面内运行');
  return sessions ??= new SolveSessionManager(() => scope.SillyTavern.getContext());
};
scope.SOLVE = Object.freeze({ ...engine, version: engine.VERSION,
  openDebugger() { if (debuggerUrl) openDebugger(debuggerUrl); },
  closeDebugger,
  async attach(definition: Definition, options: AttachOptions = {}) {
    return manager().attach(definition, options);
  },
  register(definition: Definition, options: RegistrationOptions = {}) { return manager().register(definition, options); },
  detach() { sessions?.detach(); },
  get controller() { return sessions?.controller; },
  get sessions() { return manager(); }
});
scope.solve_generation_interceptor = (chat: any[], contextSize: number, abort: (immediate: boolean) => void) => sessions?.controller?.intercept(chat, contextSize, abort);
console.info(`[SOLVE] 后端 ${engine.VERSION} 已加载；使用 SOLVE.attach(作者定义) 或 SOLVE.register(作者定义, 角色绑定) 初始化。`);
if (typeof document !== 'undefined') {
  if (document.body) installLauncher(debuggerUrl);
  else document.addEventListener('DOMContentLoaded', () => installLauncher(debuggerUrl), { once: true });
}
