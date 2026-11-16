/**
 * 独立操作模型: how SOLVE asks a model for the operations of a reply, from ⚙ 设置 › 变量更新 (this browser).
 *   · 与当前连接相同 — the tavern's current connection (generateRaw)
 *   · 酒馆连接配置 — a saved connection profile (ConnectionManagerRequestService)
 *   · 自定义 API — any OpenAI-compatible endpoint, sent through the tavern's server (most relays refuse cross-origin
 *     calls from the browser), the key going along as a request header and never stored on the server.
 */
import { UPDATE_PREFS } from './inject.js';

export interface OperatorPrefs {
  mode?: 'in-band' | 'out-of-band';
  source: 'same' | 'profile' | 'custom';
  profileId?: string;
  api: { url: string; key: string; model: string; temperature: number; maxTokens: number };
  format: 'toon' | 'json';
  history: number;
  preset: 'builtin' | 'current';
  auto: boolean;
  minLength: number;
  trigger: string;
  retries: number;
  timeout: number;
  notify: { working: boolean; failed: boolean };
}
export type OperatorRequest = (prompt: string, signal: AbortSignal) => Promise<string>;
export const UPDATE_EVENT = 'solve:update-prefs';
const DEFAULTS: OperatorPrefs = { source: 'same', api: { url: '', key: '', model: '', temperature: 0.3, maxTokens: 65536 }, format: 'toon', history: 4, preset: 'builtin',
  auto: true, minLength: 0, trigger: '', retries: 1, timeout: 60, notify: { working: true, failed: true } };

export const OLD_DEFAULTS = [2048, 16384];
export function readOperatorPrefs(scope: any): OperatorPrefs {
  let saved: any = {};
  try { saved = JSON.parse(scope.localStorage?.getItem(UPDATE_PREFS) ?? 'null') ?? {}; } catch { saved = {}; }
  const api = { ...DEFAULTS.api, ...saved.api };
  // Earlier defaults (2048, then 16384 in dev builds) were saved with the rest: they follow the current default.
  if (OLD_DEFAULTS.includes(api.maxTokens)) api.maxTokens = DEFAULTS.api.maxTokens;
  return { ...DEFAULTS, ...saved, api, notify: { ...DEFAULTS.notify, ...saved.notify } };
}
const yamlString = (s: string) => JSON.stringify(s);
const base = (url: string) => url.trim().replace(/\/+$/u, '').replace(/\/chat\/completions$/u, '');
/** The tavern's chat-completion proxy, as a custom OpenAI-compatible source. */
function viaTavern(scope: any, api: OperatorPrefs['api']) {
  const ctx = scope.SillyTavern.getContext();
  const common = { chat_completion_source: 'custom', custom_url: base(api.url), ...(api.key ? { custom_include_headers: `Authorization: ${yamlString('Bearer ' + api.key)}` } : {}) };
  return {
    async chat(messages: { role: string; content: string }[], signal: AbortSignal): Promise<string> {
      const res = await scope.fetch('/api/backends/chat-completions/generate', { method: 'POST', signal, headers: ctx.getRequestHeaders(),
        body: JSON.stringify({ ...common, model: api.model, messages, max_tokens: api.maxTokens, temperature: api.temperature, stream: false }) });
      const text = await res.text();
      let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
      if (!res.ok || json?.error) {
        const detail = String(json?.error?.message ?? json?.error ?? text).slice(0, 200);
        if (/unauthori[sz]ed|invalid.{0,20}(api.?)?key|401|incorrect api key/iu.test(detail)) throw new Error(`密钥无效或没有权限（${detail}）`);
        if (/model.{0,40}(not.?found|not exist|does not exist|unknown)/iu.test(detail)) throw new Error(`没有这个模型：${api.model}（${detail}）`);
        throw new Error(`操作模型请求失败（${res.status}）：${detail}`);
      }
      const out = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text;
      if (typeof out !== 'string') throw new Error('操作模型没有返回文字');
      if (json?.choices?.[0]?.finish_reason === 'length') throw Object.assign(new Error(`操作模型的输出到 ${api.maxTokens} token 上限被截断了，请在 ⚙ 设置 › 变量更新 调大「最大回复长度」`), { code: 'OPERATOR_TRUNCATED' });
      return out;
    },
    async models(): Promise<string[]> {
      const res = await scope.fetch('/api/backends/chat-completions/status', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify(common) });
      const json = await res.json().catch(() => undefined);
      const list = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      if (!res.ok || json?.error || !list.length) throw new Error('拿不到模型列表，请检查地址和密钥');
      return list.map((m: any) => String(m.id ?? m)).sort();
    },
  };
}

/** The request used for 独立操作模型 and 单独生成变量. */
export function operatorRequest(scope: any, prefs = readOperatorPrefs(scope)): OperatorRequest {
  const ctx = scope.SillyTavern.getContext();
  const system = 'You update game variables. Read the instructions and the latest reply, then output only the <solve_operate> block. Do not continue the story.';
  if (prefs.source === 'profile' && prefs.profileId) {
    return async (prompt, signal) => {
      const service = ctx.ConnectionManagerRequestService;
      if (!service) throw new Error('酒馆的连接配置管理不可用');
      const r = await service.sendRequest(prefs.profileId, prompt, prefs.api.maxTokens, { stream: false, signal, extractData: true, includePreset: prefs.preset === 'current' });
      return typeof r === 'string' ? r : r?.content ?? '';
    };
  }
  if (prefs.source === 'custom') {
    if (!prefs.api.url || !prefs.api.model) return async () => { throw new Error('自定义 API 还没填地址或模型名称（⚙ 设置 › 变量更新）'); };
    const api = viaTavern(scope, prefs.api);
    return (prompt, signal) => api.chat([{ role: 'system', content: system }, { role: 'user', content: prompt }], signal);
  }
  // 与当前连接相同
  return async (prompt, signal) => {
    if (!ctx.generateRaw) throw new Error('这个版本的酒馆不支持单独请求');
    const run = ctx.generateRaw({ prompt, systemPrompt: system, responseLength: prefs.api.maxTokens });
    const stop = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? new Error('已取消')), { once: true }));
    return String(await Promise.race([run, stop]) ?? '');
  };
}
/** 测试连接: a tiny request with the chosen source. */
export async function testOperator(scope: any): Promise<{ ok: boolean; at: number; ms?: number; chars?: number; error?: string }> {
  const started = performance.now(), abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error('超时')), 30_000);
  try {
    const text = await operatorRequest(scope)('只回复两个字：正常', abort.signal);
    if (!text.trim()) throw new Error('模型返回了空内容');
    return { ok: true, at: Date.now(), ms: performance.now() - started, chars: text.length };
  } catch (e) { return { ok: false, at: Date.now(), error: e instanceof Error ? e.message : String(e) }; }
  finally { clearTimeout(timer); }
}
export function listOperatorModels(scope: any): Promise<string[]> {
  const prefs = readOperatorPrefs(scope);
  if (!prefs.api.url) return Promise.reject(new Error('先填 API 地址'));
  return viaTavern(scope, prefs.api).models();
}
