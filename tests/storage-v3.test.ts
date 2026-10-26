import test from 'node:test';
import assert from 'node:assert/strict';
import { hostEnvironment } from './host-fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';
import { archiveFromChat } from '../src/host/sillytavern.js';
import { expandPointers } from '../src/host/storage-pointers.js';
import { readToken, storeToken } from '../src/host/storage-tokens.js';
import { messageVariableView } from '../src/host/variables.js';
import { headKey, restore } from '../src/history.js';
import { hash } from '../src/json.js';

test('短编码保留全部UUID与SHA256位，保留前缀的自定义编号也能无损往返', async () => {
  const values = ['c:custom', 'h:literal', '~', '~~literal', 'normal-action', '',
    'sha256:' + '00'.repeat(32), 'model:sha256:' + 'ff'.repeat(32),
    ...['commit', 'message', 'swipe', 'session', 'genesis', 'generation'].map(prefix => prefix + '_' + crypto.randomUUID())];
  for (const value of values) assert.equal(readToken(storeToken(value)), value);
  assert.equal(storeToken('sha256:' + 'ff'.repeat(32)).length, 45);
  assert.throws(() => readToken('c:bad'), /长度|编码/u);
  assert.throws(() => readToken('h:' + 'A'.repeat(42) + 'B'), /尾位/u);
});

test('共享校验表保留四种完整校验，损坏摘要或索引都会被拒绝', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1); await c.submit({ $inc: { '@alice.hp': -1 } });
  const file = env.files.get(env.ctx.chatId)!, storage = file[0].chat_metadata.solve.storage;
  assert.ok(storage.hashes.length < Object.keys(c.runtime.archive.commits).length * 4);
  assert.deepEqual(archiveFromChat(file[0].chat_metadata, file.slice(1)), c.runtime.archive);
  const altered = structuredClone(file), current = altered[2].variables[0].solve;
  altered[0].chat_metadata.solve.storage.hashes[current.commit.checks[2]] = storeToken(await hash({ tampered: true }));
  await assert.rejects(restore(archiveFromChat(altered[0].chat_metadata, altered.slice(1))!, c.runtime.headId), /操作记录被修改/u);
  current.commit.checks[2] = -1;
  assert.throws(() => archiveFromChat(altered[0].chat_metadata, altered.slice(1)), /校验索引/u);
  c.dispose();
});

test('格式2的所有旧修订与模块事件可转换到格式3，保留完整身份与历史', async () => {
  const env = await hostEnvironment();
  let c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1); await c.submit({ $inc: { '@alice.hp': -1 } }, { authorInputs: { label: 'h:literal' } });
  await c.setModule('combat', false);
  const original = c.runtime.archive, file = env.files.get(env.ctx.chatId)!;
  c.dispose(); expandPointers(file.slice(1));
  for (const message of file.slice(1)) for (const extra of [message.extra, ...(message.swipe_info ?? []).map((info: any) => info.extra)]) {
    if (!extra?.solve) continue;
    const saved = extra.solve;
    extra.solve = { messageId: saved.messageId, swipeId: saved.swipeId, nativeIndex: saved.nativeIndex, headId: saved.headId };
  }
  const { commits: _commits, ...header } = original;
  const records = Object.values(original.commits);
  const contexts = records.map(record => ({ genesisId: record.genesisId, semantics: record.semantics, chatId: record.binding.chatId }));
  file[0].chat_metadata.solve = { ...header, storage: { version: 2, contexts } };
  for (const message of file.slice(1)) {
    for (const [index, variables] of Object.entries(message.variables ?? {}) as [string, any][]) {
      if (!variables.solve) continue;
      const pointer = Number(index) === (message.swipe_id ?? 0) ? message.extra.solve : message.swipe_info[Number(index)].extra.solve;
      const selected = original.commits[pointer.headId]!;
      const encode = (record: typeof selected) => {
        const view = messageVariableView(record);
        return { ...view, version: 2, commit: { ...view.commit, context: records.findIndex(value => value.id === record.id) } };
      };
      const history = records.filter(record => headKey(record.binding) === headKey(selected.binding) && record.id !== selected.id).map(encode);
      variables.solve = { ...encode(selected), history };
    }
  }
  assert.deepEqual(archiveFromChat(file[0].chat_metadata, file.slice(1)), original);
  env.switchChat(env.ctx.chatId);
  c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  const converted = env.files.get(env.ctx.chatId)!;
  assert.equal(converted[0].chat_metadata.solve.storage.version, 3);
  assert.deepEqual(archiveFromChat(converted[0].chat_metadata, converted.slice(1)), original);
  c.dispose();
});

test('冷读取的短指针与新Swipe继承旧变量时仍隔离身份，不重复执行', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  env.addReply(); await c.processMessage(1);
  const firstHead = c.runtime.headId;
  env.switchChat(env.ctx.chatId);
  const message = env.ctx.chat[1]!;
  message.swipe_id = 1; message.swipes!.push('新回复<solve_operate>{"$inc":{"@alice.hp":-30}}</solve_operate>');
  message.swipe_info!.push({ extra: structuredClone(message.extra) });
  message.variables.push(structuredClone(message.variables[0]));
  message.mes = message.swipes![1]!;
  await env.emit('swipe', 1); await c.processMessage(1);
  assert.equal(c.getValue('@alice.hp'), 70);
  assert.equal(readToken(message.variables[0].solve.commit.id), firstHead);
  message.swipe_id = 0; message.mes = message.swipes![0]!; message.extra = structuredClone(message.swipe_info![0]!.extra);
  await env.emit('swipe', 1);
  assert.equal(c.getValue('@alice.hp'), 85);
  c.dispose();
});

test('聊天快照只保留数据和执行状态，短提交编号可直接用于检查与比较', async () => {
  const env = await hostEnvironment();
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  const first = env.ctx.chat[0]!.variables[0].solve.commit.id;
  env.addReply(); await c.processMessage(1);
  const last = env.ctx.chat[1]!.variables[0].solve.commit.id;
  assert.deepEqual(Object.keys(env.ctx.chatMetadata.variables.solve).sort(), ['data', 'engineState', 'headId', 'ready', 'stateHash']);
  assert.equal((await c.inspectCommit(last)).commit.id, c.runtime.headId);
  assert.ok((await c.compareCommits(first, last)).dataPatch.length > 0);
  const file = env.files.get(env.ctx.chatId)!;
  assert.equal(file[0].chat_metadata.solve.heads, undefined);
  assert.deepEqual(Object.keys(file[2].extra.solve), ['ref']);
  env.saveNative();
  const nativeSaved = env.files.get(env.ctx.chatId)!;
  assert.deepEqual(Object.keys(nativeSaved[2].extra.solve), ['ref']);
  assert.deepEqual(archiveFromChat(nativeSaved[0].chat_metadata, nativeSaved.slice(1)), c.runtime.archive);
  c.dispose();
});
