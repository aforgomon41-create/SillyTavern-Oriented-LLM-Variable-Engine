import type { ZodType } from 'zod';
import type { Operation as JsonPatch } from 'fast-json-patch';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Data = { [key: string]: Json };
export type Batch = Record<string, unknown> | Record<string, unknown>[];
export type View = 'full' | 'narrative' | 'operator' | string;
export interface LogicalState {
  data: Data;
  engineState: { activeModules: Record<string, boolean>; prefabLifecycle: Record<string, 'dormant' | 'active' | 'destroyed'> };
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
export interface ModuleSpec { paths: string[]; enabled?: boolean; parent?: string; guide?: string }
export interface NumericRule { min?: number; max?: number; integer?: boolean; destroyOnZero?: boolean }
export interface Definition {
  id: string;
  version: string;
  schema: ZodType;
  outputSchema?: ZodType;
  initialData: unknown;
  entities?: EntitySpec[];
  refs?: RefSpec[];
  modules?: Record<string, ModuleSpec>;
  numeric?: Record<string, NumericRule>;
  readonly?: string[];
  internal?: string[];
  guide?: string;
  templates?: Record<string, { type: string; data: Data }>;
  prefabs?: Record<string, { type: string; data: Data }>;
  views?: Record<string, (state: Readonly<Data>) => Json>;
  // Pure output-state checks; unlike transforms, safe to run on existing values.
  validateState?: (state: Readonly<LogicalState>, context: ExecutionContext) => void | Promise<void>;
}
export interface CompiledDefinition extends Definition { fingerprint: string; schemaShape: Json; storedSchema: ZodType; structuralSchema: ZodType }
export interface ExecutionContext { authorInputs?: Json; source?: 'model' | 'user' | 'replay' }
export interface ExecutionResult {
  state: LogicalState;
  feedback: Feedback[];
  aliases: Record<string, string>;
  applied: number;
}
export type Action =
  | { actionId: string; kind: 'operations'; operations: Batch; source: 'model' | 'user'; authorInputs?: Json }
  | { actionId: string; kind: 'module'; module: string; enabled: boolean; source: 'user'; authorInputs?: Json };
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
}
export interface SaveDraft { archive: Archive; commit: Commit; text: string; binding: Binding; expectedHead: string | null; sourceTextDigest?: string; prepared?: true }
export interface ArchiveAdapter {
  assertCurrent(binding: Binding): void | Promise<void>;
  save(draft: SaveDraft): Promise<void>;
}
