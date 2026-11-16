/**
 * One-line entry: `import 'https://…/solve/auto.js'` in a Tavern Helper character script.
 * Loads SOLVE and registers the official structure as the card's own (the card open when the script runs): new chats
 * of the card offer it first in 选择数据结构.
 * Cards with their own structure should use dynamic.js and register their definition instead.
 */
import { install } from './dynamic.js';
import { hostWindow } from './host/install.js';

const SOLVE = (await install())!;
const ctx = hostWindow().SillyTavern.getContext();
const avatar: string | undefined = ctx.characters?.[ctx.characterId]?.avatar;
if (!avatar) throw new Error('SOLVE auto.js：没有打开的角色卡。请把它放在角色脚本里，或改用 dynamic.js 自己注册');
await SOLVE.register(SOLVE.compileStructure(SOLVE.officialStructure), { characters: [avatar] });
console.info(`[SOLVE] auto.js：官方数据结构已登记为「${ctx.characters[ctx.characterId].name}」自带的结构`);

export default SOLVE;
