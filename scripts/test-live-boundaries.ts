import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostEnvironment } from '../tests/host-fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';
import type { AttachOptions } from '../src/host/controller.js';
import { archiveFromChat } from '../src/host/sillytavern.js';
import { hash, restore, VERSION } from '../src/index.js';
// @ts-expect-error Local API helper intentionally uses plain JavaScript.
import { liveHttp } from './live-test-http.mjs';

const { request, post } = await liveHttp(process.env.SOLVE_TEST_URL);
const id = crypto.randomUUID().slice(0, 8), name = `SOLVE_acceptance_${id}`, directory = `test-results/acceptance-${id}`;
await mkdir(directory, { recursive: true });
const own: string[] = [], controllers: { dispose(): void }[] = [], checks: Record<string, unknown>[] = [];
const report: Record<string, any> = { version: VERSION, at: new Date().toISOString(), scope: '真实本机保存/回读与PNG接口；事件按1.19源码重现，不代称真实页面点击或真实LLM连接验收', checks, passed: false, cleanup: false,
  pending: ['Edge真实页面操作', '真实多标签页', '真实独立连接预设超时/取消', '恢复此前页面预设'] };
let avatar = '';
try {
  report.hostVersion = (await (await request('/version')).json()).pkgVersion;
  assert.match(report.hostVersion, /^1\.19\./u);
  avatar = await (await post('/api/characters/create', { ch_name: name, file_name: name, first_mes: '独立边界验收' })).text();
  assert.equal(avatar, name + '.png'); own.push(avatar);
  const create = async (label: string, options: AttachOptions = {}, wrap?: (input: string, init?: RequestInit) => Promise<Response>) => {
    const env = await hostEnvironment();
    env.ctx.chatId = `${name}_${label}`; env.ctx.characters = [{ name, avatar }]; env.ctx.chatMetadata = { integrity: crypto.randomUUID() };
    const nativeSave = async () => { await post('/api/chats/save', { avatar_url: avatar, ch_name: name, file_name: env.ctx.chatId, force: false, chat: [{ chat_metadata: env.ctx.chatMetadata }, ...env.ctx.chat] }); };
    env.ctx.eventTypes!.CHARACTER_MESSAGE_RENDERED = 'rendered'; env.ctx.saveChat = nativeSave;
    const fetcher = ((input: any, init?: RequestInit) => wrap ? wrap(String(input), init) : request(String(input), init)) as typeof fetch;
    const c = await attachSillyTavern(env.def, () => env.ctx, { ...options, cache: false }, fetcher); controllers.push(c);
    const disk = async () => (await post('/api/chats/get', { avatar_url: avatar, file_name: env.ctx.chatId })).json();
    return { ...env, c, nativeSave, disk, fetcher };
  };
  {
    const e = await create('stop');
    await e.emit('start', 'normal', {}, false); e.addReply(); const ended = e.emit('end'); await e.emit('stop'); await ended;
    assert.equal(e.c.getValue('@alice.hp'), 100);
    await e.emit('start', 'regenerate', {}, false); const generated = e.emit('end'); await e.emit('rendered'); await generated;
    const head = e.c.runtime.headId; await e.emit('end'); assert.equal(e.c.runtime.headId, head);
    assert.equal(e.c.getValue('@alice.hp'), 85);
    checks.push({ id: 'H02', passed: true, hp: 85, stoppedDidNotCommit: true, duplicateEndedIgnored: true });
  }
  {
    const e = await create('edit-delete'); const one = e.addReply(); const old = await e.c.processMessage(one);
    e.addReply('{"$inc":{"@alice.hp":-10}}'); await e.c.processMessage(2);
    e.ctx.chat[one]!.mes = '<solve_operate>{"$inc":{"@alice.hp":-25}}</solve_operate>'; await e.emit('edit', one); await e.nativeSave();
    await e.c.replayFrom(one); assert.equal(e.c.getValue('@alice.hp'), 65);
    assert.equal(((await e.c.inspectCommit(old!.id)).state.data.characters as any).alice.hp, 85);
    checks.push({ id: 'H03', passed: true, replayHp: 65, oldRevisionHp: 85 });
    e.ctx.chat.splice(one, 1); await e.emit('delete'); assert.equal(e.c.ready, false); await e.nativeSave();
    await e.c.replayFrom(one); assert.equal(e.c.getValue('@alice.hp'), 90);
    e.ctx.chat.pop(); await e.emit('delete'); await e.nativeSave(); await e.c.refresh(); assert.equal(e.c.getValue('@alice.hp'), 100);
    checks.push({ id: 'H04-floors', passed: true, afterMiddleReplay: 90, afterTailDelete: 100 });
  }
  for (const current of [false, true]) {
    const e = await create(current ? 'delete-current' : 'delete-other'); const index = e.addReply(); await e.c.processMessage(index);
    const message = e.ctx.chat[index]!;
    message.swipe_id = 1; message.swipes!.push('<solve_operate>{"$inc":{"@alice.hp":-30}}</solve_operate>');
    message.swipe_info!.push({ extra: structuredClone(message.extra) }); message.mes = message.swipes![1]!; message.extra = structuredClone(message.swipe_info![1]!.extra);
    await e.emit('swipe', index); await e.c.processMessage(index);
    const remove = current ? 1 : 0; message.swipes!.splice(remove, 1); message.swipe_info!.splice(remove, 1); message.swipe_id = 0;
    await e.emit('swipeDeleted', { messageId: index, swipeId: remove, newSwipeId: 0 }); await e.nativeSave(); await e.c.refresh();
    assert.equal(e.c.getValue('@alice.hp'), current ? 85 : 70);
    checks.push({ id: 'H04-' + (current ? 'current' : 'other'), passed: true, hp: e.c.getValue('@alice.hp') });
  }
  {
    const e = await create('branch'); e.addReply(); await e.c.processMessage(1); const original = await e.disk();
    const branchId = e.ctx.chatId + '_copy', branch = structuredClone(original); branch[0].chat_metadata.integrity = crypto.randomUUID();
    await post('/api/chats/save', { avatar_url: avatar, ch_name: name, file_name: branchId, force: false, chat: branch });
    const ctx = { ...e.ctx, chatId: branchId, chat: structuredClone(branch.slice(1)), chatMetadata: structuredClone(branch[0].chat_metadata), eventSource: undefined, macros: undefined,
      updateChatMetadata: (metadata: any) => { ctx.chatMetadata = metadata; } };
    const c = await attachSillyTavern(e.def, () => ctx, { cache: false }, e.fetcher); controllers.push(c);
    await c.submit({ $inc: { '@alice.hp': 1 } }); assert.equal(c.getValue('@alice.hp'), 86);
    assert.equal((await e.disk())[0].chat_metadata.variables.solve.data.characters.alice.hp, 85);
    checks.push({ id: 'H05', passed: true, originalHp: 85, branchHp: 86 });
  }
  {
    let failure = '';
    const e = await create('save-failure', {}, async (input, init) => {
      const mode = failure; if (input === '/api/chats/save') { failure = ''; if (mode === 'before') throw new Error('模拟保存前断开'); }
      const response = await request(input, init); if (input === '/api/chats/save' && mode === 'after') throw new Error('模拟响应丢失'); return response;
    });
    e.addReply(); failure = 'before'; await assert.rejects(e.c.processMessage(1), /保存前/u); await e.c.retryPending(); assert.equal(e.c.getValue('@alice.hp'), 85);
    failure = 'after'; await assert.rejects(e.c.submit({ $inc: { '@alice.hp': -1 } }), /响应丢失/u);
    const pendingId = e.c.getPending()[0]!.commit.id; await e.c.retryPending(); assert.equal(e.c.runtime.headId, pendingId); assert.equal(e.c.getValue('@alice.hp'), 84);
    checks.push({ id: 'H06', passed: true, hp: 84, candidateReused: true });
  }
  {
    const e = await create('two-clients'), original = await e.disk();
    const ctx = { ...e.ctx, chat: structuredClone(original.slice(1)), chatMetadata: structuredClone(original[0].chat_metadata), eventSource: undefined, macros: undefined,
      updateChatMetadata: (metadata: any) => { ctx.chatMetadata = metadata; } };
    const second = await attachSillyTavern(e.def, () => ctx, { cache: false }, e.fetcher); controllers.push(second);
    await e.c.submit({ $inc: { '@alice.hp': -1 } }); const saved = await e.disk(), expected = await hash(saved);
    await assert.rejects(second.submit({ $inc: { '@alice.hp': -2 } }), /其他实例/u); await second.discardPending();
    await assert.rejects(second.refresh(), /重新加载聊天|过期/u); assert.equal(await hash(await e.disk()), expected); second.dispose();
    ctx.chat = structuredClone(saved.slice(1)); ctx.chatMetadata = structuredClone(saved[0].chat_metadata);
    const fresh = await attachSillyTavern(e.def, () => ctx, { cache: false }, e.fetcher); controllers.push(fresh);
    await fresh.submit({ $inc: { '@alice.hp': -2 } }); assert.equal(fresh.getValue('@alice.hp'), 97);
    checks.push({ id: 'H07-api', passed: true, stalePageDidNotOverwrite: true, afterReloadHp: 97 });
  }
  {
    let release!: (text: string) => void, started!: () => void, calls = 0;
    const startedPromise = new Promise<void>(done => { started = done; });
    const e = await create('operator', { mode: 'out-of-band', operatorTimeoutMs: 20, operatorRequest: () => {
      calls++; if (calls === 1) { started(); return new Promise<string>(done => { release = done; }); }
      return Promise.resolve('{"$inc":{"@alice.hp":-10}}');
    } });
    e.addReply(); const failed = e.c.processMessage(1); await startedPromise; await assert.rejects(failed, /超时/u);
    release('{"$inc":{"@alice.hp":-99}}'); await Promise.resolve(); assert.equal(e.c.getValue('@alice.hp'), 100);
    await e.c.processMessage(1); assert.equal(e.c.getValue('@alice.hp'), 90);
    checks.push({ id: 'H08-controlled', passed: true, timeoutLateResponseIgnored: true, hp: 90 });
  }
  const setup = JSON.parse(await readFile('test-results/live-distribution/setup.json', 'utf8'));
  for (const card of setup.cards) {
    assert.equal(card.avatar, `SOLVE_${card.mode}_${setup.id}.png`);
    const before = await (await post('/api/characters/get', { avatar_url: card.avatar })).json();
    const exported = await post('/api/characters/export', { avatar_url: card.avatar, format: 'png' });
    const png = await exported.arrayBuffer(); assert.deepEqual([...new Uint8Array(png).slice(0, 8)], [137,80,78,71,13,10,26,10]);
    const importedName = `SOLVE_roundtrip_${card.mode}_${id}`, form = new FormData();
    form.set('avatar', new File([png], importedName + '.png', { type: 'image/png' })); form.set('file_type', 'png'); form.set('preserved_name', importedName);
    const imported = await (await request('/api/characters/import', { method: 'POST', body: form })).json();
    const importedAvatar = imported.file_name?.endsWith('.png') ? imported.file_name : imported.file_name + '.png';
    assert.equal(importedAvatar, importedName + '.png'); own.push(importedAvatar);
    const after = await (await post('/api/characters/get', { avatar_url: importedAvatar })).json();
    assert.deepEqual(after.data.extensions?.tavern_helper, before.data.extensions?.tavern_helper);
    assert.equal(after.data.first_mes, before.data.first_mes);
    await writeFile(`${directory}/${card.mode}.png`, new Uint8Array(png));
    checks.push({ id: 'H09-' + card.mode, passed: true, scriptPreserved: true, bytes: png.byteLength, scope: 'PNG与脚本载荷往返，未宣称导入后页面执行' });
  }
  for (const e of checks) assert.equal(e.passed, true);
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
  for (const c of controllers) c.dispose();
  const cleaned = [];
  for (const target of own) {
    assert.ok(target === name + '.png' || target.startsWith('SOLVE_roundtrip_') && target.endsWith('_' + id + '.png'));
    try { await post('/api/characters/delete', { avatar_url: target, delete_chats: true }); cleaned.push(target); }
    catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  }
  report.cleanup = cleaned.length === own.length; report.cleaned = cleaned;
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  await writeFile('test-results/acceptance-latest.json', JSON.stringify({ ...report, directory }, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
