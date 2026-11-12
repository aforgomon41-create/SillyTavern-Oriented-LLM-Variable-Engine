/**
 * One-line entry: `import 'https://…/solve/auto.js'` in a Tavern Helper character script.
 * Loads SOLVE and binds the official structure to the card that is open when the script runs.
 * Cards with their own structure should use dynamic.js and register their definition instead.
 */
import { install } from './dynamic.js';
import { hostWindow } from './host/install.js';

const SOLVE = (await install())!;
const ctx = hostWindow().SillyTavern.getContext();
const avatar: string | undefined = ctx.characters?.[ctx.characterId]?.avatar;
if (!avatar) throw new Error('SOLVE auto.js：没有打开的角色卡。请把它放在角色脚本里，或改用 dynamic.js 自己注册');
await SOLVE.register(SOLVE.compileStructure(SOLVE.officialStructure), { characters: [avatar] });
console.info(`[SOLVE] auto.js：官方数据结构已绑定到 ${ctx.characters[ctx.characterId].name}`);

export default SOLVE;
