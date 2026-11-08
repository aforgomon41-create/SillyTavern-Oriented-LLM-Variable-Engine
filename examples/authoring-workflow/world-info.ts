import type { WorldInfoEntry } from '../../src/index.js';
export const workflowWorldInfo: WorldInfoEntry[] = [
  { uid: 1, comment: '[SOLVE:INIT]', content: '{"player":{"hp":20,"gold":100},"shop":{"sword":{"name":"铁剑"}}}' },
  { uid: 2, comment: '[SOLVE:GUIDE module=combat]', content: '战斗后按实际结果更新生命值。' },
  { uid: 3, comment: '[SOLVE:WORKFLOW_NOTE]', content: '购买时用原子组完成扣钱和物品入包。' },
];
