import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { attachSillyTavern } from '../src/host/controller.js';
import { archiveFromChat } from '../src/host/sillytavern.js';
import type { HostContext } from '../src/host/sillytavern.js';
import * as engine from '../src/index.js';
import { readToken } from '../src/host/storage-tokens.js';
// @ts-expect-error Plain JS acceptance fixture.
import { liveDefinition } from './live-test-hud.js';
// @ts-expect-error Plain JS local API session helper.
import { liveHttp } from './live-test-http.mjs';

const directory = 'test-results/live-distribution';
const setup = JSON.parse(await readFile(`${directory}/setup.json`, 'utf8'));
const run = crypto.randomUUID().slice(0, 8), backup = `${directory}/compact-v3-backup-${run}`;
await mkdir(backup, { recursive: true });
const { request, post } = await liveHttp();
const fetcher = ((input: any, init?: RequestInit) => request(String(input), init)) as typeof fetch;
const definition = liveDefinition(engine), results = [];
const bytes = (value: unknown) => value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value));
function context(card: any, chatId: string, file: any[]): HostContext {
  const ctx: HostContext = { characterId: 0, groupId: null, characters: [{ name: card.name, avatar: card.avatar }],
    chatId, chat: structuredClone(file.slice(1)), chatMetadata: structuredClone(file[0].chat_metadata),
    getRequestHeaders: () => ({}), updateChatMetadata: metadata => { ctx.chatMetadata = metadata; } };
  return ctx;
}
function measure(file: any[]) {
  const floors = file.slice(1).flatMap((message, floor) => {
    const payloads = [message.extra?.solve, ...(message.swipe_info ?? []).map((info: any) => info.extra?.solve),
      ...Object.values(message.variables ?? {}).map((variables: any) => variables.solve)].filter(Boolean);
    return payloads.length ? [{ floor, bytes: payloads.reduce((sum, value) => sum + bytes(value), 0) }] : [];
  });
  return { floors, floorBytes: floors.reduce((sum, value) => sum + value.bytes, 0),
    totalSolveBytes: floors.reduce((sum, value) => sum + value.bytes, 0) + bytes(file[0].chat_metadata.solve) + bytes(file[0].chat_metadata.variables?.solve),
    fileBytes: Buffer.byteLength(file.map(value => JSON.stringify(value)).join('\n') + '\n') };
}
let nativeCard: any, nativeFile: any[] | undefined;
for (const card of setup.cards) {
  assert.equal(card.name, `SOLVE_${card.mode}_${setup.id}`);
  assert.equal(card.avatar, card.name + '.png');
  const character = await (await post('/api/characters/get', { avatar_url: card.avatar })).json();
  const address = { avatar_url: card.avatar, file_name: character.chat };
  const original = await (await post('/api/chats/get', address)).json();
  await writeFile(`${backup}/${card.mode}.json`, JSON.stringify(original));
  const archive = archiveFromChat(original[0].chat_metadata, original.slice(1))!;
  const ctx = context(card, character.chat, original);
  const c = await attachSillyTavern(definition, () => ctx, { cache: false }, fetcher);
  assert.equal(c.getStatus().ready, true);
  const saved = await (await post('/api/chats/get', address)).json();
  const decoded = archiveFromChat(saved[0].chat_metadata, saved.slice(1))!;
  assert.equal(await engine.hash(decoded), await engine.hash(archive));
  assert.deepEqual(saved.slice(1).map((message: any) => message.mes), original.slice(1).map((message: any) => message.mes));
  for (const commit of Object.values(archive.commits)) assert.deepEqual(await engine.restore(decoded, commit.id), await engine.restore(archive, commit.id));
  assert.deepEqual(saved[0].chat_metadata.variables.solve.data, c.getState().data);
  for (const message of saved.slice(1)) {
    for (const extra of [message.extra, ...(message.swipe_info ?? []).map((info: any) => info.extra)]) assert.equal(extra?.solve?.commits, undefined);
    for (const variables of Object.values(message.variables ?? {}) as any[]) if (variables.solve) {
      const floor = variables.solve, commit = decoded.commits[readToken(floor.commit.id)]!;
      assert.equal(floor.version, 3); assert.ok(commit);
      assert.deepEqual(floor.operations.map((action: any) => action.operations), commit.actions.map(action => action.kind === 'operations' ? action.operations : undefined));
      assert.deepEqual((await c.inspectCommit(floor.commit.id)).commit, commit);
      assert.deepEqual(floor.dataPatch, commit.dataPatch);
      assert.deepEqual(floor.enginePatch ?? [], commit.enginePatch);
    }
  }
  const before = measure(original), after = measure(saved);
  results.push({ mode: card.mode, character: card.name, before, after,
    floorReductionPercent: +(100 * (1 - after.floorBytes / before.floorBytes)).toFixed(2),
    totalReductionPercent: +(100 * (1 - after.totalSolveBytes / before.totalSolveBytes)).toFixed(2),
    unchangedArchive: true, preservedCommits: Object.keys(archive.commits).length,
    hp: saved[0].chat_metadata.variables.solve.data.characters.player.hp, gold: saved[0].chat_metadata.variables.solve.data.characters.player.gold });
  c.dispose();
  const coldContext = context(card, character.chat, saved);
  const reopened = await attachSillyTavern(definition, () => coldContext, { cache: false }, fetcher);
  assert.deepEqual(reopened.getState().data, saved[0].chat_metadata.variables.solve.data);
  reopened.dispose();
  if (card.mode === 'native') { nativeCard = card; nativeFile = saved; }
}
assert.ok(nativeCard && nativeFile);
const branchName = `SOLVE_compact_${setup.id}_${run}`;
const branch = structuredClone(nativeFile!); branch[0].chat_metadata.integrity = crypto.randomUUID();
await post('/api/chats/save', { avatar_url: nativeCard.avatar, file_name: branchName, ch_name: nativeCard.name, force: false, chat: branch });
const ctx = context(nativeCard, branchName, branch), handlers = new Map<string, (...args: any[]) => unknown>();
ctx.eventTypes = { MESSAGE_SWIPED: 'swipe' };
ctx.eventSource = { on: (event, listener) => { handlers.set(event, listener); }, removeListener: event => { handlers.delete(event); } };
const c = await attachSillyTavern(definition, () => ctx, { cache: false }, fetcher);
const index = ctx.chat.findLastIndex(message => (message.swipes?.length ?? 0) > 1);
assert.ok(index >= 0);
const message = ctx.chat[index]!, selected = message.swipe_id ?? 0;
message.swipe_id = selected === 0 ? 1 : 0; message.mes = message.swipes![message.swipe_id]!;
message.extra = structuredClone(message.swipe_info![message.swipe_id]!.extra);
await handlers.get('swipe')!(index);
const address = { avatar_url: nativeCard.avatar, file_name: branchName };
const switched = await (await post('/api/chats/get', address)).json();
assert.equal(switched[0].chat_metadata.solve.sessionId, c.runtime.sessionId);
assert.equal(switched[0].chat_metadata.variables.solve.headId, c.getStatus().headId);
const hp = c.getValue('@player.hp') as number, baseline = JSON.stringify(switched);
await c.preview({ $inc: { '@player.hp': -1 } });
assert.equal(JSON.stringify(await (await post('/api/chats/get', address)).json()), baseline);
const action = { actionId: 'compact-live-' + run };
await c.submit({ $inc: { '@player.hp': -1 } }, action);
const headId = c.getStatus().headId;
await c.submit({ $inc: { '@player.hp': -1 } }, action);
assert.equal(c.getStatus().headId, headId);
const submitted = await (await post('/api/chats/get', address)).json();
assert.equal(submitted[0].chat_metadata.variables.solve.data.characters.player.hp, hp - 1);
assert.ok((await c.validateArchive()).every(result => result.valid));
c.dispose();
const coldContext = context(nativeCard, branchName, submitted);
const reopened = await attachSillyTavern(definition, () => coldContext, { cache: false }, fetcher);
assert.equal(reopened.getValue('@player.hp'), hp - 1); reopened.dispose();
const report = { version: engine.VERSION, at: new Date().toISOString(), target: setup.origin, passed: true, backup, results,
  branch: { name: branchName, swipeHp: hp, submittedHp: hp - 1, previewDidNotSave: true, deduplicated: true, coldRestore: true },
  scope: '真实本机API、存储与控制器验证；未代称已刷新浏览器页面' };
await writeFile(`${directory}/compact-v3-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
