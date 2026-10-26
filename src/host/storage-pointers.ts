import { fail } from '../json.js';
import { floorBinding } from './storage.js';
import { readToken, storeToken } from './storage-tokens.js';
import type { HostMessage } from './sillytavern.js';
import type { Archive } from '../types.js';

/** 1.19 emits deletion before switching displayed text; stable identities survive index shifts. */
export function reconcileSwipeDeletion(messages: HostMessage[], archive: Archive, event: { messageId: number; swipeId: number; newSwipeId: number }): void {
  const message = messages[event.messageId];
  if (!message?.swipes?.length || !Number.isInteger(event.newSwipeId) || typeof message.swipes[event.newSwipeId] !== 'string') fail('STORAGE_INVALID', '删除后的回复版本无效');
  const slots: Record<string, any>[] = Array.from({ length: Math.max(message.variables?.length ?? 0, message.swipes.length) }, (_, index) => ({ ...message.variables?.[index] }));
  const records = new Map(slots.flatMap(slot => slot.solve?.commit?.id ? [[readToken(slot.solve.commit.id), slot.solve] as const] : []));
  for (let index = 0; index < slots.length; index++) {
    const saved = message.swipe_info?.[index]?.extra?.solve;
    const headId = index < message.swipes.length && saved ? saved.headId ?? (saved.ref ? readToken(saved.ref) : undefined) : undefined;
    const commit = headId ? archive.commits[headId] : undefined;
    if (!commit) { delete slots[index]!.solve; continue; }
    const floor = records.get(commit.id);
    if (!floor) fail('STORAGE_MISSING', '删除后缺少存活回复的正式变量');
    slots[index]!.solve = floor;
    message.swipe_info![index]!.extra!.solve = { messageId: commit.binding.messageId, swipeId: commit.binding.swipeId, nativeIndex: index, headId: commit.id,
      ...(saved.commits ? { commits: saved.commits } : {}) };
  }
  message.variables = slots;
  message.extra ??= {};
  const selected = message.swipe_info?.[event.newSwipeId]?.extra?.solve;
  if (selected) message.extra.solve = { ...selected }; else delete message.extra.solve;
  message.mes = message.swipes[event.newSwipeId]!;
}

/** Hydrate only host identity pointers; persisted floor records stay compact and readable. */
export function expandPointers(messages: HostMessage[]): void {
  for (const message of messages) {
    for (const extra of [message.extra, ...(message.swipe_info ?? []).map(info => info.extra)]) {
      const saved = extra?.solve;
      if (!saved || saved.ref === undefined) continue;
      if (Object.getOwnPropertyDescriptor(saved, 'messageId')?.enumerable === false) continue;
      const index = saved.index ?? 0, floor = message.variables?.[index]?.solve;
      if (!Number.isInteger(index) || index < 0 || floor?.version !== 3 || readToken(floor.commit?.id) !== readToken(saved.ref))
        fail('STORAGE_MISSING', '楼层正式记录缺少或回复指针不一致');
      const expanded = { ref: saved.ref, ...(index ? { index } : {}), ...(saved.commits ? { commits: saved.commits } : {}) };
      for (const [key, value] of Object.entries({ ...floorBinding(floor), nativeIndex: index, headId: readToken(saved.ref) }))
        Object.defineProperty(expanded, key, { value, writable: true, configurable: true, enumerable: false });
      extra!.solve = expanded;
    }
  }
}
export function compactPointers(messages: HostMessage[]): void {
  for (const message of messages) {
    for (const extra of [message.extra, ...(message.swipe_info ?? []).map(info => info.extra)]) {
      const saved = extra?.solve;
      if (!saved?.headId) continue;
      const index = saved.nativeIndex, floor = message.variables?.[index]?.solve;
      if (floor?.version !== 3 || readToken(floor.commit.id) !== saved.headId) fail('STORAGE_HEAD_MISMATCH', '无法保存回复指针');
      const binding = floorBinding(floor);
      if (binding.messageId !== saved.messageId || binding.swipeId !== saved.swipeId) fail('STORAGE_HEAD_MISMATCH', '无法保存消息绑定');
      extra!.solve = { ref: storeToken(saved.headId), ...(index ? { index } : {}) };
    }
  }
}
