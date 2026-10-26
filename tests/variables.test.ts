import test from 'node:test';
import assert from 'node:assert/strict';
import { hostEnvironment } from './host-fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';
import { SolveSessionManager } from '../src/host/sessions.js';
import { archiveFromChat } from '../src/host/sillytavern.js';
import { headKey, restore } from '../src/history.js';
import { readToken } from '../src/host/storage-tokens.js';
import { expandPointers } from '../src/host/storage-pointers.js';

/** Recreate the pre-0.8.2 file layout, including legacy derived variables. */
function legacy(file: any[]) {
  const archive = archiveFromChat(file[0].chat_metadata, file.slice(1))!;
  const { commits: _commits, ...header } = archive;
  file[0].chat_metadata.solve = header;
  expandPointers(file.slice(1));
  for (const message of file.slice(1)) {
    for (const extra of [message.extra, ...(message.swipe_info ?? []).map((info: any) => info.extra)]) {
      if (extra?.solve) {
        const saved = extra.solve;
        extra.solve = { messageId: saved.messageId, swipeId: saved.swipeId, nativeIndex: saved.nativeIndex, headId: saved.headId,
          commits: Object.fromEntries(Object.entries(archive.commits).filter(([, record]) => headKey(record.binding) === headKey(saved))) };
      }
    }
    for (const variables of Object.values(message.variables ?? {}) as any[]) if (variables.solve) variables.solve = { version: 1, derived: true };
  }
  return archive;
}

test('酒馆助手楼层变量可读取操作、双Patch与commit，聊天变量包含确认快照且保留其他变量', async () => {
  const env = await hostEnvironment();
  env.ctx.chat[0]!.variables = [{ unrelated: { keep: true } }];
  env.ctx.chatMetadata.variables = { author: 'keep' };
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  const index = env.addReply(), commit = await c.processMessage(index);
  const file = env.files.get(env.ctx.chatId)!;
  const floor = file[index + 1].variables[file[index + 1].swipe_id ?? 0].solve;
  const chat = file[0].chat_metadata.variables.solve;
  assert.deepEqual(floor.operations.map((action: any) => action.operations), commit!.actions.map(action => action.kind === 'operations' ? action.operations : undefined));
  assert.deepEqual(archiveFromChat(file[0].chat_metadata, file.slice(1))!.commits[commit!.id]!.actions, commit!.actions);
  assert.deepEqual(floor.dataPatch, commit!.dataPatch);
  assert.deepEqual(floor.enginePatch ?? [], commit!.enginePatch);
  assert.equal(readToken(floor.commit.id), commit!.id);
  assert.equal(archiveFromChat(file[0].chat_metadata, file.slice(1))!.commits[commit!.id]!.stateHash, chat.stateHash);
  assert.equal(chat.headId, commit!.id);
  assert.equal(file[0].chat_metadata.solve.sessionId, c.runtime.sessionId);
  assert.equal(chat.data.characters.alice.hp, 85);
  assert.deepEqual(chat.engineState, c.getState().engineState);
  assert.equal(chat.ready, true);
  assert.equal(file[0].chat_metadata.variables.author, 'keep');
  assert.equal(file[1].variables[0].unrelated.keep, true);
  assert.equal(readToken(env.ctx.chat[index]!.variables[0].solve.commit.id), commit!.id);
  assert.ok(env.ctx.chat[index]!.mes.includes('<solve_operate>'));
  c.dispose();
});

test('打开旧聊天自动补齐楼层变量与聊天快照，不增加commit或重跑模型操作', async () => {
  const env = await hostEnvironment();
  let c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1); c.dispose();
  const old = env.files.get(env.ctx.chatId)!;
  const original = legacy(old);
  delete old[0].chat_metadata.variables;
  for (const message of old.slice(1)) delete message.variables;
  env.ctx.chat = structuredClone(old.slice(1)); env.ctx.chatMetadata = structuredClone(old[0].chat_metadata);
  c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  const upgraded = env.files.get(env.ctx.chatId)!;
  assert.deepEqual(archiveFromChat(upgraded[0].chat_metadata, upgraded.slice(1)), original);
  assert.equal(readToken(upgraded[2].variables[0].solve.commit.id), c.getStatus().headId);
  assert.equal(upgraded[0].chat_metadata.variables.solve.data.characters.alice.hp, 85);
  c.dispose();
});

test('不同Swipe各有楼层变量，切换后聊天快照在内存和磁盘同时更新', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1);
  const message = env.ctx.chat[1]!, firstHead = c.getStatus().headId;
  message.variables[0].author = 'first';
  message.swipe_id = 1;
  message.swipes!.push('另一个回复。<solve_operate>{"$inc":{"@alice.hp":-30}}</solve_operate>');
  message.swipe_info!.push({ extra: structuredClone(message.extra) });
  message.mes = message.swipes![1]!;
  await env.emit('swipe', 1); await c.processMessage(1);
  assert.notEqual(readToken(message.variables[1].solve.commit.id), firstHead);
  assert.equal(readToken(message.variables[0].solve.commit.id), firstHead);
  assert.equal(message.variables[0].author, 'first');
  assert.equal(env.ctx.chatMetadata.variables.solve.data.characters.alice.hp, 70);
  message.swipe_id = 0; message.mes = message.swipes![0]!;
  message.extra = structuredClone(message.swipe_info![0]!.extra);
  await env.emit('swipe', 1);
  assert.equal(env.ctx.chatMetadata.variables.solve.headId, firstHead);
  assert.equal(env.ctx.chatMetadata.variables.solve.data.characters.alice.hp, 85);
  assert.equal(env.files.get(env.ctx.chatId)![0].chat_metadata.variables.solve.data.characters.alice.hp, 85);
  c.dispose();
});

