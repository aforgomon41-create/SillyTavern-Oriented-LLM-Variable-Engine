/**
 * 随正文输出时，把 SOLVE 的提示词注入写正文的模型（设置 › 变量更新 › 提示词注入）。
 * 每次生成前按这台设备上的设置重新计算：操作说明、数据结构、指南、变量数据（叙事视图）、上轮反馈，
 * 用酒馆的扩展提示词（setExtensionPrompt）放到所选位置。卡里已经写了对应宏的，自动模式下不重复注入。
 * 独立操作模型（out-of-band）、聊天未绑定或历史未对齐时清空注入。
 */
import { guide, sop, toJson, toToon } from '../projection.js';
import { schemaText } from '../schema-text.js';
import { INJECT_DEFAULTS, INJECTS, injected, type InjectKey, type InjectPosition, type InjectPrefs } from '../ui/statusbar/inject.js';
import type { SillyTavernController } from './controller.js';

export const UPDATE_PREFS = 'solve.update.v1';
// The tavern joins prompts of the same place in key order: numbered keys keep 操作说明 → 数据结构 → 指南 → 变量 → 反馈.
const KEY = (k: InjectKey) => `solve_inject_${INJECTS.findIndex(x => x.key === k) + 1}_${k}`;
// SillyTavern extension_prompt_types / extension_prompt_roles
const POSITION = { before: 2, after: 0, chat: 1 } as const;
const empty = (): Record<'before' | 'system' | 'user' | 'end', string[]> => ({ before: [], system: [], user: [], end: [] });
const ROLE = { system: 0, user: 1, assistant: 2 } as const;
const MACROS: Record<InjectKey, RegExp> = {
  sop: /\{\{\s*solve_SOP\b/iu, schema: /\{\{\s*solve_schema\b/iu, guide: /\{\{\s*solve_guide\b/iu, data: /\{\{\s*solve_(?:toon|json)\b/iu, feedback: /\{\{\s*solve_feedback\b/iu,
};

export function readInjectPrefs(scope: any): InjectPrefs {
  try {
    const p = JSON.parse(scope.localStorage?.getItem(UPDATE_PREFS) ?? 'null')?.inject;
    return p ? { ...INJECT_DEFAULTS, ...p, items: { ...INJECT_DEFAULTS.items, ...p.items } } : INJECT_DEFAULTS;
  } catch { return INJECT_DEFAULTS; }
}

/** Which SOLVE macros the card already uses: character fields, its world books, the chat-completion preset prompts. */
export async function detectCardMacros(scope: any): Promise<InjectKey[]> {
  let ctx: any; try { ctx = scope.SillyTavern?.getContext?.(); } catch { return []; }
  const char = ctx?.characters?.[ctx.characterId];
  const texts: string[] = [];
  if (char) {
    const d = char.data ?? {};
    texts.push(char.description, char.personality, char.scenario, char.mes_example, d.system_prompt, d.post_history_instructions, d.extensions?.depth_prompt?.prompt);
    for (const e of d.character_book?.entries ?? []) texts.push(e?.content);
    const world = d.extensions?.world;
    if (world && typeof ctx.loadWorldInfo === 'function') {
      try { const book = await ctx.loadWorldInfo(world); for (const e of Object.values(book?.entries ?? {}) as any[]) if (!e?.disable) texts.push(e?.content); } catch { /* missing book */ }
    }
  }
  for (const p of ctx?.chatCompletionSettings?.prompts ?? []) texts.push(p?.content);
  const all = texts.filter((t): t is string => typeof t === 'string').join('\n');
  return (Object.keys(MACROS) as InjectKey[]).filter(k => MACROS[k].test(all));
}

/** Text of each prompt for the current state (also shown in the settings page). */
export function injectTexts(controller: SillyTavernController, format: InjectPrefs['format']): Record<InjectKey, string> {
  const def = controller.core.definition, state = controller.getState();
  const feedback = controller.runtime.getCommit()?.feedback ?? [];
  const data = format === 'json' ? toJson(def, state, { view: 'narrative' }) : toToon(def, state, { view: 'narrative' });
  const rules = guide(def, state);
  // Empty collections read as a bare 「name:」 in TOON; say so instead of letting it look broken.
  let empty: string[] = [];
  try { const top = JSON.parse(toJson(def, state, { view: 'narrative' })); empty = Object.entries(top).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length).map(([k]) => k); } catch { empty = []; }
  // The tavern trims each prompt and joins those of one place with a newline: every part starts with its own heading instead.
  const part = (text: string) => text.trim();
  return {
    sop: part(sop()),
    schema: part(schemaText(def, state)),
    guide: part(rules ? `## 变量规则\n${rules}` : ''),
    data: part(data ? `## 当前变量（${format === 'json' ? 'JSON' : 'TOON'}）\n${empty.length && format === 'toon' ? `${empty.join('、')} 后面没有内容：还没有建任何实体。\n` : ''}${data}` : ''),
    feedback: part(feedback.length ? `## 上一轮变量操作的反馈\n下面的操作被修正或失败了，这一轮照此改正：\n${JSON.stringify(feedback)}` : ''),
  };
}

/** What the last generation got (debug panel, SOLVE.injection(), console). */
export interface InjectionReport {
  at: number; type: string; dryRun: boolean;
  /** Why nothing was injected (whole turn). */
  skipped?: string;
  items: { key: InjectKey; label: string; on: boolean; why?: string; where?: string; chars?: number }[];
}
const PLACE: Record<InjectPosition, string> = { before: '最前面', system: '系统提示末尾', after: '聊天记录之前', chat: '聊天记录中', user: '玩家最后一句', end: '最末尾' };
/** Positions the tavern has no slot for: placed in the finished chat-completion request. */
type Placed = 'before' | 'system' | 'user' | 'end';
type Msg = { role: string; content: unknown };
const append = (m: Msg, text: string) => {
  if (typeof m.content === 'string') m.content = m.content ? `${m.content}\n\n${text}` : text;
  else if (Array.isArray(m.content)) m.content.push({ type: 'text', text });
  else m.content = text;
};
/** Puts the placed prompts into the finished request (each list keeps the INJECTS order). */
export function placeInChat(chat: Msg[], placed: Record<Placed, string[]>, said = ''): void {
  if (placed.system.length) {
    const sys = chat.find(m => m.role === 'system');
    if (sys) append(sys, placed.system.join('\n\n')); else chat.unshift({ role: 'system', content: placed.system.join('\n\n') });
  }
  if (placed.before.length) chat.unshift(...placed.before.map(content => ({ role: 'system', content })));
  if (placed.user.length) {
    // The player's line (presets often add their own user messages after the history), else the last user message.
    const users = chat.filter(m => m.role === 'user').reverse(), text = (m: Msg) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    // The history message itself (trimmed text equal) before preset wrappers that quote it.
    const user = (said && (users.find(m => text(m).trim() === said) ?? users.find(m => text(m).includes(said)))) || users[0];
    if (user) append(user, placed.user.join('\n\n')); else chat.push({ role: 'user', content: placed.user.join('\n\n') });
  }
  if (placed.end.length) chat.push(...placed.end.map(content => ({ role: 'system', content })));
}
const ROLE_LABEL = { system: '系统', user: '用户', assistant: 'AI' } as const;

/**
 * Listens for generations and keeps the extension prompts in sync. Returns a disposer.
 *
 * Chat Completion attaches 「before / after」 extension prompts to the preset's Main Prompt, and drops them when a
 * preset disables it (the Kami preset does). So there: 「after」 goes in at the top of the chat history (in-chat,
 * depth = history length); 「before」, 「system」 (end of the first system message), 「user」 (appended to the last user
 * message) and 「end」 (after everything) are placed in the finished request. Text Completion uses the nearest native slot.
 */
export function installInjection(scope: any, controller: () => SillyTavernController | undefined): { dispose(): void; report(): InjectionReport | undefined } {
  let ctx: any; try { ctx = scope.SillyTavern?.getContext?.(); } catch { return { dispose: () => undefined, report: () => undefined }; }
  const source = ctx?.eventSource, event = ctx?.eventTypes?.GENERATION_AFTER_COMMANDS, ready = ctx?.eventTypes?.CHAT_COMPLETION_PROMPT_READY;
  let last: InjectionReport | undefined;
  if (!source || !event || typeof ctx.setExtensionPrompt !== 'function') return { dispose: () => undefined, report: () => last };
  const host = () => scope.SillyTavern.getContext();
  const set = (k: InjectKey, text: string, position: number, depth: number, role: number) => {
    try { host().setExtensionPrompt(KEY(k), text, position, depth, false, role); } catch { /* host changed */ }
  };
  let placed = empty();
  // The player's newest line; read when the prompt is ready (at GENERATION_AFTER_COMMANDS the new message is not in the chat yet).
  const said = () => { try { return String([...(host().chat ?? [])].reverse().find((m: any) => m?.is_user && !m.is_system)?.mes ?? '').trim(); } catch { return ''; } };
  const clear = () => { placed = empty(); for (const x of INJECTS) set(x.key, '', POSITION.after, 0, ROLE.system); };
  const skip = (type: string, dryRun: boolean, why: string) => {
    clear();
    last = { at: Date.now(), type, dryRun, skipped: why, items: INJECTS.map(x => ({ key: x.key, label: x.label, on: false, why })) };
    console.info(`[SOLVE] 本轮没有注入提示词：${why}`);
  };
  const apply = async (type = 'normal', _options?: unknown, dryRun = false) => {
    const c = controller();
    let status: any; try { status = c?.getStatus(); } catch { status = undefined; }
    if (!c) return skip(type, dryRun, '当前聊天没有启用 SOLVE');
    if (!status?.ready) return skip(type, dryRun, `SOLVE 状态未就绪：${status?.reason || '正在加载'}`);
    if ((status.mode ?? 'in-band') !== 'in-band') return skip(type, dryRun, '这张卡用独立操作模型，正文模型不需要操作说明');
    // Quiet prompts (other extensions, the operator model) and impersonation do not write the story.
    if (type === 'quiet' || type === 'impersonate') return skip(type, dryRun, type === 'quiet' ? '后台静默请求' : '代写');
    const prefs = readInjectPrefs(scope);
    if (prefs.mode === 'off') return skip(type, dryRun, '设置里选了「不注入」');
    const macros = prefs.mode === 'auto' ? await detectCardMacros(scope) : [];
    let texts: Record<InjectKey, string>;
    try { texts = injectTexts(c, prefs.format); } catch (error) { return skip(type, dryRun, `读取变量失败：${error instanceof Error ? error.message : String(error)}`); }
    const chatCompletion = host().mainApi === 'openai';
    const top = (host().chat?.length ?? 0) + 1;
    placed = empty();
    const items: InjectionReport['items'] = [];
    for (const x of INJECTS) {
      const item = prefs.items[x.key], st = injected(prefs, x.key, macros), on = st.on && !!texts[x.key];
      const where = item.position === 'chat' ? `${PLACE.chat} · 深度 ${item.depth} · ${ROLE_LABEL[item.role]}` : PLACE[item.position];
      items.push({ key: x.key, label: x.label, on, ...(on ? { where, chars: texts[x.key].length } : { why: st.why ?? '现在是空的' }) });
      if (!on) { set(x.key, '', POSITION.after, 0, ROLE.system); continue; }
      const pos = item.position in PLACE ? item.position : 'after';
      if (chatCompletion && (pos === 'before' || pos === 'system' || pos === 'user' || pos === 'end')) { set(x.key, '', POSITION.after, 0, ROLE.system); placed[pos].push(texts[x.key]); continue; }
      if (chatCompletion && pos === 'after') { set(x.key, texts[x.key], POSITION.chat, top, ROLE.system); continue; }
      // Text completion: the tavern's own slots (system → after the story string, last user message / end → newest in-chat).
      if (pos === 'system' || pos === 'after') { set(x.key, texts[x.key], POSITION.after, 0, ROLE.system); continue; }
      if (pos === 'user' || pos === 'end') { set(x.key, texts[x.key], POSITION.chat, 0, pos === 'user' ? ROLE.user : ROLE.system); continue; }
      set(x.key, texts[x.key], POSITION[pos], item.depth, ROLE[item.role]);
    }
    last = { at: Date.now(), type, dryRun, items };
    console.info('[SOLVE] 本轮注入：' + items.map(i => i.on ? `${i.label} ${i.chars} 字 @${i.where}` : `${i.label}（${i.why}）`).join('；'));
  };
  const onReady = (data: { chat?: Msg[] }) => { if (Array.isArray(data?.chat)) placeInChat(data.chat, placed, placed.user.length ? said() : ''); };
  source.on(event, apply);
  if (ready) source.on(ready, onReady);
  return { dispose: () => {
    source.removeListener(event, apply); if (ready) source.removeListener(ready, onReady); clear();
    // Leave no empty slots behind in the tavern's prompt list.
    try { const prompts = host().extensionPrompts; if (prompts) for (const x of INJECTS) delete prompts[KEY(x.key)]; } catch { /* host changed */ }
  }, report: () => last };
}
