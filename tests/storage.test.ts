import test from 'node:test';
import assert from 'node:assert/strict';
import { hostEnvironment } from './host-fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';
import { archiveFromChat } from '../src/host/sillytavern.js';
import { headKey, restore } from '../src/history.js';
import { messageVariableView } from '../src/host/variables.js';
import { compactStorage, readFloor, storeFloor } from '../src/host/storage.js';

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

test('正式楼层只存一份修订，公共上下文与历史操作共享且所有旧状态无损恢复', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1);
  await c.submit({ $inc: { '@alice.hp': -1 } }, { actionId: 'second', authorInputs: { fixed: 42 } });
  await c.submit({ $group: [{ $inc: { '@alice.gold': -99999 } }] }, { actionId: 'failed' });
  const archive = c.runtime.archive, file = env.files.get(env.ctx.chatId)!;
  assert.ok(Object.values(archive.commits).every(record => record.binding.generationToken === undefined));
  const decoded = archiveFromChat(file[0].chat_metadata, file.slice(1))!;
  assert.deepEqual(decoded, archive);
  const records = file.slice(1).flatMap(message => Object.values(message.variables ?? {}).flatMap((item: any) => item.solve ? [item.solve, ...(item.solve.history ?? [])] : []));
  assert.equal(records.length, Object.keys(archive.commits).length);
  assert.equal(new Set(records.map(record => record.commit.id)).size, records.length);
  assert.ok(records.some(record => record.operationsPrefix > 0));
  for (const message of file.slice(1)) {
    for (const extra of [message.extra, ...(message.swipe_info ?? []).map((info: any) => info.extra)]) assert.equal(extra?.solve?.commits, undefined);
  }
  for (const commit of Object.values(archive.commits)) assert.deepEqual(await restore(decoded, commit.id), await restore(archive, commit.id));
  const message = file[2], head = c.runtime.getCommit()!, owner = head.binding;
  const oldRecords = Object.fromEntries(Object.entries(archive.commits).filter(([, record]) => headKey(record.binding) === headKey(owner)));
  const oldPointer = { messageId: owner.messageId, swipeId: owner.swipeId, nativeIndex: 0, headId: head.id, commits: oldRecords };
  const legacyBytes = bytes(oldPointer) * 2 + bytes(messageVariableView(head));
  const compactBytes = bytes(message.extra.solve) + bytes(message.swipe_info[0].extra.solve) + bytes(message.variables[0].solve);
  assert.ok(compactBytes < legacyBytes / 2, `${compactBytes} should be less than half of ${legacyBytes}`);
  c.dispose();
});

test('精简记录保留不同绑定上下文、孤立祖先和空值，不以共享前缀改变历史事实', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1);
  const head = c.runtime.getCommit()!, root = c.getHistory().find(record => record.parentId === null)!;
  const { current: _current, selected: _selected, ...old } = root;
  old.binding = { chatId: 'original-branch', messageId: 'deleted-message', swipeId: 'deleted-swipe', generationToken: '' };
  old.aliases = { former: 'canonical' };
  const storage = compactStorage([head, old]);
  assert.equal(storage.contexts.length, 2);
  const encoded = storeFloor(head, [head, old], storage);
  assert.deepEqual(readFloor(encoded, head.binding, storage), [head, old]);
  encoded.history![0]!.operationsPrefix = head.actions.length + 1;
  assert.throws(() => readFloor(encoded, head.binding, storage), /共享记录越界/u);
  c.dispose();
});

test('正式楼层操作被篡改时拒绝恢复，不再用隐藏重复副本覆盖用户修改', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1); c.dispose();
  const file = env.files.get(env.ctx.chatId)!;
  file[2].variables[0].solve.operations[0].operations = { $inc: { '@alice.hp': -99 } };
  env.switchChat(env.ctx.chatId);
  const original = JSON.stringify(file);
  await assert.rejects(attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher), /操作记录被修改/u);
  assert.equal(JSON.stringify(env.files.get(env.ctx.chatId)), original);
});

test('正式楼层变量丢失时明确拒绝恢复，不能误建新开局或从缓存掩盖丢失', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1); c.dispose();
  const file = env.files.get(env.ctx.chatId)!;
  delete file[1].variables;
  env.switchChat(env.ctx.chatId);
  const original = JSON.stringify(file);
  await assert.rejects(attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher), /缺少|开局/u);
  assert.equal(JSON.stringify(env.files.get(env.ctx.chatId)), original);
});
