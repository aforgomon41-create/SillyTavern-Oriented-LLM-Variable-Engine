import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRawBlocks } from '../src/parser.js';

import { hostEnvironment, setup } from './host-fixture.js';
import { fixture } from './fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';
import { SolveSessionManager } from '../src/host/sessions.js';

test('原生重新载入同名聊天后重建控制器，可继续提交且保留确认历史', async () => {
  const env = await hostEnvironment(), manager = new SolveSessionManager(() => env.ctx, env.fetcher);
  try {
    await manager.register(env.def, { characters: ['test.png'], attach: { cache: false } });
    const before = manager.controller!; await before.submit({ $inc: { '@alice.hp': -1 } }); const head = before.runtime.headId;
    env.switchChat(env.ctx.chatId); await env.emit('chat'); await manager.settled();
    assert.notEqual(manager.controller, before); assert.equal(manager.controller!.ready, true); assert.equal(manager.controller!.runtime.headId, head);
    await manager.controller!.submit({ $inc: { '@alice.hp': -1 } }); assert.equal(manager.controller!.getValue('@alice.hp'), 98);
  } finally { manager.dispose(); }
});

test('普通定义恢复中的重复同聊天事件合并，不互相废弃绑定任务', async () => {
  const env = await hostEnvironment(); let release!: () => void, entered!: () => void, reads = 0;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const fetcher = (async (url: any, options?: any) => { if (url === '/api/chats/get' && ++reads === 1) { entered(); await gate; } return env.fetcher(url, options); }) as typeof fetch;
  const manager = new SolveSessionManager(() => env.ctx, fetcher);
  try {
    const pending = manager.register(env.def, { characters: ['test.png'], attach: { cache: false } }); await started;
    const events = Promise.all([env.emit('chat'),env.emit('chat')]); await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 1);
    release(); await pending; await events; await manager.settled();
    assert.equal(manager.controller!.ready, true); assert.equal(reads, 5); assert.equal(manager.journal.read().filter(row => row.code === 'SESSION_ATTACHED').length, 1);
  } finally { release?.(); manager.dispose(); }
});

