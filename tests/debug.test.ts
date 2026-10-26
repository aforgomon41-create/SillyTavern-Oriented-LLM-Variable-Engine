import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { IndexedDbCache, hash, restore } from '../src/index.js';
import { attachSillyTavern } from '../src/host/controller.js';
import { SolveSessionManager } from '../src/host/sessions.js';
import { setup, hostEnvironment } from './host-fixture.js';

test('用户或系统首楼不能成为操作与重放目标，拒绝时不写身份或 Swipe 元数据', async () => {
  const env = await hostEnvironment();
  env.ctx.chat.unshift({ mes: '系统消息', is_system: true, extra: {} }, { mes: '用户先发言', is_user: true, extra: {} });
  const untouched = structuredClone(env.ctx.chat.slice(0, 2));
  const c = await attachSillyTavern(env.def, () => env.ctx, { cache: false }, env.fetcher);
  try {
    assert.equal(c.getMessages().find(m => m.role === 'assistant')?.index, 2);
    for (const index of [0, 1]) {
      assert.equal(await c.processMessage(index), undefined);
      await assert.rejects(c.replayMessage(index), /角色回复/u);
      await assert.rejects(c.submit({ $inc: { '@alice.hp': -1 } }, { index }), /角色回复/u);
    }
    assert.deepEqual(env.ctx.chat.slice(0, 2), untouched);
    await c.submit({ $inc: { '@alice.hp': -1 } }, { index: 2 });
    const saved = env.files.get(env.ctx.chatId)!;
    assert.deepEqual(saved.slice(1, 3), untouched);
    assert.equal(saved[1].swipe_info, undefined);
    assert.equal(saved[2].extra.solve, undefined);
  } finally { c.dispose(); }
});

test('预演基线与目标楼层不同会在切换执行位置之前拒绝', async () => {
  const { controller: c, addReply, ctx } = await setup({ cache: false });
  try {
    const root = c.getStatus().headId!, index = addReply(); await c.processMessage(index);
    const latest = c.getStatus().headId!, text = ctx.chat[index]!.mes;
    await c.runtime.select(root);
    const preview = await c.preview({ $inc: { '@alice.hp': -1 } });
    assert.equal(c.getStatus().ready, false, '界面应阻止不对齐历史上的正式提交');
    await assert.rejects(c.submit({ $inc: { '@alice.hp': -1 } }, { expectedHead: preview.baseHeadId }), /状态已变化/u);
    assert.equal(c.runtime.headId, root, '失败不会静默切到最后一层');
    assert.equal(ctx.chat[index]!.mes, text);
    await c.runtime.select(latest);
    await assert.rejects(c.submit({ $inc: { '@alice.hp': -1 } }, { index: 0, expectedHead: latest }), /目标楼层/u);
    assert.equal(c.runtime.headId, latest);
    assert.equal(c.getPending().length, 0);
  } finally { c.dispose(); }
});

test('调试预演不保存，过期预演基线不能提交，读取与订阅不会暴露可写引用', async () => {
  const { controller, addReply } = await setup(); const index = addReply(); await controller.processMessage(index);
  let changes = 0; const unsub = controller.subscribe(() => { changes++; });
  const before = controller.runtime.headId, preview = await controller.preview({ $inc: { '@alice.hp': -5 } });
  assert.equal((preview.state.data.characters as any).alice.hp, 80); assert.equal(controller.getValue('@alice.hp'), 85);
  assert.equal(controller.runtime.headId, before);
  const copy = controller.getState(); (copy.data.characters as any).alice.hp = -999;
  assert.equal(controller.getValue('@alice.hp'), 85);
  await controller.submit({ $inc: { '@alice.hp': 1 } }, { index });
  assert.ok((await controller.compareCommits(before, controller.runtime.headId)).dataPatch.some(p => p.path.endsWith('/hp')));
  await assert.rejects(controller.submit({ $inc: { '@alice.hp': -5 } }, { index, expectedHead: preview.baseHeadId }), /状态已变化/u);
  assert.ok(changes > 0); unsub();
  const inspected = await controller.inspectCommit(before); assert.equal((inspected.state.data.characters as any).alice.hp, 85);
  assert.ok(inspected.entities.some(e => e.id === 'alice'));
  assert.ok((await controller.validateArchive()).every(r => r.valid));
  assert.ok(controller.getContextPreview({ view: 'operator' }).json.includes('@alice'));
  assert.ok(!JSON.stringify(controller.exportDebugReport()).includes('开场'));
  controller.dispose();
});

