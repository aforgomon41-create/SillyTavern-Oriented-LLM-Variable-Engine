import * as engine from '../index.js';
import { SolveSessionManager } from './sessions.js';
import type { AttachOptions } from './controller.js';
import type { PublicRegistrationOptions, PublicWorldInfoRegistrationOptions } from './sessions.js';
import { fail } from '../json.js';
import { readWorldInfoSelection } from './world-info.js';
import type { WorldInfoSelection } from './world-info.js';
import type { Definition } from '../types.js';
import { closeDebugger, openDebugger } from '../debug/launcher.js';
import type { DebugTarget } from '../debug/launcher.js';
import { engineRequest, nativeSaveBody } from './fetch-origin.js';
import { guardUnboundNativeSave } from './native-save.js';
import { BgmPlayer } from './bgm.js';
import { installInjection } from './inject.js';
import type { BgmTrack } from '../types.js';

export type Carrier = 'native' | 'dynamic' | 'embedded';
const registryKey = '__SOLVE_RUNTIME_V1__';
/** Where this runtime was loaded from (tells dev builds apart: the folder name carries the build). Empty in the single-file carrier. */
const LOADED_FROM: string | undefined = (() => { try { return (import.meta as { url?: string }).url || undefined; } catch { return undefined; } })();
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
  const publicOptions = <T extends object>(options: T): T => {
    if (Object.hasOwn(options, 'owner') || Object.hasOwn(options, 'priority')) fail('REGISTRATION_OPTIONS', 'owner 和 priority 由载体管理，不能通过此注册入口指定');
    return options;
  };
  let sessions: SolveSessionManager | undefined, target = initial.debugger, native = Boolean(initial.native);
  const providers = new Map<string, Carrier>();
  let bgm: BgmPlayer | undefined, unwatchController: (() => void) | undefined, unwatchSessions: (() => void) | undefined;
  // Music follows the bound chat: re-evaluated on every controller change, silent while unbound.
  const watchMusic = (manager: SolveSessionManager) => {
    bgm ??= new BgmPlayer(scope, () => {
      const controller = sessions?.controller;
      if (!controller) return undefined;
      try { return { definition: controller.core.definition, state: controller.getState() }; } catch { return undefined; }
    });
    let bound: unknown;
    const rebind = () => {
      const controller = manager.controller;
      if (controller !== bound) { unwatchController?.(); bound = controller; unwatchController = controller?.subscribe(() => bgm?.sync()); }
      bgm?.sync();
    };
    unwatchSessions?.(); unwatchSessions = manager.subscribe(rebind); rebind();
    return manager;
  };
  const sessionWatchers = new Set<() => void>();
  let injection: ReturnType<typeof installInjection> | undefined;
  const manager = () => {
    if (!scope.SillyTavern?.getContext) throw new Error('SOLVE需要在SillyTavern 1.19页面内运行');
    if (!sessions) {
      sessions = watchMusic(new SolveSessionManager(() => scope.SillyTavern.getContext(), scope.fetch.bind(scope)));
      // The status bar follows the session manager once it exists (binding changes are announced through it).
      sessions.subscribe(() => { for (const watcher of sessionWatchers) watcher(); });
      for (const watcher of sessionWatchers) watcher();
      // 随正文输出：生成前把操作说明、指南、变量和反馈注入写正文的模型（按设置 › 变量更新 › 提示词注入）。
      injection ??= installInjection(scope, () => sessions?.controller);
    }
    return sessions;
  };
  const music = () => { manager(); return bgm!; };
  const bgmApi = Object.freeze({
    status: () => music().status(),
    setEnabled: (enabled: boolean) => music().setEnabled(enabled),
    setVolume: (volume: number) => music().setVolume(volume),
    addTracks: (tracks: BgmTrack[]) => music().addTracks(tracks),
    removeTrack: (id: string) => music().removeTrack(id),
    subscribe: (listener: () => void) => music().subscribe(listener),
  });
  const launch = () => { if (target) openDebugger(target, scope.document); };
  const getGuide = (tag?: string): string => {
    const controller = manager().controller;
    if (!controller) fail('NOT_BOUND', '当前聊天尚未绑定SOLVE定义');
    return controller.getGuide(tag);
  };
  const api = Object.freeze({ ...engine, version: engine.VERSION,
    openDebugger: launch, closeDebugger,
    getGuide,
    bgm: bgmApi,
    attach(definition: Definition, options: AttachOptions = {}) { return manager().attach(definition, options); },
    register(definition: Definition, options: PublicRegistrationOptions = {}) { return manager().register(definition, { ...publicOptions(options), owner: 'native', priority: 0 }); },
    registerWorldInfo(definition: Definition, options: PublicWorldInfoRegistrationOptions = {}) { return manager().registerWorldInfo(definition, { ...publicOptions(options), owner: 'native', priority: 0 }); },
    readWorldInfo(options: WorldInfoSelection = {}) { return readWorldInfoSelection(() => scope.SillyTavern.getContext(), options, scope.fetch.bind(scope)); },
    detach() { sessions?.detach(); },
    get controller() { return sessions?.controller; },
    get sessions() { return manager(); },
    distribution() { return { native, providers: [...providers].map(([id, kind]) => ({ id, kind })), ...(LOADED_FROM ? { source: LOADED_FROM } : {}) }; },
    /** What the last generation got from SOLVE's prompt injection (随正文输出). */
    injection() { return injection?.report(); },
    use(options: { kind: Exclude<Carrier, 'native'>; debugger?: DebugTarget }) {
      const owner = `card:${scope.crypto.randomUUID()}`;
      providers.set(owner, options.kind); if (options.debugger) target = options.debugger;
      let disposed = false;
      return Object.freeze({ ...engine, version: engine.VERSION, openDebugger: launch, closeDebugger,
        getGuide(tag?: string) { if (disposed) throw new Error('该脚本入口已停用'); return getGuide(tag); },
        get controller() { return sessions?.controller; }, get sessions() { return manager(); },
        async register(definition: Definition, registration: PublicRegistrationOptions = {}) {
          if (disposed) throw new Error('该脚本入口已停用');
          const result = await manager().register(definition, { ...publicOptions(registration), owner, priority: 10 });
          if (disposed) await manager().unregister(owner);
          return result;
        },
        async registerWorldInfo(definition: Definition, registration: PublicWorldInfoRegistrationOptions = {}) {
          if (disposed) throw new Error('该脚本入口已停用');
          const result = await manager().registerWorldInfo(definition, { ...publicOptions(registration), owner, priority: 10 });
          if (disposed) await manager().unregister(owner);
          return result;
        },
        readWorldInfo(options: WorldInfoSelection = {}) {
          if (disposed) throw new Error('该脚本入口已停用');
          return readWorldInfoSelection(() => scope.SillyTavern.getContext(), options, scope.fetch.bind(scope));
        },
        async dispose() {
          if (disposed) return; disposed = true; providers.delete(owner);
          if (sessions) await sessions.unregister(owner);
          if (!native && !providers.size) { unwatchSessions?.(); unwatchController?.(); bgm?.dispose(); bgm = undefined; injection?.dispose(); injection = undefined; sessions?.dispose(); sessions = undefined; for (const watcher of sessionWatchers) watcher(); closeDebugger(); }
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
  };
  configure(initial);
  // Status bar in the page (browser only; the declared layout decides whether anything is shown).
  let disposeStatusBar: (() => void) | undefined;
  const mountStatusBar = () => {
    if (disposeStatusBar || !scope.document?.body || typeof scope.CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in (scope.Document?.prototype ?? {}))) return;
    disposeStatusBar = () => undefined;
    void import('./statusbar.js').then(m => {
      disposeStatusBar = m.installStatusBar(scope, {
        sessions: () => sessions,
        onSessions: (listener: () => void) => { sessionWatchers.add(listener); return () => { sessionWatchers.delete(listener); }; },
        bgm: () => sessions ? bgm : undefined,
        injection: () => injection?.report(),
        ...(LOADED_FROM ? { source: LOADED_FROM } : {}),
      });
    }).catch(error => { disposeStatusBar = undefined; console.warn('[SOLVE] 状态栏加载失败', error); });
  };
  if (scope.document?.readyState === 'loading') scope.document.addEventListener('DOMContentLoaded', mountStatusBar, { once: true }); else mountStatusBar();
  console.info(`[SOLVE] ${engine.VERSION} 共享运行时已加载`);
  return { api, configure };
}
