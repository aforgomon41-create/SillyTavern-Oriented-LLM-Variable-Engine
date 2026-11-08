import { z } from 'zod';
import type { Definition } from '../src/index.js';

export const simpleDefinition: Definition = {
  id: 'solve-simple-example', version: '1.0.0',
  schema: z.object({ hp: z.number().min(0).max(100).default(100) }), initialData: {},
  guide: '受到伤害时减少 hp；休息时增加 hp。',
};
export const takeDamage = { $inc: { hp: -10 } };
