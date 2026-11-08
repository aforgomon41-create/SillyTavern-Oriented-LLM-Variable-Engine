import test from 'node:test';
import assert from 'node:assert/strict';
import { hostEnvironment } from './host-fixture.js';
import { installRuntime } from '../src/host/install.js';
import { hash } from '../src/index.js';

async function fixture() {
  const env = await hostEnvironment();
  const scope = { SillyTavern: { getContext: () => env.ctx }, location: new URL('http://localhost:11451/'), fetch: env.fetcher, crypto };
  const api = installRuntime({ scope, native: true }); await api.register(env.def, { characters: ['test.png'] });
  return { ...env, scope, api };
}
test('SOLVE开局已是固定历史，角色编辑/PNG导出不应重建未使用的开场消息', async () => {
  const env = await fixture();
  assert.equal(env.ctx.chatMetadata.tainted, true);
  assert.equal(env.files.get(env.ctx.chatId)![0].chat_metadata.tainted, true);
  await env.api.controller!.submit({ $inc: { '@alice.hp': -5 } });
  assert.equal(env.ctx.chatMetadata.tainted, true); assert.equal(env.api.controller!.getValue('@alice.hp'), 95);
  env.api.detach();
});
test('原生重新创建唯一开场时不得仅保留聊天头并丢失全部楼层历史', async () => {
  const env = await fixture(); await env.api.controller!.submit({ $inc: { '@alice.hp': -5 } });
  const before = await hash(env.files.get(env.ctx.chatId));
  // Match 1.19 createOrEditCharacter: replace the sole greeting with a fresh message/extra.
  env.ctx.chat = [{ mes: '重新生成的开场白', extra: {}, swipes: ['重新生成的开场白'], swipe_id: 0, swipe_info: [{ extra: {} }] }];
  const body = { file_name: env.ctx.chatId, avatar_url: 'test.png', ch_name: '测试',
    chat: [{ chat_metadata: env.ctx.chatMetadata }, ...env.ctx.chat] };
  await assert.rejects(env.scope.fetch('/api/chats/save', { method: 'POST', body: JSON.stringify(body) }), /开场消息|全部SOLVE历史/u);
  assert.equal(await hash(env.files.get(env.ctx.chatId)), before); env.api.detach();
});
test('载入旧聊天会补写开场保护标记，不增加提交或重新执行动作', async () => {
  const env = await fixture(); await env.api.controller!.submit({ $inc: { '@alice.hp': -5 } });
  const count = env.api.controller!.getHistory().length, head = env.api.controller!.runtime.headId;
  env.api.detach(); delete env.ctx.chatMetadata.tainted; delete env.files.get(env.ctx.chatId)![0].chat_metadata.tainted;
  await env.api.register(env.def, { characters: ['test.png'] });
  assert.equal(env.api.controller!.getValue('@alice.hp'), 95);
  assert.equal(env.api.controller!.getHistory().length, count); assert.equal(env.api.controller!.runtime.headId, head);
  assert.equal(env.ctx.chatMetadata.tainted, true); assert.equal(env.files.get(env.ctx.chatId)![0].chat_metadata.tainted, true); env.api.detach();
});
