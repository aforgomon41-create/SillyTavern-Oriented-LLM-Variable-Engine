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
