import jsonpatch from 'fast-json-patch';
import { assertJson, canonical, clone, fail, hash, id, segments } from './json.js';
import type { Action, Archive, Binding, Commit, ExecutionResult, Genesis, LogicalState } from './types.js';
import { SolveCore } from './engine.js';

const { compare, applyPatch } = jsonpatch;
export const SEMANTICS = '0.5.0';
export const headKey = (binding: Pick<Binding, 'messageId' | 'swipeId'>): string => JSON.stringify([binding.messageId, binding.swipeId]);
// Heads are scoped by the Archive/session, not the host filename: copied branch files
// intentionally retain immutable ancestor message/swipe identities.
export async function archiveProof(archive: Archive, targetId: string): Promise<string> {
  const chain: Commit[] = [], seen = new Set<string>();
  let current: string | null = targetId;
  while (current) {
    if (seen.has(current)) fail('HISTORY_CYCLE', '历史父链循环');
    seen.add(current);
    const commit: Commit | undefined = archive.commits[current];
    if (!commit) fail('BROKEN_HISTORY', '归档缺少父提交');
    chain.push(commit); current = commit.parentId;
  }
  const genesis = archive.geneses[chain.at(-1)?.genesisId ?? ''];
  if (!genesis) fail('GENESIS_CORRUPT', '归档缺少开局');
  return hash({ version: archive.version, sessionId: archive.sessionId, definitionHash: archive.definitionHash, genesis, chain });
}
export async function createArchive(core: SolveCore, binding: Binding, initial?: unknown): Promise<{ archive: Archive; headId: string }> {
  const state = await core.initialize(initial);
  const genesis: Genesis = { id: id('genesis'), definitionHash: core.definition.fingerprint, state, stateHash: await hash(state) };
  const archive: Archive = { version: '0.5', sessionId: id('session'), definitionHash: core.definition.fingerprint,
    geneses: { [genesis.id]: genesis }, commits: {}, heads: {} };
  const root = await buildCommit(archive, null, genesis.id, state, state, binding, [], [], {}, '');
  archive.commits[root.id] = root; archive.heads[headKey(binding)] = root.id;
  return { archive, headId: root.id };
}
export async function addGenesisVariant(archive: Archive, core: SolveCore, binding: Binding, initial: unknown): Promise<string> {
  if (archive.definitionHash !== core.definition.fingerprint) fail('DEFINITION_MISMATCH', '不能给旧会话替换作者定义');
  const variant = await createArchive(core, binding, initial);
  Object.assign(archive.geneses, variant.archive.geneses);
  Object.assign(archive.commits, variant.archive.commits);
  archive.heads[headKey(binding)] = variant.headId;
  return variant.headId;
}
export async function buildCommit(archive: Archive, parentId: string | null, genesisId: string, before: LogicalState, after: LogicalState,
  binding: Binding, actions: Action[], feedback: ExecutionResult['feedback'], aliases: Record<string, string>, text: string): Promise<Commit> {
  assertJson(after); assertJson(actions);
  const baseHash = await hash(before);
  if (parentId && archive.commits[parentId]?.stateHash !== baseHash) fail('PARENT_MISMATCH', '父提交与执行前状态不一致');
  if (!parentId && archive.geneses[genesisId]?.stateHash !== baseHash) fail('GENESIS_MISMATCH', '根提交与开局状态不一致');
  return { id: id('commit'), parentId, genesisId, baseHash, stateHash: await hash(after), semantics: SEMANTICS,
    binding: clone(binding), dataPatch: compare(before.data, after.data), enginePatch: compare(before.engineState, after.engineState),
    actions: clone(actions), opsDigest: await hash(actions), feedback: clone(feedback), aliases: clone(aliases), textDigest: await hash(text) };
}
export async function restore(archive: Archive, targetId: string): Promise<LogicalState> {
  if (archive.version !== '0.5') fail('ARCHIVE_VERSION', '不支持此归档格式');
  const chain: Commit[] = [], seen = new Set<string>();
  let current: string | null = targetId;
  while (current) {
    if (seen.has(current)) fail('HISTORY_CYCLE', '历史父链出现循环');
    seen.add(current);
    const commit: Commit | undefined = archive.commits[current];
    if (!commit || commit.id !== current) fail('BROKEN_HISTORY', `缺少提交：${current}`);
    chain.push(commit); current = commit.parentId;
  }
  const root = chain.at(-1);
  if (!root) fail('BROKEN_HISTORY', '没有可恢复的历史');
  const genesis = archive.geneses[root.genesisId];
  if (!genesis || genesis.definitionHash !== archive.definitionHash || await hash(genesis.state) !== genesis.stateHash) fail('GENESIS_CORRUPT', '开局状态损坏或定义不符');
  let state = clone(genesis.state);
  for (const commit of chain.reverse()) {
    if (commit.genesisId !== genesis.id || commit.baseHash !== await hash(state)) fail('BASE_HASH_MISMATCH', `提交基线不符：${commit.id}`);
    if (commit.opsDigest !== await hash(commit.actions)) fail('OPS_DIGEST_MISMATCH', `操作记录被修改：${commit.id}`);
    try {
      for (const patch of [...commit.dataPatch, ...commit.enginePatch]) {
        segments(patch.path);
        if ('from' in patch) segments(patch.from);
      }
      state = { data: applyPatch(clone(state.data), clone(commit.dataPatch), true, true, true).newDocument,
        engineState: applyPatch(clone(state.engineState), clone(commit.enginePatch), true, true, true).newDocument };
      assertJson(state);
    } catch { fail('PATCH_CORRUPT', `状态补丁无效：${commit.id}`); }
    if (await hash(state) !== commit.stateHash) fail('STATE_HASH_MISMATCH', `提交结果不符：${commit.id}`);
  }
  return state;
}
export function serializeArchive(archive: Archive): string { assertJson(archive); return JSON.stringify(archive); }
export function parseArchive(text: string): Archive {
  const archive: unknown = JSON.parse(text); assertJson(archive);
  const a = archive as unknown as Archive;
  if (a.version !== '0.5' || !a.sessionId || !a.geneses || !a.commits || !a.heads) fail('ARCHIVE_INVALID', '归档结构无效');
  return a;
}
export async function applyAction(core: SolveCore, action: Action, state: LogicalState): Promise<ExecutionResult> {
  return action.kind === 'module'
    ? core.setModule(action.module, action.enabled, state, { source: action.source, authorInputs: action.authorInputs })
    : core.execute(action.operations, state, { source: action.source, authorInputs: action.authorInputs });
}
export async function replay(core: SolveCore, archive: Archive, oldIds: string[], newParent: string,
  replacements: Record<string, Action[]> = {}): Promise<{ archive: Archive; headId: string }> {
  if (core.definition.fingerprint !== archive.definitionHash) fail('DEFINITION_MISMATCH', '重放必须使用原会话固定定义');
  const next = clone(archive);
  let parent = newParent, state = await restore(next, parent);
  for (const oldId of oldIds) {
    const old = archive.commits[oldId];
    if (!old) fail('BROKEN_HISTORY', `缺少历史：${oldId}`);
    if (headKey(next.commits[parent]!.binding) === headKey(old.binding) && next.commits[parent]!.actions.length) fail('REPLAY_SAME_SWIPE_PARENT', '重放必须从该Swipe前的父状态开始，不能叠加同Swipe累计修订');
    if (old.semantics !== SEMANTICS) fail('SEMANTICS_MISMATCH', '引擎语义版本不同，不能自动重放');
    const before = clone(state), feedback: ExecutionResult['feedback'] = [], aliases: Record<string, string> = {};
    const actions = replacements[oldId] ?? old.actions;
    for (const action of actions) {
      const result = await applyAction(core, clone(action), state);
      state = result.state; feedback.push(...result.feedback); Object.assign(aliases, result.aliases);
    }
    const commit = await buildCommit(next, parent, next.commits[parent]!.genesisId, before, state, old.binding, actions, feedback, aliases, '');
    // Text is not regenerated by Replay; caller must archive edited raw blocks together with this revision.
    commit.textDigest = old.textDigest;
    next.commits[commit.id] = commit; next.heads[headKey(commit.binding)] = commit.id; parent = commit.id;
  }
  return { archive: next, headId: parent };
}
