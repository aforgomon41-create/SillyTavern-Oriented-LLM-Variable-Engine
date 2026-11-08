import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { archiveFromChat } from '../src/host/sillytavern.js';
import { hash, restore } from '../src/index.js';
import { expandPointers } from '../src/host/storage-pointers.js';
// @ts-expect-error Local test helper intentionally uses plain JavaScript.
import { liveHttp } from './live-test-http.mjs';
const setup = JSON.parse(await readFile('test-results/live-distribution/setup.json', 'utf8'));
const { post } = await liveHttp();
const results = [];
for (const card of setup.cards) {
  assert.ok(card.name.startsWith('SOLVE_') && card.name.endsWith(setup.id));
  const character = await (await post('/api/characters/get', { avatar_url: card.avatar })).json();
  const file = await (await post('/api/chats/get', { avatar_url: card.avatar, file_name: character.chat })).json();
  if (!Array.isArray(file) || !file.length) { results.push({ mode: card.mode, tested: false }); continue; }
  const archive = archiveFromChat(file[0].chat_metadata ?? {}, file.slice(1));
  if (!archive) { results.push({ mode: card.mode, tested: false }); continue; }
  expandPointers(file.slice(1));
  const selected = [...file.slice(1)].reverse().find(message => message.extra?.solve?.headId)?.extra.solve.headId;
  const state = await restore(archive, selected);
  assert.equal(await hash(state), archive.commits[selected]!.stateHash);
  const actions = new Map(Object.values(archive.commits).flatMap(commit => commit.actions).map(action => [action.actionId, action]));
  results.push({ mode: card.mode, tested: true, character: card.name, chat: character.chat, sessionId: archive.sessionId,
    selectedHead: selected, stateHash: await hash(state), data: state.data,
    revisions: Object.keys(archive.commits).length, uniqueModelActions: [...actions.values()].filter(a => a.source === 'model').length,
    uniqueUserActions: [...actions.values()].filter(a => a.source === 'user').length, coldRestore: true });
}
const report = { at: new Date().toISOString(), host: 'http://localhost:11451', results };
await writeFile('test-results/live-distribution/disk-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