test('丢失保存响应后放弃草稿会确认已保存事实，编辑正文不能被重新读取绕过', async () => {
  const { controller, ctx, addReply, setFail, emit } = await setup(); const index = addReply(); await controller.processMessage(index);
  setFail(true); await assert.rejects(controller.submit({ $inc: { '@alice.hp': -5 } }, { index })); setFail(false);
  await controller.discardPending(); assert.equal(controller.getValue('@alice.hp'), 80); assert.equal(controller.getStatus().pendingCount, 0);
  assert.ok(controller.journal.read().some(e => e.code === 'ALREADY_ARCHIVED'));
  ctx.chat[index]!.mes = '<solve_operate>{"$inc":{"@alice.hp":-50}}</solve_operate>'; await emit('edit', index);
  await assert.rejects(controller.refresh(), /重放/u); assert.equal(controller.ready, false);
  controller.dispose();
});

test('缺少原作者定义时仍可只读检查 Patch 归档，不能用新版写入', async () => {
  const env = await setup(); const index = env.addReply(); await env.controller.processMessage(index); env.controller.dispose();
  const manager = new SolveSessionManager(() => env.ctx, env.fetcher);
  await manager.register({ ...env.def, version: 'new-version' }, { characters: ['test.png'] });
  assert.equal(manager.controller, undefined);
  const inspection = await manager.inspectArchive(); assert.equal(inspection.readonly, true); assert.equal((inspection.state!.data.characters as any).alice.hp, 85);
  manager.dispose();
});

test('控制器草稿跨刷新重试复用候选，放弃同步清理本地缓存', async () => {
  const cache = new IndexedDbCache(indexedDB, `debug-${crypto.randomUUID()}`);
  const env = await setup({ cache }); const { controller, ctx, addReply, setFailBefore, fetcher, def } = env;
  const index = addReply(); await controller.processMessage(index);
  setFailBefore(true); await assert.rejects(controller.submit({ $inc: { '@alice.hp': -5 } }, { actionId: 'draft', index }));
  assert.equal(controller.getStatus().pendingCount, 1); const candidate = controller.getPending()[0]!.commit.id;
  controller.dispose(); setFailBefore(false);
  const fresh = await attachSillyTavern(def, () => ctx, { cache }, fetcher);
  assert.equal(fresh.getStatus().pendingCount, 1);
  const saved = await fresh.retryPending(); assert.equal(saved.id, candidate); assert.equal(fresh.getValue('@alice.hp'), 80);
  setFailBefore(true); await assert.rejects(fresh.submit({ $inc: { '@alice.hp': -7 } }, { index }));
  setFailBefore(false); await fresh.discardPending(); assert.equal(fresh.getStatus().pendingCount, 0);
  assert.deepEqual(await cache.loadPending(fresh.runtime.sessionId), []);
  await fresh.rebuildCache(); await fresh.runtime.select(fresh.runtime.headId); assert.equal(fresh.getStatus().cache.source, 'snapshot');
  assert.equal(fresh.getValue('@alice.hp'), 80); fresh.dispose(); cache.close();
});

test('损坏本地草稿不阻止打开正式历史，显式放弃后可继续', async () => {
  const cache = new IndexedDbCache(indexedDB, `bad-draft-${crypto.randomUUID()}`);
  const { controller, ctx, def, fetcher } = await setup({ cache }); const sessionId = controller.runtime.sessionId;
  controller.dispose(); await cache.savePending(sessionId, [{ commit: { id: 'invalid' } }]);
  const fresh = await attachSillyTavern(def, () => ctx, { cache }, fetcher);
  assert.equal(fresh.getValue('@alice.hp'), 100); assert.equal(fresh.getStatus().pendingCount, 1);
  assert.ok(fresh.getStatus().pendingImportError); await fresh.discardPending(); assert.equal(fresh.getStatus().pendingCount, 0);
  fresh.dispose(); cache.close();
});

