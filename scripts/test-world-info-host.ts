import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { z, VERSION } from '../src/index.js';
import { SolveSessionManager } from '../src/host/sessions.js';
import type { HostContext } from '../src/host/sillytavern.js';

// Only UUID-owned files. No browser cookies, model calls, user books or user chats.
const origin = new URL(process.env.SOLVE_TEST_URL ?? 'http://localhost:11451');
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('只允许本机酒馆验收');
const nonce = crypto.randomUUID(), name = 'SOLVE_world_info_' + nonce, book = name + '_book';
let cookie = '', csrf = '', avatar: string | undefined, bookCreated = false, worldReads = 0;
let manager: SolveSessionManager | undefined;
const checks: Record<string, unknown>[] = [];
const report: Record<string, unknown> = { version: VERSION, target: origin.origin,
  scope: '真实1.19世界书/角色/聊天保存回读；Node中构造宿主上下文与切聊，不代称真实页面事件', checks, passed: false, cleanup: false };
const request = (async (input: any, options: RequestInit = {}) => {
  const url = new URL(String(input), origin);
  if (url.origin !== origin.origin) throw new Error('测试请求不得离开本机酒馆');
  if (['/api/worldinfo/get', '/api/worldinfo/list'].includes(url.pathname)) worldReads++;
  const response = await fetch(url, { ...options, headers: { ...(options.headers as Record<string, string> ?? {}),
    ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } });
  const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
  return response;
}) as typeof fetch;
async function post(path: string, body: unknown): Promise<Response> {
  const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(path + ' HTTP ' + response.status);
  return response;
}
const world = (hp: number, item: string) => ({ entries: {
  0: { uid: 0, comment: '[SOLVE:INIT]', content: JSON.stringify({ hp }), disable: false },
  1: { uid: 1, comment: '[SOLVE:TEMPLATES]', content: JSON.stringify({ potion: { type: 'item', data: { name: item, count: 1 } } }), disable: false },
  2: { uid: 2, comment: '[SOLVE:GUIDE]', content: '受到伤害时减少 hp。', disable: false },
  3: { uid: 3, comment: '普通测试世界书', content: '这段内容不应进入SOLVE声明快照', disable: false },
} });
try {
  csrf = (await (await request('/csrf-token')).json()).token; assert.ok(csrf);
  const version = await (await request('/version')).json(); assert.match(version.pkgVersion, /^1\.19\./u); report.hostVersion = version.pkgVersion;
  const list = await (await post('/api/worldinfo/list', {})).json();
  assert.equal(list.some((item: any) => item.file_id === book), false);
  await post('/api/worldinfo/edit', { name: book, data: world(90, '原药水') }); bookCreated = true;
  avatar = await (await post('/api/characters/create', { ch_name: name, file_name: name, first_mes: '世界书独立验收', world: book })).text();
  assert.equal(avatar, name + '.png');
  const card = await (await post('/api/characters/get', { avatar_url: avatar })).json();
  assert.equal(card.data.extensions.world, book); card.avatar = avatar;
  const base = { id: 'solve-live-world-info', version: '1', runtimeBindings: { build: 'world-info-host-v1' },
    schema: z.object({ hp: z.number().min(0).max(100).default(100), items: z.record(z.string(), z.object({ name: z.string(), count: z.number() })).default({}) }),
    initialData: {}, entities: [{ path: 'items', type: 'item' }] };
  const firstChat = name + '_original', secondChat = name + '_new';
  const ctx: HostContext = { chatId: firstChat, characterId: 0, groupId: null, characters: [card],
    chat: [{ mes: '世界书独立验收', is_user: false, name, extra: {} }], chatMetadata: { integrity: crypto.randomUUID() },
    getRequestHeaders: () => ({ 'X-CSRF-Token': csrf }), updateChatMetadata: metadata => { ctx.chatMetadata = metadata; } };
  const registration = { characters: [avatar], worldInfo: { characterBook: true }, attach: { cache: false as const } };
  const disk = async (fileName: string) => (await post('/api/chats/get', { avatar_url: avatar, file_name: fileName })).json();
  const open = async (fileName: string) => {
    const file = await disk(fileName); ctx.chatId = fileName;
    ctx.chat = Array.isArray(file) && file.length ? file.slice(1) : [{ mes: '世界书独立验收', name, extra: {} }];
    ctx.chatMetadata = Array.isArray(file) && file.length ? file[0].chat_metadata : { integrity: crypto.randomUUID() };
  };
  manager = new SolveSessionManager(() => ctx, request); await manager.registerWorldInfo(base, registration);
  assert.equal(manager.controller!.getValue('hp'), 90); const originalHash = manager.controller!.core.definition.fingerprint;
  await manager.controller!.submit({ $inc: { hp: -5 } }, { actionId: 'live-world-damage' });
  assert.equal(manager.controller!.getValue('hp'), 85);
  const original = await disk(firstChat);
  assert.equal(original[0].chat_metadata.solve.authoring.version, 1);
  assert.equal(JSON.stringify(original).includes('这段内容不应进入SOLVE声明快照'), false);
  checks.push({ case: 'actual-character-primary-book-and-save', passed: true, hp: 85, headerSnapshot: true });
  await post('/api/worldinfo/edit', { name: book, data: world(60, '新药水') });
  await open(secondChat); await manager.reconcile(); await manager.settled();
  assert.equal(manager.controller!.getValue('hp'), 60);
  assert.equal(manager.controller!.core.definition.templates!.potion!.data.name, '新药水');
  assert.notEqual(manager.controller!.core.definition.fingerprint, originalHash);
  checks.push({ case: 'new-chat-uses-updated-book', passed: true, hp: 60 });
  await open(firstChat); await manager.reconcile(); await manager.settled();
  assert.equal(manager.controller!.getValue('hp'), 85);
  assert.equal(manager.controller!.core.definition.templates!.potion!.data.name, '原药水');
  assert.equal(manager.controller!.core.definition.fingerprint, originalHash);
  checks.push({ case: 'switch-back-keeps-original-definition', passed: true });
  manager.dispose(); await post('/api/worldinfo/delete', { name: book }); bookCreated = false;
  await open(firstChat); const count = worldReads;
  manager = new SolveSessionManager(() => ctx, request); await manager.registerWorldInfo(base, registration);
  assert.equal(manager.controller!.getValue('hp'), 85); assert.equal(worldReads, count);
  await manager.controller!.submit({ $inc: { hp: -1 } }, { actionId: 'live-world-reload' });
  assert.equal(manager.controller!.getValue('hp'), 84);
  checks.push({ case: 'cold-reload-after-book-deleted', passed: true, hp: 84, liveBookReads: 0 });
  const branchName = name + '_branch', branch = await disk(firstChat); branch[0].chat_metadata.integrity = crypto.randomUUID();
  await post('/api/chats/save', { avatar_url: avatar, file_name: branchName, ch_name: name, force: false, chat: branch });
  await open(branchName); await manager.reconcile(); await manager.settled();
  await manager.controller!.submit({ $inc: { hp: -1 } }, { actionId: 'live-world-branch' });
  assert.equal(manager.controller!.getValue('hp'), 83);
  assert.equal((await disk(firstChat))[0].chat_metadata.variables.solve.data.hp, 84);
  checks.push({ case: 'independent-branch-with-fixed-source', passed: true, branchHp: 83, originalHp: 84 });
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  manager?.dispose();
  let cleanup = true;
  if (avatar === name + '.png' && name.startsWith('SOLVE_world_info_')) {
    try { await post('/api/characters/delete', { avatar_url: avatar, delete_chats: true }); }
    catch (error) { report.characterCleanupError = String(error); cleanup = false; }
  }
  if (bookCreated && book === name + '_book' && name.startsWith('SOLVE_world_info_')) {
    try { await post('/api/worldinfo/delete', { name: book }); }
    catch (error) { report.bookCleanupError = String(error); cleanup = false; }
  }
  report.cleanup = cleanup; if (!cleanup) process.exitCode = 1;
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/world-info-host.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
