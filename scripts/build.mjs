import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/solve.js', sourcemap: true });
await build({ entryPoints: ['src/host/controller.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/sillytavern.js', sourcemap: true });
await build({ entryPoints: ['src/extension.ts'], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: 'dist/index.js', sourcemap: true });
await build({ entryPoints: ['examples/rpg-definition.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/rpg-example.js', sourcemap: true });
await writeFile('dist/manifest.json', JSON.stringify({ display_name: 'SOLVE 后端', author: 'SOLVE', version: '0.5.0',
  loading_order: 50, requires: [], optional: [], js: 'index.js', generate_interceptor: 'solve_generation_interceptor',
  auto_update: false, minimum_client_version: '1.19.0' }, null, 2));
console.log('已生成 Core、1.19 Adapter 与无界面扩展构建。');
