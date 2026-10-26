import * as engine from './index.js';
import { attachSillyTavern } from './host/controller.js';
import type { AttachOptions, SillyTavernController } from './host/controller.js';
import type { Definition } from './types.js';

const scope = globalThis as any;
let active: SillyTavernController | undefined;
scope.SOLVE = Object.freeze({ ...engine, version: '0.5.0',
  async attach(definition: Definition, options: AttachOptions = {}) {
    if (!scope.SillyTavern?.getContext) throw new Error('SOLVE需要在SillyTavern 1.19页面内运行');
    if (active) throw new Error('当前已有SOLVE实例，请先调用SOLVE.detach()');
    active = await attachSillyTavern(definition, () => scope.SillyTavern.getContext(), options);
    return active;
  },
  detach() { active?.dispose(); active = undefined; },
  get controller() { return active; }
});
scope.solve_generation_interceptor = (chat: any[], contextSize: number, abort: (immediate: boolean) => void) => active?.intercept(chat, contextSize, abort);
console.info('[SOLVE] 后端 0.5.0 已加载；使用 SOLVE.attach(作者定义) 初始化当前聊天。');
