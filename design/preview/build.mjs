#!/usr/bin/env node
/**
 * 构建 SOLVE 界面合并预览：输出单文件 HTML（审阅用）。
 * 需要卡密预设仓库（运行库与皮肤）：KAMI_ROOT（默认 ../sillytavern-kami-preset），并先在那里跑
 * node build/frontend/pack-skins.mjs 生成 .cache/frontend/skins.json。
 * 用法：node design/preview/build.mjs [输出文件]（默认 design/preview/out/index.html，不进 Git）
 * 预览里打包了卡密预设的运行库代码（CC BY-NC 4.0），只用于审阅，不进入 SOLVE 的分发包。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const KAMI = path.resolve(process.env.KAMI_ROOT || path.join(ROOT, '..', 'sillytavern-kami-preset'));
const out = path.resolve(process.argv[2] || path.join(HERE, 'out', 'index.html'));
const kamiRequire = createRequire(path.join(KAMI, 'package.json'));
const esbuild = kamiRequire('esbuild');
const { withRadixPatches } = await import(pathToFileURL(path.join(KAMI, 'build/frontend/radix-patches.mjs')).href);
const skins = path.join(KAMI, '.cache/frontend/skins.json');
if (!fs.existsSync(skins)) throw new Error('缺少 ' + skins + '：先在卡密仓库运行 node build/frontend/pack-skins.mjs');

const kamiModules = path.join(KAMI, 'node_modules');
const result = await esbuild.build(withRadixPatches({
  entryPoints: [path.join(HERE, 'main.tsx')], bundle: true, write: false, format: 'iife', minify: true,
  target: ['es2020', 'chrome108', 'safari16'], jsx: 'automatic', legalComments: 'none', charset: 'utf8',
  loader: { '.css': 'text', '.png': 'dataurl', '.json': 'json' },
  define: { 'process.env.NODE_ENV': '"production"', __BUILD__: JSON.stringify(new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })) },
  // One React for both the Kami runtime and the SOLVE components.
  alias: {
    'kami': path.join(KAMI, 'src'), 'kami-skins': skins,
    'react': path.join(kamiModules, 'react'), 'react-dom': path.join(kamiModules, 'react-dom'),
  },
  nodePaths: [path.join(ROOT, 'node_modules'), kamiModules],
  logLevel: 'warning',
}));
const js = result.outputFiles[0].text.replace(/<\/script/giu, '<\\/script');
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8').replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('[预览] ' + path.relative(process.cwd(), out) + '  ' + Math.round(html.length / 1024) + 'KB');
