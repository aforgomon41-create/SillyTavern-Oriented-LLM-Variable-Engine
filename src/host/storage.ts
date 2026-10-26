import { canonical, clone, fail } from '../json.js';
import type { Action, Archive, Batch, Commit, Json } from '../types.js';
import { readToken, storeToken } from './storage-tokens.js';

interface CommitContext { genesisId: string; semantics: string; chatId: string; generationToken?: string }
type ContextTuple = [string, string, string, string?];
interface StorageV2 { version: 2; contexts: CommitContext[] }
interface StorageV3 { version: 3; contexts: ContextTuple[]; hashes: string[] }
export type CompactStorage = StorageV2 | StorageV3;
interface CompactCommit {
  id: string; parentId?: string | null; context?: number;
  baseHash?: string; stateHash?: string; opsDigest?: string; textDigest?: string;
  checks?: number[];
  binding?: { messageId: string; swipeId: string } | [string, string];
}
interface StoredAction { actionId: string; operations?: Batch; source?: 'model' | 'user'; module?: string; enabled?: boolean; authorInputs?: Json }
interface StoredRecord {
  commit: CompactCommit;
  operations?: StoredAction[]; operationsPrefix?: number;
  dataPatch?: Commit['dataPatch']; dataSame?: 1; enginePatch?: Commit['enginePatch'];
  feedback?: Commit['feedback']; feedbackPrefix?: number;
  aliases?: Commit['aliases'];
}
export interface StoredFloor extends StoredRecord { version: 2 | 3; history?: StoredRecord[] }

function contextOf(record: Commit): CommitContext {
  const { chatId, generationToken } = record.binding;
  return { genesisId: record.genesisId, semantics: record.semantics, chatId,
    ...(generationToken === undefined ? {} : { generationToken }) };
}
function tupleOf(context: CommitContext): ContextTuple {
  return [storeToken(context.genesisId), context.semantics, context.chatId,
    ...(context.generationToken === undefined ? [] : [storeToken(context.generationToken)])] as ContextTuple;
}
export function compactStorage(records: Commit[]): StorageV3 {
  const contexts = new Map<string, ContextTuple>(), hashes = new Set<string>();
  for (const record of records) {
    const tuple = tupleOf(contextOf(record)); contexts.set(canonical(tuple), tuple);
    for (const value of [record.baseHash, record.stateHash, record.opsDigest, record.textDigest]) hashes.add(storeToken(value));
  }
  return { version: 3, contexts: [...contexts.values()], hashes: [...hashes] };
}
function isPrefix(value: unknown[], full: unknown[]): boolean {
  return value.length > 0 && value.length <= full.length && canonical(value) === canonical(full.slice(0, value.length));
}
function storeAction(action: Action): StoredAction {
  return { actionId: storeToken(action.actionId),
    ...(action.kind === 'module' ? { module: action.module, enabled: action.enabled }
      : { operations: clone(action.operations), ...(action.source === 'user' ? { source: 'user' as const } : {}) }),
    ...(action.authorInputs === undefined ? {} : { authorInputs: clone(action.authorInputs) }) };
}
function readAction(action: StoredAction): Action {
  const common = { actionId: readToken(action.actionId), ...(action.authorInputs === undefined ? {} : { authorInputs: clone(action.authorInputs) }) };
  if (Object.hasOwn(action, 'module')) {
    if (typeof action.module !== 'string' || typeof action.enabled !== 'boolean') fail('STORAGE_INVALID', '模块动作无效');
    return { ...common, kind: 'module', source: 'user', module: action.module, enabled: action.enabled };
  }
  if (!Object.hasOwn(action, 'operations') || (action.source !== undefined && action.source !== 'user')) fail('STORAGE_INVALID', '操作记录来源无效');
  return { ...common, kind: 'operations', source: action.source ?? 'model', operations: clone(action.operations!) };
}
export function storeFloor(head: Commit, records: Commit[], storage: StorageV3): StoredFloor {
  const owner = head.binding;
  const encode = (record: Commit, historical: boolean): StoredRecord => {
    const context = storage.contexts.findIndex(item => canonical(item) === canonical(tupleOf(contextOf(record))));
    if (context < 0) fail('STORAGE_CONTEXT', '提交缺少存储上下文');
    const checks = [record.baseHash, record.stateHash, record.opsDigest, record.textDigest].map(value => storage.hashes.indexOf(storeToken(value)));
    if (checks.some(index => index < 0)) fail('STORAGE_CONTEXT', '提交缺少校验上下文');
    const commit: CompactCommit = { id: storeToken(record.id), ...(record.parentId ? { parentId: storeToken(record.parentId) } : {}),
      ...(context ? { context } : {}), checks };
    if (!historical || record.binding.messageId !== owner.messageId || record.binding.swipeId !== owner.swipeId)
      commit.binding = [storeToken(record.binding.messageId), storeToken(record.binding.swipeId)];
    return { commit,
      ...(historical && isPrefix(record.actions, head.actions) ? { operationsPrefix: record.actions.length }
        : record.actions.length || !historical ? { operations: record.actions.map(storeAction) } : {}),
      ...(historical && record.dataPatch.length && canonical(record.dataPatch) === canonical(head.dataPatch) ? { dataSame: 1 as const }
        : record.dataPatch.length || !historical ? { dataPatch: clone(record.dataPatch) } : {}),
      ...(record.enginePatch.length ? { enginePatch: clone(record.enginePatch) } : {}),
      ...(historical && isPrefix(record.feedback, head.feedback) ? { feedbackPrefix: record.feedback.length }
        : record.feedback.length ? { feedback: clone(record.feedback) } : {}),
      ...(Object.keys(record.aliases).length ? { aliases: clone(record.aliases) } : {}) };
  };
  const history = records.filter(record => record.id !== head.id).map(record => encode(record, true));
  return { version: 3, ...encode(head, false), ...(history.length ? { history } : {}) };
}

