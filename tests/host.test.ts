import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { createArchive, hash, SolveRuntime, restore, headKey } from '../src/index.js';
import { SillyTavern119Adapter, archiveFromChat } from '../src/host/sillytavern.js';
import type { HostContext, HostMessage } from '../src/host/sillytavern.js';

async function hostFixture() {
  const { core } = await fixture();
  let file: any[] | undefined;
  let failAfterSave = false;
  const ctx: HostContext = { chatId: 'isolated-test', characterId: 0, groupId: null,
    characters: [{ name: '测试角色', avatar: 'test.png' }], chat: [{ mes: '开场', name: '测试角色', extra: {} }], chatMetadata: { integrity: 'test-integrity', unrelated: true },
    getRequestHeaders: () => ({}), updateChatMetadata: metadata => { ctx.chatMetadata = metadata; } };
  const fetcher = (async (url: any, init: any) => {
    if (url === '/version') return Response.json({ pkgVersion: '1.19.0' });
    const body = JSON.parse(init.body);
    if (url === '/api/chats/get') return Response.json(file ?? {});
    if (url === '/api/chats/save') {
      assert.equal(body.force, false); assert.equal(body.chat[0].chat_metadata.integrity, 'test-integrity');
      file = structuredClone(body.chat);
      if (failAfterSave) throw new Error('响应丢失');
      return Response.json({ ok: true });
    }
    throw new Error(`未知URL：${url}`);
  }) as typeof fetch;
  const adapter = new SillyTavern119Adapter(() => ctx, fetcher);
  const binding = adapter.binding(0);
  const { archive, headId } = await createArchive(core, binding);
  const root = archive.commits[headId]!; root.textDigest = await hash(ctx.chat[0]!.mes);
  await adapter.save({ archive, commit: root, binding, text: ctx.chat[0]!.mes, expectedHead: null });
  const runtime = new SolveRuntime(core, archive, headId, adapter); await runtime.ready();
  return { core, ctx, adapter, runtime, binding, getFile: () => structuredClone(file!), setFile: (v: any[]) => { file = v; }, setFail: (v: boolean) => { failAfterSave = v; } };
}
test('1.19保存响应和回读验证，正文与Swipe数据同步', async () => {
  const { ctx, adapter, runtime, binding, getFile } = await hostFixture();
  assert.equal(await adapter.verifyVersion(), '1.19.0');
  const commit = await runtime.submit({ actionId: 'model-1', kind: 'operations', source: 'model', operations: { $inc: { '@alice.hp': -15 } } }, binding, '正文<solve_operate>{"$inc":{"@alice.hp":-15}}</solve_operate>');
  const file = getFile();
  assert.equal(file[1].mes, file[1].swipes[0]);
  assert.equal(file[1].extra.solve.headId, commit.id);
  assert.equal(file[1].swipe_info[0].extra.solve.headId, commit.id);
  assert.equal(ctx.chatMetadata.unrelated, true);
  assert.equal(await adapter.selectedHead(binding), commit.id);
  const archive = archiveFromChat(file[0].chat_metadata, file.slice(1))!;
  assert.equal((await restore(archive, commit.id)).data.characters && ((await restore(archive, commit.id)).data.characters as any).alice.hp, 85);
});
test('服务端已保存但响应丢失，重试回读确认，不重复执行', async () => {
  const { runtime, binding, setFail } = await hostFixture();
  const action = { actionId: 'retry', kind: 'operations' as const, source: 'model' as const, operations: { $inc: { '@alice.hp': -10 } } };
  setFail(true); await assert.rejects(runtime.submit(action, binding, '正文'), /响应丢失/u);
  setFail(false); await runtime.submit(action, binding, '正文');
  assert.equal((runtime.getState().data.characters as any).alice.hp, 90);
});
test('其他实例修改归档后不覆盖磁盘', async () => {
  const { runtime, binding, getFile, setFile } = await hostFixture();
  const changed = getFile(); changed[0].chat_metadata.solve.sessionId = 'other-session'; setFile(changed);
  await assert.rejects(runtime.submit({ actionId: 'model', kind: 'operations', source: 'model', operations: { $inc: { '@alice.hp': -10 } } }, binding, '正文'), /其他实例/u);
});
test('新Swipe继承旧extra时分配独立身份，不把旧指针当新历史', async () => {
  const { runtime, ctx, adapter, binding } = await hostFixture();
  await runtime.submit({ actionId: 'a', kind: 'operations', source: 'model', operations: { $inc: { '@alice.hp': -10 } } }, binding, '回复A');
  const message = ctx.chat[0]!;
  message.swipes!.push('回复B'); message.swipe_info!.push({ extra: structuredClone(message.extra) });
  message.swipe_id = 1; message.mes = '回复B'; message.extra = structuredClone(message.swipe_info![1]!.extra);
  adapter.invalidate();
  const b = adapter.binding(0);
  assert.notEqual(b.swipeId, binding.swipeId);
  assert.equal(await adapter.selectedHead(b), undefined);
  assert.throws(() => adapter.assertCurrent(binding), /不属于|切换/u);
});
test('群聊不执行、正文手改要求Replay', async () => {
  const { ctx, adapter, binding } = await hostFixture();
  ctx.chat[0]!.mes = '修改旧指令';
  await assert.rejects(adapter.selectedHead(binding), /重放/u);
  ctx.groupId = 'group'; assert.throws(() => adapter.binding(), /单角色/u);
});
