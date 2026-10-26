import * as engine from '../index.js';
import { SolveSessionManager } from './sessions.js';
import type { AttachOptions } from './controller.js';
import type { RegistrationOptions } from './sessions.js';
import type { Definition } from '../types.js';
import { closeDebugger, installLauncher, openDebugger } from '../debug/launcher.js';
import type { DebugTarget } from '../debug/launcher.js';
import { engineRequest, nativeSaveBody } from './fetch-origin.js';
import { guardUnboundNativeSave } from './native-save.js';

export type Carrier = 'native' | 'dynamic' | 'embedded';
const registryKey = '__SOLVE_RUNTIME_V1__';
export function hostWindow(): any {
  if (typeof window === 'undefined') return globalThis;
  try { if (window.parent !== window && (window.parent as any).SillyTavern?.getContext) return window.parent; } catch { /* reject below */ }
  return window;
}

/** Must run in the host realm. Script loaders inject this module into the parent page. */
export function installRuntime(options: { scope?: any; debugger?: DebugTarget; native?: boolean } = {}) {
  const scope = options.scope ?? globalThis as any;
  const existing = scope[registryKey] as ReturnType<typeof createRuntime> | undefined;
  if (existing) {
    if (existing.api.version !== engine.VERSION) throw new Error(`SOLVE版本冲突：页面为${existing.api.version}，脚本为${engine.VERSION}。请统一版本后刷新。`);
    existing.configure(options);
    return existing.api;
  }
  if (scope.SOLVE) throw new Error('页面已有未参与握手的SOLVE实例，请停用旧入口后刷新');
  const runtime = createRuntime(scope, options);
  scope[registryKey] = runtime;
  scope.SOLVE = runtime.api;
  return runtime.api;
}
function createRuntime(scope: any, initial: { debugger?: DebugTarget; native?: boolean }) {
  let sessions: SolveSessionManager | undefined, target = initial.debugger, native = Boolean(initial.native);
  const providers = new Map<string, Carrier>();
  const manager = () => {
    if (!scope.SillyTavern?.getContext) throw new Error('SOLVE需要在SillyTavern 1.19页面内运行');
    return sessions ??= new SolveSessionManager(() => scope.SillyTavern.getContext(), scope.fetch.bind(scope));
  };
  const launch = () => { if (target) openDebugger(target, scope.document); };
  const api = Object.freeze({ ...engine, version: engine.VERSION,
    openDebugger: launch, closeDebugger,
    attach(definition: Definition, options: AttachOptions = {}) { return manager().attach(definition, options); },
    register(definition: Definition, options: RegistrationOptions = {}) { return manager().register(definition, { ...options, owner: 'native', priority: 0 }); },
    detach() { sessions?.detach(); },
    get controller() { return sessions?.controller; },
    get sessions() { return manager(); },
    distribution() { return { native, providers: [...providers].map(([id, kind]) => ({ id, kind })) }; },
    use(options: { kind: Exclude<Carrier, 'native'>; debugger?: DebugTarget }) {
      const owner = `card:${scope.crypto.randomUUID()}`;
      providers.set(owner, options.kind); if (options.debugger) target = options.debugger;
      if (scope.document?.body) installLauncher(launch, scope.document);
      let disposed = false;
      return Object.freeze({ ...engine, version: engine.VERSION, openDebugger: launch, closeDebugger,
        get controller() { return sessions?.controller; }, get sessions() { return manager(); },
        async register(definition: Definition, registration: RegistrationOptions = {}) {
          if (disposed) throw new Error('该脚本入口已停用');
          const result = await manager().register(definition, { ...registration, owner, priority: 10 });
          if (disposed) await manager().unregister(owner);
          return result;
        },
        async dispose() {
          if (disposed) return; disposed = true; providers.delete(owner);
          if (sessions) await sessions.unregister(owner);
          if (!native && !providers.size) { sessions?.dispose(); sessions = undefined; closeDebugger(); scope.document?.getElementById('solve-debug-launcher')?.remove(); }
        }
      });
    }
  });
  scope.solve_generation_interceptor = (chat: any[], size: number, abort: (immediate: boolean) => void) => sessions?.controller?.intercept(chat, size, abort);
  // Script carriers have no manifest. Guard their actual local LLM transport.
  // Internal operator requests pass while busy; native manifest admission is stricter.
  if (scope.fetch && scope.location) {
    const upstream = scope.fetch;
    scope.fetch = function(input: RequestInfo | URL, init?: RequestInit) {
      const url = new URL(typeof input === 'string' ? input : 'url' in input ? input.url : input.href, scope.location.href);
      if (url.origin === scope.location.origin && url.pathname === '/api/chats/save' && !(init as any)?.[engineRequest]) {
        return (async () => {
          const body = await nativeSaveBody(input, init, url), controller = sessions?.controller;
          const ctx = scope.SillyTavern?.getContext();
          const avatar = ctx?.characters?.[ctx.characterId]?.avatar;
          if (controller && body.file_name === controller.boundChatId && body.avatar_url === avatar)
            return controller.guardNativeSave(body, () => upstream.call(scope, input, init));
          return guardUnboundNativeSave(body, ctx?.getRequestHeaders?.() ?? {}, upstream.bind(scope), () => upstream.call(scope, input, init));
        })();
      }
      if (!native && url.origin === scope.location.origin && /^\/api\/(?:backends\/(?:chat-completions|text-completions)|novelai|horde|kobold)\/generate(?:\/|$)/u.test(url.pathname)) {
        const status = sessions?.controller?.getStatus();
        if (status && (!status.ready || status.pendingCount || (status.busy && !status.operatorBusy))) return Promise.reject(new Error('SOLVE：变量状态未就绪，请先在调试面板处理待保存操作或重放历史'));
      }
      return upstream.call(scope, input, init);
    };
  }
  const configure = (options: { debugger?: DebugTarget; native?: boolean }) => {
    if (options.debugger) target = options.debugger;
    native ||= Boolean(options.native);
    if (scope.document?.body && (native || providers.size)) installLauncher(launch, scope.document);
  };
  configure(initial);
  console.info(`[SOLVE] ${engine.VERSION} 共享运行时已加载`);
  return { api, configure };
}