test('原生删除末尾楼层可继续生成，删除中间楼层保留旧祖先并可重放', async () => {
  const { controller, ctx, addReply, emit, saveNative } = await setup();
  const first = addReply(); const a = await controller.processMessage(first); const second = addReply(); await controller.processMessage(second);
  await emit('start', 'regenerate', {}, false); ctx.chat.pop(); await emit('delete', ctx.chat.length); saveNative();
  assert.equal(controller.ready, true); assert.equal(controller.getValue('@alice.hp'), 85);
  addReply('{"$inc":{"@alice.hp":-10}}'); saveNative(); await emit('end'); assert.equal(controller.getValue('@alice.hp'), 75);
  ctx.chat.splice(first, 1); await emit('delete', ctx.chat.length); saveNative();
  assert.equal(controller.ready, false); assert.ok(controller.getStatus().reason.includes('中间历史'));
  await controller.replayFrom(1); assert.equal(controller.getValue('@alice.hp'), 90);
  assert.equal((await restore(controller.runtime.archive, a!.id)).data.characters && ((await restore(controller.runtime.archive, a!.id)).data.characters as any).alice.hp, 85);
  controller.dispose();
});

test('离线改过操作及不一致分支仍可打开调试控制器并显式修复', async () => {
  const { controller, ctx, addReply, def, fetcher, saveNative } = await setup();
  const first = addReply(); await controller.processMessage(first); controller.dispose();
  ctx.chat[first]!.mes = '<solve_operate>{"$inc":{"@alice.hp":-30}}</solve_operate>'; saveNative();
  const fresh = await attachSillyTavern(def, () => ctx, {}, fetcher); assert.equal(fresh.ready, false);
  assert.equal((await fresh.inspectCommit()).commit.id, fresh.runtime.headId);
  await fresh.replayFrom(first); assert.equal(fresh.getValue('@alice.hp'), 70); fresh.dispose();
});

test('停止生成与独立连接预设路径可观察，渲染过滤不修改原文', async () => {
  const { controller, ctx, emit, addReply, hooks } = await setup({ mode: 'out-of-band', operatorProfileId: 'test-profile' });
  let seen = false;
  ctx.ConnectionManagerRequestService = { sendRequest: async (...args: any[]) => { seen = args[0] === 'test-profile' && args[3].signal instanceof AbortSignal; return { content: '{"$inc":{"@alice.hp":-2}}' }; } };
  await emit('start', 'normal', {}, false); addReply(); await emit('stop'); await emit('end'); assert.equal(controller.getValue('@alice.hp'), 100);
  await controller.processMessage(1); assert.equal(seen, true); assert.equal(controller.getValue('@alice.hp'), 98);
  assert.ok(ctx.chat[1]!.mes.includes('<solve_operate>')); assert.ok(!hooks[0]!(ctx.chat[1]!.mes).includes('<solve_operate>'));
  assert.ok(controller.journal.read().some(e => e.code === 'OPERATOR_COMPLETED'));
  controller.dispose();
});

test('会话管理自动切换且只初始化指定角色，旧定义按指纹恢复', async () => {
  const env = await hostEnvironment(); const manager = new SolveSessionManager(() => env.ctx, env.fetcher);
  await manager.register(env.def, { characters: ['test.png'], attach: { cache: false } });
  assert.ok(manager.controller); const first = manager.controller!; const index = env.addReply(); await first.processMessage(index);
  const aHash = await hash(first.getState()); env.saveNative();
  env.switchChat('second'); await env.emit('chat'); await manager.settled(); assert.notEqual(manager.controller, first);
  assert.equal(manager.controller!.getValue('@alice.hp'), 100);
  env.switchChat('controller-test'); await env.emit('chat'); await manager.settled(); assert.equal(await hash(manager.controller!.getState()), aHash);
  env.ctx.characterId = 1; (env.ctx.characters as any[]).push({ name: '未绑定', avatar: 'other.png' }); env.switchChat('unbound');
  await env.emit('chat'); await manager.settled(); assert.equal(manager.controller, undefined); assert.equal(manager.getStatus().phase, 'unbound');
  manager.dispose(); assert.equal(env.macros.size, 0);
});

