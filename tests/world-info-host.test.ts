import test from 'node:test';
import assert from 'node:assert/strict';
import { hostEnvironment } from './host-fixture.js';
import { SolveSessionManager } from '../src/host/sessions.js';
import { readWorldInfoSelection } from '../src/host/world-info.js';
import { installRuntime } from '../src/host/install.js';
import { archiveFromChat } from '../src/host/sillytavern.js';
import { archiveProof, hash, restore, verifyDefinitionSnapshot } from '../src/index.js';

async function environment() {
  const env = await hostEnvironment();
  const books = new Map<string, any>([['card-book', { entries: {
    0: { comment: '[SOLVE:INIT]', content: '{"characters":{"alice":{"hp":85}}}' },
    1: { comment: '[SOLVE:GUIDE]', content: '角色 {{char}} 受到伤害后减少 hp。' },
    2: { comment: '普通世界书', content: '不应归档这段普通设定' },
  } }]]);
  (env.ctx.characters as any)[0].data = { extensions: { world: 'card-book' } };
  let macros = 0;
  env.ctx.substituteParams = text => { macros++; return text.replace('{{char}}', 'Alice'); };
  const reads: string[] = [];
  const fetcher = (async (input: any, init?: RequestInit) => {
    if (input === '/api/worldinfo/list') { reads.push('list'); return Response.json([...books.keys()].map(file_id => ({ file_id, name: '显示别名' }))); }
    if (input === '/api/worldinfo/get') { const name = JSON.parse(String(init?.body)).name; reads.push(name); return Response.json(books.get(name) ?? { entries: {} }); }
    return env.fetcher(input, init);
  }) as typeof fetch;
  const manager = () => new SolveSessionManager(() => env.ctx, fetcher);
  return { ...env, books, reads, fetcher, manager, macroCount: () => macros };
}
const registration = { characters: ['test.png'], attach: { cache: false as const } };

test('条件指南按已确认状态变化，刷新用固定条件与原JS函数，不重新读取世界书', async () => {
  const env = await environment();
  env.books.get('card-book').entries[3] = { comment: '[SOLVE:GUIDE id=critical when="@alice.hp < 80"]', content: '世界书低血量指南' };
  const base = { ...env.def, guides: [{ id: 'js', when: ({ get }: any) => get('@alice.hp') <= 70, text: '原包JS指南' }] };
  const first = env.manager();
  await first.registerWorldInfo(base, registration);
  assert.doesNotMatch(first.controller!.getGuide(), /低血量|原包JS/u);
  await first.controller!.submit({ $inc: { '@alice.hp': -15 } });
  const expected = first.controller!.getGuide(); assert.match(expected, /世界书低血量指南/u); assert.match(expected, /原包JS指南/u);
  const snapshot = first.controller!.runtime.archive.authoring!;
  assert.deepEqual((snapshot.declaration.guides as any[])[0].when, { binding: 'js' });
  first.dispose(); const reads = env.reads.length;
  env.books.delete('card-book'); const second = env.manager();
  try {
    await second.registerWorldInfo(base, registration); assert.equal(second.controller!.getValue('@alice.hp'), 70);
    assert.equal(second.controller!.getGuide(), expected); assert.equal(env.reads.length, reads);
    assert.equal(env.macros.get('solve_guide').handler({ unnamedArgs: [] }), expected);
    assert.ok((await second.controller!.validateArchive()).every(row => row.valid));
  } finally { second.dispose(); }
});

