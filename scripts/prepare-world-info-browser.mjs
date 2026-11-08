// Prepare disposable fixtures for MANUAL browser acceptance on an isolated local host.
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
const origin = new URL(process.env.SOLVE_TEST_URL ?? 'http://127.0.0.1:11452');
const dataRoot = resolve(process.env.SOLVE_BROWSER_DATA_ROOT ?? 'test-results/browser-host/data');
const testRoot = resolve('test-results');
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.port === '11451') throw new Error('仅允许独立本机测试酒馆，不能使用现有11451环境');
if (!dataRoot.startsWith(testRoot + sep)) throw new Error('测试数据目录必须位于本项目test-results内，不能指向日常酒馆');
await access(resolve(dataRoot, 'default-user/settings.json')); // Host must already have initialized this isolated root.
let cookie = '', csrf = '';
async function request(path, options = {}) {
  const response = await fetch(new URL(path, origin), { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } });
  const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
  if (!response.ok) throw new Error(path + ' HTTP ' + response.status); return response;
}
const post = (path, body) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
csrf = (await (await request('/csrf-token')).json()).token;
const hostVersion = (await (await request('/version')).json()).pkgVersion;
if (!/^1\.19\./u.test(hostVersion)) throw new Error('需要SillyTavern1.19');
const id = crypto.randomUUID().slice(0, 8), prefix = 'SOLVE_browser_world_', extension = 'solve-browser-' + id;
const result = { id, origin: origin.origin, hostVersion, dataRoot, extension, cards: [], prepared: false };
const output = resolve(testRoot, 'browser-fixture-' + id + '.json');
const persist = () => writeFile(output, JSON.stringify(result, null, 2) + '\n');
await mkdir(testRoot, { recursive: true }); await persist();
const entry = (uid, comment, content) => ({ uid, comment, content, key: [], keysecondary: [], constant: false, selective: true, order: 100, position: 0,
  disable: false, addMemo: true, excludeRecursion: true, preventRecursion: true, probability: 100, useProbability: true, displayIndex: uid, depth: 4, role: null });
const existingBooks = new Set((await (await post('/api/worldinfo/list', {})).json()).map(book => book.file_id));
for (const [suffix, hp] of [['A', 90], ['B', 40]]) {
  const name = prefix + suffix + '_' + id, book = name + '_book', row = { name, book, hp, bookCreated: false };
  if (existingBooks.has(book)) throw new Error('测试书名已存在，拒绝覆盖：' + book);
  result.cards.push(row); await persist();
  await post('/api/worldinfo/edit', { name: book, data: { entries: { 0: entry(0, '[SOLVE:INIT]', JSON.stringify({ hp })), 1: entry(1, '[SOLVE:GUIDE]', '受到伤害时减少hp。'), 2: entry(2, '普通条目', '普通条目不应进入声明') } } });
  row.bookCreated = true; await persist();
  row.avatar = await (await post('/api/characters/create', { ch_name: name, file_name: name, first_mes: '世界书页面验收，初始HP=' + hp, world: book })).text();
  await persist(); if (row.avatar !== name + '.png') throw new Error('角色文件名不符，见已保存的fixture记录');
}
const directory = resolve(dataRoot, 'default-user/extensions', extension);
await cp('dist', directory, { recursive: true, force: false, errorOnExist: true });
for (const file of ['browser-world-info.js', 'browser-cache-benchmark.js']) await cp('scripts/' + file, resolve(directory, file));
await writeFile(resolve(directory, 'index.js'), await readFile(resolve(directory, 'index.js'), 'utf8') + '\nimport { mountWorldInfoAcceptance } from "./browser-world-info.js"; mountWorldInfoAcceptance(window.SOLVE);\n');
result.prepared = true; await persist();
console.log(JSON.stringify({ fixture: output, ...result }, null, 2));
