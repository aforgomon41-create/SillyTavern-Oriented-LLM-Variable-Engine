import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeInChat } from '../src/host/inject.js';

test('placed prompts land at the system prompt end, before everything, on the last user message and at the end', () => {
  const chat = [{ role: 'system', content: 'S' }, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a' }, { role: 'user', content: [{ type: 'text', text: 'u2' }] as unknown }];
  placeInChat(chat, { before: ['B'], system: ['X', 'Y'], user: ['U'], end: ['E'] });
  assert.deepEqual(chat.map(m => m.content), ['B', 'S\n\nX\n\nY', 'u1', 'a', [{ type: 'text', text: 'u2' }, { type: 'text', text: 'U' }], 'E']);
});
test('missing system or user messages are added', () => {
  const chat: { role: string; content: unknown }[] = [{ role: 'assistant', content: 'a' }];
  placeInChat(chat, { before: [], system: ['X'], user: ['U'], end: [] });
  assert.deepEqual(chat, [{ role: 'system', content: 'X' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'U' }]);
});
test('the player line is found by its text even when a preset adds user messages after it', () => {
  const chat = [{ role: 'user', content: '我走了。' }, { role: 'user', content: '[继续]' }];
  placeInChat(chat, { before: [], system: [], user: ['U'], end: [] }, '我走了。');
  assert.deepEqual(chat.map(m => m.content), ['我走了。\n\nU', '[继续]']);
});
