import type { ZodType } from 'zod';
import type { Operation as JsonPatch } from 'fast-json-patch';
import type { SolveFacet } from './authoring.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Data = { [key: string]: Json };
export type Batch = Record<string, unknown> | Record<string, unknown>[];
export type View = 'full' | 'narrative' | 'operator' | string;
export interface ListLimit { max: number; warn: number }
export interface EngineSettings {
  /** Player overrides keyed by the declared list pattern; null restores the default. */
  lists?: Record<string, ListLimit>;
  /** Player overrides keyed by the declared numeric pattern; 0 disables the limit. */
  maxDelta?: Record<string, number>;
}
export interface PendingMigration { group: string; from: string | null; to: string; data: Data }
export interface LogicalState {
  data: Data;
  engineState: {
    activeModules: Record<string, boolean>;
    prefabLifecycle: Record<string, 'dormant' | 'active' | 'destroyed'>;
    /** Present only after a player changes settings; old states keep their exact hash. */
    settings?: EngineSettings;
    /** One-shot instruction for the next model action after an exclusive-group switch. */
    migration?: PendingMigration;
  };
}
export interface Feedback { level: 'L1' | 'L2' | 'L3'; code: string; message: string; path?: string; statement?: number }
export interface EntitySpec { path: string; type: string; singletonId?: string; nullable?: boolean }
export interface EntityEntry { id: string; pointer: string; type: string; owner?: string }
export interface RefSpec {
  path: string;
  kind: 'single' | 'array' | 'record-key';
  onDelete: 'remove' | 'null' | 'unset' | 'restrict';
}
export interface RefEntry { pointer: string; target: string; spec: RefSpec }
export interface ModuleSpec { paths: string[]; enabled?: boolean; parent?: string; guide?: string; label?: string; exclusive?: string }
export interface GuideConditionContext { get(path: string): Json | undefined }
export interface GuideRule {
  id: string;
  module?: string;
  when?: string | ((context: Readonly<GuideConditionContext>) => boolean);
  text: string;
  source?: string;
}
export interface NumericRule { min?: number; max?: number; integer?: boolean; destroyOnZero?: boolean; maxDelta?: number }
export interface RuntimeBinding {
  id: string;
  version: string;
  build?: string;
  dependencies?: Data;
}
export interface DefinitionBindings {
  build?: string;
  dependencies?: Data;
  authoring?: { version: '1'; initialDataHash: string; facets: RuntimeBinding[] };
}
export interface DefinitionSnapshot {
  version: 1;
  baseHash: string;
  fingerprint: string;
  declaration: Data;
  views: string[];
  customValidation: boolean;
  books: string[];
  digest: string;
}
export type ComputedFormula = 'wodTranscend' | 'dndModifier' | ((value: number) => number);
export interface ComputedRule { label: string; formula: ComputedFormula }
export interface StampRule { field: string; text: string }
export type ProjectionRule =
  | { kind: 'present'; collection: string; list: string; keep: string[]; always?: { field: string; equals: Json } }
  | { kind: 'related'; path: string; collection: string; list: string; always?: { field: string; equals: Json } }
  | { kind: 'neighborhood'; collection: string; current: string; parent?: string; links?: string; keep: string[] }
  /** Root entities referenced from `from` (record keys or ref values, after earlier rules) stay whole; the rest keep only `keep`. */
  | { kind: 'referenced'; collection: string; from: string[]; keep: string[] };
export interface BgmTrack { id: string; url: string; title?: string; moods: string[] }
export interface BgmSpec { library?: BgmTrack[]; mood?: string; location?: string; places?: string; field?: string; parent?: string }
export interface DisplaySpec { labels?: Record<string, string>; spoiler?: Record<string, 'public' | 'spoiler' | 'hidden'>; as?: Record<string, string>;
  fields?: Record<string, Json>; layout?: Json; render?: boolean | Json; [key: string]: Json | undefined }
