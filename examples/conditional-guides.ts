import { z } from 'zod';
import { compileAuthorDefinition } from '../src/authoring.js';
import type { Definition } from '../src/types.js';

/** Each when is a pure synchronous predicate; update the package version when its behavior changes. */
export const conditionalGuideDefinition: Definition = {
  id: 'conditional-guides', version: '1',
  schema: z.object({ player: z.object({ hp: z.number().min(0).max(100), maxHp: z.number().positive() }),
    world: z.object({ inCombat: z.boolean(), phase: z.string() }) }),
  initialData: { player: { hp: 20, maxHp: 100 }, world: { inCombat: true, phase: '战斗' } },
  entities: [{ path: 'player', type: 'person', singletonId: 'player' }],
  modules: { combat: { paths: [], enabled: true } },
  guide: '根据实际事件提出变量操作，不凭空改变数值。',
  guides: [
    { id: 'combat', module: 'combat', when: 'world.inCombat', text: '受到伤害减少生命值，治疗增加生命值。' },
    { id: 'critical-ratio', module: 'combat', when: ({ get }) => {
      const hp = get('@player.hp'), max = get('@player.maxHp');
      return typeof hp === 'number' && typeof max === 'number' && hp < max * 0.3;
    }, text: '重伤时及时更新相关状态。' },
  ],
};
export function compileConditionalGuideExample() {
  return compileAuthorDefinition(conditionalGuideDefinition, { worldInfo: [
    { uid: 1, comment: '[SOLVE:GUIDE id=low-hp module=combat when="@player.hp < 30"]', content: '低血量时的额外变量更新说明。' },
    { uid: 2, comment: `[SOLVE:GUIDE id=trade when='world.phase == "交易"']`, content: '购买时使用原子组完成扣钱和物品入包。' },
  ] });
}