test('宿主先切聊天再渲染再发事件时，就绪探测和格式化钩子不抛出旧绑定错误', async () => {
  const env = await hostEnvironment(); let stale = false;
  const c = await attachSillyTavern(env.def, () => { if (stale) throw new Error('绑定期间聊天已切换'); return env.ctx; }, { cache: false }, env.fetcher);
  try {
    stale = true; assert.equal(c.ready, false);
    const text = '正文<solve_operate>{}</solve_operate>'; assert.equal(env.hooks[0]!(text), text);
    await assert.rejects(c.submit({}), /绑定期间聊天已切换/u);
  } finally { stale = false; c.dispose(); }
});

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
test('忙碌时原生入口等 SOLVE 忙完再发送，从不中止；过滤只修改发送副本', async () => {
  let release!: (text: string) => void;
  const { controller, ctx } = await setup({ mode: 'out-of-band', operatorRequest: () => new Promise(r => { release = r; }) });
  ctx.chat.push({ mes: '剧情', extra: {} }); const task = controller.processMessage(1);
  while (!release) await new Promise(r => setTimeout(r, 1));
  let aborted = false, sent = false;
  const waiting = controller.intercept([], 1000, () => { aborted = true; }).then(() => { sent = true; });
  await new Promise(r => setTimeout(r, 250)); assert.equal(sent, false, '操作模型还在跑，请求应等待');
  release('{"$inc":{"@alice.hp":-10}}'); await task; await waiting;
  assert.equal(sent, true); assert.equal(aborted, false);
  const copy = structuredClone(ctx.chat); await controller.intercept(copy, 1000, () => {});
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
  assert.equal(macros.get('solve_json').handler({ unnamedArgs: [] }), '', '历史未对齐时宏输出空内容，不把过时的状态交给模型');
  assert.match(macros.get('solve_SOP').handler({ unnamedArgs: [] }), /SOLVE 变量操作说明/u, '操作说明不依赖状态');
  let aborted = false; await controller.intercept([], 1000, () => { aborted = true; }); assert.equal(aborted, false, '历史不一致时照常发送，不中止');
  assert.ok(controller.journal.read().some(l => l.code === 'REQUEST_UNTRACKED'), '记下这一轮不更新变量');
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
test('状态栏撤销只退回最新一次玩家操作，正文同步；旁白进入发送副本', async () => {
  const { controller, ctx, addReply } = await setup();
  const index = addReply(); await controller.processMessage(index);
  const original = ctx.chat[index]!.mes, hp = () => (controller.runtime.getState().data.characters as any).alice.hp;
  const start = hp();
  await controller.submit({ $inc: { '@alice.hp': 5 } }, { actionId: 'a1', index, authorInputs: { narrate: '艾琳喝下药水' } });
  await controller.submit({ $inc: { '@alice.hp': 1 } }, { actionId: 'a2', index });
  assert.equal(hp(), start + 6);
  const copy = structuredClone(ctx.chat); await controller.intercept(copy, 1000, () => {});
  assert.match(copy[index]!.mes, /（玩家在状态栏中：艾琳喝下药水）$/u);
  assert.doesNotMatch(copy[index]!.mes, /solve_/u);
  await controller.undoUser({ index });
  assert.equal(hp(), start + 5);
  assert.deepEqual(JSON.parse(extractRawBlocks(ctx.chat[index]!.mes).mutual!).map((a: any) => a.actionId), ['a1']);
  await controller.undoUser({ index });
  assert.equal(hp(), start); assert.equal(ctx.chat[index]!.mes, original);
  await assert.rejects(controller.undoUser({ index }), /没有可以撤销/u);
  await controller.submit({ $inc: { '@alice.hp': 2 } }, { actionId: 'a3', index });
  assert.equal(hp(), start + 2);
  controller.dispose();
});

test('打开聊天时，最后一条带操作块却从没处理过的回复会自动补处理', async () => {
  const env = await hostEnvironment(), manager = new SolveSessionManager(() => env.ctx, env.fetcher);
  try {
    await manager.register(env.def, { characters: ['test.png'], attach: { cache: false } });
    // SOLVE 关着（或当时失败）时来了一条带操作的回复：没有 headId
    env.ctx.chat.push({ mes: '用户', is_user: true, extra: {} } as any);
    env.addReply('{"$inc":{"@alice.hp":-15}}'); env.saveNative();
    env.switchChat(env.ctx.chatId); await env.emit('chat'); await manager.settled();
    const c = manager.controller!; await c.whenIdle();
    assert.equal(c.getValue('@alice.hp'), 85, '补处理了这条回复的操作');
    assert.ok(env.ctx.chat.at(-1)!.extra?.solve?.headId, '回复有了 headId');
    assert.ok(c.journal.read().some(l => l.code === 'CATCH_UP'));
    // 再打开一次不会重复处理
    env.saveNative(); env.switchChat(env.ctx.chatId); await env.emit('chat'); await manager.settled(); await manager.controller!.whenIdle();
    assert.equal(manager.controller!.getValue('@alice.hp'), 85);
  } finally { manager.dispose(); }
});

test('旧版定义开的聊天：当前版本把历史逐条重算一致就接管，不一致就拒绝且不改文件', async () => {
  const env = await hostEnvironment();
  const first = new SolveSessionManager(() => env.ctx, env.fetcher);
  try {
    await first.register(env.def, { characters: ['test.png'], attach: { cache: false } }); await first.settled();
    env.ctx.chat.push({ mes: '用户', is_user: true, extra: {} } as any);
    await env.emit('start', 'normal', {}, false); env.addReply('{"$inc":{"@alice.hp":-15}}'); await env.emit('end'); await first.controller!.whenIdle();
    assert.equal(first.controller!.getValue('@alice.hp'), 85);
  } finally { first.dispose(); }
  const oldHash = env.ctx.chatMetadata.solve.definitionHash; env.saveNative();

  // 换了规则（生命单次变化不超过 10）：第 2 楼重算结果不同，拒绝接管，聊天文件不动。
  const stricter = (await fixture({ version: '3', numeric: { 'characters.*.hp': { maxDelta: 10 } } })).def;
  const refused = new SolveSessionManager(() => env.ctx, env.fetcher);
  try {
    await refused.register(stricter, { characters: ['test.png'], attach: { cache: false } });
    env.switchChat(env.ctx.chatId); await env.emit('chat'); await refused.settled();
    assert.equal(refused.controller, undefined);
    assert.match(refused.getStatus().reason, /另一版结构.*第 \d+ 楼|另一版结构.*不同|另一版结构.*出错/u);
    assert.equal(env.ctx.chatMetadata.solve.definitionHash, oldHash, '拒绝时不改聊天');
    // 同一聊天再触发事件不重复重算
    await env.emit('chat'); await refused.settled();
    assert.ok(refused.journal.read().filter(l => l.code === 'ADOPT_REFUSED').length === 1);
  } finally { refused.dispose(); }

  // 规则相同、只是版本号变了：逐条重算一致，接管，之后照常可用。
  const next = (await fixture({ version: '2' })).def;
  assert.notEqual(next.fingerprint, oldHash);
  const second = new SolveSessionManager(() => env.ctx, env.fetcher);
  try {
    await second.register(next, { characters: ['test.png'], attach: { cache: false } });
    env.switchChat(env.ctx.chatId); await env.emit('chat'); await second.settled();
    const c = second.controller!;
    assert.ok(c, second.getStatus().reason);
    assert.equal(c.getValue('@alice.hp'), 85);
    assert.equal(env.ctx.chatMetadata.solve.definitionHash, next.fingerprint, '聊天改记到新版名下');
    assert.ok(second.journal.read().some(l => l.code === 'ADOPTED'));
    env.ctx.chat.push({ mes: '用户', is_user: true, extra: {} } as any);
    await env.emit('start', 'normal', {}, false); env.addReply('{"$inc":{"@alice.hp":-5}}'); await env.emit('end'); await c.whenIdle();
    assert.equal(c.getValue('@alice.hp'), 80);
    // 重新打开：直接按新指纹绑定，不再重算
    env.saveNative(); env.switchChat(env.ctx.chatId); await env.emit('chat'); await second.settled();
    assert.equal(second.journal.read().filter(l => l.code === 'ADOPTED').length, 1, '只接管一次');
    assert.equal(second.controller!.getValue('@alice.hp'), 80);
  } finally { second.dispose(); }
});

test('模块指南、显示名、条件指南只影响提示词，改了不换定义指纹', async () => {
  const { def } = await fixture();
  const edited = (await fixture({ modules: { combat: { paths: ['characters.*.combat'], enabled: true, guide: '改过的战斗指南', label: '战斗' } }, guides: [{ id: 'g', text: '新指南' }] })).def;
  assert.equal(edited.fingerprint, def.fingerprint);
  assert.notEqual((await fixture({ modules: { combat: { paths: ['characters.*.combat'], enabled: false, guide: '战斗指南' } } })).def.fingerprint, def.fingerprint, '模块默认开关仍属于规则');
});
