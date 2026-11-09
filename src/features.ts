import { at, assertJson, canonical, clone, expand, fail, matches, pointer, safeKey } from './json.js';
import type { BgmTrack, CompiledDefinition, ComputedFormula, Data, Definition, Feedback, Json, ListLimit, LogicalState, PendingMigration, ProjectionRule, SettingsPatch } from './types.js';

/* ---------- computed fields ---------- */

const FORMULAS: Record<string, (value: number) => number> = {
  /** WOD / Infinite-horror transcendence: one point per five beyond the first five (5→0, 6→1, 11→2). */
  wodTranscend: value => value >= 1 ? Math.floor((value - 1) / 5) : 0,
  dndModifier: value => Math.floor((value - 10) / 2),
};
export function formulaName(formula: ComputedFormula): string {
  if (typeof formula === 'function') return 'runtime-bound-by-definition-version';
  if (!Object.hasOwn(FORMULAS, formula)) fail('COMPUTED_FORMULA', `未知计算公式：${formula}`);
  return formula;
}
export function runFormula(formula: ComputedFormula, value: number): number | undefined {
  const fn = typeof formula === 'function' ? formula : FORMULAS[formula];
  if (!fn) return undefined;
  const result = fn(value);
  return typeof result === 'number' && Number.isFinite(result) ? result : undefined;
}
/** Computed values for one concrete path, as projection siblings `key(label)`. */
export function computedFor(def: CompiledDefinition, parts: string[], value: unknown): { label: string; value: number }[] {
  if (typeof value !== 'number' || !def.computed) return [];
  const out: { label: string; value: number }[] = [];
  for (const [pattern, rule] of Object.entries(def.computed)) {
    if (!matches(pattern, parts)) continue;
    const result = runFormula(rule.formula, value);
    if (result !== undefined) out.push({ label: rule.label, value: result });
  }
  return out;
}
/** All computed values of a state, keyed by JSON pointer; used by front ends. */
export function computeAll(def: CompiledDefinition, state: LogicalState): Record<string, { label: string; value: number }[]> {
  const out: Record<string, { label: string; value: number }[]> = {};
  for (const pattern of Object.keys(def.computed ?? {})) {
    for (const found of expand(state.data, pattern)) {
      const values = computedFor(def, found.parts, found.value);
      if (values.length) out[pointer(found.parts)] = values;
    }
  }
  return out;
}

/* ---------- settings, lists and change limits ---------- */