export function floorBinding(floor: StoredFloor): { messageId: string; swipeId: string } {
  const binding = floor.commit?.binding;
  if (floor.version !== 3 || !Array.isArray(binding) || binding.length !== 2) fail('STORAGE_INVALID', '楼层缺少身份绑定');
  return { messageId: readToken(binding[0]), swipeId: readToken(binding[1]) };
}
export function readFloor(floor: StoredFloor, owner: { messageId: string; swipeId: string }, storage: CompactStorage): Commit[] {
  if (floor.version !== storage?.version || ![2, 3].includes(floor.version) || !Array.isArray(storage.contexts)
    || !floor.commit || !Array.isArray(floor.operations) || !Array.isArray(floor.dataPatch)
    || (floor.history !== undefined && !Array.isArray(floor.history))) fail('STORAGE_INVALID', '楼层正式记录格式无效');
  const modern = storage.version === 3;
  const actions: Action[] = modern ? floor.operations.map(readAction) : clone(floor.operations) as Action[];
  const prefix = <T>(count: number | undefined, values: T[]): T[] | undefined => {
    if (count === undefined) return undefined;
    if (!Number.isInteger(count) || count < 1 || count > values.length) fail('STORAGE_INVALID', '历史共享记录越界');
    return clone(values.slice(0, count));
  };
  return [floor, ...(floor.history ?? [])].map(stored => {
    const metadata = stored.commit, rawContext = storage.contexts[metadata?.context ?? 0];
    if (!rawContext || !metadata.id || (stored.operations !== undefined && stored.operationsPrefix !== undefined)
      || (stored.feedback !== undefined && stored.feedbackPrefix !== undefined)
      || (stored.dataSame !== undefined && (stored.dataSame !== 1 || stored.dataPatch !== undefined || !modern))) fail('STORAGE_INVALID', '提交存储上下文或共享记录无效');
    let context: CommitContext, binding = owner;
    if (modern) {
      if (!Array.isArray(rawContext) || !Array.isArray(metadata.checks) || metadata.checks.length !== 4) fail('STORAGE_INVALID', '提交校验上下文无效');
      context = { genesisId: readToken(rawContext[0]), semantics: rawContext[1], chatId: rawContext[2],
        ...(rawContext[3] === undefined ? {} : { generationToken: readToken(rawContext[3]) }) };
      if (metadata.binding !== undefined) {
        if (!Array.isArray(metadata.binding) || metadata.binding.length !== 2) fail('STORAGE_INVALID', '提交绑定无效');
        binding = { messageId: readToken(metadata.binding[0]), swipeId: readToken(metadata.binding[1]) };
      }
    } else { context = rawContext as CommitContext; binding = (metadata.binding ?? owner) as typeof owner; }
    const checks = storage.version === 3 ? metadata.checks!.map(index => {
      const value = storage.hashes?.[index];
      if (!Number.isInteger(index) || typeof value !== 'string') fail('STORAGE_INVALID', '提交校验索引无效');
      return readToken(value);
    }) : [metadata.baseHash!, metadata.stateHash!, metadata.opsDigest!, metadata.textDigest!];
    const { genesisId, semantics, chatId, generationToken } = context;
    return { id: modern ? readToken(metadata.id) : metadata.id, parentId: modern ? metadata.parentId ? readToken(metadata.parentId) : null : metadata.parentId!, genesisId, semantics,
      binding: { chatId, ...clone(binding), ...(generationToken === undefined ? {} : { generationToken }) },
      baseHash: checks[0]!, stateHash: checks[1]!, opsDigest: checks[2]!, textDigest: checks[3]!,
      actions: stored.operations === undefined ? prefix(stored.operationsPrefix, actions) ?? [] : modern ? stored.operations.map(readAction) : clone(stored.operations) as Action[],
      dataPatch: clone(stored.dataSame ? floor.dataPatch! : stored.dataPatch ?? []), enginePatch: clone(stored.enginePatch ?? []),
      feedback: clone(stored.feedback ?? prefix(stored.feedbackPrefix, floor.feedback ?? []) ?? []), aliases: clone(stored.aliases ?? {}) };
  });
}

export function storeGeneses(archive: Archive) {
  return Object.fromEntries(Object.values(archive.geneses).map(genesis => [storeToken(genesis.id), {
    state: clone(genesis.state), stateHash: storeToken(genesis.stateHash),
    ...(genesis.definitionHash === archive.definitionHash ? {} : { definitionHash: genesis.definitionHash }) }]));
}
export function readGeneses(geneses: Record<string, any>, definitionHash: string): Archive['geneses'] {
  return Object.fromEntries(Object.entries(geneses).map(([key, value]) => {
    const id = readToken(key);
    return [id, { id, definitionHash: value.definitionHash ?? definitionHash, state: clone(value.state), stateHash: readToken(value.stateHash) }];
  }));
}
