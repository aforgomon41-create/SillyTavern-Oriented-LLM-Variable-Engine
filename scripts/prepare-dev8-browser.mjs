// Isolated local acceptance fixture only; never touches the user's daily instance.
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('test-results/browser-dev8'); await mkdir(root, { recursive: true });
const fixture = JSON.parse(await readFile('test-results/browser-dev6/fixture.json', 'utf8'));
if (fixture.origin !== 'http://127.0.0.1:11452' || fixture.id !== '97a0081d') throw new Error('Unexpected fixture');
const dataRoot = resolve('test-results/browser-dev6/data/default-user');
if (resolve(fixture.dataRoot) !== dataRoot) throw new Error('Unexpected data root');
for (const row of fixture.chats) {
  const from = resolve(dataRoot, 'chats', fixture.long.name, row.filename + '.jsonl');
  row.filename = row.filename.replace('live6', 'live8');
  const to = resolve(dataRoot, 'chats', fixture.long.name, row.filename + '.jsonl');
  await copyFile(from, to, 1); // COPYFILE_EXCL; preserve prior test input on reruns.
  await copyFile(from, resolve(root, row.filename + '-input.jsonl'), 1);
}
fixture.version = '0.9.0-dev.8';
const extension = resolve(dataRoot, 'extensions', fixture.extension);
await cp('dist', extension, { recursive: true });
let harness = await readFile('test-results/browser-dev6/acceptance.js', 'utf8');
harness = harness.replace("'solve-live6-' + fixture.id", "'solve-live8-' + fixture.id");
harness = harness.replace("const submit = await measured(async () =>", "c.clearPerformance(); const verificationBefore = c.getVerificationStats();\n    const submit = await measured(async () =>");
harness = harness.replace("check(c.getValue('@e0.count') === before + 1, 'Submit result mismatch');", "submit.stages = c.getPerformance(); submit.verificationBefore = verificationBefore; submit.verificationAfter = c.getVerificationStats();\n    check(c.getValue('@e0.count') === before + 1, 'Submit result mismatch');");
const append = `
  button('追加一楼并核对保存', async () => {
    check(selected().avatar === fixture.long.avatar, 'Select long card');
    const c = SOLVE.controller, before = c.getValue('@e0.count');
    context().chat.push({ mes: 'dev8测试正文<solve_operate>{"$inc":{"@e0.count":1}}</solve_operate>', extra: {} });
    c.clearPerformance(); const verificationBefore = c.getVerificationStats();
    const timing = await measured(async () => { const commit = await c.processMessage(context().chat.length - 1); return { headId: commit.id }; });
    timing.stages = c.getPerformance(); timing.verificationBefore = verificationBefore; timing.verificationAfter = c.getVerificationStats();
    check(c.getValue('@e0.count') === before + 1, 'Append mismatch');
    return { chat: context().chatId, before, after: c.getValue('@e0.count'), timing, constructedMessage: true, disk: await diskCheck(c) };
  });
`;
harness = harness.replace("  button('检查刷新与缓存回退'", append + "  button('检查刷新与缓存回退'");
await writeFile(resolve(root, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
await writeFile(resolve(root, 'acceptance.js'), harness);
await writeFile(resolve(extension, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
await writeFile(resolve(extension, 'acceptance.js'), harness);
await writeFile(resolve(extension, 'index.js'), await readFile('dist/index.js', 'utf8') + '\nimport { mountLive6 } from "./acceptance.js"; mountLive6(window.SOLVE);\n');
console.log(JSON.stringify({ version: fixture.version, origin: fixture.origin, extension, chats: fixture.chats.map(row => row.filename) }));