export function listLimit(def: CompiledDefinition, state: LogicalState, pattern: string): ListLimit | undefined {
  const base = def.lists?.[pattern];
  if (!base) return undefined;
  const override = state.engineState.settings?.lists?.[pattern];
  return override ? { max: override.max, warn: override.warn } : { max: base.max, warn: base.warn };
}
export function countOf(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return undefined;
}
/** Reject only growth beyond the cap, so lowering a cap never breaks an existing state. */
export function assertListCaps(def: CompiledDefinition, before: LogicalState, after: LogicalState): void {
  for (const pattern of Object.keys(def.lists ?? {})) {
    const limit = listLimit(def, after, pattern)!;
    for (const found of expand(after.data, pattern)) {
      const count = countOf(found.value);
      if (count === undefined || count <= limit.max) continue;
      const previous = countOf(at(before.data, found.parts, false)) ?? 0;
      if (count > previous) fail('LIST_FULL', `清单已满（${count}/${limit.max}），请先合并相近条目、删除过时内容`, pointer(found.parts));
    }
  }
}
export function deltaLimit(def: CompiledDefinition, state: LogicalState, parts: string[]): number | undefined {
  let limit: number | undefined;
  for (const [pattern, rule] of Object.entries(def.numeric ?? {})) {
    if (rule.maxDelta === undefined || !matches(pattern, parts)) continue;
    const override = state.engineState.settings?.maxDelta?.[pattern];
    limit = override === undefined ? rule.maxDelta : override;
  }
  return limit && limit > 0 ? limit : undefined;
}
/** Clamp a change to the declared per-action limit; atomic groups fail instead of hiding it. */
export function limitDelta(def: CompiledDefinition, state: LogicalState, parts: string[], before: number, after: number, strict: boolean, feedback: Feedback[]): number {
  const limit = deltaLimit(def, state, parts);
  if (limit === undefined) return after;
  const delta = after - before;
  if (Math.abs(delta) <= limit) return after;
  if (strict) fail('DELTA_LIMIT', `单次变化不能超过 ±${limit}`, pointer(parts));
  const next = before + Math.sign(delta) * limit;
  feedback.push({ level: 'L2', code: 'DELTA_CLAMPED', message: `单次变化上限 ±${limit}：${before} → ${after} 调整为 ${next}`, path: pointer(parts) });
  return next;
}
export function applySettings(def: CompiledDefinition, state: LogicalState, patch: SettingsPatch): Feedback[] {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('SETTINGS_FORMAT', '设置必须是对象');
  assertJson(patch);
  const unknown = Object.keys(patch).filter(key => !['lists', 'maxDelta'].includes(key));
  if (unknown.length) fail('SETTINGS_FORMAT', `未知设置：${unknown.join(', ')}`);
  const settings = clone(state.engineState.settings ?? {});
  const notes: Feedback[] = [];
  for (const [pattern, value] of Object.entries(patch.lists ?? {})) {
    if (!def.lists?.[pattern]) fail('SETTINGS_TARGET', `未声明的清单：${pattern}`);
    settings.lists ??= {};
    if (value === null) delete settings.lists[pattern];
    else {
      if (!value || !Number.isInteger(value.max) || !Number.isInteger(value.warn) || value.max < 1 || value.warn < 0 || value.warn > value.max) fail('SETTINGS_VALUE', `清单上限需为正整数，预警线在 0 与上限之间：${pattern}`);
      settings.lists[pattern] = { max: value.max, warn: value.warn };
    }
    notes.push({ level: 'L2', code: 'SETTINGS_CHANGED', message: `清单上限：${pattern}`, path: pattern });
  }
  for (const [pattern, value] of Object.entries(patch.maxDelta ?? {})) {
    if (def.numeric?.[pattern]?.maxDelta === undefined) fail('SETTINGS_TARGET', `未声明单次变化上限的字段：${pattern}`);
    settings.maxDelta ??= {};
    if (value === null) delete settings.maxDelta[pattern];
    else {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail('SETTINGS_VALUE', `单次变化上限需为非负数（0 表示不限制）：${pattern}`);
      settings.maxDelta[pattern] = value;
    }
    notes.push({ level: 'L2', code: 'SETTINGS_CHANGED', message: `单次变化上限：${pattern}`, path: pattern });
  }
  if (settings.lists && !Object.keys(settings.lists).length) delete settings.lists;
  if (settings.maxDelta && !Object.keys(settings.maxDelta).length) delete settings.maxDelta;
  if (Object.keys(settings).length) state.engineState.settings = settings; else delete state.engineState.settings;
  return notes;
}

/* ---------- round and stamps ---------- */

