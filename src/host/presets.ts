/**
 * 设置存档: a structure's per-chat settings (module switches, list caps, per-change limits) saved so that a new chat
 * can start with them instead of the structure's defaults. Kept in the tavern's extension settings (the account, on
 * every device), per structure id:
 *   · named sets the player saved (⚙ 设置 › 设置存档);
 *   · 「上次的设置」, recorded every time the player changes these settings in any chat of that structure.
 */
import type { SettingsPatch } from '../types.js';

export interface PresetValues { modules: Record<string, boolean>; settings: SettingsPatch }
export interface StructurePreset extends PresetValues { id: string; name: string; savedAt: number }
interface Store { presets?: Record<string, StructurePreset[]>; last?: Record<string, PresetValues & { savedAt: number }>; pick?: Record<string, string> }
/** What a new chat starts with: the structure's defaults, the last settings used, or a saved set. */
export type PresetChoice = 'default' | 'last' | string;

interface ControllerLike {
  core: { definition: { id: string } };
  getModules(): { name: string; enabled: boolean; parent?: string; exclusive?: string }[];
  getSettings(): { lists: Record<string, { max: number; warn: number; default: { max: number; warn: number } }>; maxDelta: Record<string, { value: number; default: number }> };
  setModule(name: string, enabled: boolean): Promise<unknown>;
  setSettings(patch: SettingsPatch): Promise<unknown>;
}

const KEY = 'solve';
function store(scope: any): Store {
  try { return (scope.SillyTavern?.getContext?.().extensionSettings?.[KEY] ?? {}) as Store; } catch { return {}; }
}
function save(scope: any, next: Store): void {
  const ctx = scope.SillyTavern?.getContext?.();
  if (!ctx?.extensionSettings) return;
  ctx.extensionSettings[KEY] = next;
  try { ctx.saveSettingsDebounced?.(); } catch { /* saved with the next settings save */ }
  try { scope.document?.dispatchEvent(new scope.CustomEvent(PRESETS_EVENT)); } catch { /* old browser */ }
}
export const PRESETS_EVENT = 'solve:presets';

export function listPresets(scope: any, structure: string): StructurePreset[] { return [...store(scope).presets?.[structure] ?? []]; }
export function lastSettings(scope: any, structure: string): (PresetValues & { savedAt: number }) | undefined { return store(scope).last?.[structure]; }
/** The choice offered first in 选择数据结构: the one picked last time, if it still exists. */
export function defaultPick(scope: any, structure: string): PresetChoice {
  // A named set picked last time stays first; otherwise the settings changed last (so a new chat never silently
  // falls back to the structure's defaults once the player has adjusted anything).
  const s = store(scope), pick = s.pick?.[structure];
  if (pick && pick !== 'last' && pick !== 'default' && s.presets?.[structure]?.some(p => p.id === pick)) return pick;
  return s.last?.[structure] ? 'last' : 'default';
}
export function rememberPick(scope: any, structure: string, choice: PresetChoice): void {
  const s = store(scope); save(scope, { ...s, pick: { ...s.pick, [structure]: choice } });
}
export function resolvePreset(scope: any, structure: string, choice: PresetChoice): PresetValues | undefined {
  if (choice === 'default') return undefined;
  if (choice === 'last') return lastSettings(scope, structure);
  return listPresets(scope, structure).find(p => p.id === choice);
}

/** The chat's current settings, kept as differences from the structure's defaults (so later default changes still reach them). */
export function capture(controller: ControllerLike): PresetValues {
  const modules = Object.fromEntries(controller.getModules().map(m => [m.name, m.enabled]));
  const current = controller.getSettings();
  const lists = Object.fromEntries(Object.entries(current.lists).filter(([, r]) => r.max !== r.default.max || r.warn !== r.default.warn).map(([k, r]) => [k, { max: r.max, warn: r.warn }]));
  const maxDelta = Object.fromEntries(Object.entries(current.maxDelta).filter(([, r]) => r.value !== r.default).map(([k, r]) => [k, r.value]));
  return { modules, settings: { ...(Object.keys(lists).length ? { lists } : {}), ...(Object.keys(maxDelta).length ? { maxDelta } : {}) } };
}
/** 「上次的设置」 for this structure: called after the player changes module switches or limits. */
export function recordLast(scope: any, controller: ControllerLike): void {
  try {
    const s = store(scope), id = controller.core.definition.id;
    save(scope, { ...s, last: { ...s.last, [id]: { ...capture(controller), savedAt: Date.now() } } });
  } catch { /* the chat is not ready: nothing to record */ }
}
export function savePreset(scope: any, controller: ControllerLike, name: string, overwrite?: string): StructurePreset {
  const s = store(scope), id = controller.core.definition.id, list = s.presets?.[id] ?? [];
  const preset: StructurePreset = { ...capture(controller), id: overwrite ?? `p${Date.now().toString(36)}`, name: name.trim() || '未命名', savedAt: Date.now() };
  const next = overwrite ? list.map(p => p.id === overwrite ? preset : p) : [...list, preset];
  save(scope, { ...s, presets: { ...s.presets, [id]: next } });
  return preset;
}
export function deletePreset(scope: any, structure: string, presetId: string): void {
  const s = store(scope);
  const { [structure]: _, ...pick } = s.pick ?? {};
  save(scope, { ...s, presets: { ...s.presets, [structure]: (s.presets?.[structure] ?? []).filter(p => p.id !== presetId) }, pick: s.pick?.[structure] === presetId ? pick : s.pick ?? {} });
}

/**
 * Bring the chat to these settings: only what differs is changed (each change is a player action on the latest reply).
 * Parents are switched on before their children and children off before their parents; exclusive sets are re-read
 * after every change, since switching one on turns its siblings off.
 */
export async function applyPreset(controller: ControllerLike, values: PresetValues): Promise<number> {
  let changes = 0;
  const depth = (name: string, all: Map<string, { parent?: string }>) => { let d = 0, at = all.get(name); while (at?.parent && d < 20) { d++; at = all.get(at.parent); } return d; };
  for (const wanted of [true, false]) {
    const modules = new Map(controller.getModules().map(m => [m.name, m]));
    const names = Object.keys(values.modules).filter(n => modules.has(n) && values.modules[n] === wanted)
      .sort((a, b) => wanted ? depth(a, modules) - depth(b, modules) : depth(b, modules) - depth(a, modules));
    for (const name of names) {
      const now = controller.getModules().find(m => m.name === name);
      if (!now || now.enabled === wanted) continue;
      await controller.setModule(name, wanted); changes++;
    }
  }
  const current = controller.getSettings(), patch: SettingsPatch = {};
  const lists = Object.fromEntries(Object.entries(current.lists).map(([k, r]) => [k, values.settings.lists?.[k] ?? null] as const)
    .filter(([k, v]) => v ? v.max !== current.lists[k]!.max || v.warn !== current.lists[k]!.warn : current.lists[k]!.max !== current.lists[k]!.default.max || current.lists[k]!.warn !== current.lists[k]!.default.warn));
  const maxDelta = Object.fromEntries(Object.entries(current.maxDelta).map(([k, r]) => [k, values.settings.maxDelta?.[k] ?? null] as const)
    .filter(([k, v]) => v !== null ? v !== current.maxDelta[k]!.value : current.maxDelta[k]!.value !== current.maxDelta[k]!.default));
  if (Object.keys(lists).length) patch.lists = lists;
  if (Object.keys(maxDelta).length) patch.maxDelta = maxDelta;
  if (patch.lists || patch.maxDelta) { await controller.setSettings(patch); changes++; }
  return changes;
}
