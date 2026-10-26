import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';
import type { AttachOptions } from '../src/host/controller.js';
import type { HostContext, HostMessage } from '../src/host/sillytavern.js';
import { extractRawBlocks } from '../src/parser.js';

async function setup(options: AttachOptions = {}) {
  const { def } = await fixture();
  let file: any[] | undefined;
  let failAfterSave = false;
  const macros = new Map<string, any>(), handlers = new Map<string, Set<(...args: any[]) => unknown>>();
  const ctx: HostContext = { chatId: 'controller-test', characterId: 0, groupId: null,
    characters: [{ name: '测试', avatar: 'test.png' }], chat: [{ mes: '开场', extra: {} }], chatMetadata: { integrity: 'test' },
    getRequestHeaders: () => ({}), updateChatMetadata: m => { ctx.chatMetadata = m; },
    macros: { registry: { registerMacro: (name: string, opts: any) => { macros.set(name, opts); return opts; }, unregisterMacro: (name: string) => macros.delete(name) } },
    eventTypes: { GENERATION_STARTED: 'start', GENERATION_ENDED: 'end', GENERATION_STOPPED: 'stop', MESSAGE_SWIPED: 'swipe', CHAT_CHANGED: 'chat', MESSAGE_EDITED: 'edit' },
    eventSource: { on: (name, fn) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name)!.add(fn); }, removeListener: (name, fn) => { handlers.get(name)?.delete(fn); } } };
  const fetcher = (async (url: any, opts?: any) => {
    if (url === '/version') return Response.json({ pkgVersion: '1.19.0' });
    if (url === '/api/chats/get') return Response.json(file ?? {});
    if (url === '/api/chats/save') { file = JSON.parse(opts.body).chat; if (failAfterSave) throw new Error('保存响应丢失'); return Response.json({ ok: true }); }
    throw new Error(`未知请求${url}`);
  }) as typeof fetch;
  const controller = await attachSillyTavern(def, () => ctx, options, fetcher);
  const emit = async (name: string, ...args: any[]) => { for (const handler of handlers.get(name) ?? []) await handler(...args); };
  const addReply = (operations = '{"$inc":{"@alice.hp":-15}}') => {
    ctx.chat.push({ mes: `受伤。<solve_operate>${operations}</solve_operate>`, extra: {} });
    return ctx.chat.length - 1;
  };
  return { controller, ctx, emit, macros, addReply, setFail: (value: boolean) => { failAfterSave = value; } };
}
test('控制器生成事件、双格式宏与重复结束信号', async () => {
  const { controller, emit, macros, addReply } = await setup();
  await emit('start', 'normal', {}, false); addReply(); await emit('end');
  assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 85);
  const head = controller.runtime.headId; await emit('end'); assert.equal(controller.runtime.headId, head);
  assert.equal(JSON.parse(macros.get('solve_json').handler({ unnamedArgs: [] })).characters['@alice'].hp, 85);
  assert.ok(macros.get('solve_toon').handler({ unnamedArgs: [] }).includes('85'));
  controller.dispose(); assert.equal(macros.size, 0);
});
test('玩家并发两次动作按序归档，正文与累计动作一致', async () => {
  const { controller, ctx, addReply } = await setup();
  const index = addReply(); await controller.processMessage(index);
  await Promise.all([controller.submit({ $inc: { '@alice.hp': 5 } }, { actionId: 'user1', index }), controller.submit({ $inc: { '@alice.hp': 5 } }, { actionId: 'user2', index })]);
  assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 95);
  const raw = extractRawBlocks(ctx.chat[index]!.mes);
  const actions = JSON.parse(raw.mutual!);
  assert.deepEqual(actions.map((a: any) => a.actionId), ['user1', 'user2']);
  assert.equal(controller.runtime.archive.commits[controller.runtime.headId]!.actions.length, 3);
  controller.dispose();
});
test('操作模型使用独立请求，写回指令后执行，可超时释放忙碌', async () => {
  let prompt = '';
  const { controller, ctx } = await setup({ mode: 'out-of-band', operatorRequest: async p => { prompt = p; return '<solve_operate>{"$inc":{"@alice.hp":-20}}</solve_operate>'; } });
  ctx.chat.push({ mes: '剧情受伤。', extra: {} });
  await controller.processMessage(1);
  assert.ok(prompt.includes('@alice'));
  assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 80);
  assert.ok(ctx.chat[1]!.mes.includes('<solve_operate>'));
  assert.equal(controller.busy, false); controller.dispose();
  const slow = await setup({ mode: 'out-of-band', operatorTimeoutMs: 10, operatorRequest: async () => new Promise(() => {}) });
  slow.ctx.chat.push({ mes: '剧情。', extra: {} });
  await assert.rejects(slow.controller.processMessage(1), /超时/u);
  assert.equal(slow.controller.busy, false); slow.controller.dispose();
});
test('操作模型迟到响应在切聊天后不写入', async () => {
  let finish!: (text: string) => void;
  const { controller, ctx, emit } = await setup({ mode: 'out-of-band', operatorRequest: () => new Promise(r => { finish = r; }) });
  ctx.chat.push({ mes: '剧情。', extra: {} });
  const result = controller.processMessage(1);
  while (!finish) await new Promise(r => setTimeout(r, 1));
  ctx.chatId = 'another-chat'; await emit('chat');
  finish('{"$inc":{"@alice.hp":-30}}');
  await assert.rejects(result);
  assert.equal(controller.ready, false); controller.dispose();
});
test('切换Swipe恢复各自状态，新回复从上游开始而非重复扣血', async () => {
  const { controller, ctx, addReply, emit } = await setup();
  const index = addReply(); await controller.processMessage(index);
  const message = ctx.chat[index]!;
  const aExtra = structuredClone(message.extra), aText = message.mes;
  message.swipes!.push('另一个回复。<solve_operate>{"$inc":{"@alice.hp":-30}}</solve_operate>');
  message.swipe_info!.push({ extra: structuredClone(aExtra) }); message.swipe_id = 1;
  message.mes = message.swipes![1]!; message.extra = structuredClone(aExtra);
  await emit('swipe', index); await controller.processMessage(index);
  assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 70);
  message.swipe_id = 0; message.mes = aText; message.extra = structuredClone(message.swipe_info![0]!.extra);
  await emit('swipe', index);
  assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 85);
  controller.dispose();
});
test('忙碌时原生入口阻止生成，过滤只修改发送副本', async () => {
  let release!: (text: string) => void;
  const { controller, ctx } = await setup({ mode: 'out-of-band', operatorRequest: () => new Promise(r => { release = r; }) });
  ctx.chat.push({ mes: '剧情', extra: {} }); const task = controller.processMessage(1);
  while (!release) await new Promise(r => setTimeout(r, 1));
  let aborted = false; controller.intercept([], 1000, () => { aborted = true; }); assert.equal(aborted, true);
  release('{"$inc":{"@alice.hp":-10}}'); await task;
  const copy = structuredClone(ctx.chat); controller.intercept(copy, 1000, () => {});
  assert.equal(copy[1]!.mes, '剧情'); assert.ok(ctx.chat[1]!.mes.includes('<solve_operate>'));
  controller.dispose();
});
test('手改旧操作后显式重放，下游重新计算且旧历史可恢复', async () => {
  const { controller, ctx, emit, addReply } = await setup();
  const one = addReply(); const first = await controller.processMessage(one);
  const two = addReply('{"$inc":{"@alice.hp":-10}}'); await controller.processMessage(two);
  assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 75);
  ctx.chat[one]!.mes = '改为受伤25点。<solve_operate>{"$inc":{"@alice.hp":-25}}</solve_operate>';
  await emit('edit', one);
  await controller.replayFrom(one);
  assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 65);
  assert.ok(controller.runtime.archive.commits[first!.id]);
  controller.dispose();
});
test('中间楼层切Swipe后未重放的下游禁止直接接续和输出宏', async () => {
  const { controller, ctx, addReply, emit, macros } = await setup();
  const index = addReply(); await controller.processMessage(index);
  const message = ctx.chat[index]!, aExtra = structuredClone(message.extra);
  message.swipes!.push('另一回复。<solve_operate>{"$inc":{"@alice.hp":-30}}</solve_operate>');
  message.swipe_info!.push({ extra: structuredClone(aExtra) });
  const next = addReply('{"$inc":{"@alice.hp":-10}}'); await controller.processMessage(next);
  message.swipe_id = 1; message.mes = message.swipes![1]!; message.extra = structuredClone(aExtra);
  await emit('swipe', index); await controller.processMessage(index);
  assert.throws(() => macros.get('solve_json').handler({ unnamedArgs: [] }), /同一历史/u);
  let aborted = false; controller.intercept([], 1000, () => { aborted = true; }); assert.equal(aborted, true);
  await controller.replayFrom(next);
  assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 60);
  controller.dispose();
});
test('独立模型结果保存失败，重试复用草稿而不再次调用模型', async () => {
  let calls = 0;
  const { controller, ctx, setFail } = await setup({ mode: 'out-of-band', operatorRequest: async () => { calls++; return '{"$inc":{"@alice.hp":-20}}'; } });
  ctx.chat.push({ mes: '剧情受伤。', extra: {} });
  setFail(true); await assert.rejects(controller.processMessage(1), /响应丢失/u);
  setFail(false); await controller.processMessage(1);
  assert.equal(calls, 1); assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 80);
  controller.dispose();
});
