import { applyAction, buildCommit, headKey, restore } from './history.js';
import { assertJson, canonical, clone, fail, hash } from './json.js';
import { SolveCore } from './engine.js';
import type { Action, Archive, ArchiveAdapter, Binding, Commit, LogicalState, SaveDraft } from './types.js';

export class SolveRuntime {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, SaveDraft>();
  private currentState?: LogicalState;
  private currentHead: string;
  private epoch = 0;
  private queued = 0;
  constructor(public readonly core: SolveCore, private currentArchive: Archive, headId: string, private adapter: ArchiveAdapter) {
    this.currentHead = headId;
    if (core.definition.fingerprint !== currentArchive.definitionHash) fail('DEFINITION_MISMATCH', '会话绑定的定义已变化');
  }
  get archive(): Archive { return clone(this.currentArchive); }
  get headId(): string { return this.currentHead; }
  get busy(): boolean { return this.queued > 0; }
  get pendingCount(): number { return this.pending.size; }
  getState(): LogicalState {
    if (!this.currentState) fail('STATE_NOT_READY', 'SOLVE 状态尚未恢复');
    return clone(this.currentState);
  }
  async ready(): Promise<void> {
    const epoch = this.epoch, head = this.currentHead;
    const state = await restore(this.currentArchive, head);
    if (epoch !== this.epoch || head !== this.currentHead) fail('STALE_ACTION', '恢复期间选中历史已改变');
    this.currentState = state;
  }
  async select(headId: string): Promise<void> {
    const epoch = ++this.epoch;
    const state = await restore(this.currentArchive, headId);
    if (epoch !== this.epoch) fail('STALE_SELECTION', '选中历史已经改变');
    this.currentHead = headId; this.currentState = state;
  }
  invalidate(): void { this.epoch++; this.currentState = undefined; }
  submit(action: Action, binding: Binding, text: string, options: { expectedHead?: string; sourceText?: string } = {}): Promise<Commit> {
    const epoch = this.epoch;
    const expectedHead = options.expectedHead, sourceText = options.sourceText;
    // Clone at intake: callers cannot mutate a queued action or redirect a save.
    const input = clone(action), identity = clone(binding);
    assertJson(input);
    if (!input.actionId) return Promise.reject(new Error('动作必须有 actionId'));
    this.queued++;
    const task = this.queue.then(async () => {
      if (epoch !== this.epoch) fail('STALE_ACTION', '聊天或回复版本已经改变');
      await this.adapter.assertCurrent(identity);
      if (epoch !== this.epoch) fail('STALE_ACTION', '身份检查期间选中历史已改变');
      if (expectedHead && this.currentHead !== expectedHead) fail('HEAD_CHANGED', '状态已变化，请重新提交');
      const key = `${headKey(identity)}:${input.actionId}`;
      let previous: Commit | undefined;
      for (let cursor: string | null = this.currentHead; cursor;) {
        const record: Commit = this.currentArchive.commits[cursor]!;
        if (headKey(record.binding) === headKey(identity) && record.actions.some(a => a.actionId === input.actionId)) { previous = record; break; }
        cursor = record.parentId;
      }
      if (previous) {
        const old = previous.actions.find(a => a.actionId === input.actionId)!;
        if (canonical(old) !== canonical(input)) fail('ACTION_ID_CONFLICT', '同一动作编号对应不同操作');
        return clone(previous);
      }
      let draft = this.pending.get(key);
      if (draft) {
        if (canonical(draft.commit.actions.at(-1)) !== canonical(input)) fail('ACTION_ID_CONFLICT', '待保存动作内容不同');
        if (draft.expectedHead !== this.currentHead) fail('PENDING_CONFLICT', '待保存草稿基线已变化');
        if (draft.binding.chatId !== identity.chatId) fail('PENDING_CONFLICT', '待保存草稿不属于当前聊天');
        if (draft.sourceTextDigest && (sourceText === undefined || await hash(sourceText) !== draft.sourceTextDigest)) fail('PENDING_TEXT_CHANGED', '待保存动作的原正文已变化，不能覆盖');
        draft.binding = clone(identity); // refresh an ephemeral generation token after reload
      } else {
        // Do not accept a new mutation while an earlier unsaved result is pending.
        if (this.pending.size) fail('PENDING_SAVE', '上次操作尚未保存，请先重试或撤回');
        if (!this.currentState) await this.ready();
        const sameSwipeId = this.currentArchive.heads[headKey(identity)];
        const current = this.currentArchive.commits[this.currentHead]!;
        const revising = sameSwipeId === this.currentHead && current.binding.messageId === identity.messageId && current.binding.swipeId === identity.swipeId && current.actions.length > 0;
        const parentId = revising ? current.parentId : this.currentHead;
        const base = parentId ? await restore(this.currentArchive, parentId) : clone(this.currentArchive.geneses[current.genesisId]!.state);
        const result = await applyAction(this.core, input, this.currentState!);
        if (epoch !== this.epoch) fail('STALE_ACTION', '计算期间聊天或回复版本已改变');
        const actions = revising ? [...current.actions, input] : [input];
        const feedback = revising ? [...current.feedback, ...result.feedback] : result.feedback;
        const aliases = revising ? { ...current.aliases, ...result.aliases } : result.aliases;
        const commit = await buildCommit(this.currentArchive, parentId, current.genesisId, base, result.state, identity, actions, feedback, aliases, text);
        if (epoch !== this.epoch) fail('STALE_ACTION', '归档准备期间选中历史已改变');
        const archive = clone(this.currentArchive);
        archive.commits[commit.id] = commit; archive.heads[headKey(identity)] = commit.id;
        draft = { archive, commit, text, binding: identity, expectedHead: this.currentHead,
          ...(sourceText !== undefined ? { sourceTextDigest: await hash(sourceText) } : {}) };
        this.pending.set(key, clone(draft));
      }
      await this.adapter.assertCurrent(identity);
      if (epoch !== this.epoch) fail('STALE_ACTION', '保存前选中历史已改变');
      await this.adapter.save(clone(draft));
      if (epoch !== this.epoch) fail('STALE_ACTION', '保存期间聊天或回复版本已改变；已写结果保留在原归属');
      await this.adapter.assertCurrent(identity);
      if (epoch !== this.epoch) fail('STALE_ACTION', '保存确认期间选中历史已改变');
      const confirmedState = await restore(draft.archive, draft.commit.id);
      if (epoch !== this.epoch) fail('STALE_ACTION', '保存恢复期间选中历史已改变');
      this.currentArchive = clone(draft.archive); this.currentHead = draft.commit.id;
      this.currentState = confirmedState;
      this.pending.delete(key);
      return clone(draft.commit);
    });
    this.queue = task.catch(() => undefined);
    return task.finally(() => { this.queued--; });
  }
  discardPending(): void {
    if (this.busy) fail('RUNTIME_BUSY', '写入运行中不能撤回草稿');
    this.pending.clear();
  }
  // Persist these drafts locally for refresh recovery; they are never archived facts.
  exportPending(): SaveDraft[] { return clone([...this.pending.values()]); }
  importPending(drafts: SaveDraft[]): void {
    if (this.busy) fail('RUNTIME_BUSY', '运行中不能载入草稿');
    for (const draft of drafts) {
      if (draft.archive.sessionId !== this.currentArchive.sessionId || draft.expectedHead !== this.currentHead) fail('PENDING_CONFLICT', '待保存草稿不属于当前会话基线');
      const action = draft.commit.actions.at(-1);
      if (!action) fail('PENDING_INVALID', '草稿没有动作');
      if (draft.archive.definitionHash !== this.currentArchive.definitionHash || canonical(draft.archive.commits[draft.commit.id]) !== canonical(draft.commit)
        || draft.archive.heads[headKey(draft.binding)] !== draft.commit.id || headKey(draft.commit.binding) !== headKey(draft.binding)
        || draft.commit.binding.chatId !== draft.binding.chatId) fail('PENDING_INVALID', '草稿身份或归档内容不一致');
      for (const [commitId, commit] of Object.entries(this.currentArchive.commits)) {
        if (!draft.archive.commits[commitId] || canonical(draft.archive.commits[commitId]) !== canonical(commit)) fail('PENDING_CONFLICT', '草稿缺少当前已存在的历史分支');
      }
      for (const [key, head] of Object.entries(this.currentArchive.heads)) {
        if (key !== headKey(draft.binding) && draft.archive.heads[key] !== head) fail('PENDING_CONFLICT', '草稿的其他分支已过期');
      }
      this.pending.set(`${headKey(draft.binding)}:${action.actionId}`, clone(draft));
    }
  }
}
