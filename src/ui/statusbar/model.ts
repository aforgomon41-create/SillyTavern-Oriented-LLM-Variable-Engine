/**
 * Read-only view model for the status bar: everything comes from the compiled definition's
 * display metadata, so any structure built with compileStructure renders without custom code.
 */
import { dormant } from '../../schema.js';
import { computedFor } from '../../features.js';
import { holds, type Cond } from '../../interact.js';
import type { CompiledDefinition, Json, LogicalState } from '../../types.js';

export type Path = string[];
export interface FieldMeta { type: string; desc?: string; values?: string[]; min?: number; max?: number; to?: string | string[]; entity?: string; keys?: string; stamp?: boolean; sections?: { label: string; keys: string[] }[] }
export type Spoiler = 'public' | 'spoiler' | 'hidden';
export interface Exempt { collection: string; field: string; equals: Json }

export class StatusModel {
  readonly fields: Record<string, FieldMeta>;
  readonly labels: Record<string, string>;
  readonly spoilers: Record<string, Spoiler>;
  readonly widgets: Record<string, string>;
  readonly exempt?: Exempt;
  constructor(readonly def: CompiledDefinition, readonly state: LogicalState) {
    const display = (def.display ?? {}) as Record<string, any>;
    this.fields = display.fields ?? {};
    this.labels = display.labels ?? {};
    this.spoilers = display.spoiler ?? {};
    this.widgets = display.as ?? {};
    this.exempt = display.spoilerExempt;
  }
  get data(): Record<string, any> { return this.state.data as Record<string, any>; }
  get layout(): any[] { return ((this.def.display as any)?.layout ?? []) as any[]; }
  /** Pattern of a concrete path: record keys and array indices become `*`. */
  pattern(parts: Path): string {
    const out: string[] = [];
    for (const key of parts) {
      const parent = this.fields[out.join('.')];
      out.push(parent && ['record', 'array', 'refs'].includes(parent.type) ? '*' : key);
    }
    return out.join('.');
  }
  meta(parts: Path): FieldMeta | undefined { return this.fields[this.pattern(parts)]; }
  label(parts: Path): string { return this.labels[this.pattern(parts)] ?? parts.at(-1) ?? ''; }
  widget(parts: Path): string | undefined { return this.widgets[this.pattern(parts)]; }
  /** Declared children of a path, in declaration order. */
  children(parts: Path): string[] {
    const prefix = this.pattern(parts), depth = prefix ? prefix.split('.').length + 1 : 1;
    return Object.keys(this.fields).filter(key => key.split('.').length === depth && (!prefix || key.startsWith(prefix + '.')) && !key.endsWith('.*')).map(key => key.split('.').at(-1)!);
  }
  value(parts: Path): any { let v: any = this.data; for (const key of parts) { if (v == null || typeof v !== 'object') return undefined; v = v[key]; } return v; }
  dormant(parts: Path): boolean { return parts.length > 0 && dormant(this.def, this.state, parts); }
  computed(parts: Path, value: unknown) {
    const pattern = this.pattern(parts);
    const rule = this.def.computed?.[pattern];
    return computedFor(this.def, parts, value).map(c => ({ ...c, formula: typeof rule?.formula === 'string' ? rule.formula : 'custom' }));
  }
  /** Spoiler level for a path; the player's own character is always public. */
  spoiler(parts: Path): Spoiler {
    // The deepest declared level wins (a public field inside a spoiler record, e.g. 好感度), but hidden stays hidden;
    // a record's `reveal` makes matching entries public (equipped items can be seen).
    let level: Spoiler = 'public';
    for (let i = 1; i <= parts.length; i++) {
      const pattern = this.pattern(parts.slice(0, i));
      const found = this.spoilers[pattern];
      if (found === 'hidden') return 'hidden';
      if (found) level = found;
      const reveal = (this.fields[pattern] as any)?.reveal as Cond | undefined;
      if (reveal && level === 'spoiler' && i < parts.length) {
        const entry = this.value(parts.slice(0, i + 1));
        if (entry && typeof entry === 'object' && holds(reveal, entry, {}, p => this.value(p))) level = 'public';
      }
    }
    if (level === 'spoiler' && this.exempt && this.isExempt(parts)) return 'public';
    return level;
  }
  private isExempt(parts: Path): boolean {
    const base = this.exempt!.collection.split('.');
    if (parts.length <= base.length || base.some((key, i) => parts[i] !== key)) return false;
    const entity = this.value(parts.slice(0, base.length + 1));
    return JSON.stringify(entity?.[this.exempt!.field] ?? null) === JSON.stringify(this.exempt!.equals);
  }
  /** Where an entity lives, for reference chips. */
  locate(id: string): Path | undefined {
    for (const spec of this.def.entities ?? []) {
      if (spec.singletonId) continue;
      const base = spec.path.split('.');
      if (base.includes('*')) {
        // nested collections (e.g. items under characters): scan owners
        const owner = base.slice(0, base.indexOf('*'));
        const rest = base.slice(base.indexOf('*') + 1);
        for (const key of Object.keys(this.value(owner) ?? {})) {
          const path = [...owner, key, ...rest];
          if (this.value([...path, id]) !== undefined) return [...path, id];
        }
      } else if (this.value([...base, id]) !== undefined) return [...base, id];
    }
    return undefined;
  }
  /** An entity's thumbnail (falls back to its full picture). */
  picture(id: string): string | undefined { const path = this.locate(id); return thumbOf(path ? this.value(path) : undefined); }
  /** An entity's full picture / 立绘 (falls back to its thumbnail). */
  art(id: string): string | undefined { const path = this.locate(id); return artOf(path ? this.value(path) : undefined); }
  entityName(id: string): string {
    const path = this.locate(id);
    const entity = path ? this.value(path) : undefined;
    return typeof entity?.name === 'string' && entity.name ? entity.name : id;
  }
  /** The player's character id, from the spoiler exemption rule. */
  get userId(): string | undefined {
    if (!this.exempt) return undefined;
    const collection = this.value(this.exempt.collection.split('.')) ?? {};
    return Object.keys(collection).find(key => JSON.stringify(collection[key]?.[this.exempt!.field] ?? null) === JSON.stringify(this.exempt!.equals));
  }
  moduleOn(name?: string): boolean { return !name || this.state.engineState.activeModules[name] !== false; }
}
export function isEmpty(value: unknown): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && !value.length) || (value !== null && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);
}

const str = (v: unknown): string | undefined => typeof v === 'string' && v ? v : undefined;
/** Two pictures per entity: `thumb` for avatars, `image` for the full view; either stands in for the other. */
export function thumbOf(v: any): string | undefined { return str(v?.thumb) ?? str(v?.image); }
export function artOf(v: any): string | undefined { return str(v?.image) ?? str(v?.thumb); }

