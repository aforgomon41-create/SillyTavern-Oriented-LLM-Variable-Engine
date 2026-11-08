import { z } from 'zod';
import type { AuthorPart, Definition } from '../../src/index.js';

const item = z.object({ name: z.string(), count: z.number().int().min(0).default(1) });
export const structure: Definition = {
  id: 'solve-world-info-example', version: '1.0.0', runtimeBindings: { build: 'world-info-example-1' },
  schema: z.object({
    characters: z.record(z.string(), z.object({ name: z.string(), hp: z.number().min(0).max(100).default(100),
      gold: z.number().min(0).default(100), inventory: z.record(z.string(), item).default({}),
      friend: z.string().nullable().default(null), bio: z.string().default('背景'), secret: z.string().default('隐藏信息'),
      combat: z.object({ mp: z.number().min(0).default(10) }).default({ mp: 10 }) })),
    shop: z.record(z.string(), item).default({}),
  }), initialData: {},
};
export const topology: AuthorPart = { source: 'examples/modular/structure.ts:topology', definition: {
  entities: [{ path: 'characters', type: 'character' }, { path: 'characters.*.inventory', type: 'item' }, { path: 'shop', type: 'item' }],
  refs: [{ path: 'characters.*.friend', kind: 'single', onDelete: 'null' }],
  readonly: ['characters.*.bio'], internal: ['characters.*.secret'], numeric: { 'characters.*.inventory.*.count': { destroyOnZero: true } },
} };