test('保存失败不能把候选发布为正式快照，重试后同步变量且不重复扣血', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); env.setFailBefore(true);
  await assert.rejects(c.processMessage(1), /断开/u);
  assert.equal(c.getStatus().pendingCount, 1);
  assert.equal(env.ctx.chatMetadata.variables.solve.data.characters.alice.hp, 100);
  assert.equal(env.ctx.chatMetadata.variables.solve.ready, false);
  assert.equal(env.ctx.chat[1]!.variables?.[0]?.solve, undefined);
  env.setFailBefore(false); await c.retryPending();
  assert.equal(env.ctx.chatMetadata.variables.solve.data.characters.alice.hp, 85);
  assert.equal(env.ctx.chatMetadata.variables.solve.ready, true);
  assert.equal(readToken(env.ctx.chat[1]!.variables[0].solve.commit.id), c.getStatus().headId);
  c.dispose();
});

test('回读聊天快照缺失会明确失败；已落盘的commit可补写快照后确认，不重新执行', async () => {
  const env = await hostEnvironment(); let dropViews = false;
  const fetcher = (async (input: any, init?: any) => {
    if (input === '/api/chats/save' && dropViews) {
      const body = JSON.parse(init.body);
      delete body.chat[0].chat_metadata.variables;
      init = { ...init, body: JSON.stringify(body) };
    }
    return env.fetcher(input, init);
  }) as typeof fetch;
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, fetcher);
  env.addReply(); dropViews = true;
  await assert.rejects(c.processMessage(1), /楼层变量|聊天快照/u);
  assert.equal(c.getStatus().pendingCount, 1);
  const savedCommit = c.getPending()[0]!.commit.id;
  dropViews = false; await c.retryPending();
  assert.equal(c.getStatus().headId, savedCommit);
  assert.equal(c.getHistory().length, 2);
  assert.equal(c.getValue('@alice.hp'), 85);
  assert.equal(readToken(env.files.get(env.ctx.chatId)![2].variables[0].solve.commit.id), savedCommit);
  c.dispose();
});

test('旧版派生变量被篡改不影响历史；迁移后聊天快照仍可修复', async () => {
  const env = await hostEnvironment();
  let c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1); c.dispose();
  const file = env.files.get(env.ctx.chatId)!;
  const original = legacy(file);
  file[0].chat_metadata.variables.solve.data.characters.alice.hp = 1;
  file[2].variables[0].solve.operations = [];
  env.ctx.chat = structuredClone(file.slice(1)); env.ctx.chatMetadata = structuredClone(file[0].chat_metadata);
  c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  assert.equal(c.getValue('@alice.hp'), 85);
  assert.equal(env.ctx.chatMetadata.variables.solve.data.characters.alice.hp, 85);
  assert.equal(env.ctx.chat[1]!.variables[0].solve.operations.length, 1);
  const repaired = env.files.get(env.ctx.chatId)!;
  assert.deepEqual(archiveFromChat(repaired[0].chat_metadata, repaired.slice(1)), original);
  assert.equal(((await restore(original, c.getStatus().headId!)).data.characters as any).alice.hp, 85);
  c.dispose();
});

test('切聊天分别恢复自己的快照，预演不改变变量或正式快照', async () => {
  const env = await hostEnvironment();
  const sessions = new SolveSessionManager(() => env.ctx, env.fetcher);
  await sessions.register(env.def, { characters: ['test.png'], attach: { cache: false } });
  env.addReply(); await sessions.controller!.processMessage(1);
  const firstSession = env.ctx.chatMetadata.solve.sessionId;
  env.switchChat('second-chat'); await env.emit('chat'); await sessions.settled();
  assert.notEqual(env.ctx.chatMetadata.solve.sessionId, firstSession);
  assert.equal(env.ctx.chatMetadata.variables.solve.data.characters.alice.hp, 100);
  env.switchChat('controller-test'); await env.emit('chat'); await sessions.settled();
  assert.equal(env.ctx.chatMetadata.solve.sessionId, firstSession);
  assert.equal(env.ctx.chatMetadata.variables.solve.data.characters.alice.hp, 85);
  const before = JSON.stringify({ chat: env.ctx.chat, meta: env.ctx.chatMetadata });
  await sessions.controller!.preview({ $inc: { '@alice.hp': -1 } });
  assert.equal(JSON.stringify({ chat: env.ctx.chat, meta: env.ctx.chatMetadata }), before);
  sessions.dispose();
});

test('重新读取补回被删除的变量，删除末楼后快照随剩余链恢复', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1);
  const stored = env.files.get(env.ctx.chatId)!;
  delete stored[0].chat_metadata.variables;
  await c.refresh();
  assert.equal(env.files.get(env.ctx.chatId)![0].chat_metadata.variables.solve.data.characters.alice.hp, 85);
  assert.equal(readToken(env.files.get(env.ctx.chatId)![2].variables[0].solve.commit.id), c.getStatus().headId);
  env.ctx.chat.pop(); await env.emit('delete');
  assert.equal(env.ctx.chatMetadata.variables.solve.data.characters.alice.hp, 100);
  env.saveNative(); await c.refresh();
  assert.equal(env.files.get(env.ctx.chatId)![0].chat_metadata.variables.solve.data.characters.alice.hp, 100);
  c.dispose();
});
