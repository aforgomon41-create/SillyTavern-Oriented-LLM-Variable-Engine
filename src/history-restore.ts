import jsonpatch from 'fast-json-patch';
import { assertJson, clone, fail, hash, segments } from './json.js';
import type { Archive, Commit, Genesis, LogicalState } from './types.js';

/** Internal, owned snapshot of a single ancestor path; unrelated branches are excluded. */
export interface RestorePath {
  version: Archive['version']; sessionId: string; definitionHash: string; authoring?: Archive['authoring'];
  genesis: Genesis; chain: Commit[];
}
export function captureRestorePath(archive: Archive, targetId: string): RestorePath {
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
  if (!genesis || genesis.definitionHash !== archive.definitionHash) fail('GENESIS_CORRUPT', '开局状态损坏或定义不符');
  // Capture before any await. Caller mutation must neither poison a certificate nor
  // replace Patch values while a browser digest is pending.
  return clone({ version: archive.version, sessionId: archive.sessionId, definitionHash: archive.definitionHash,
    genesis, chain: chain.reverse(), ...(archive.authoring ? { authoring: archive.authoring } : {}) });
}
/** Same bytes/ordering as the existing archiveProof, scoped to one ancestor prefix. */
export function pathProof(path: RestorePath, length = path.chain.length): Promise<string> {
  return hash({ version: path.version, sessionId: path.sessionId, definitionHash: path.definitionHash,
    genesis: path.genesis, chain: path.chain.slice(0, length).reverse(), ...(path.authoring ? { authoring: path.authoring } : {}) });
}
/** Internal only. An anchor is supplied solely after its complete prefix proof matches. */
export async function materializePath(path: RestorePath, start = 0, anchor?: LogicalState,
  captureParent?: (state: LogicalState) => void): Promise<LogicalState> {
  const genesis = path.genesis;
  let state = anchor ? { data: clone(anchor.data), engineState: clone(anchor.engineState) }
    : { data: clone(genesis.state.data), engineState: clone(genesis.state.engineState) };
  let stateHash = await hash(state);
  const expected = start ? path.chain[start - 1]!.stateHash : genesis.stateHash;
  if (stateHash !== expected) fail('GENESIS_CORRUPT', '开局或已验证检查点状态损坏');
  for (let i = start; i < path.chain.length; i++) {
    if (i === path.chain.length - 1 && i > 0) captureParent?.(state);
    const commit = path.chain[i]!;
    if (commit.genesisId !== genesis.id || commit.baseHash !== stateHash) fail('BASE_HASH_MISMATCH', `提交基线不符：${commit.id}`);
    if (commit.opsDigest !== await hash(commit.actions)) fail('OPS_DIGEST_MISMATCH', `操作记录被修改：${commit.id}`);
    try {
      for (const patch of [...commit.dataPatch, ...commit.enginePatch]) {
        segments(patch.path); if ('from' in patch) segments(patch.from);
      }
      state = { data: jsonpatch.applyPatch(state.data, clone(commit.dataPatch), true, true, true).newDocument,
        engineState: jsonpatch.applyPatch(state.engineState, clone(commit.enginePatch), true, true, true).newDocument };
      assertJson(state);
    } catch { fail('PATCH_CORRUPT', `状态补丁无效：${commit.id}`); }
    stateHash = await hash(state);
    if (stateHash !== commit.stateHash) fail('STATE_HASH_MISMATCH', `提交结果不符：${commit.id}`);
  }
  return state;
}
