import { z } from 'zod';
import { compile, SolveCore } from '../src/index.js';
import type { Definition } from '../src/types.js';

export async function fixture(overrides: Partial<Definition> = {}) {
  const item = z.object({ name: z.string().default('物品'), count: z.number().min(0).default(1) });
  const character = z.object({ name: z.string().default('角色'), hp: z.number().min(0).max(100).default(100),
    gold: z.number().min(0).default(50), items: z.record(z.string(), item).default({}),
    friend: z.string().nullable().default(null), friends: z.array(z.string()).default([]), tags: z.array(z.string()).default([]),
    relations: z.record(z.string(), z.number()).default({}), secret: z.string().default('隐藏'), bio: z.string().default('长背景'),
    combat: z.object({ mp: z.number().min(0).default(20) }).default({ mp: 20 }) });
  const definition: Definition = {
    id: 'test-card', version: '1',
    schema: z.object({ world: z.object({ weather: z.string().default('晴'), logs: z.array(z.string()).default([]) }).default({ weather: '晴', logs: [] }),
      characters: z.record(z.string(), character), storage: z.record(z.string(), item).default({}), settings: z.object({ alice: z.string().default('普通键') }).default({ alice: '普通键' }) }),
    initialData: { characters: { alice: {}, bob: { hp: 80 } }, storage: { sword: { name: '剑' } } },
    entities: [{ path: 'characters', type: 'character' }, { path: 'characters.*.items', type: 'item' }, { path: 'storage', type: 'item' }],
    refs: [{ path: 'characters.*.friend', kind: 'single', onDelete: 'null' }, { path: 'characters.*.friends', kind: 'array', onDelete: 'remove' }, { path: 'characters.*.relations', kind: 'record-key', onDelete: 'unset' }],
    modules: { combat: { paths: ['characters.*.combat'], enabled: true, guide: '战斗指南' } },
    internal: ['characters.*.secret'], readonly: ['characters.*.bio'],
    prefabs: { key: { type: 'item', data: { name: '钥匙', count: 1 } } },
    templates: { potion: { type: 'item', data: { name: '药水', count: 1 } } },
    ...overrides
  };
  const def = await compile(definition), core = new SolveCore(def), state = await core.initialize();
  return { def, core, state };
}
export const binding = { chatId: 'test-chat', messageId: 'message-1', swipeId: 'swipe-0' };
