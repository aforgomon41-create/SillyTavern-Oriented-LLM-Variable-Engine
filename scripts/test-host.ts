import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture } from '../tests/fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';
import { archiveFromChat, SillyTavern119Adapter } from '../src/host/sillytavern.js';
import type { HostContext, HostMessage } from '../src/host/sillytavern.js';
import { hash, restore, toJson, toToon } from '../src/index.js';

// Only creates/deletes its own UUID-named disposable character and chats.
const origin = process.env.SOLVE_TEST_URL ?? 'http://localhost:11451';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('宿主实测仅允许本机地址');
const nonce = crypto.randomUUID(), characterName = `SOLVE_backend_test_${nonce}`, chatName = `SOLVE_test_${nonce}`;
let cookie = '', csrf = '', avatar: string | undefined;
const checks: string[] = [];
const hostFetch = (async (url: any, options: RequestInit = {}) => {
  const response = await fetch(new URL(String(url), origin), { ...options, headers: {
    ...(options.headers as Record<string, string> ?? {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {})
  } });
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length) cookie = setCookies.map(c => c.split(';')[0]).join('; ');
  return response;
}) as typeof fetch;
async function post(path: string, body: unknown): Promise<Response> {
  const response = await hostFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response;
}
const report: Record<string, unknown> = { target: origin, createdAt: new Date().toISOString(), checks, passed: false, cleanup: false };
try {
  const tokenResponse = await hostFetch('/csrf-token');
  csrf = (await tokenResponse.json()).token;
  assert.ok(csrf);
  const version = await (await hostFetch('/version')).json();
  assert.match(version.pkgVersion, /^1\.19\./u); report.hostVersion = version.pkgVersion;
  checks.push('本地服务确认为 SillyTavern 1.19');
  avatar = await (await post('/api/characters/create', { ch_name: characterName, file_name: characterName, first_mes: 'SOLVE独立后端测试开场', description: '自动测试临时角色' })).text();
  assert.equal(avatar, characterName + '.png');
  const ctx: HostContext = { chatId: chatName, characterId: 0, groupId: null,
    characters: [{ avatar, name: characterName }], chat: [{ mes: 'SOLVE独立后端测试开场', name: characterName, is_user: false, extra: {} }],
    chatMetadata: { integrity: crypto.randomUUID() }, getRequestHeaders: () => ({ 'X-CSRF-Token': csrf }), updateChatMetadata: metadata => { ctx.chatMetadata = metadata; } };
  const { def } = await fixture();
  const controller = await attachSillyTavern(def, () => ctx, {}, hostFetch);
  checks.push('创建独立角色和聊天，Genesis写入并回读确认');
  const root = controller.runtime.headId;
  ctx.chat.push({ mes: '艾莉丝受到15点伤害。\n<solve_operate>\n{"$inc":{"@alice.hp":-15}}\n</solve_operate>', name: characterName, is_user: false, extra: {} });
  const wounded = await controller.processMessage(1);
  assert.ok(wounded); assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 85);
  checks.push('随正文提取JSON指令，扣血85，正式保存');
  const buy = await controller.submit({ $group: [{ $inc: { '@alice.gold': -30 } }, { $move: { '@sword': '@alice.items' } }] }, { index: 1, actionId: 'live-buy' });
  assert.equal((controller.runtime.getState().data.characters as any).alice.gold, 20);
  assert.ok((controller.runtime.getState().data.characters as any).alice.items.sword);
  checks.push('$group扣钱与物品搬移一起成功');
  const bad = await controller.submit({ $group: [{ $inc: { '@alice.gold': -999 } }, { $inc: { '@alice.hp': 1 } }] }, { index: 1, actionId: 'live-fail' });
  assert.ok(bad.feedback.some(f => f.code === 'GROUP_ROLLED_BACK'));
  assert.equal((controller.runtime.getState().data.characters as any).alice.gold, 20);
  assert.equal((controller.runtime.getState().data.characters as any).alice.hp, 85);
  checks.push('失败group完整回退，仍可保存失败反馈');
  const before = controller.runtime.headId;
  await controller.submit({ $group: [{ $inc: { '@alice.gold': -30 } }, { $move: { '@sword': '@alice.items' } }] }, { index: 1, actionId: 'live-buy' });
  assert.equal(controller.runtime.headId, before);
  assert.equal((controller.runtime.getState().data.characters as any).alice.gold, 20);
  checks.push('同一actionId重试没有再次扣钱');
  const reloadAdapter = new SillyTavern119Adapter(() => ctx, hostFetch);
  const archive = await reloadAdapter.load(); assert.ok(archive);
  const restored = await restore(archive, before);
  assert.equal(await hash(restored), archive.commits[before]!.stateHash);
  assert.equal((restored.data.characters as any).alice.hp, 85);
  checks.push('重新读取真实聊天JSON，仅凭归档恢复同一stateHash');
  assert.equal((await restore(archive, wounded.id)).data.characters && ((await restore(archive, wounded.id)).data.characters as any).alice.hp, 85);
  assert.equal((await restore(archive, buy.id)).data.characters && ((await restore(archive, buy.id)).data.characters as any).alice.gold, 20);
  checks.push('累计修订保留旧Commit，可分别恢复');
  assert.ok(toJson(def, restored).includes('"@alice"')); assert.ok(toToon(def, restored).includes('@alice'));
  checks.push('TOON与紧凑JSON投影均可输出');
  // A second isolated file receives a real branch copy; no existing chat is read or changed.
  const originalFile = await (await post('/api/chats/get', { avatar_url: avatar, file_name: chatName })).json();
  const branchName = chatName + '_branch';
  originalFile[0].chat_metadata.integrity = crypto.randomUUID();
  await post('/api/chats/save', { avatar_url: avatar, file_name: branchName, ch_name: characterName, force: false, chat: originalFile });
  const branchFile = await (await post('/api/chats/get', { avatar_url: avatar, file_name: branchName })).json();
  const branchArchive = archiveFromChat(branchFile[0].chat_metadata, branchFile.slice(1))!;
  assert.equal(await hash(await restore(branchArchive, before)), await hash(restored));
  checks.push('独立分支文件携带完整历史，离线恢复结果一致');
  controller.dispose();
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (avatar === characterName + '.png' && characterName.startsWith('SOLVE_backend_test_')) {
    try { await post('/api/characters/delete', { avatar_url: avatar, delete_chats: true }); report.cleanup = true; }
    catch (error) { report.cleanupError = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
  }
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/host-1.19.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
