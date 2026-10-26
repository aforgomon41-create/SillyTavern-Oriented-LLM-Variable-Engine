import { clone, SolveError } from './json.js';
import type { HostContext } from './host/sillytavern.js';

export interface DiagnosticEntry {
  sequence: number;
  time: string;
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  durationMs?: number;
}
export interface Capability { id: string; label: string; available: boolean; required: boolean; detail: string }
export function inspectCapabilities(ctx: HostContext, hostVersion?: string): Capability[] {
  const events = ['CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED'];
  return [
    { id: 'version', label: '酒馆版本', available: Boolean(hostVersion?.startsWith('1.19.')), required: true, detail: hostVersion ?? '尚未确认' },
    { id: 'single-chat', label: '单角色聊天', available: ctx.groupId == null && Boolean(ctx.chatId), required: true, detail: ctx.groupId != null ? '不支持群聊' : ctx.chatId || '尚未选择聊天' },
    ...events.map(name => ({ id: name, label: name, available: Boolean(ctx.eventSource && ctx.eventTypes?.[name]), required: true, detail: ctx.eventTypes?.[name] ?? '缺少事件，不能自动同步此类变化' })),
    { id: 'macros', label: '状态宏', available: typeof ctx.macros?.registry?.registerMacro === 'function', required: false, detail: '未提供时可继续使用程序接口' },
    { id: 'formatter', label: '指令显示过滤', available: typeof ctx.messageFormatter?.addHook === 'function', required: false, detail: '只过滤显示，不修改原始指令' },
    { id: 'operator-profile', label: '独立连接预设', available: typeof ctx.ConnectionManagerRequestService?.sendRequest === 'function', required: false, detail: '也可配置自定义 operatorRequest' },
    { id: 'indexeddb', label: '浏览器草稿与快照', available: typeof indexedDB !== 'undefined', required: false, detail: '不可用时正式历史仍由聊天文件保存' },
    { id: 'write-lock', label: '浏览器写锁', available: Boolean(globalThis.navigator?.locks), required: false, detail: '写锁仅协调同源 SOLVE 实例；保存仍做回读核验' },
  ];
}
export function describeError(error: unknown): { code: string; message: string } {
  return { code: error instanceof SolveError ? error.code : 'UNEXPECTED_ERROR', message: error instanceof Error ? error.message : String(error) };
}
export class DiagnosticJournal {
  private entries: DiagnosticEntry[] = [];
  private sequence = 0;
  constructor(private limit = 300) {}
  add(level: DiagnosticEntry['level'], code: string, message: string, durationMs?: number): DiagnosticEntry {
    const entry: DiagnosticEntry = { sequence: ++this.sequence, time: new Date().toISOString(), level, code, message, ...(durationMs !== undefined ? { durationMs } : {}) };
    this.entries.push(entry); if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    return clone(entry);
  }
  read(): DiagnosticEntry[] { return clone(this.entries); }
  clear(): void { this.entries = []; }
}
