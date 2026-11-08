import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { liveDefinition, mountLiveHud } from './live-test-hud.js';

const origin = 'http://localhost:11451', server = 'C:/Program Files/SillyTavern Launcher GUI/data/sillytavern/1.19.0';
const id = crypto.randomUUID().slice(0, 8), assetsName = 'http://localhost:4176';
let cookie = '', csrf = '';
async function request(path, options = {}) {
  const response = await fetch(origin + path, { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } });
  if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response;
}
csrf = (await (await request('/csrf-token')).json()).token;
await mkdir('test-results/live-distribution', { recursive: true });
const setup = { id, origin, server, assetsName, createdAt: new Date().toISOString(), cards: [] };
const helpers = `const liveDefinition = ${liveDefinition.toString()};\nconst mountLiveHud = ${mountLiveHud.toString()};\n`;
for (const mode of ['dynamic', 'embedded', 'native']) {
  const name = `SOLVE_${mode}_${id}`;
  const author = `\n${helpers}\nawait SOLVE.register(liveDefinition(SOLVE), { characters: [window.parent.SillyTavern.getContext().characters[window.parent.SillyTavern.getContext().characterId].avatar] });\nconst cleanup = mountLiveHud(SOLVE, ${JSON.stringify(mode)}, window.parent);\nwindow.addEventListener('pagehide', cleanup, { once:true });\n`;
  const content = mode === 'embedded' ? await readFile('dist/embedded.js', 'utf8') + author : `const { install } = await import(${JSON.stringify(assetsName + '/dynamic.js')});\nconst SOLVE = await install();` + author;
  const script = { type: 'script', enabled: true, name: `SOLVE ${mode} 实机验收`, id: crypto.randomUUID(), content, info: '仅用于独立验收角色。', button: { enabled: false, buttons: [] }, data: {}, export_with: { data: true, button: true } };
  const prompt = 'You are an integration test character. For every user test message reply EXACTLY with the following two lines and nothing else. Do not use code fences. Do not roleplay.\n验收完成。\n<solve_operate>{"$inc":{"@player.hp":-5}}</solve_operate>';
  const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description: prompt, personality: '精确执行测试，不写额外内容。', scenario: '独立软件验收', first_mes: 'SOLVE 独立实机验收已开始。初始 HP=100，金币=100。', mes_example: '', creator_notes: `SOLVE ${mode} carrier test ${id}`, system_prompt: prompt, post_history_instructions: prompt, alternate_greetings: [], tags: ['SOLVE实机验收'], creator: 'SOLVE test', character_version: '1.0', extensions: mode === 'native' ? {} : { tavern_helper: { scripts: [script], variables: {} } } } };
  await writeFile(`test-results/live-distribution/${name}.json`, JSON.stringify(card));
  if (mode !== 'native') await writeFile(`test-results/live-distribution/${mode}-script.json`, JSON.stringify(script));
  const form = new FormData(); form.set('avatar', new File([JSON.stringify(card)], `${name}.json`, { type: 'application/json' })); form.set('file_type', 'json'); form.set('preserved_name', name);
  const imported = await (await request('/api/characters/import', { method: 'POST', body: form })).json();
  if (imported.error || !imported.file_name) throw new Error(`导入 ${mode} 失败`);
  setup.cards.push({ mode, name, avatar: imported.file_name.endsWith('.png') ? imported.file_name : imported.file_name + '.png' });
}
const nativeCard = setup.cards.find(c => c.mode === 'native');
setup.nativeExtra = `\n${helpers}\nawait window.SOLVE.register(liveDefinition(window.SOLVE), { characters: ${JSON.stringify(setup.cards.map(c => c.avatar))} });\nlet liveCleanup;\nconst renderLiveTest = () => { liveCleanup?.(); liveCleanup = undefined; const ctx = window.SillyTavern.getContext(); if (ctx.characters[ctx.characterId]?.avatar === ${JSON.stringify(nativeCard.avatar)}) liveCleanup = mountLiveHud(window.SOLVE, 'native', window); };\nwindow.SillyTavern.getContext().eventSource.on(window.SillyTavern.getContext().eventTypes.CHAT_CHANGED, renderLiveTest);\nrenderLiveTest();\n`;
await writeFile('test-results/live-distribution/setup.json', JSON.stringify(setup, null, 2));
console.log(JSON.stringify({ id, assetsName, cards: setup.cards }, null, 2));
