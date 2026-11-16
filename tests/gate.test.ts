import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFrameworks, type CardSnapshot } from '../src/ui/statusbar/gate.js';

const snap = (p: Partial<CardSnapshot>): CardSnapshot => ({ greeting: '', scripts: [], entries: [], chatVariables: {}, messages: [], ...p });

test('进入聊天检测：MVU / ERA / 自带 SOLVE / 没有变量', () => {
  assert.equal(detectFrameworks(snap({ greeting: '你好' })).framework, undefined);
  const mvu = detectFrameworks(snap({ entries: [{ comment: '[InitVar]初始化', content: '' }] }));
  assert.equal(mvu.framework, 'mvu');
  assert.match(mvu.evidence[0]!, /\[InitVar\]初始化/);
  assert.equal(detectFrameworks(snap({ greeting: '开场\n<initvar>\na: 1\n</initvar>' })).framework, 'mvu');
  assert.equal(detectFrameworks(snap({ scripts: [{ name: '变量', content: "import 'https://cdn/MagVarUpdate/bundle.js'" }] })).framework, 'mvu');
  assert.equal(detectFrameworks(snap({ greeting: '<VariableInsert>{"a":1}</VariableInsert>' })).framework, 'era');
  assert.equal(detectFrameworks(snap({ chatVariables: { ERAMetaData: {} } })).framework, 'era');
  assert.equal(detectFrameworks(snap({ messages: ['正文<era_data>{"era-message-key"="x"}</era_data>'] })).framework, 'era');
  assert.equal(detectFrameworks(snap({ entries: [{ comment: '[SOLVE:STRUCTURE] 灰烬纪元', content: '{}' }] })).framework, 'solve');
  assert.equal(detectFrameworks(snap({ scripts: [{ name: '结构', content: 'await SOLVE.register(def, {})' }] })).framework, 'solve');
});

test('进入聊天检测：卡自带 SOLVE 结构优先；只提到变量的普通条目不算', () => {
  const both = detectFrameworks(snap({ entries: [{ comment: '[SOLVE:STRUCTURE] x', content: '' }, { comment: '[initvar]旧变量', content: '' }] }));
  assert.equal(both.framework, 'solve');
  assert.equal(detectFrameworks(snap({ entries: [{ comment: '关于变量的说明', content: '这里讲 MVU 的历史' }] })).framework, undefined);
});

test('提示词注入：自动模式跳过卡里已写的宏，关闭的项与「不注入」都不注入', async () => {
  const { injected, INJECT_DEFAULTS } = await import('../src/ui/statusbar/inject.js');
  assert.equal(injected(INJECT_DEFAULTS, 'sop').on, true);
  assert.equal(injected(INJECT_DEFAULTS, 'guide', ['guide']).on, false);
  assert.equal(injected({ ...INJECT_DEFAULTS, mode: 'always' }, 'guide', ['guide']).on, true);
  assert.equal(injected({ ...INJECT_DEFAULTS, mode: 'off' }, 'sop').on, false);
  assert.equal(injected({ ...INJECT_DEFAULTS, items: { ...INJECT_DEFAULTS.items, data: { ...INJECT_DEFAULTS.items.data, on: false } } }, 'data').on, false);
});

import { hostEnvironment } from './host-fixture.js';
import { SolveSessionManager } from '../src/host/sessions.js';
import { hideBlocks } from '../src/parser.js';

test('选择数据结构：打开没有存档的聊天先等玩家选；选了才绑定；「不用」记在聊天里；卡自带的排第一', async () => {
  const env = await hostEnvironment();
  const manager = new SolveSessionManager(() => env.ctx, env.fetcher);
  manager.setGate({});
  await manager.register(env.def, { characters: [], owner: 'catalog', priority: -1 });
  await manager.settled();
  assert.equal(manager.controller, undefined);
  assert.equal(manager.getStatus().phase, 'choose');
  const [only] = manager.getStatus().candidates!;
  assert.equal(only!.own, false);
  // The card registers its own structure: it comes first and is marked as the card's.
  await manager.register({ ...env.def, id: 'own-structure' }, { characters: ['test.png'], owner: 'card:x', priority: 10 });
  assert.equal(manager.getStatus().phase, 'choose', 'a card registration no longer binds by itself');
  const list = manager.getStatus().candidates!;
  assert.deepEqual(list.map(c => [c.id, c.own]), [['own-structure', true], [env.def.id, false]]);
  // 这个聊天不用 SOLVE
  await manager.turnOff();
  assert.equal(manager.getStatus().phase, 'off'); assert.equal(env.ctx.chatMetadata.solve_off, true);
  // Picking one binds it and creates the archive.
  const controller = await manager.choose(list[1]!.key);
  assert.equal(controller.core.definition.id, env.def.id);
  assert.equal(manager.getStatus().phase, 'ready');
  assert.equal(env.ctx.chatMetadata.solve_off, undefined);
  assert.ok(env.ctx.chatMetadata.solve?.definitionHash);
  manager.dispose();
});

test('正文显示隐藏操作块：完整的、流式写到一半的、标签写到一半的', () => {
  assert.equal(hideBlocks('雨还在下。\n<solve_operate>[{"$set":{"a":1}}]</solve_operate>'), '雨还在下。');
  assert.equal(hideBlocks('雨还在下。\n<solve_operate>\n[{"$set":{"a'), '雨还在下。');
  assert.equal(hideBlocks('雨还在下。\n<solve_mutual_operate>[1]</solve_mutual_operate>\n<solve_op'), '雨还在下。');
  assert.equal(hideBlocks('雨还在下。<s'), '雨还在下。');
  assert.equal(hideBlocks('a < b'), 'a < b');
});