test('首次导入世界书保存后自动重试失败绑定，已有聊天不热替换声明', async () => {
  const env = await environment(); env.ctx.eventTypes!.WORLDINFO_UPDATED = 'world-updated';
  const book = env.books.get('card-book'); env.books.delete('card-book');
  const manager = env.manager();
  try {
    await manager.registerWorldInfo(env.def, registration); assert.equal(manager.getStatus().phase, 'error'); assert.equal(env.files.size, 0);
    env.books.set('card-book', book); await env.emit('world-updated', 'card-book', book); await manager.settled();
    assert.equal(manager.controller!.getValue('@alice.hp'), 85); const fingerprint = manager.controller!.core.definition.fingerprint, reads = env.reads.length;
    book.entries[0].content = '{"characters":{"alice":{"hp":60}}}'; await env.emit('world-updated', 'card-book', book); await manager.settled();
    assert.equal(env.reads.length, reads); assert.equal(manager.controller!.getValue('@alice.hp'), 85); assert.equal(manager.controller!.core.definition.fingerprint, fingerprint);
  } finally { manager.dispose(); }
});
test('世界书保存通知到来时旧的缺书读取仍未返回，等待结束后只重试一次', async () => {
  const env = await environment(); env.ctx.eventTypes!.WORLDINFO_UPDATED = 'world-updated';
  const book = env.books.get('card-book'); env.books.delete('card-book');
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  let first = true;
  const fetcher = (async (input: any, init?: RequestInit) => {
    const response = await env.fetcher(input, init);
    if (input === '/api/worldinfo/list' && first) { first = false; entered(); await gate; } return response;
  }) as typeof fetch;
  const manager = new SolveSessionManager(() => env.ctx, fetcher);
  try {
    const registering = manager.registerWorldInfo(env.def, registration); await started;
    env.books.set('card-book', book); const updated = env.emit('world-updated', 'card-book', book); release();
    await registering; await updated; await manager.settled();
    assert.equal(manager.getStatus().phase, 'ready'); assert.equal(manager.controller!.getValue('@alice.hp'), 85);
    assert.equal(env.reads.filter(item => item === 'list').length, 2); assert.equal(Object.keys(manager.controller!.runtime.archive.commits).length, 1);
  } finally { manager.dispose(); }
});

