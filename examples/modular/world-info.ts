import type { WorldInfoEntry } from '../../src/index.js';

/** In a real card, supply a snapshot of the world-book entries selected for that card. */
export const worldInfo: WorldInfoEntry[] = [
  { source: '示例世界书:开局', comment: '[SOLVE:INIT]', content: JSON.stringify({
    characters: { player: { name: '玩家', hp: 95, friend: '@merchant' }, merchant: { name: '商人' } },
    shop: { sword: { name: '铁剑' } },
  }) },
  { source: '示例世界书:战斗', comment: '[SOLVE:MODULES]', content: JSON.stringify({ combat: { paths: ['characters.*.combat'], enabled: false } }) },
  { source: '示例世界书:指南', comment: '[SOLVE:GUIDE]', content: '购买时将扣钱和移动物品放进同一个 $group。' },
  { source: '示例世界书:战斗指南', comment: '[SOLVE:GUIDE module=combat]', content: '战斗结束后更新生命与法力。' },
  { source: '示例世界书:预制', comment: '[SOLVE:PREFABS]', content: JSON.stringify({ key: { type: 'item', data: { name: '唯一钥匙', count: 1 } } }) },
  { source: '示例世界书:模板', comment: '[SOLVE:TEMPLATES]', content: JSON.stringify({ potion: { type: 'item', data: { name: '药水', count: 1 } } }) },
];
