import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const sourceUrl = 'https://github.com/aforgomon41-create/SillyTavern-Oriented-LLM-Variable-Engine';
const browserBuild = async options => {
  const result = await build({ banner: { js: `/*! SOLVE ${version} | Copyright 2026 aforgomon41-create and SOLVE contributors | SPDX-License-Identifier: AGPL-3.0-only | Source: SOURCE_CODE.zip included in release packages | Project: ${sourceUrl} | See LICENSE and THIRD_PARTY_NOTICES.txt. */` }, ...options });
  if (options.sourcemap && options.outfile && options.write !== false) {
    const path = options.outfile + '.map', map = JSON.parse(await readFile(path, 'utf8'));
    // CRLF and LF sources map to the same lines; normalize embedded text for reproducible archives.
    if (map.sourcesContent) map.sourcesContent = map.sourcesContent.map(source => source?.replaceAll('\r\n', '\n') ?? null);
    await writeFile(path, JSON.stringify(map) + '\n');
  }
  return result;
};

await mkdir('dist', { recursive: true });
await browserBuild({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/solve.js', sourcemap: true });
await browserBuild({ entryPoints: ['src/host/index.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/sillytavern.js', sourcemap: true });
await browserBuild({ entryPoints: ['src/extension.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/index.js', sourcemap: true });
await browserBuild({ entryPoints: ['src/runtime-entry.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/runtime.js', sourcemap: true });
await browserBuild({ entryPoints: ['src/dynamic.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/dynamic.js', sourcemap: true });
const panelBuild = await browserBuild({ entryPoints: ['src/debug/app.tsx'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/debug.js', minify: true, sourcemap: true, metafile: true, define: { 'process.env.NODE_ENV': '"production"' } });
const inlinePanel = await browserBuild({ entryPoints: ['src/debug/app.tsx'], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: 'dist/inline-debug.js', write: false, minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
const inlineJs = inlinePanel.outputFiles.find(file => file.path.endsWith('.js')).text;
const inlineCss = inlinePanel.outputFiles.find(file => file.path.endsWith('.css')).text;
const inlineHtml = (await readFile('src/debug/index.html', 'utf8')).replace('<link rel="stylesheet" href="./debug.css">', () => `<style>${inlineCss}</style>`).replace('<script type="module" src="./debug.js"></script>', () => `<script>${inlineJs.replaceAll('</script', '<\\/script')}</script>`);
await writeFile('dist/debug-inline.html', inlineHtml);
const embedded = await browserBuild({ entryPoints: ['src/embedded-entry.ts'], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, minify: true, define: { SOLVE_DEBUG_HTML: JSON.stringify(inlineHtml) } });
// The parent realm owns timers and subscriptions even after the importing helper iframe is removed.
const literal = text => JSON.stringify(text).replaceAll('<', '\\u003c');
await writeFile('dist/embedded.js', `const SOLVE = (() => {\n  const host = window.parent !== window && window.parent.SillyTavern?.getContext ? window.parent : window;\n  const script = host.document.createElement('script');\n  script.textContent = ${literal(embedded.outputFiles[0].text)};\n  host.document.head.append(script); script.remove();\n  if (host.SOLVE?.version !== ${JSON.stringify(version)}) throw new Error('SOLVE内嵌版本冲突，请统一版本后刷新');\n  const lease = host.SOLVE.use({ kind: 'embedded' });\n  window.addEventListener('pagehide', () => { void lease.dispose(); }, { once: true });\n  return lease;\n})();\n`);
const packages = new Set(Object.keys(panelBuild.metafile.inputs).map(path => path.match(/^node_modules\/(@[^/]+\/[^/]+|[^/]+)\//)?.[1]).filter(Boolean));
const notices = [];
for (const name of [...packages].sort()) {
  const directory = `node_modules/${name}`;
  const info = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  const licenses = (await readdir(directory)).filter(file => /^licen[sc]e(?:\.|$)/i.test(file));
  for (const license of licenses) notices.push(`${name}@${info.version}\n${await readFile(`${directory}/${license}`, 'utf8')}`);
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n----------------------------------------\n\n'));
await copyFile('src/debug/index.html', 'dist/debug.html');
await browserBuild({ entryPoints: ['scripts/host-preview.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/host-preview.js', minify: true });
await copyFile('scripts/host-preview.html', 'dist/host-preview.html');
await browserBuild({ entryPoints: ['examples/rpg-definition.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/rpg-example.js', sourcemap: true });
await writeFile('dist/manifest.json', JSON.stringify({ display_name: 'SOLVE 变量引擎与调试面板', author: 'SOLVE', version,
  loading_order: 50, requires: [], optional: [], js: 'index.js', generate_interceptor: 'solve_generation_interceptor',
  auto_update: false, minimum_client_version: '1.19.0' }, null, 2));
await mkdir('dist/docs', { recursive: true });
await mkdir('dist/docs/images', { recursive: true });
for (const name of ['debug-desktop-light.jpg', 'debug-mobile-dark.jpg', 'live-native-desktop.jpg', 'live-mobile-operation.jpg']) await copyFile(`docs/images/${name}`, `dist/docs/images/${name}`);
await copyFile('README.md', 'dist/README.md');
await copyFile('LICENSE', 'dist/LICENSE');
await copyFile('NOTICE', 'dist/NOTICE');
await writeFile('dist/SOURCE_CODE.md', `# SOLVE ${version} corresponding source\n\nLicense: AGPL-3.0-only. See LICENSE and NOTICE.\n\nRelease packages generated by npm run package include SOURCE_CODE.zip with the actual sources used for this build, a lockfile, tests and build scripts. Package metadata records its SHA256. A standalone development dist is built from the surrounding project workspace; package it before distribution.\n\nProject repository: ${sourceUrl}\n\nBuild with Node.js 22 or later: npm ci, then npm run check:portable. Preserve third-party notices. A repository homepage or an unpublished tag does not replace the corresponding source archive.\n`);
for (const name of ['backend-design.md', 'frontend-design.md', 'debug-api.md', 'distributions.md', 'implementation-status.md', 'verification.md', 'storage-format.md', 'licensing.md', 'acceptance-release-plan.md', 'release-guide.md']) await copyFile(`docs/${name}`, `dist/docs/${name}`);
console.log('已生成动态Import、卡内嵌单文件、原生扩展及React / Radix调试面板。');
