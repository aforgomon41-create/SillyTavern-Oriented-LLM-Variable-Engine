import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { attachSillyTavern } from '../src/host/controller.js';
import { archiveFromChat } from '../src/host/sillytavern.js';
import type { HostContext } from '../src/host/sillytavern.js';
import * as engine from '../src/index.js';
import { readToken } from '../src/host/storage-tokens.js';
// @ts-expect-error Plain JS acceptance fixture, separate from production code.
import { liveDefinition } from './live-test-hud.js';
// @ts-expect-error Plain JS local API session helper.
import { liveHttp } from './live-test-http.mjs';

const directory = 'test-results/live-distribution';
const setup = JSON.parse(await readFile(`${directory}/setup.json`, 'utf8'));
const { request, post } = await liveHttp();
const fetcher = ((input: any, init?: RequestInit) => request(String(input), init)) as typeof fetch;
const definition = liveDefinition(engine), results = [];
function context(card: any, chatId: string, file: any[]): HostContext {
  const ctx: HostContext = { characterId: 0, groupId: null, characters: [{ name: card.name, avatar: card.avatar }],
    chatId, chat: structuredClone(file.slice(1)), chatMetadata: structuredClone(file[0].chat_metadata),
    getRequestHeaders: () => ({}), updateChatMetadata: value => { ctx.chatMetadata = value; } };
  return ctx;
}
function verifyViews(file: any[], headId: string) {
  const archive = archiveFromChat(file[0].chat_metadata, file.slice(1))!;
  const active = file[0].chat_metadata.variables?.solve;
  assert.equal(active?.headId, headId);
  assert.equal(active?.stateHash, archive.commits[headId]!.stateHash);
  let floors = 0;
  for (const message of file.slice(1)) {
    if (message.is_user || message.is_system) continue;
    for (const [index, variables] of Object.entries(message.variables ?? {})) {
      const view = (variables as any)?.solve; if (!view) continue;
      const commit = archive.commits[readToken(view.commit.id)]!; assert.ok(commit);
      assert.deepEqual(view.operations.map((action: any) => action.operations), commit.actions.map(action => action.kind === 'operations' ? action.operations : undefined));
      assert.deepEqual(view.dataPatch, commit.dataPatch);
      assert.deepEqual(view.enginePatch ?? [], commit.enginePatch);
      assert.equal(readToken(view.commit.id), commit.id);
      if (Number(index) === (message.swipe_id ?? 0)) assert.equal(view.commit.id, message.extra.solve.ref);
      floors++;
    }
  }
  assert.ok(floors > 0);
  return { headId, floorSwipeViews: floors, hp: active.data.characters.player.hp, gold: active.data.characters.player.gold, ready: active.ready };
}
let nativeCard: any, nativeFile: any[] | undefined;
for (const card of setup.cards) {
  assert.equal(card.name, `SOLVE_${card.mode}_${setup.id}`);
  assert.equal(card.avatar, card.name + '.png');
  const character = await (await post('/api/characters/get', { avatar_url: card.avatar })).json();
  const address = { avatar_url: card.avatar, file_name: character.chat };
  const file = await (await post('/api/chats/get', address)).json();
  const before = archiveFromChat(file[0].chat_metadata, file.slice(1))!;
  const ctx = context(card, character.chat, file);
  const c = await attachSillyTavern(definition, () => ctx, { cache: false }, fetcher);
  assert.equal(c.getStatus().ready, true);
  const backfilled = await (await post('/api/chats/get', address)).json();
  assert.equal(await engine.hash(archiveFromChat(backfilled[0].chat_metadata, backfilled.slice(1))), await engine.hash(before));
  const checked = verifyViews(backfilled, c.getStatus().headId!);
  assert.deepEqual(backfilled[0].chat_metadata.variables.solve.data, c.getState().data);
  results.push({ mode: card.mode, character: card.name, backfillWithoutNewCommits: true, ...checked });
  c.dispose();
  const reloaded = context(card, character.chat, backfilled);
  const reopened = await attachSillyTavern(definition, () => reloaded, { cache: false }, fetcher);
  assert.deepEqual(reopened.getState().data, backfilled[0].chat_metadata.variables.solve.data);
  reopened.dispose();
  if (card.mode === 'native') { nativeCard = card; nativeFile = backfilled; }
}

assert.ok(nativeCard && nativeFile);
const branchName = `SOLVE_variables_${setup.id}_${crypto.randomUUID().slice(0, 8)}`;
const branch = structuredClone(nativeFile!); branch[0].chat_metadata.integrity = crypto.randomUUID();
await post('/api/chats/save', { avatar_url: nativeCard.avatar, file_name: branchName, ch_name: nativeCard.name, force: false, chat: branch });
const ctx = context(nativeCard, branchName, branch);
const handlers = new Map<string, (...args: any[]) => unknown>();
ctx.eventTypes = { MESSAGE_SWIPED: 'swipe' };
ctx.eventSource = { on: (event, listener) => { handlers.set(event, listener); }, removeListener: event => { handlers.delete(event); } };
const c = await attachSillyTavern(definition, () => ctx, { cache: false }, fetcher);
const index = ctx.chat.findLastIndex(message => (message.swipes?.length ?? 0) > 1);
assert.ok(index >= 0);
const message = ctx.chat[index]!, oldIndex = message.swipe_id ?? 0;
message.swipe_id = oldIndex === 0 ? 1 : 0;
message.mes = message.swipes![message.swipe_id]!;
message.extra = structuredClone(message.swipe_info![message.swipe_id]!.extra);
await handlers.get('swipe')!(index);
const address = { avatar_url: nativeCard.avatar, file_name: branchName };
const switched = await (await post('/api/chats/get', address)).json();
const swipeCheck = verifyViews(switched, c.getStatus().headId!);
assert.equal(switched[0].chat_metadata.solve.sessionId, c.runtime.sessionId);
const hp = c.getValue('@player.hp') as number;
const previewHead = c.getStatus().headId;
await c.preview({ $inc: { '@player.hp': -1 } });
assert.equal((await (await post('/api/chats/get', address)).json())[0].chat_metadata.variables.solve.headId, previewHead);
await c.submit({ $inc: { '@player.hp': -1 } }, { actionId: 'variables-live-' + crypto.randomUUID() });
const submitted = await (await post('/api/chats/get', address)).json();
const submitCheck = verifyViews(submitted, c.getStatus().headId!);
assert.equal(submitCheck.hp, hp - 1);
c.dispose();
const report = { version: engine.VERSION, at: new Date().toISOString(), target: setup.origin, passed: true, results,
  branch: { name: branchName, previewDidNotSave: true, swipe: swipeCheck, submit: submitCheck },
  scope: '真实本机API与控制器；标准变量存储路径已回读，不代称已通过浏览器变量面板点击验收' };
await writeFile(`${directory}/variables-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