test('读取实际文件 id 和全量条目，选择角色/聊天世界书去重，不扫描其他书', async () => {
  const env = await environment();
  env.books.set('chat-book', { entries: { 0: { comment: '[SOLVE:GUIDE]', content: '聊天指南' } } });
  env.books.set('unselected', { entries: { 0: { comment: '[SOLVE:INIT]', content: '损坏' } } });
  env.ctx.chatMetadata.world_info = 'chat-book';
  const result = await readWorldInfoSelection(() => env.ctx, { books: ['card-book'], characterBook: true, chatBook: true }, env.fetcher);
  assert.deepEqual(result.books, ['card-book', 'chat-book']);
  assert.equal(result.entries.length, 3); assert.equal(result.entries[0]!.source, 'card-book#0');
  assert.deepEqual(env.reads, ['list', 'card-book', 'chat-book']);
  await assert.rejects(readWorldInfoSelection(() => env.ctx, { books: ['显示别名'] }, env.fetcher), /不存在/u);
});
test('世界书声明只在聊天头保存一次；刷新后不读当前世界书、不重跑宏', async () => {
  const env = await environment(), manager = env.manager();
  await manager.registerWorldInfo(env.def, registration);
  assert.equal(manager.controller!.getValue('@alice.hp'), 85);
  const firstHash = manager.controller!.core.definition.fingerprint;
  assert.match(manager.controller!.core.definition.guide!, /Alice/u);
  await manager.controller!.submit({ $inc: { '@alice.hp': -1 } });
  const saved = env.files.get(env.ctx.chatId)!;
  assert.equal(saved[0].chat_metadata.solve.authoring.version, 1);
  assert.equal(JSON.stringify(saved).includes('不应归档这段普通设定'), false);
  assert.equal(JSON.stringify(saved.slice(1)).includes('baseHash'), false);
  const reads = env.reads.length, macros = env.macroCount();
  manager.dispose(); env.books.delete('card-book'); env.switchChat(env.ctx.chatId);
  const refreshed = env.manager();
  try {
    await refreshed.registerWorldInfo(env.def, registration);
    assert.equal(refreshed.controller!.getValue('@alice.hp'), 84);
    assert.equal(refreshed.controller!.core.definition.fingerprint, firstHash);
    assert.equal(env.reads.length, reads); assert.equal(env.macroCount(), macros);
    await refreshed.controller!.submit({ $inc: { '@alice.hp': -1 } });
    assert.equal(refreshed.controller!.getValue('@alice.hp'), 83);
  } finally { refreshed.dispose(); }
});
test('新聊天读取更新后的书，切回旧聊天恢复各自定义和数据', async () => {
  const env = await environment(), manager = env.manager(), original = env.ctx.chatId;
  try {
    await manager.registerWorldInfo(env.def, registration);
    const oldHash = manager.controller!.core.definition.fingerprint;
    env.books.get('card-book').entries[0].content = '{"characters":{"alice":{"hp":65}}}';
    env.switchChat('world-second'); await env.emit('chat'); await manager.settled();
    assert.equal(manager.controller!.getValue('@alice.hp'), 65);
    assert.notEqual(manager.controller!.core.definition.fingerprint, oldHash);
    env.switchChat(original); await env.emit('chat'); await manager.settled();
    assert.equal(manager.controller!.getValue('@alice.hp'), 85);
    assert.equal(manager.controller!.core.definition.fingerprint, oldHash);
    assert.equal(env.reads.filter(name => name === 'card-book').length, 2);
  } finally { manager.dispose(); }
});
test('快照损坏拒绝写入，但合法 Patch 历史仍能只读检查', async () => {
  const env = await environment(), manager = env.manager();
  await manager.registerWorldInfo(env.def, registration);
  const commit = manager.controller!.runtime.headId;
  const before = manager.controller!.runtime.archive;
  manager.dispose();
  const file = env.files.get(env.ctx.chatId)!;
  file[0].chat_metadata.solve.authoring.declaration.initialData.characters.alice.hp = 1;
  env.switchChat(env.ctx.chatId);
  const corrupted = archiveFromChat(env.ctx.chatMetadata, env.ctx.chat)!;
  assert.notEqual(await archiveProof(before, commit), await archiveProof(corrupted, commit));
  const next = env.manager();
  try {
    await next.registerWorldInfo(env.def, registration);
    assert.equal(next.controller, undefined); assert.match(next.getStatus().reason, /快照校验/u);
    const readonly = await next.inspectArchive(commit);
    assert.equal((readonly.state!.data.characters as any).alice.hp, 85);
    assert.equal(file[0].chat_metadata.solve.authoring.declaration.initialData.characters.alice.hp, 1);
  } finally { next.dispose(); }
});
test('缺失或换版基础作者包不读取新世界书冒充原定义，保留只读事实', async () => {
  const env = await environment(), manager = env.manager();
  await manager.registerWorldInfo(env.def, registration); const root = manager.controller!.runtime.headId;
  manager.dispose(); const count = env.reads.length;
  const next = env.manager();
  try {
    await next.registerWorldInfo({ ...env.def, version: 'different' }, registration);
    assert.equal(next.controller, undefined); assert.match(next.getStatus().reason, /原定义/u);
    assert.equal(env.reads.length, count);
    assert.equal((await next.inspectArchive(root)).readonly, true);
  } finally { next.dispose(); }
});
test('不存在、空书和损坏条目均不创建默认开局；未绑定角色不读取书', async () => {
  for (const data of [undefined, { entries: {} }, { entries: { 0: { comment: '[SOLVE:INIT]', content: '{bad}' } } }]) {
    const env = await environment(); if (data) env.books.set('card-book', data); else env.books.delete('card-book');
    const manager = env.manager();
    try { await manager.registerWorldInfo(env.def, registration); assert.equal(manager.controller, undefined); assert.equal(env.files.size, 0); }
    finally { manager.dispose(); }
  }
  const env = await environment(), manager = env.manager();
  try { await manager.registerWorldInfo(env.def, { characters: ['other.png'] }); assert.equal(env.reads.length, 0); assert.equal(env.files.size, 0); }
  finally { manager.dispose(); }
});
test('世界书加载中快速切聊天，迟到结果不会初始化已离开的文件', async () => {
  const env = await environment(); let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  let held = true;
  const fetcher = (async (input: any, init?: RequestInit) => {
    if (input === '/api/worldinfo/get' && held) { held = false; started(); await gate; }
    return env.fetcher(input, init);
  }) as typeof fetch;
  const manager = new SolveSessionManager(() => env.ctx, fetcher), original = env.ctx.chatId;
  try {
    const pending = manager.registerWorldInfo(env.def, registration); await entered;
    env.switchChat('world-fast-switch'); await env.emit('chat'); release();
    await pending; await manager.settled();
    assert.equal(env.files.has(original), false); assert.equal(manager.controller!.boundChatId, 'world-fast-switch');
    assert.equal(manager.controller!.getValue('@alice.hp'), 85);
  } finally { release?.(); manager.dispose(); }
});
test('同聊天重复切换信号合并加载，脚本在加载中停用后不能写入', async () => {
  const env = await environment(); let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  const fetcher = (async (input: any, init?: RequestInit) => { if (input === '/api/worldinfo/get') { started(); await gate; } return env.fetcher(input, init); }) as typeof fetch;
  const api = installRuntime({ scope: { SillyTavern: { getContext: () => env.ctx }, fetch: fetcher, crypto } });
  const lease = api.use({ kind: 'embedded' }), pending = lease.registerWorldInfo(env.def, registration);
  await entered; await env.emit('chat');
  await lease.dispose(); release(); await pending;
  assert.equal(env.files.size, 0); assert.equal(api.controller, undefined);
  await assert.rejects(lease.registerWorldInfo(env.def, registration), /已停用/u);
  assert.equal(env.reads.filter(name => name === 'card-book').length, 1);
});

