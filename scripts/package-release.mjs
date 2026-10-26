import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createZip } from './release-zip.mjs';

const info = JSON.parse(await readFile('package.json', 'utf8')), version = info.version;
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(version)) throw new Error('Invalid release version');
if (JSON.parse(await readFile('dist/manifest.json', 'utf8')).version !== version) throw new Error('Run npm run build first');
const output = resolve('artifacts/releases', version); await mkdir(output, { recursive: true });
const digest = value => createHash('sha256').update(value).digest('hex');
const source = new Map(), runtime = new Map();
const textFile = name => /(?:\.(?:ts|tsx|js|mjs|cjs|json|md|txt|yml|yaml|css|html|map)|(?:^|\/)(?:LICENSE|NOTICE|\.gitignore|\.gitattributes))$/u.test(name);
async function read(path) { const data = await readFile(path); return textFile(path) ? Buffer.from(data.toString('utf8').replaceAll('\r\n', '\n')) : data; }
async function collect(path, target, filter = () => true) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = path + '/' + entry.name; if (!filter(name)) continue;
    if (entry.isSymbolicLink()) throw new Error('Refusing symlink in release: ' + name);
    if (entry.isDirectory()) await collect(name, target, filter);
    else if (entry.isFile()) target.set(name, await read(name));
  }
}
for (const name of ['src', 'tests', 'examples', 'docs', '.github']) await collect(name, source);
await collect('scripts', source, name => !/(?:^|\/)(?:live-test-|test-live-|update-live-test-)/u.test(name));
for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'LICENSE', 'NOTICE', '.gitignore', '.gitattributes', 'CHANGELOG.md']) source.set(name, await read(name));
for (const name of (await readdir('.')).filter(name => name.startsWith('SOLVE_') && name.endsWith('.md'))) source.set(name, await read(name));
const sourcePrefix = `SOLVE-source-${version}/`;
const sourceZip = createZip([...source].map(([name, data]) => [sourcePrefix + name, data]));
const sourceNotice = Buffer.from(`# SOLVE ${version} 对应源码\n\n本包附带 [SOURCE_CODE.zip](SOURCE_CODE.zip)，其 SHA256 为 ${digest(sourceZip)}。解压后运行 npm ci、npm run check:portable。\n\n该归档包含本次构建的实际源码、锁文件、构建脚本、测试与文档；项目仓库为 https://github.com/aforgomon41-create/SillyTavern-Oriented-LLM-Variable-Engine 。远程预览标签和发布状态见 release.json/交付说明，未发布时不以仓库首页代替本归档。\n\n许可：AGPL-3.0-only。保留 LICENSE、NOTICE、THIRD_PARTY_NOTICES.txt。\n`);
const names = ['manifest.json', 'index.js', 'solve.js', 'sillytavern.js', 'runtime.js', 'dynamic.js', 'embedded.js', 'debug.html', 'debug-inline.html', 'debug.js', 'debug.css', 'rpg-example.js', 'README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt'];
for (const name of names) runtime.set(name, await read('dist/' + name));
for (const name of (await readdir('dist')).filter(name => name.endsWith('.map'))) runtime.set(name, await read('dist/' + name));
const docs = new Map(); await collect('dist/docs', docs);
for (const [name, data] of docs) runtime.set(name.slice('dist/'.length), data);
runtime.set('SOURCE_CODE.zip', sourceZip); runtime.set('SOURCE_CODE.md', sourceNotice);
const example = `// 放在 embedded.js 之后；动态载体取得 SOLVE 后也可使用。\nconst host = window.parent.SillyTavern?.getContext ? window.parent : window;\nconst z = SOLVE.z;\nawait SOLVE.register({id:'solve-starter',version:'1.0.0',schema:z.object({hp:z.number().min(0).max(100).default(100)}),initialData:{},guide:'受到伤害时减少hp。'}, {characters:[host.SillyTavern.getContext().characters[host.SillyTavern.getContext().characterId].avatar]});\n`;
const seed = digest(Buffer.from('SOLVE embedded starter ' + version));
const scriptId = `${seed.slice(0,8)}-${seed.slice(8,12)}-4${seed.slice(13,16)}-a${seed.slice(17,20)}-${seed.slice(20,32)}`;
const script = { type: 'script', enabled: true, name: `SOLVE ${version} 内嵌入门示例`, id: scriptId,
  content: runtime.get('embedded.js').toString('utf8') + '\n' + example, info: '预览版；导入角色卡脚本，详见INSTALL.md。', button: { enabled: false, buttons: [] }, data: {}, export_with: { data: true, button: true } };
const embedded = new Map(['embedded.js', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.txt', 'SOURCE_CODE.zip', 'SOURCE_CODE.md'].map(name => [name, runtime.get(name)]));
embedded.set('AUTHOR_EXAMPLE.js', Buffer.from(example)); embedded.set('tavern-helper-script.json', Buffer.from(JSON.stringify(script, null, 2) + '\n'));
const channel = version.includes('-') ? 'preview' : 'release';
const status = Buffer.from(`# SOLVE ${version}\n\n当前为${channel === 'preview' ? '预览版，真实页面边界仍有待验收项目' : '发布构建'}。安装前备份聊天；三种载体需统一版本。\n\n`);
runtime.set('INSTALL.md', Buffer.concat([status, Buffer.from('原生：解压后将 solve 文件夹放入酒馆自定义扩展目录，manifest.json 必须直接位于 solve 下，再重载酒馆。\n动态：将 solve 文件夹全部托管到 HTTP(S)，导入其 dynamic.js，并注册作者定义。\n对应源码随包附在 SOURCE_CODE.zip；不要单独复制一个入口文件。\n') ]));
embedded.set('INSTALL.md', Buffer.concat([status, Buffer.from('需要酒馆助手。在独立角色卡脚本中导入 tavern-helper-script.json，或粘贴 embedded.js 全文并追加 AUTHOR_EXAMPLE.js。示例只含 hp；正式卡片须提供自己的作者定义。\n此方式内含引擎和调试面板；对应源码在 SOURCE_CODE.zip。\n') ]));
const prefix = entries => [...entries].map(([name, data]) => ['solve/' + name, data]);
const artifacts = new Map([
  [`SOLVE-source-${version}.zip`, sourceZip],
  [`SOLVE-native-${version}.zip`, createZip(prefix(runtime))],
  [`SOLVE-dynamic-${version}.zip`, createZip(prefix(runtime))],
  [`SOLVE-embedded-${version}.zip`, createZip(embedded)],
]);
const manifest = { version, channel, license: info.license, sourceArchive: `SOLVE-source-${version}.zip`, sourceSha256: digest(sourceZip),
  remotePublication: 'not-performed-by-packaging', artifacts: [...artifacts].map(([file, data]) => ({ file, bytes: data.length, sha256: digest(data) })) };
for (const [name, data] of artifacts) await writeFile(resolve(output, name), data);
await writeFile(resolve(output, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(resolve(output, 'SHA256SUMS.txt'), manifest.artifacts.map(item => item.sha256 + '  ' + item.file).join('\n') + '\n');
console.log(JSON.stringify({ version, directory: output, artifacts: manifest.artifacts }, null, 2));
