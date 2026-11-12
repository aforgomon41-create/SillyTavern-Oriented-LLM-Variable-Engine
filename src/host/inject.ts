/**
 * 随正文输出时，把 SOLVE 的提示词注入写正文的模型（设置 › 变量更新 › 提示词注入）。
 * 每次生成前按这台设备上的设置重新计算：操作说明、指南、变量数据（叙事视图）、上轮反馈，
 * 用酒馆的扩展提示词（setExtensionPrompt）放到所选位置。卡里已经写了对应宏的，自动模式下不重复注入。
 * 独立操作模型（out-of-band）、聊天未绑定或历史未对齐时清空注入。
 */
import { guide, sop, toJson, toToon } from '../projection.js';
import { INJECT_DEFAULTS, INJECTS, injected, type InjectKey, type InjectPrefs } from '../ui/statusbar/inject.js';
import type { SillyTavernController } from './controller.js';

export const UPDATE_PREFS = 'solve.update.v1';
const KEY = (k: InjectKey) => `solve_inject_${k}`;
// SillyTavern extension_prompt_types / extension_prompt_roles
const POSITION = { before: 2, after: 0, chat: 1 } as const;
const ROLE = { system: 0, user: 1, assistant: 2 } as const;
const MACROS: Record<InjectKey, RegExp> = {
  sop: /\{\{\s*solve_SOP\b/iu, guide: /\{\{\s*solve_guide\b/iu, data: /\{\{\s*solve_(?:toon|json)\b/iu, feedback: /\{\{\s*solve_feedback\b/iu,
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
  return {
    sop: sop(),
    guide: guide(def, state),
    data: data ? `当前变量（${format === 'json' ? 'JSON' : 'TOON'}）：\n${data}` : '',
    feedback: feedback.length ? `上一回合的变量操作反馈（照此改正）：\n${JSON.stringify(feedback)}` : '',
  };
}

/**
 * Listens for generations and keeps the extension prompts in sync. Returns a disposer.
 *
 * Chat Completion attaches 「before / after」 extension prompts to the preset's Main Prompt, and drops them when a
 * preset disables it (the Kami preset does). So there: 「after」 goes in at the top of the chat history (in-chat,
 * depth = history length), 「before」 is put first in the finished request. Text Completion keeps the native positions.
 */
export function installInjection(scope: any, controller: () => SillyTavernController | undefined): () => void {
  let ctx: any; try { ctx = scope.SillyTavern?.getContext?.(); } catch { return () => undefined; }
  const source = ctx?.eventSource, event = ctx?.eventTypes?.GENERATION_AFTER_COMMANDS, ready = ctx?.eventTypes?.CHAT_COMPLETION_PROMPT_READY;
  if (!source || !event || typeof ctx.setExtensionPrompt !== 'function') return () => undefined;
  const host = () => scope.SillyTavern.getContext();
  const set = (k: InjectKey, text: string, position: number, depth: number, role: number) => {
    try { host().setExtensionPrompt(KEY(k), text, position, depth, false, role); } catch { /* host changed */ }
  };
  let first: { role: string; content: string }[] = [];
  const clear = () => { first = []; for (const x of INJECTS) set(x.key, '', POSITION.after, 0, ROLE.system); };
  const apply = async (type?: string) => {
    const c = controller();
    let status: any; try { status = c?.getStatus(); } catch { status = undefined; }
    // Quiet prompts (other extensions, the operator model) and impersonation do not write the story.
    if (!c || !status?.ready || (status.mode ?? 'in-band') !== 'in-band' || type === 'quiet' || type === 'impersonate') { clear(); return; }
    const prefs = readInjectPrefs(scope);
    if (prefs.mode === 'off') { clear(); return; }
    const macros = prefs.mode === 'auto' ? await detectCardMacros(scope) : [];
    let texts: Record<InjectKey, string>;
    try { texts = injectTexts(c, prefs.format); } catch { clear(); return; }
    const chatCompletion = host().mainApi === 'openai';
    const top = (host().chat?.length ?? 0) + 1;
    first = [];
    for (const x of INJECTS) {
      const item = prefs.items[x.key], on = injected(prefs, x.key, macros).on && !!texts[x.key];
      if (!on) { set(x.key, '', POSITION.after, 0, ROLE.system); continue; }
      if (chatCompletion && item.position === 'before') { set(x.key, '', POSITION.after, 0, ROLE.system); first.push({ role: 'system', content: texts[x.key] }); continue; }
      if (chatCompletion && item.position === 'after') { set(x.key, texts[x.key], POSITION.chat, top, ROLE.system); continue; }
      set(x.key, texts[x.key], POSITION[item.position], item.depth, ROLE[item.role]);
    }
  };
  const onReady = (data: { chat?: { role: string; content: string }[] }) => { if (first.length && Array.isArray(data?.chat)) data.chat.unshift(...first.map(m => ({ ...m }))); };
  source.on(event, apply);
  if (ready) source.on(ready, onReady);
  return () => { source.removeListener(event, apply); if (ready) source.removeListener(ready, onReady); clear(); };
}