test('同名世界书聊天重新载入恢复原声明与状态，不重新读实时书', async () => {
  const env = await environment(), manager = env.manager();
  try {
    await manager.registerWorldInfo(env.def, registration); const before = manager.controller!;
    await before.submit({ $inc: { '@alice.hp': -5 } }); const head = before.runtime.headId, reads = env.reads.length;
    env.books.clear(); env.switchChat(env.ctx.chatId); await env.emit('chat'); await manager.settled();
    assert.notEqual(manager.controller, before); assert.equal(manager.controller!.ready, true); assert.equal(manager.controller!.runtime.headId, head);
    assert.equal(manager.controller!.getValue('@alice.hp'), 80); assert.equal(env.reads.length, reads);
  } finally { manager.dispose(); }
});
test('宏能力缺失明确报错，显式关闭宏后保留原指南文本', async () => {
  const env = await environment(); delete env.ctx.substituteParams;
  const manager = env.manager();
  try {
    await manager.registerWorldInfo(env.def, registration); assert.equal(manager.controller, undefined); assert.match(manager.getStatus().reason, /宏替换/u);
    await manager.registerWorldInfo(env.def, { ...registration, worldInfo: { macros: false } });
    assert.match(manager.controller!.core.definition.guide!, /\{\{char\}\}/u);
    const archive = manager.controller!.runtime.archive;
    assert.equal(await hash(await restore(archive, manager.controller!.runtime.headId)), archive.commits[manager.controller!.runtime.headId]!.stateHash);
  } finally { manager.dispose(); }
});
test('普通定义与世界书入口同优先级不能因基础指纹相同而静默选错', async () => {
  const env = await environment(); (env.ctx.characters as any)[0].avatar = 'unbound.png';
  const manager = env.manager();
  try {
    await manager.register(env.def, registration); await manager.registerWorldInfo(env.def, registration);
    (env.ctx.characters as any)[0].avatar = 'test.png'; await manager.reconcile();
    assert.equal(manager.controller, undefined); assert.match(manager.getStatus().reason, /多个作者定义或不同世界书/u);
    assert.equal(env.reads.length, 0); assert.equal(env.files.size, 0);
  } finally { manager.dispose(); }
});
test('相同基础包为不同角色绑定不同书，不覆盖其他角色的选择', async () => {
  const env = await environment(), manager = env.manager();
  env.books.set('other-book', { entries: { 0: { comment: '[SOLVE:INIT]', content: '{"characters":{"alice":{"hp":66}}}' } } });
  try {
    await manager.registerWorldInfo(env.def, { ...registration, worldInfo: { books: ['card-book'] } });
    await manager.registerWorldInfo(env.def, { characters: ['b.png'], attach: { cache: false }, worldInfo: { books: ['other-book'] } });
    env.switchChat('role-a-new'); await env.emit('chat'); await manager.settled();
    assert.equal(manager.controller!.getValue('@alice.hp'), 85);
    (env.ctx.characters as any)[1] = { name: 'B', avatar: 'b.png' }; env.ctx.characterId = 1;
    env.switchChat('role-b-new'); await env.emit('chat'); await manager.settled();
    assert.equal(manager.controller!.getValue('@alice.hp'), 66);
  } finally { manager.dispose(); }
});
test('两个同级载体使用不同书时明确歧义，不受注册先后影响', async () => {
  const env = await environment(); (env.ctx.characters as any)[0].avatar = 'unbound.png';
  const manager = env.manager();
  try {
    await manager.registerWorldInfo(env.def, { ...registration, owner: 'one', priority: 10, worldInfo: { books: ['card-book'] } });
    await manager.registerWorldInfo(env.def, { ...registration, owner: 'two', priority: 10, worldInfo: { books: ['other-book'] } });
    (env.ctx.characters as any)[0].avatar = 'test.png'; await manager.reconcile();
    assert.equal(manager.controller, undefined); assert.match(manager.getStatus().reason, /不同世界书/u); assert.equal(env.files.size, 0);
  } finally { manager.dispose(); }
});
test('缺少固定声明时明确提示快照或原包缺失，不用当前世界书初始化旧历史', async () => {
  const env = await environment(), manager = env.manager();
  await manager.registerWorldInfo(env.def, registration); manager.dispose();
  delete env.files.get(env.ctx.chatId)![0].chat_metadata.solve.authoring; env.switchChat(env.ctx.chatId);
  const count = env.reads.length, next = env.manager();
  try {
    await next.registerWorldInfo(env.def, registration); assert.equal(next.controller, undefined);
    assert.match(next.getStatus().reason, /快照缺失/u); assert.equal(env.reads.length, count);
    assert.equal((await next.inspectArchive()).readonly, true);
  } finally { next.dispose(); }
});
test('原生保存不能替换或删除固定声明，即使重新计算了声明自身摘要', async () => {
  const env = await environment(), manager = env.manager();
  try {
    await manager.registerWorldInfo(env.def, registration);
    const file = env.files.get(env.ctx.chatId)!, incoming = structuredClone(file), source = incoming[0].chat_metadata.solve.authoring;
    source.declaration.guide = '替换指南'; const { digest: _digest, ...body } = source; source.digest = await hash(body);
    let sent = false;
    const request = { file_name: env.ctx.chatId, avatar_url: 'test.png', chat: incoming };
    await assert.rejects(manager.controller!.guardNativeSave(request, async () => { sent = true; return Response.json({ ok: true }); }), /固定作者声明/u);
    assert.equal(sent, false); assert.notEqual(file[0].chat_metadata.solve.authoring.declaration.guide, '替换指南');
  } finally { manager.dispose(); }
});
test('快照开局声明必须与作者绑定的开局摘要一致', async () => {
  const env = await environment(), manager = env.manager();
  try {
    await manager.registerWorldInfo(env.def, registration); const archive = manager.controller!.runtime.archive;
    const source = structuredClone(archive.authoring!); (source.declaration.initialData as any).characters.alice.hp = 1;
    const { digest: _digest, ...body } = source; source.digest = await hash(body);
    await assert.rejects(verifyDefinitionSnapshot(source, archive.definitionHash), /开局数据/u);
  } finally { manager.dispose(); }
});
test('载体公开注册接口拒绝冒充 owner 或自设优先级', async () => {
  const env = await environment(), api = installRuntime({ scope: { SillyTavern: { getContext: () => env.ctx }, fetch: env.fetcher, crypto } });
  assert.throws(() => api.registerWorldInfo(env.def, { ...registration, owner: 'fake' } as any), /由载体管理/u);
  const lease = api.use({ kind: 'dynamic' });
  await assert.rejects(lease.register(env.def, { ...registration, priority: 100 } as any), /由载体管理/u);
  await lease.dispose(); assert.equal(env.files.size, 0);
});