test('快速切聊天使未完成的旧绑定作废，不写入已离开的聊天', async () => {
  const env = await hostEnvironment(); let release!: () => void, reached!: () => void;
  const started = new Promise<void>(r => { reached = r; });
  const fetcher = (async (url: any, opts: any) => {
    if (url === '/api/chats/get' && JSON.parse(opts.body).file_name === 'slow') { reached(); await new Promise<void>(r => { release = r; }); }
    return env.fetcher(url, opts);
  }) as typeof fetch;
  const manager = new SolveSessionManager(() => env.ctx, fetcher);
  await manager.register(env.def, { characters: ['test.png'], attach: { cache: false } });
  env.switchChat('slow'); await env.emit('chat'); const oldTask = manager.settled(); await started;
  env.switchChat('latest'); await env.emit('chat'); await manager.settled(); release(); await oldTask;
  assert.equal(manager.controller?.boundChatId, 'latest'); assert.equal(env.files.has('slow'), false);
  assert.equal(env.handlers.get('start')?.size, 1); assert.equal(env.macros.size, 6); manager.dispose();
});

test('支持 IndexedDB 的默认接入自动启用缓存', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDB });
  try {
    const { controller } = await setup(); assert.equal(controller.getStatus().cache.enabled, true); controller.dispose();
  } finally { if (old) Object.defineProperty(globalThis, 'indexedDB', old); else delete (globalThis as any).indexedDB; }
});

test('删除事件保留待保存草稿，处理草稿后才能恢复和继续', async () => {
  const { controller, ctx, addReply, emit, setFailBefore, saveNative } = await setup(); const index = addReply(); await controller.processMessage(index);
  setFailBefore(true); await assert.rejects(controller.submit({ $inc: { '@alice.hp': -5 } }, { index })); setFailBefore(false);
  ctx.chat.pop(); await emit('delete', ctx.chat.length); saveNative();
  assert.equal(controller.getStatus().pendingCount, 1); assert.equal(controller.ready, false);
  await controller.discardPending(); await controller.refresh(); assert.equal(controller.getValue('@alice.hp'), 100); controller.dispose();
});

test('多楼重放中途失败会阻止继续写入混合历史，修复后可接续重放', async () => {
  const { controller, ctx, addReply, emit } = await setup(); const one = addReply(); await controller.processMessage(one); const two = addReply(); await controller.processMessage(two);
  ctx.chat[one]!.mes = '<solve_operate>{"$inc":{"@alice.hp":-30}}</solve_operate>'; await emit('edit', one);
  const oldText = ctx.chat[two]!.mes; ctx.chat[two]!.mes += '<solve_mutual_operate>invalid</solve_mutual_operate>';
  await assert.rejects(controller.replayFrom(one)); assert.equal(controller.ready, false);
  await assert.rejects(controller.submit({ $inc: { '@alice.hp': -5 } }), /尚未绑定并恢复/u);
  ctx.chat[two]!.mes = oldText; await controller.replayFrom(two); assert.equal(controller.getValue('@alice.hp'), 55); controller.dispose();
});

test('重放保存失败的候选跨刷新重试不重新执行作者校验', async () => {
  const cache = new IndexedDbCache(indexedDB, `replay-draft-${crypto.randomUUID()}`);
  const env = await hostEnvironment(); let calls = 0; env.def.validateState = () => { calls++; };
  const controller = await attachSillyTavern(env.def, () => env.ctx, { cache }, env.fetcher);
  const index = env.addReply(); await controller.processMessage(index);
  env.ctx.chat[index]!.mes = '<solve_operate>{"$inc":{"@alice.hp":-30}}</solve_operate>'; await env.emit('edit', index);
  env.setFailBefore(true); await assert.rejects(controller.replayMessage(index)); const candidate = controller.getPending()[0]!;
  assert.equal(candidate.prepared, true); const before = calls; controller.dispose(); env.setFailBefore(false);
  const fresh = await attachSillyTavern(env.def, () => env.ctx, { cache }, env.fetcher);
  const result = await fresh.retryPending(); assert.equal(result.id, candidate.commit.id); assert.equal(calls, before); assert.equal(fresh.getValue('@alice.hp'), 70);
  fresh.dispose(); cache.close();
});
