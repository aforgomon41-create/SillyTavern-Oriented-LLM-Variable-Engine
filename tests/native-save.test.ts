import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { hostEnvironment } from './host-fixture.js';
import { installRuntime } from '../src/host/install.js';
import { hash } from '../src/json.js';
import type { HostContext } from '../src/host/sillytavern.js';

async function fixture() {
  const env = await hostEnvironment();
  const fetcher = (async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : 'url' in input ? input.url : input.href, 'http://localhost:11451');
    if (url.pathname === '/version') return env.fetcher('/version');
    const request = new Request(typeof input === 'object' && 'clone' in input ? input.clone() : url, options);
    const bytes = Buffer.from(await request.arrayBuffer());
    const text = request.headers.get('content-encoding') === 'gzip' ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
    return env.fetcher(url.pathname, { method: 'POST', body: text });
  }) as typeof fetch;
  const make = (ctx: HostContext) => {
    const scope = { SillyTavern: { getContext: () => ctx }, location: new URL('http://localhost:11451/'), fetch: fetcher, crypto };
    return { scope, api: installRuntime({ scope, native: true }) };
  };
  const one = make(env.ctx); await one.api.register(env.def, { characters: ['test.png'] });
  const secondContext: HostContext = { ...env.ctx, chat: structuredClone(env.ctx.chat), chatMetadata: structuredClone(env.ctx.chatMetadata),
    eventSource: undefined, macros: undefined, updateChatMetadata: metadata => { secondContext.chatMetadata = metadata; } };
  const two = make(secondContext); await two.api.register(env.def, { characters: ['test.png'] });
  const body = (ctx: HostContext) => JSON.stringify({ file_name: ctx.chatId, avatar_url: 'test.png', ch_name: '测试', force: false,
    chat: [{ chat_metadata: ctx.chatMetadata }, ...ctx.chat] });
  return { env, one, two, secondContext, body };
}

for (const format of ['json', 'gzip', 'request']) test(`旧标签页原生保存不能覆盖其他标签页的新提交（${format}）`, async () => {
  const { env, one, two, secondContext, body } = await fixture();
  await one.api.controller!.submit({ $inc: { '@alice.hp': -1 } });
  const before = await hash(env.files.get(env.ctx.chatId));
  secondContext.chat.push({ is_user: true, mes: '旧标签页编辑的文本', extra: {} });
  const text = body(secondContext), options: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text };
  if (format === 'gzip') { options.headers = { ...options.headers, 'Content-Encoding': 'gzip' }; options.body = new Blob([gzipSync(text)]); }
  const input = format === 'request' ? new Request('http://localhost:11451/api/chats/save', options) : '/api/chats/save';
  await assert.rejects(two.scope.fetch(input, format === 'request' ? undefined : options), /其他标签页.*原生保存已阻止/u);
  assert.equal(await hash(env.files.get(env.ctx.chatId)), before);
  assert.equal(one.api.controller!.getValue('@alice.hp'), 99);
  assert.equal(two.api.controller!.ready, false);
  one.api.detach(); two.api.detach();
});

test('本页原生删楼后更新保存基线，重载与后续 SOLVE 提交继续正常', async () => {
  const { env, one, two, body } = await fixture(); two.api.detach();
  env.addReply(); await one.api.controller!.processMessage(1);
  env.ctx.chat.pop(); await env.emit('delete');
  const response = await one.scope.fetch('/api/chats/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(env.ctx) });
  assert.equal(response.ok, true);
  await one.api.controller!.refresh(); assert.equal(one.api.controller!.getValue('@alice.hp'), 100);
  await one.api.controller!.submit({ $inc: { '@alice.hp': -2 } });
  assert.equal(one.api.controller!.getValue('@alice.hp'), 98); one.api.detach();
});

test('未绑定聊天的原生请求保持可用', async () => {
  const { env, one, two } = await fixture(); one.api.detach(); two.api.detach();
  const response = await one.scope.fetch('/api/chats/save', { method: 'POST', body: JSON.stringify({ file_name: 'unbound', avatar_url: 'test.png', chat: [{ chat_metadata: {} }, { mes: '普通聊天' }] }) });
  assert.equal(response.ok, true); assert.equal(env.files.get('unbound')![1].mes, '普通聊天');
});

for (const strip of [false, true]) test(`旧页切换/解绑后的延迟原生保存仍受保护（归档${strip ? '缺失' : '过期'}）`, async () => {
  const { env, one, two, secondContext, body } = await fixture();
  const payload = JSON.parse(body(secondContext));
  await one.api.controller!.submit({ $inc: { '@alice.hp': -1 } });
  const before = await hash(env.files.get(env.ctx.chatId)); two.api.detach();
  if (strip) { delete payload.chat[0].chat_metadata.solve; for (const message of payload.chat.slice(1)) { delete message.extra?.solve; delete message.variables; } }
  await assert.rejects(two.scope.fetch('/api/chats/save', { method: 'POST', body: JSON.stringify(payload) }), /原生保存已阻止/u);
  assert.equal(await hash(env.files.get(env.ctx.chatId)), before); one.api.detach();
});

test('解绑后相同归档的文本保存可用，新分支可以携带现有历史', async () => {
  const { env, one, two, secondContext, body } = await fixture(); one.api.detach(); two.api.detach();
  secondContext.chat.push({ is_user: true, mes: '只改普通文字', extra: {} });
  const payload = JSON.parse(body(secondContext));
  assert.equal((await two.scope.fetch('/api/chats/save', { method: 'POST', body: JSON.stringify(payload) })).ok, true);
  payload.file_name = 'copied-branch';
  assert.equal((await two.scope.fetch('/api/chats/save', { method: 'POST', body: JSON.stringify(payload) })).ok, true);
  assert.equal(env.files.get('copied-branch')![2].mes, '只改普通文字');
  assert.deepEqual(env.files.get('copied-branch')![0].chat_metadata.solve, env.files.get(env.ctx.chatId)![0].chat_metadata.solve);
});

test('旧页重读归档失败不能推进原生保存基线并重新覆盖新历史', async () => {
  const { env, one, two, secondContext, body } = await fixture();
  await one.api.controller!.submit({ $inc: { '@alice.hp': -1 } });
  const before = await hash(env.files.get(env.ctx.chatId));
  await assert.rejects(two.api.controller!.submit({ $inc: { '@alice.hp': -2 } }), /其他实例/u);
  await two.api.controller!.discardPending();
  await assert.rejects(two.api.controller!.refresh(), /过期|重新加载/u);
  secondContext.chat.push({ is_user: true, mes: '失败重读后的原生保存', extra: {} });
  await assert.rejects(two.scope.fetch('/api/chats/save', { method: 'POST', body: body(secondContext) }), /原生保存已阻止/u);
  assert.equal(await hash(env.files.get(env.ctx.chatId)), before); one.api.detach(); two.api.detach();
});
