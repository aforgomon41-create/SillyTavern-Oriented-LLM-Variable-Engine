import { author, z } from '../../src/index.js';
import type { Definition } from '../../src/index.js';
const a = author();
const item = z.object({ name: z.string(), count: a.field(z.number().int().min(0).default(1), { numeric: { destroyOnZero: true } }) });
export const workflowStructure: Definition = {
  id: 'inline-world-workflow', version: '1',
  schema: z.object({
    player: a.singleton(z.object({
      hp: a.field(z.number().min(0).max(100).default(100), { module: 'combat', guide: { when: '@player.hp < 30', text: '重伤时更新相关状态。' } }),
      gold: z.number().min(0).default(100).meta({ label: '购买消耗金币。' }),
      inventory: a.collection(z.record(z.string(), item).default({}), { type: 'item' }),
      secret: a.field(z.string().default('内部记录'), { internal: true }),
    }), { id: 'player', type: 'person' }),
    shop: a.collection(z.record(z.string(), item).default({}), { type: 'item' }),
  }), initialData: {}, ...a.useModules({ combat: { enabled: true } }),
};
