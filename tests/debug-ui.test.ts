import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEditor, isPreviewCurrent } from '../src/debug/editor.js';
import { createDemo } from '../src/debug/demo.js';

test('debug editor rejects primitive batches and preserves explicit author JSON', () => {
  for (const text of ['null', '4', '[]', '[null]', '"text"']) assert.throws(() => parseEditor(text, ''));
  assert.deepEqual(parseEditor('{"$inc":{"@player.hp":-2}}', '{"reason":"调试"}'), {
    operations: { $inc: { '@player.hp': -2 } }, authorInputs: { reason: '调试' }
  });
  assert.throws(() => parseEditor('{}', 'invalid'));
});
test('debug preview cannot submit changed input, author inputs or a different history head', () => {
  const ticket = { input: '{}', author: '', head: 'head-a', actionId: 'one-click' };
  assert.equal(isPreviewCurrent(ticket, '{}', '', 'head-a'), true);
  assert.equal(isPreviewCurrent(ticket, '{ }', '', 'head-a'), false);
  assert.equal(isPreviewCurrent(ticket, '{}', '{}', 'head-a'), false);
  assert.equal(isPreviewCurrent(ticket, '{}', '', 'head-b'), false);
  assert.equal(isPreviewCurrent(undefined, '{}', '', 'head-a'), false);
});
test('standalone debug demo uses real previews, saves, retained revisions and recovery', async () => {
  const connection = await createDemo(), c = connection.sessions.controller!;
  try {
    const first = c.getStatus().headId!;
    const batch = { $inc: { '@player.hp': -5 } };
    const preview = await c.preview(batch);
    assert.equal(c.getValue('@player.hp'), 85, 'preview leaves formal state unchanged');
    await c.submit(batch, { expectedHead: preview.baseHeadId, actionId: 'debug-save' });
    assert.equal(c.getValue('@player.hp'), 80);
    const restored = await c.inspectCommit(first);
    assert.equal((restored.state.data.characters as Record<string, any>).player.hp, 85);
    assert.equal(c.getValue('@player.hp'), 80, 'history inspection never selects the old state');
    assert.equal((await c.compareCommits(first, c.getStatus().headId!)).dataPatch.length, 1);
    assert.equal((await c.validateArchive()).every(item => item.valid), true);
    await assert.rejects(c.submit(batch, { expectedHead: first }), /预演|变化|提交/);
    connection.simulation!.setFailure(true);
    await assert.rejects(c.submit(batch), /保存前连接中断/);
    assert.equal(c.getStatus().pendingCount, 1);
    assert.equal(c.getValue('@player.hp'), 80);
    connection.simulation!.setFailure(false);
    await c.retryPending();
    assert.equal(c.getValue('@player.hp'), 75);
    assert.equal(c.getStatus().pendingCount, 0);
    const archive = await connection.sessions.inspectArchive();
    assert.equal(archive.readonly, true);
    assert.equal(c.getHistory().length, 3);
  } finally { connection.dispose?.(); }
});