export function roundOf(def: Definition, state: LogicalState): number {
  if (!def.round) return 0;
  const value = at(state.data, def.round.split('.'), false);
  return typeof value === 'number' ? value : 0;
}
/** Round for a model reply on a tavern floor: the floor number, never moving backwards. */
export function nextRound(def: Definition, state: LogicalState, floor: number): number {
  return Math.max(floor, roundOf(def, state) + 1);
}
export function isRoundPath(def: Definition, parts: string[]): boolean {
  if (!def.round) return false;
  const round = def.round.split('.');
  const n = Math.min(round.length, parts.length);
  return round.slice(0, n).every((key, i) => key === parts[i]);
}
/** Fill engine timestamps in entries written under stamped arrays; plain strings become `{round, text}`. */
export function stampValue(def: Definition, state: LogicalState, parts: string[], value: unknown): unknown {
  if (!def.stamps || value === null || value === undefined) return value;
  const round = roundOf(def, state);
  const visit = (current: unknown, path: string[]): unknown => {
    if (Array.isArray(current)) {
      const rule = Object.entries(def.stamps!).find(([pattern]) => matches(pattern, path))?.[1];
      return current.map((item, i) => rule ? stampEntry(rule, item, round) : visit(item, [...path, String(i)]));
    }
    if (current && typeof current === 'object') return Object.fromEntries(Object.entries(current).map(([key, child]) => [key, visit(child, [...path, key])]));
    return current;
  };
  // A single pushed element: parts ends with the array index.
  const parent = parts.slice(0, -1), rule = Object.entries(def.stamps).find(([pattern]) => matches(pattern, parent))?.[1];
  if (rule && /^(?:0|[1-9]\d*)$/u.test(parts.at(-1) ?? '')) return stampEntry(rule, value, round);
  return visit(value, parts);
}
function stampEntry(rule: { field: string; text: string }, item: unknown, round: number): unknown {
  if (typeof item === 'string') return { [rule.field]: round, [rule.text]: item };
  if (item && typeof item === 'object' && !Array.isArray(item) && !Object.hasOwn(item, rule.field)) return { [rule.field]: round, ...item };
  return item;
}

/* ---------- exclusive groups and migration ---------- */

export function moduleData(def: CompiledDefinition, state: LogicalState, name: string): Data {
  const out: Data = {};
  for (const pattern of def.modules?.[name]?.paths ?? []) for (const found of expand(state.data, pattern)) out[found.parts.join('.')] = clone(found.value) as Json;
  return out;
}
/** Update the one-shot migration after switching `name` on inside an exclusive group. */
export function switchExclusive(def: CompiledDefinition, state: LogicalState, name: string, enabled: boolean): void {
  const group = def.modules?.[name]?.exclusive;
  if (!group) return;
  const pending = state.engineState.migration?.group === group ? state.engineState.migration : undefined;
  if (!enabled) { if (pending?.to === name) delete state.engineState.migration; return; }
  const members = Object.entries(def.modules ?? {}).filter(([, m]) => m.exclusive === group).map(([key]) => key);
  const previous = members.find(member => member !== name && state.engineState.activeModules[member]) ?? null;
  for (const member of members) if (member !== name) state.engineState.activeModules[member] = false;
  if (def.groups?.[group]?.migrate === false) return;
  if (pending) {
    if (pending.from === name) delete state.engineState.migration;
    else state.engineState.migration = { ...pending, to: name };
    return;
  }
  if (previous === name) return;
  const migration: PendingMigration = { group, from: previous, to: name, data: previous ? moduleData(def, state, previous) : {} };
  state.engineState.migration = migration;
}
export function migrationText(def: CompiledDefinition, migration: PendingMigration): string {
  const label = (name: string | null) => name ? def.modules?.[name]?.label ?? name : '无';
  const group = def.groups?.[migration.group]?.label ?? migration.group;
  if (!migration.from) return `【迁移】${group}已启用「${label(migration.to)}」。请依各角色设定，在本次更新中填写「${label(migration.to)}」的对应字段；不适用的项填 null。`;
  return `【迁移】${group}由「${label(migration.from)}」切换为「${label(migration.to)}」。原数据如下（只提供这一次）：${JSON.stringify(migration.data)}。请依这些数值和角色设定换算，在本次更新中填写「${label(migration.to)}」的对应字段；不适用的项填 null。`;
}
/** Compaction warnings for lists at or above their warning threshold. */
/** Tells the model which ready-made entities exist: dormant prefabs (appear once, under their own ID) and templates. */
export function presetText(def: CompiledDefinition, state: LogicalState): string {
  const name = (id: string, data: unknown) => {
    const n = data && typeof data === 'object' && typeof (data as Record<string, unknown>).name === 'string' ? (data as Record<string, string>).name : '';
    return n ? `${id}（${n}）` : id;
  };
  const dormantPrefabs = Object.entries(def.prefabs ?? {}).filter(([id]) => state.engineState.prefabLifecycle[id] === 'dormant');
  const templates = Object.entries(def.templates ?? {});
  if (!dormantPrefabs.length && !templates.length) return '';
  const byType = (list: [string, { type: string; data: unknown }][]) => {
    const groups = new Map<string, string[]>();
    for (const [id, p] of list) groups.set(p.type, [...(groups.get(p.type) ?? []), name(id, p.data)]);
    return [...groups].map(([type, ids]) => `${type}: ${ids.join('、')}`).join('；');
  };
  return [
    dormantPrefabs.length ? `预制实体（尚未登场；登场时用 $createEntity 以同一 ID 创建，内容自动带入，只能登场一次）：${byType(dormantPrefabs)}` : '',
    templates.length ? `模板（$createEntity 时写 "$from": "@模板ID" 生成新的独立实体，可多次使用）：${byType(templates)}` : '',
    '预制实体也可以作为 $from 的来源，生成与它不同 ID 的独立实体。',
  ].filter(Boolean).join('\n');
}
export function listWarnings(def: CompiledDefinition, state: LogicalState, isDormant: (parts: string[]) => boolean): string[] {
  const lines: string[] = [];
  for (const [pattern, rule] of Object.entries(def.lists ?? {})) {
    const limit = listLimit(def, state, pattern)!;
    for (const found of expand(state.data, pattern)) {
      const count = countOf(found.value);
      if (count === undefined || count < limit.warn || isDormant(found.parts)) continue;
      lines.push(`【清单整理】${rule.label ? `${rule.label}（${found.parts.join('.')}）` : found.parts.join('.')}已有 ${count}/${limit.max} 条，请在本次更新中合并相近条目、删除过时内容。`);
    }
  }
  return lines;
}

