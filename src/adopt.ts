/**
 * 换用新版定义继续旧聊天。
 *
 * 聊天锁定在开局时那一版定义的指纹上。作者发了新版（或者指纹算法变了）而旧版不再注册时，
 * 只有在新版下把整段历史（所有分支、所有楼层）逐个提交重新执行，结果与存档完全一致，
 * 才允许把聊天改记到新版名下：状态摘要、反馈、改名记录都必须一样。
 * 有一处不同就拒绝，并说明是哪一楼、哪里不同；不会用新规则去改动已有的历史。
 */
import { canonical, fail, hash } from './json.js';
import { applyAction, restore, SEMANTICS } from './history.js';
import type { Archive, Commit, LogicalState } from './types.js';
import type { SolveCore } from './engine.js';

export interface AdoptionResult { commits: number }

/** Re-executes every commit with `core`; throws DEFINITION_MISMATCH naming the first difference. */
export async function verifyAdoption(core: SolveCore, archive: Archive, floorOf: (commit: Commit) => string = c => c.id): Promise<AdoptionResult> {
  if (archive.authoring) fail('DEFINITION_MISMATCH', '这个聊天的结构来自世界书声明快照，不能换用其他版本');
  const children = new Map<string | null, Commit[]>();
  for (const commit of Object.values(archive.commits)) {
    const list = children.get(commit.parentId) ?? []; list.push(commit); children.set(commit.parentId, list);
  }
  let checked = 0;
  const walk = async (parentId: string | null, base: LogicalState | undefined): Promise<void> => {
    for (const commit of children.get(parentId) ?? []) {
      const where = floorOf(commit);
      if (commit.semantics !== SEMANTICS) fail('DEFINITION_MISMATCH', `${where} 用的是另一版引擎语义，不能换用当前结构`);
      let state = base ?? archive.geneses[commit.genesisId]?.state;
      if (!state) fail('GENESIS_CORRUPT', '归档缺少开局');
      const feedback: unknown[] = [], aliases: Record<string, string> = {};
      try {
        for (const action of commit.actions) {
          const result = await applyAction(core, structuredClone(action), state);
          state = result.state; feedback.push(...result.feedback); Object.assign(aliases, result.aliases);
        }
      } catch (error) { fail('DEFINITION_MISMATCH', `${where} 在当前结构下执行出错：${error instanceof Error ? error.message : String(error)}`); }
      if (await hash(state) !== commit.stateHash) fail('DEFINITION_MISMATCH', `${where} 在当前结构下算出的变量和存档不同`);
      if (canonical(feedback as never) !== canonical(commit.feedback as never)) fail('DEFINITION_MISMATCH', `${where} 在当前结构下的执行反馈和存档不同`);
      if (canonical(aliases) !== canonical(commit.aliases)) fail('DEFINITION_MISMATCH', `${where} 在当前结构下的实体改名和存档不同`);
      checked++;
      await walk(commit.id, state);
    }
  };
  await walk(null, undefined);
  if (!checked) fail('BROKEN_HISTORY', '归档里没有提交');
  return { commits: checked };
}

/** The same history recorded under `fingerprint`. Commit contents are unchanged. */
export function adoptArchive(archive: Archive, fingerprint: string): Archive {
  const next = structuredClone(archive);
  next.definitionHash = fingerprint;
  for (const genesis of Object.values(next.geneses)) genesis.definitionHash = fingerprint;
  return next;
}
/** Restores the head to make sure the adopted archive is internally consistent before saving it. */
export async function checkAdopted(archive: Archive, head: string): Promise<void> { await restore(archive, head); }
