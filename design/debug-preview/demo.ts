/**
 * Demo chat for the debug panel preview: the official structure, opening on the example world (王都酒馆), then a few
 * floors played through the real controller on an in-memory tavern — clamped affection (L2), a rejected operation (L3),
 * a player action with narration, and a second reply version on one floor. Nothing leaves the page.
 */
import { compile, compileStructure, SolveCore } from '../../src/index';
import { SolveSessionManager } from '../../src/host/sessions';
import { exampleState, exampleStructure } from '../../examples/official/example';
import type { HostContext } from '../../src/host/sillytavern';
import type { Definition } from '../../src/types';

const op = (prose: string, ops: unknown[]) => `${prose}\n<solve_operate>\n${JSON.stringify(ops)}\n</solve_operate>`;

export async function createDebugDemo() {
  // Open on the example world: its data becomes the definition's opening, its module choices the defaults.
  const base = compileStructure(exampleStructure) as Definition;
  const probe = new SolveCore(await compile(base));
  const example = await exampleState(probe);
  const modules = Object.fromEntries(Object.entries(base.modules ?? {}).map(([name, m]) => [name, { ...m, enabled: example.engineState.activeModules[name] !== false }]));
  const { round: _round, ...meta } = (example.data as any).meta;
  const definition: Definition = { ...base, modules, initialData: { ...(example.data as object), meta: { ...meta, round: 0 } } };

  const handlers = new Map<string, Set<(...args: any[]) => unknown>>();
  const files = new Map<string, unknown>();
  let failure = false;
  const ctx: HostContext = {
    chatId: '王都 · 调试演示', characterId: 0, groupId: null,
    characters: [{ name: '灰烬纪元', avatar: 'solve-debug-demo.png' }],
    chat: [{ name: '灰烬纪元', mes: '夜雨中的王都，醉橡木酒馆的门被推开了。炉火噼啪作响，角落里的吟游诗人抬起头。', extra: {} }],
    chatMetadata: {}, getRequestHeaders: () => ({}),
    updateChatMetadata: metadata => { ctx.chatMetadata = metadata; },
    macros: { registry: { registerMacro: () => undefined, unregisterMacro: () => undefined } },
    messageFormatter: { addHook: () => undefined },
    eventTypes: Object.fromEntries(['GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'CHAT_CHANGED', 'MESSAGE_EDITED', 'MESSAGE_DELETED'].map(n => [n, n])),
    eventSource: {
      on(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name)!.add(fn); },
      removeListener(name, fn) { handlers.get(name)?.delete(fn); },
    },
  } as HostContext;
  const fetcher = (async (url: string, options?: RequestInit) => {
    if (url === '/version') return Response.json({ pkgVersion: '1.19.0' });
    const body = JSON.parse(options!.body as string);
    if (url === '/api/chats/get') return Response.json(files.get(body.file_name) ?? {});
    if (url === '/api/chats/save') {
      if (failure) throw new Error('演示：保存前连接中断。关闭故障模拟后可重试保存。');
      files.set(body.file_name, structuredClone(body.chat)); return Response.json({ ok: true });
    }
    throw new Error('演示环境不发起外部请求');
  }) as typeof fetch;
  const sessions = new SolveSessionManager(() => ctx, fetcher);
  await sessions.attach(definition, { cache: false });
  const c = () => sessions.controller!;
  const user = (mes: string) => ctx.chat.push({ name: '艾琳', is_user: true, mes, extra: {} });
  const reply = async (mes: string) => { ctx.chat.push({ name: '灰烬纪元', mes, extra: {} }); await c().processMessage(ctx.chat.length - 1); };

  user('我抖掉斗篷上的雨水，在吧台边坐下，请米拉喝一杯。');
  await reply(op('米拉接过酒杯，眼睛亮了一下：“今晚的雨真大。”', [
    { $inc: { '@erin.relations.mira.affection': 30 }, $push: { '@erin.relations.mira.keyEvents': '在酒馆请她喝了一杯' } },
    { $set: { 'meta.mood': '浪漫', 'meta.time.clock': '20:10' } },
  ]));
  await c().submit([{ $group: [{ $inc: { '@erin.items.healing_draught.count': -1 } }, { $inc: { '@erin.rp.gauges.生命.value': 15 } }] }] as never,
    { authorInputs: { narrate: '艾琳喝下了一瓶治疗药剂' } });
  user('地窖里传来铁链的声音。我拔出铁剑走下去。');
  await reply(op('幽蓝的火在锈蚀的板甲里跳动。灰烬抬起头，盯着你的剑。', [
    { $set: { 'meta.location': 'tavern', 'meta.mood': '紧张' } },
    { $inc: { '@ash.rp.gauges.生命.value': -5 } },
    { $set: { '@erin.rp.attributes.dnd.str': 15 } },
    { $set: { '@erin.items.iron_sword.equipped': true } },
  ]));
  // A second version of the same floor (re-rolled reply).
  const last = ctx.chat.at(-1)!;
  last.swipes = [last.mes, op('灰烬没有动，只是轻声说：“你父亲也走过这道楼梯。”', [{ $set: { 'meta.mood': '悲伤' } }, { $push: { '@erin.drive.plan': { text: '问灰烬关于父亲的事' } } }])];
  last.swipe_info = [{ extra: last.extra?.solve ? { solve: last.extra.solve } : {} }, { extra: {} }];
  last.swipe_id = 1; last.mes = last.swipes[1]!;
  await c().processMessage(ctx.chat.length - 1);
  user('我收起剑，回到楼上。天快亮了。');
  await reply(op('雨停了，下城区的方向传来早市的吆喝。', [
    { $set: { 'meta.location': 'lower_town', 'meta.weather': '阴', 'meta.mood': '日常', 'meta.time.clock': '06:40', 'meta.time.day': 15 } },
    { $set: { 'meta.present': ['erin', 'mira'] } },
  ]));

  return {
    sessions, ctx,
    simulation: {
      setFailure(value: boolean) { failure = value; },
      async addReply() {
        user('我在早市买了一份热面包。');
        await reply(op('面包还烫手，摊主多找了你两枚铜币。', [{ $inc: { '@erin.items.copper.count': 2 } }, { $set: { 'meta.mood': '欢快' } }]));
      },
    },
  };
}
