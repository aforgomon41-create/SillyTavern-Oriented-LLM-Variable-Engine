import test from 'node:test';
import assert from 'node:assert/strict';
import { hostEnvironment, setup } from './host-fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';
import { archiveFromChat } from '../src/host/sillytavern.js';
import { readToken } from '../src/host/storage-tokens.js';
import { restore } from '../src/history.js';
import { hash } from '../src/json.js';
import type { HostContext } from '../src/host/sillytavern.js';

for (const removeCurrent of [false, true]) for (const helper of [false, true]) {
  test(`原生删除${removeCurrent ? '当前' : '非当前'}Swipe时处理事件早于显示切换，助手变量${helper ? '先同步' : '不参与'}`, async () => {
    const env = await hostEnvironment();
    if (helper) env.ctx.eventSource!.on('swipeDeleted', (event: any) => env.ctx.chat[event.messageId]!.variables.splice(event.swipeId, 1));
    const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
    const index = env.addReply(); await c.processMessage(index);
    const message = env.ctx.chat[index]!, first = c.runtime.headId;
    message.swipe_id = 1; message.swipes!.push('<solve_operate>{"$inc":{"@alice.hp":-30}}</solve_operate>');
    message.swipe_info!.push({ extra: structuredClone(message.extra) }); message.mes = message.swipes![1]!;
    message.extra = structuredClone(message.swipe_info![1]!.extra);
    await env.emit('swipe', index); await c.processMessage(index);
    const second = c.runtime.headId, remove = removeCurrent ? 1 : 0;
    message.swipes!.splice(remove, 1); message.swipe_info!.splice(remove, 1); message.swipe_id = 0;
    // Match script.js: the old .mes/.extra still exist at this exact event boundary.
    await env.emit('swipeDeleted', { messageId: index, swipeId: remove, newSwipeId: 0 });
    assert.equal(c.getStatus().ready, true, c.getStatus().reason);
    assert.equal(c.runtime.headId, removeCurrent ? first : second);
    assert.equal(c.getValue('@alice.hp'), removeCurrent ? 85 : 70);
    assert.equal(readToken(message.variables[0].solve.commit.id), c.runtime.headId);
    env.saveNative(); await c.refresh();
    const file = env.files.get(env.ctx.chatId)!, archive = archiveFromChat(file[0].chat_metadata, file.slice(1))!;
    assert.deepEqual(await restore(archive, c.runtime.headId), c.getState()); c.dispose();
  });
}

test('停止发生在结束与渲染之间时不提交，下一次重新生成与重复结束仅执行一次', async () => {
  const env = await hostEnvironment();
  env.ctx.eventTypes!.CHARACTER_MESSAGE_RENDERED = 'rendered'; env.ctx.saveChat = async () => { env.saveNative(); };
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  await env.emit('start', 'normal', {}, false); env.addReply();
  const ended = env.emit('end'); await env.emit('stop'); await ended;
  assert.equal(c.getValue('@alice.hp'), 100); assert.equal(c.busy, false);
  await env.emit('start', 'regenerate', {}, false); const regenerated = env.emit('end'); await env.emit('rendered'); await regenerated;
  assert.equal(c.getValue('@alice.hp'), 85); const head = c.runtime.headId;
  await env.emit('end'); assert.equal(c.runtime.headId, head); c.dispose();
});

test('独立模型被取消后忽略不合作的迟到响应，后续请求可成功', async () => {
  let resolve!: (value: string) => void, started!: () => void, calls = 0;
  const waiting = new Promise<void>(done => { started = done; });
  const env = await setup({ mode: 'out-of-band', operatorRequest: async () => {
    calls++; if (calls === 1) { started(); return new Promise<string>(done => { resolve = done; }); }
    return '{"$inc":{"@alice.hp":-10}}';
  } });
  const index = env.addReply(); const first = env.controller.processMessage(index); await waiting;
  env.controller.cancelOperator(); await assert.rejects(first, /取消/u);
  resolve('{"$inc":{"@alice.hp":-99}}'); await Promise.resolve();
  assert.equal(env.controller.getValue('@alice.hp'), 100); assert.equal(env.controller.busy, false);
  await env.controller.processMessage(index); assert.equal(env.controller.getValue('@alice.hp'), 90); env.controller.dispose();
});

test('另一客户端提交后，过期页面重新检查不能以旧正文覆盖新操作；重载后可继续', async () => {
  const env = await hostEnvironment();
  const first = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  const secondContext: HostContext = { ...env.ctx, chat: structuredClone(env.ctx.chat), chatMetadata: structuredClone(env.ctx.chatMetadata),
    macros: undefined, eventSource: undefined, updateChatMetadata: metadata => { secondContext.chatMetadata = metadata; } };
  const second = await attachSillyTavern(env.def, () => secondContext, { cache: false }, env.fetcher);
  await first.submit({ $inc: { '@alice.hp': -1 } }, { actionId: 'first-client' });
  const saved = structuredClone(env.files.get(env.ctx.chatId)!);
  await assert.rejects(second.submit({ $inc: { '@alice.hp': -2 } }, { actionId: 'second-client' }), /其他实例/u);
  await second.discardPending();
  await assert.rejects(second.refresh(), /重新加载聊天|过期/u);
  assert.equal(second.ready, false);
  assert.equal(await hash(env.files.get(env.ctx.chatId)), await hash(saved));
  second.dispose();
  secondContext.chat = structuredClone(saved.slice(1)); secondContext.chatMetadata = structuredClone(saved[0].chat_metadata);
  const reloaded = await attachSillyTavern(env.def, () => secondContext, { cache: false }, env.fetcher);
  await reloaded.submit({ $inc: { '@alice.hp': -2 } }, { actionId: 'second-after-reload' });
  assert.equal(reloaded.getValue('@alice.hp'), 97); reloaded.dispose(); first.dispose();
});
