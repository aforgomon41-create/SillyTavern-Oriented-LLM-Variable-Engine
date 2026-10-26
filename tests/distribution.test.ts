import test from 'node:test';
import assert from 'node:assert/strict';
import { installRuntime } from '../src/host/install.js';
import { VERSION } from '../src/version.js';
import { hostEnvironment } from './host-fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';

test('1.19流式结束早于渲染与原生保存时，等待收尾再归档且仅执行一次', async () => {
  const env = await hostEnvironment();
  env.ctx.eventTypes!.CHARACTER_MESSAGE_RENDERED = 'render';
  let releaseSave!: () => void;
  const nativeSaving = new Promise<void>(resolve => { releaseSave = resolve; });
  env.ctx.saveChat = async () => { await nativeSaving; env.saveNative(); };
  const controller = await attachSillyTavern(env.def, () => env.ctx, {}, env.fetcher);
  await env.emit('start', 'normal', {}, false); env.addReply();
  const ended = env.emit('end');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(controller.busy, true);
  assert.equal(controller.getValue('@alice.hp'), 100);
  // A render hook appends text after the early ENDED notification.
  env.ctx.chat[1]!.mes += '\n宿主渲染完成';
  await env.emit('render', 1); releaseSave(); await ended;
  assert.equal(controller.getValue('@alice.hp'), 85);
  assert.equal(controller.getStatus().pendingCount, 0);
  await env.emit('end'); assert.equal(controller.getValue('@alice.hp'), 85);
  controller.dispose();
});

test('同页多载体共享唯一运行时，卡定义让位与停用恢复原生定义', async () => {
  const env = await hostEnvironment();
  const scope = { SillyTavern: { getContext: () => env.ctx }, fetch: env.fetcher, crypto };
  const native = installRuntime({ scope, native: true });
  await native.register(env.def, { characters: ['test.png'] });
  const first = native.controller!;
  const again = installRuntime({ scope });
  assert.equal(again, native);
  const lease = again.use({ kind: 'embedded' });
  await lease.register(env.def, { characters: ['test.png'] });
  assert.equal(lease.controller, native.controller);
  assert.notEqual(native.controller, first);
  assert.throws(() => first.getStatus(), /绑定期间聊天已切换/u);
  assert.equal(env.handlers.get('end')!.size, 1);
  assert.equal(native.distribution().providers.length, 1);
  await lease.dispose();
  assert.equal(native.controller?.getStatus().ready, true);
  assert.equal(env.handlers.get('end')!.size, 1);
  assert.equal(native.distribution().providers.length, 0);
  native.detach();
});

test('脚本载体独立运行和清理，不遗留监听器；已停用脚本不能重新注册', async () => {
  const env = await hostEnvironment();
  const scope = { SillyTavern: { getContext: () => env.ctx }, fetch: env.fetcher, crypto };
  const api = installRuntime({ scope });
  const script = api.use({ kind: 'dynamic' });
  await script.register(env.def, { characters: ['test.png'] });
  assert.equal(script.controller?.getStatus().ready, true);
  await script.dispose();
  assert.equal(api.controller, undefined);
  assert.equal([...env.handlers.values()].reduce((sum, set) => sum + set.size, 0), 0);
  await assert.rejects(script.register(env.def), /已停用/u);
  const next = api.use({ kind: 'embedded' });
  await next.register(env.def, { characters: ['test.png'] });
  assert.equal(next.controller?.getStatus().ready, true);
  await next.dispose();
});

test('版本不匹配和旧入口覆盖均明确拒绝', () => {
  assert.throws(() => installRuntime({ scope: { __SOLVE_RUNTIME_V1__: { api: { version: VERSION + '-old' } } } }), /版本冲突/u);
  assert.throws(() => installRuntime({ scope: { SOLVE: {} } }), /未参与握手/u);
});

test('同一原生定义可绑定多个角色而不丢失之前绑定', async () => {
  const env = await hostEnvironment();
  const api = installRuntime({ scope: { SillyTavern: { getContext: () => env.ctx }, fetch: env.fetcher, crypto }, native: true });
  await api.register(env.def, { characters: ['test.png'] });
  await api.register(env.def, { characters: ['another.png'] });
  assert.deepEqual(api.sessions.getStatus().registered[0]?.characters, ['test.png', 'another.png']);
  api.detach();
});

test('真实overswipe保留旧正文和extra时，新回复从父状态开始并可切回旧版本', async () => {
  const env = await hostEnvironment();
  const controller = await attachSillyTavern(env.def, () => env.ctx, {}, env.fetcher);
  env.addReply(); await controller.processMessage(1);
  const message = env.ctx.chat[1]!;
  assert.equal(controller.getValue('@alice.hp'), 85);
  // 1.19 increments swipe_id before Generate, retaining the prior mes/extra.
  message.swipe_id = message.swipes!.length;
  await env.emit('swipe', 1);
  assert.equal(controller.getStatus().ready, true);
  let blocked = false; controller.intercept([], 0, () => { blocked = true; });
  assert.equal(blocked, false);
  await env.emit('start', 'swipe', {}, false);
  message.mes = '另一回复。<solve_operate>{"$inc":{"@alice.hp":-25}}</solve_operate>';
  await env.emit('end');
  assert.equal(controller.getValue('@alice.hp'), 75);
  let notifications = 0; controller.subscribe(() => { notifications++; });
  message.swipe_id = 0; message.mes = message.swipes![0]!;
  message.extra = structuredClone(message.swipe_info![0]!.extra);
  await env.emit('swipe', 1);
  assert.equal(controller.getValue('@alice.hp'), 85);
  assert.ok(notifications > 0, 'Swipe恢复后需要通知调试面板');
  controller.dispose();
});
