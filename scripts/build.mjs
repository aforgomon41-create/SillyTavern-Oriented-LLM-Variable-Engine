import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const sourceUrl = `https://github.com/aforgomon41-create/SillyTavern-Oriented-LLM-Variable-Engine/tree/v${version}`;
const browserBuild = options => build({ banner: { js: `/*! SOLVE ${version} | Copyright 2026 aforgomon41-create and SOLVE contributors | SPDX-License-Identifier: AGPL-3.0-only | Source: ${sourceUrl} | See LICENSE and THIRD_PARTY_NOTICES.txt. */` }, ...options });

await mkdir('dist', { recursive: true });
await browserBuild({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/solve.js', sourcemap: true });
await browserBuild({ entryPoints: ['src/host/index.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/sillytavern.js', sourcemap: true });
await browserBuild({ entryPoints: ['src/extension.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/index.js', sourcemap: true });
const panelBuild = await browserBuild({ entryPoints: ['src/debug/app.tsx'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/debug.js', minify: true, sourcemap: true, metafile: true, define: { 'process.env.NODE_ENV': '"production"' } });
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
for (const name of ['debug-desktop-light.jpg', 'debug-mobile-dark.jpg']) await copyFile(`docs/images/${name}`, `dist/docs/images/${name}`);
await copyFile('README.md', 'dist/README.md');
await copyFile('LICENSE', 'dist/LICENSE');
await copyFile('NOTICE', 'dist/NOTICE');
await writeFile('dist/SOURCE_CODE.md', `# SOLVE ${version} corresponding source\n\nLicense: AGPL-3.0-only. See LICENSE and NOTICE.\n\nExact version source: ${sourceUrl}\n\nDownload source: https://github.com/aforgomon41-create/SillyTavern-Oriented-LLM-Variable-Engine/archive/refs/tags/v${version}.zip\n\nBuild with Node.js 22 or later: npm ci, then npm run build. Run npm run check for verification. The lockfile identifies exact dependency versions and their registry sources; browser source maps contain the bundled source. Preserve third-party notices. If you modify this version, provide the actual corresponding source of your modified version and update these links.\n`);
for (const name of ['backend-design.md', 'frontend-design.md', 'debug-api.md', 'implementation-status.md', 'verification.md', 'licensing.md']) await copyFile(`docs/${name}`, `dist/docs/${name}`);
console.log('已生成 Core、1.19 Adapter、React / Radix 调试面板与扩展构建。');