export interface Definition {
  id: string;
  version: string;
  schema: ZodType;
  runtimeBindings?: DefinitionBindings;
  outputSchema?: ZodType;
  initialData: unknown;
  entities?: EntitySpec[];
  refs?: RefSpec[];
  modules?: Record<string, ModuleSpec>;
  numeric?: Record<string, NumericRule>;
  readonly?: string[];
  internal?: string[];
  guide?: string;
  guides?: GuideRule[];
  facets?: SolveFacet[];
  templates?: Record<string, { type: string; data: Data }>;
  prefabs?: Record<string, { type: string; data: Data }>;
  views?: Record<string, (state: Readonly<Data>) => Json>;
  // Pure output-state checks; unlike transforms, safe to run on existing values.
  validateState?: (state: Readonly<LogicalState>, context: ExecutionContext) => void | Promise<void>;
  /** Engine-maintained interaction round (tavern floor number); read-only for the model. */
  round?: string;
  /** Array patterns whose entries receive the current round automatically. */
  stamps?: Record<string, StampRule>;
  /** Growing lists (arrays or records) with a hard cap and a compaction warning threshold. */
  lists?: Record<string, ListLimit & { label?: string }>;
  /** Derived values shown in projections; never stored and never writable. */
  computed?: Record<string, ComputedRule>;
  /** Declarative prompt filtering applied to non-path projections. */
  projection?: ProjectionRule[];
  /** Labels for exclusive module groups, used by migration instructions. */
  groups?: Record<string, { label?: string; migrate?: boolean }>;
  /** Background music selection; presentation only, excluded from the fingerprint. */
  bgm?: BgmSpec;
  /** Status-bar labels, spoiler levels, widgets and layout; excluded from the fingerprint. */
  display?: DisplaySpec;
}
export interface CompiledDefinition extends Definition { fingerprint: string; schemaShape: Json; outputShape?: Json; storedSchema: ZodType; structuralSchema: ZodType; authoringSnapshot?: DefinitionSnapshot }
export interface ExecutionContext { authorInputs?: Json; source?: 'model' | 'user' | 'replay' }
export interface ExecutionResult {
  state: LogicalState;
  feedback: Feedback[];
  aliases: Record<string, string>;
  applied: number;
}
export type Action =
  | { actionId: string; kind: 'operations'; operations: Batch; source: 'model' | 'user'; authorInputs?: Json }
  | { actionId: string; kind: 'module'; module: string; enabled: boolean; source: 'user'; authorInputs?: Json }
  | { actionId: string; kind: 'settings'; settings: SettingsPatch; source: 'user'; authorInputs?: Json };
export interface SettingsPatch { lists?: Record<string, ListLimit | null>; maxDelta?: Record<string, number | null> }
export interface Binding {
  chatId: string;
  messageId: string;
  swipeId: string;
  generationToken?: string;
}
export interface Genesis {
  id: string;
  definitionHash: string;
  state: LogicalState;
  stateHash: string;
}
export interface Commit {
  id: string;
  parentId: string | null;
  genesisId: string;
  baseHash: string;
  stateHash: string;
  semantics: string;
  binding: Binding;
  dataPatch: JsonPatch[];
  enginePatch: JsonPatch[];
  actions: Action[];
  opsDigest: string;
  feedback: Feedback[];
  aliases: Record<string, string>;
  textDigest: string;
}
export interface Archive {
  version: '0.5';
  sessionId: string;
  definitionHash: string;
  geneses: Record<string, Genesis>;
  commits: Record<string, Commit>;
  heads: Record<string, string>;
  authoring?: DefinitionSnapshot;
}
export interface SaveDraft { archive: Archive; commit: Commit; text: string; binding: Binding; expectedHead: string | null; sourceTextDigest?: string; prepared?: true }
export interface ArchiveAdapter {
  assertCurrent(binding: Binding): void | Promise<void>;
  save(draft: SaveDraft): Promise<void>;
}