/* ---------- declarative projection ---------- */

function valueAt(data: Data, path: string): unknown { return at(data, path.split('.'), false); }
function idList(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map(v => v.replace(/^@/u, '')) : []; }
function alwaysIds(collection: unknown, always?: { field: string; equals: Json }): string[] {
  if (!always || !collection || typeof collection !== 'object') return [];
  return Object.entries(collection as Record<string, any>).filter(([, item]) => item && canonical(item[always.field] ?? null) === canonical(always.equals)).map(([key]) => key);
}
function keepFields(item: unknown, keep: string[]): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item).filter(([key]) => keep.includes(key)));
}
/** Apply declarative prompt rules to a copy of the data. Unknown or missing paths leave data untouched. */
export function applyProjectionRules(rules: ProjectionRule[] | undefined, data: Data): Data {
  if (!rules?.length) return data;
  const out = clone(data);
  for (const rule of rules) {
    if (rule.kind === 'present' || rule.kind === 'related') {
      const collection = valueAt(out, rule.collection);
      const visible = new Set([...idList(valueAt(out, rule.list)), ...alwaysIds(collection, rule.always)]);
      if (rule.kind === 'present') {
        if (!collection || typeof collection !== 'object') continue;
        for (const [key, item] of Object.entries(collection as Record<string, unknown>)) if (!visible.has(key)) (collection as any)[key] = keepFields(item, rule.keep);
      } else for (const found of expand(out, rule.path)) {
        if (!found.value || typeof found.value !== 'object' || Array.isArray(found.value)) continue;
        for (const key of Object.keys(found.value)) if (!visible.has(key)) delete found.value[key];
      }
    } else if (rule.kind === 'referenced') {
      const collection = valueAt(out, rule.collection) as Record<string, any> | undefined;
      if (!collection || typeof collection !== 'object') continue;
      const used = new Set<string>();
      for (const from of rule.from) for (const found of expand(out, from)) {
        const v = found.value;
        if (typeof v === 'string') used.add(v);
        else if (Array.isArray(v)) v.forEach(x => typeof x === 'string' && used.add(x));
        else if (v && typeof v === 'object') Object.keys(v).forEach(k => used.add(k));
      }
      const field = rule.field;
      const isUsed = (key: string, item: any) => field ? typeof item?.[field] === 'string' && used.has(item[field]) : used.has(key);
      for (const [key, item] of Object.entries(collection)) if (!isUsed(key, item)) collection[key] = keepFields(item, rule.keep);
    } else {
      const collection = valueAt(out, rule.collection) as Record<string, any> | undefined;
      const current = valueAt(out, rule.current);
      if (!collection || typeof collection !== 'object' || typeof current !== 'string' || !Object.hasOwn(collection, current)) continue;
      const near = new Set<string>([current]);
      for (let cursor: unknown = rule.parent ? collection[current]?.[rule.parent] : undefined, n = 0; typeof cursor === 'string' && n < 64 && !near.has(cursor); n++) {
        near.add(cursor); cursor = rule.parent ? collection[cursor]?.[rule.parent] : undefined;
      }
      if (rule.links) for (const id of idList(collection[current]?.[rule.links])) near.add(id);
      for (const [key, item] of Object.entries(collection)) if (!near.has(key)) collection[key] = keepFields(item, rule.keep);
    }
  }
  return out;
}
export function describeProjection(rules: ProjectionRule[] | undefined): Json | undefined {
  if (!rules?.length) return undefined;
  for (const rule of rules) for (const value of Object.values(rule)) if (typeof value === 'string') value.split('.').forEach(part => part !== '*' && safeKey(part));
  return clone(rules) as unknown as Json;
}

