import { author, z } from '../src/index.js';
import type { Definition } from '../src/index.js';
const a = author();

export const inlinePersonDefinition: Definition = {
  id: 'inline-person', version: '1',
  schema: z.object({ player: a.singleton(z.object({
    name: z.string().default('旅人'),
    hp: a.field(z.number().min(0).max(100).default(100), { module: 'combat', guide: '根据受伤或治疗更新生命值。' }),
    bio: a.field(z.string().default('旅人的背景'), { readonly: true }),
    bookkeeping: a.field(z.number().default(0), { internal: true }),
  }), { id: 'player', type: 'person' }) }),
  initialData: { player: {} }, ...a.useModules({ combat: { enabled: true } }),
};
const item = z.object({ name: z.string(), count: a.field(z.number().int().min(0).default(1), { numeric: { destroyOnZero: true } }) });
export const inlineShopDefinition: Definition = {
  id: 'inline-shop', version: '1',
  schema: z.object({
    player: a.singleton(z.object({
      gold: z.number().min(0).default(100),
      inventory: a.collection(z.record(z.string(), item).default({}), { type: 'item' }),
      favorite: a.ref(z.string().nullable().default(null), { kind: 'single', onDelete: 'null' }),
    }), { id: 'player', type: 'person' }),
    shop: a.collection(z.record(z.string(), item).default({}), { type: 'item' }),
  }),
  initialData: { player: {}, shop: { sword: { name: '铁剑' } } },
  guide: '购买时使用原子组，扣钱与物品入包一起成功。',
};
export const inlineBuySword = { $group: [{ $inc: { '@player.gold': -30 } }, { $move: { '@sword': '@player.inventory' } }] };
