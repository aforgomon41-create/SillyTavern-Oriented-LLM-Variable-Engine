import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readZip, createZip } from './release-zip.mjs';
import vm from 'node:vm';
const { version } = JSON.parse(await readFile('package.json', 'utf8')), directory = `artifacts/releases/${version}`;
const manifest = JSON.parse(await readFile(directory + '/release.json', 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
assert.equal(manifest.version, version); assert.equal(manifest.license, 'AGPL-3.0-only');
const source = await readFile(directory + '/' + manifest.sourceArchive); assert.equal(hash(source), manifest.sourceSha256);
const sourceEntries = readZip(source), sourceRoot = `SOLVE-source-${version}/`;
for (const path of ['CONTRIBUTING.md', 'docs/README.md', '.github/pull_request_template.md']) assert.ok(sourceEntries.has(sourceRoot + path), path);
for (const path of ['src/history-restore.ts', 'src/verified-history.ts', 'src/performance.ts', 'tests/verified-history.test.ts', 'scripts/benchmark-commit-pipeline.ts', 'scripts/run-commit-pipeline-benchmark.mjs', 'scripts/compare-commit-pipeline.mjs']) assert.ok(sourceEntries.has(sourceRoot + path), path);
for (const path of ['scripts/benchmark-long-chat.ts', 'scripts/run-long-chat-benchmark.mjs', 'scripts/compare-long-chat.mjs', 'tests/performance-integrity.test.ts']) assert.ok(sourceEntries.has(sourceRoot + path), path);
for (const path of ['src/inline.ts', 'src/facets.ts', 'tests/inline.test.ts', 'tests/facets.test.ts', 'examples/inline-authoring.ts', 'examples/authoring-workflow/index.ts', 'examples/authoring-workflow/structure.ts', 'examples/authoring-workflow/facets.ts', 'examples/authoring-workflow/world-info.ts']) assert.ok(sourceEntries.has(sourceRoot + path), path);
for (const path of ['src/cache.ts', 'tests/cache.test.ts', 'tests/greeting-save.test.ts', 'src/guides.ts', 'tests/guides.test.ts', 'examples/conditional-guides.ts', 'scripts/prepare-world-info-browser.mjs', 'scripts/browser-world-info.js', 'scripts/browser-cache-benchmark.js', 'docs/images/png-upload-dev3.png']) assert.ok(sourceEntries.has(sourceRoot + path), path);
for (const path of ['package.json', 'package-lock.json', 'scripts/build.mjs', 'scripts/check-portable.mjs', 'scripts/run-benchmark.mjs', 'scripts/test-world-info-host.ts', 'src/index.ts', 'src/authoring.ts', 'src/world-info.ts', 'src/definition-snapshot.ts', 'src/host/world-info.ts', 'docs/authoring.md', 'docs/performance.md', 'examples/modular/index.ts', 'tests/authoring.test.ts', 'tests/world-info-host.test.ts', 'tests/acceptance.test.ts', 'LICENSE', 'docs/verification.md', '.github/workflows/check.yml']) assert.ok(sourceEntries.has(sourceRoot + path), path);
for (const name of sourceEntries.keys()) assert.equal(/(?:^|\/)(?:node_modules|test-results|artifacts|\.git|\.env(?:\..*)?)(?:\/|$)/u.test(name), false, name);
for (const item of manifest.artifacts) {
  const buffer = await readFile(directory + '/' + item.file); assert.equal(buffer.length, item.bytes); assert.equal(hash(buffer), item.sha256);
  const entries = readZip(buffer); assert.deepEqual(createZip(entries), buffer, 'Archive must be deterministic');
  if (item.file.includes('-source-')) continue;
  const root = item.file.includes('-embedded-') ? '' : 'solve/';
  assert.deepEqual(entries.get(root + 'SOURCE_CODE.zip'), source);
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt', 'INSTALL.md', 'SOURCE_CODE.md']) assert.ok(entries.has(root + name), name);
  if (!root) {
    const script = JSON.parse(entries.get('tavern-helper-script.json').toString('utf8'));
    assert.ok(script.content.startsWith(entries.get('embedded.js').toString('utf8')));
    assert.match(script.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    let saved;
    const ctx = { chatId: 'package-starter', characterId: 0, groupId: null, characters: [{ name: 'starter', avatar: 'starter.png' }],
      chat: [{ mes: '开场', extra: {} }], chatMetadata: { integrity: 'package-test' }, getRequestHeaders: () => ({}),
      updateChatMetadata: metadata => { ctx.chatMetadata = metadata; } };
    const parent = vm.createContext({ crypto, performance, TextEncoder, structuredClone, btoa, atob, URL, AbortController, setTimeout, clearTimeout,
      console: { info() {}, warn() {}, error() {}, log() {} }, fetch: async (path, options) => {
        if (path === '/version') return Response.json({ pkgVersion: '1.19.0' });
        if (path === '/api/chats/get') return Response.json(saved ?? {});
        if (path === '/api/chats/save') { saved = JSON.parse(options.body).chat; return Response.json({ ok: true }); }
        throw new Error('Unexpected package starter request');
      }, document: { body: null, createElement: () => ({ remove() {} }), head: { append(script) { vm.runInContext(script.textContent, parent); } } } });
    parent.SillyTavern = { getContext: () => ctx }; vm.runInContext('globalThis.window = globalThis', parent);
    const frame = vm.createContext({ window: { parent, addEventListener() {} } });
    const hp = await vm.runInContext('(async () => {' + script.content + '; return SOLVE.controller.getValue("hp"); })()', frame);
    assert.equal(hp, 100); assert.equal(saved[0].chat_metadata.variables.solve.data.hp, 100);
    parent.SOLVE.detach();
  } else {
    assert.equal(JSON.parse(entries.get(root + 'manifest.json')).version, version);
    for (const name of ['index.js', 'runtime.js', 'dynamic.js', 'debug.html', 'debug-inline.html', 'debug.js', 'debug.css', 'author-examples.js', 'CONTRIBUTING.md', 'CHANGELOG.md', 'docs/README.md', 'docs/development-plan.md', 'docs/authoring.md', 'docs/performance.md', 'docs/images/png-upload-dev3.png']) assert.ok(entries.has(root + name), name);
  }
  for (const [name, content] of entries) if (name.endsWith('.js')) {
    assert.equal(content.includes(Buffer.from('solve-live-acceptance')), false, 'Local HUD leaked into ' + name);
    assert.equal(content.includes(Buffer.from('solve-world-acceptance')), false, 'World-info acceptance HUD leaked into ' + name);
    assert.equal(content.includes(Buffer.from('44a45a8a')), false, 'Local test identity leaked into ' + name);
  }
  for (const [name, content] of entries) if (name.endsWith('.map')) {
    const map = JSON.parse(content.toString('utf8'));
    for (const source of map.sourcesContent ?? []) assert.equal(source?.includes('\r\n') ?? false, false, 'Noncanonical source-map line endings in ' + name);
  }
}
console.log('发布包验证通过：版本、三载体、源码一致性、CRC、校验和、确定性和本机测试隔离。');
