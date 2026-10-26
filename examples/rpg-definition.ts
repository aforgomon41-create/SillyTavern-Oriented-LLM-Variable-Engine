import { z } from 'zod';
import type { Definition } from '../src/index.js';

const item = z.object({ name: z.string(), count: z.number().int().min(0).default(1) });
export const rpgDefinition: Definition = {
  id: 'solve-rpg-example', version: '1.0.0',
  schema: z.object({
    world: z.object({ weather: z.string().default('晴') }).default({ weather: '晴' }),
    characters: z.record(z.string(), z.object({ name: z.string(), hp: z.number().min(0).max(100).default(100),
      gold: z.number().int().min(0).default(100), inventory: z.record(z.string(), item).default({}) })),
    shop: z.record(z.string(), item).default({})
  }),
  initialData: { characters: { player: { name: '玩家' } }, shop: { sword: { name: '铁剑' } } },
  entities: [{ path: 'characters', type: 'character' }, { path: 'characters.*.inventory', type: 'item' }, { path: 'shop', type: 'item' }],
  guide: '战斗后更新血量。买东西时，将扣钱和移交物品放进同一个$group。'
};
export const buySword = { $group: [{ $inc: { '@player.gold': -30 } }, { $move: { '@sword': '@player.inventory' } }] };
