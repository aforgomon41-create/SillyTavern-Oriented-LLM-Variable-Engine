import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { rpgDefinition, buySword } from '../dist/rpg-example.js';

const sandbox = { crypto, TextEncoder, structuredClone, setTimeout, clearTimeout, console: { info() {}, error() {}, warn() {}, log() {} } };
vm.runInNewContext(await readFile('dist/index.js', 'utf8'), sandbox, { filename: 'solve-bundle.js' });
const api = sandbox.SOLVE;
assert.equal(api.version, '0.5.0');
const definition = await api.compile(rpgDefinition);
const core = new api.SolveCore(definition);
const result = await core.execute(buySword, await core.initialize());
assert.equal(result.feedback.length, 0);
assert.equal(result.state.data.characters.player.gold, 70);
assert.equal(result.state.data.characters.player.inventory.sword.name, '铁剑');
assert.ok(api.toJson(definition, result.state).includes('"@player"'));
assert.ok(api.toToon(definition, result.state).includes('@player'));
console.log('构建包验证通过：跨 JS 上下文的作者定义、group 和双格式输出可运行。');
