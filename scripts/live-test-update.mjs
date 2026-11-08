import { readFile, writeFile } from 'node:fs/promises';
import { liveDefinition, mountLiveHud } from './live-test-hud.js';
import { liveHttp } from './live-test-http.mjs';
const setup = JSON.parse(await readFile('test-results/live-distribution/setup.json', 'utf8'));
const { post } = await liveHttp();
for (const card of setup.cards.filter(c => c.mode === 'embedded')) {
  const previous = JSON.parse(await readFile(`test-results/live-distribution/${card.name}.json`, 'utf8'));
  const saved = await (await post('/api/characters/get', { avatar_url: card.avatar })).json();
  const script = saved.data.extensions.tavern_helper.scripts.find(item => item.id === previous.data.extensions.tavern_helper.scripts[0].id);
  if (!script) throw new Error('测试脚本身份已变化，拒绝覆盖其他脚本');
  script.content = await readFile('dist/embedded.js', 'utf8') + `\nconst liveDefinition = ${liveDefinition.toString()};\nconst mountLiveHud = ${mountLiveHud.toString()};\nawait SOLVE.register(liveDefinition(SOLVE), { characters: [window.parent.SillyTavern.getContext().characters[window.parent.SillyTavern.getContext().characterId].avatar] });\nconst cleanup = mountLiveHud(SOLVE, 'embedded', window.parent);\nwindow.addEventListener('pagehide', cleanup, { once:true });`;
  const result = await (await post('/api/characters/merge-attributes', { avatars: [card.avatar], data: { data: { extensions: saved.data.extensions } } })).json();
  if (!result.updated?.includes(card.avatar)) throw new Error(JSON.stringify(result));
  await writeFile(`test-results/live-distribution/${card.name}.json`, JSON.stringify(saved));
  await writeFile('test-results/live-distribution/embedded-script.json', JSON.stringify(script));
  console.log('Updated ' + card.name);
}