/* ---------- background music ---------- */

export interface BgmSelection { track?: BgmTrack; url?: string; source: 'place' | 'region' | 'mood' | 'none'; mood?: string; place?: string }
/** Pick music: current place → ancestor regions → library tracks matching the scene mood. */
export function selectBgm(def: Definition, state: LogicalState, extra: BgmTrack[] = []): BgmSelection {
  const spec = def.bgm;
  if (!spec) return { source: 'none' };
  const library = [...(spec.library ?? []), ...extra];
  const resolve = (value: unknown): { track?: BgmTrack; url?: string } | undefined => {
    if (typeof value !== 'string' || !value) return undefined;
    const track = library.find(t => t.id === value);
    if (track) return { track, url: track.url };
    return /^(?:https?:|blob:|data:audio\/|\/)/u.test(value) ? { url: value } : undefined;
  };
  const places = spec.places ? valueAt(state.data, spec.places) as Record<string, any> | undefined : undefined;
  const current = spec.location ? valueAt(state.data, spec.location) : undefined;
  if (places && typeof current === 'string') {
    const seen = new Set<string>();
    for (let cursor: unknown = current, first = true; typeof cursor === 'string' && !seen.has(cursor) && places[cursor]; first = false) {
      seen.add(cursor);
      const hit = resolve(places[cursor]?.[spec.field ?? 'bgm']);
      if (hit) return { ...hit, source: first ? 'place' : 'region', place: cursor };
      cursor = spec.parent ? places[cursor]?.[spec.parent] : undefined;
    }
  }
  const mood = spec.mood ? valueAt(state.data, spec.mood) : undefined;
  if (typeof mood === 'string') {
    const tracks = library.filter(t => t.moods.includes(mood));
    if (tracks.length) {
      // Stable choice per mood, so re-renders do not reshuffle the music.
      let h = 0; for (const c of mood) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const track = tracks[h % tracks.length]!;
      return { track, url: track.url, source: 'mood', mood };
    }
  }
  return { source: 'none', ...(typeof mood === 'string' ? { mood } : {}) };
}
export function validateTracks(tracks: unknown): BgmTrack[] {
  if (!Array.isArray(tracks)) fail('BGM_LIBRARY', '曲库必须是数组');
  return tracks.map((t: any) => {
    if (!t || typeof t.id !== 'string' || !t.id || typeof t.url !== 'string' || !t.url || !Array.isArray(t.moods) || t.moods.some((m: unknown) => typeof m !== 'string')) fail('BGM_LIBRARY', '曲目需要 id、url 与 moods 字符串数组');
    return { id: t.id, url: t.url, moods: [...t.moods], ...(typeof t.title === 'string' ? { title: t.title } : {}) };
  });
}
