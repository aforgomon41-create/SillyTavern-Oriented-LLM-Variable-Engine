import { clone } from '../json.js';
import type { Archive, Commit, LogicalState } from '../types.js';
import type { HostMessage, SwipeArchive } from './sillytavern.js';
import { compactStorage, storeFloor } from './storage.js';
import { headKey } from '../history.js';
import type { CompactStorage } from './storage.js';

/** Tavern Helper reads message.variables[swipe_id] and chat_metadata.variables. */
export function messageVariableView(record: Commit) {
  const { actions, dataPatch, enginePatch, feedback, aliases, ...commit } = clone(record);
  return { version: 1, derived: true, headId: record.id, operations: actions, dataPatch, enginePatch, feedback, aliases, commit };
}

export function activeVariableView(commit: Commit, state: LogicalState, ready = true, reason = '') {
  return { headId: commit.id, stateHash: commit.stateHash, ready, ...(reason ? { reason } : {}),
    data: clone(state.data), engineState: clone(state.engineState) };
}

function variableSlots(message: HostMessage): Record<string, any>[] {
  const source = message.variables;
  const count = Math.max(message.swipes?.length ?? 1, message.swipe_info?.length ?? 0,
    Array.isArray(source) ? source.length : 0, (message.swipe_id ?? 0) + 1);
  return Array.from({ length: count }, (_, index) => {
    const item = source?.[index];
    return item && typeof item === 'object' && !Array.isArray(item) ? { ...item } : {};
  });
}

/** Store each revision once, in the corresponding standard message variable slot. */
export function writeMessageVariableViews(messages: HostMessage[], archive: Archive): CompactStorage {
  const storage = compactStorage(Object.values(archive.commits));
  const owners = new Set(messages.flatMap(message => [message.extra?.solve,
    ...(message.swipe_info ?? []).map(info => info.extra?.solve)]).filter(Boolean).map(saved => headKey(saved)));
  const orphans = Object.values(archive.commits).filter(record => !owners.has(headKey(record.binding)));
  let carriedOrphans = false;
  for (const message of messages) {
    if (message.is_user || message.is_system || !message.extra?.solve?.messageId) continue;
    const slots = variableSlots(message), selected = message.swipe_id ?? 0;
    for (let index = 0; index < slots.length; index++) {
      const saved: SwipeArchive | undefined = index === selected ? message.extra?.solve : message.swipe_info?.[index]?.extra?.solve;
      const record = saved?.headId ? archive.commits[saved.headId] : undefined;
      if (record && saved?.messageId === record.binding.messageId && saved?.swipeId === record.binding.swipeId && saved?.nativeIndex === index) {
        const records = Object.values(archive.commits).filter(item => headKey(item.binding) === headKey(record.binding));
        if (!carriedOrphans) { records.push(...orphans); carriedOrphans = true; }
        slots[index]!.solve = storeFloor(record, records, storage);
      } else delete slots[index]!.solve;
    }
    message.variables = slots;
    for (const extra of [message.extra, ...(message.swipe_info ?? []).map(info => info.extra)]) if (extra?.solve) delete extra.solve.commits;
  }
  return storage;
}

/** Merge only SOLVE's namespace; never replace other scripts' variables. */
export function applyMessageVariableViews(live: HostMessage, saved: HostMessage): void {
  const slots = variableSlots(live), projected = variableSlots(saved);
  while (slots.length < projected.length) slots.push({});
  for (let index = 0; index < slots.length; index++) {
    if (projected[index]?.solve) slots[index]!.solve = clone(projected[index]!.solve);
    else delete slots[index]!.solve;
  }
  live.variables = slots;
}

export function variableViews(metadata: Record<string, any>, messages: HostMessage[]) {
  return { active: metadata.variables?.solve ?? null, messages: messages.map(message => {
    if (message.is_user || message.is_system) return null;
    const slots = variableSlots(message);
    return slots.map(slot => slot.solve ?? null);
  }) };
}
