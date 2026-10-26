import { fixture } from './fixture.js';
import { attachSillyTavern } from '../src/host/controller.js';
import type { AttachOptions } from '../src/host/controller.js';
import type { HostContext } from '../src/host/sillytavern.js';

export async function hostEnvironment() {
  const { def } = await fixture();
  const files = new Map<string, any[]>(), macros = new Map<string, any>(), handlers = new Map<string, Set<(...args: any[]) => unknown>>();
  const hooks: ((text: string) => string)[] = [];
  let failure: 'none' | 'before' | 'after' = 'none';
  const ctx: HostContext = { chatId: 'controller-test', characterId: 0, groupId: null,
    characters: [{ name: '测试', avatar: 'test.png' }], chat: [{ mes: '开场', extra: {} }], chatMetadata: { integrity: 'test' },
    getRequestHeaders: () => ({}), updateChatMetadata: m => { ctx.chatMetadata = m; },
    macros: { registry: { registerMacro: (name: string, opts: any) => { macros.set(name, opts); return opts; }, unregisterMacro: (name: string) => macros.delete(name) } },
    messageFormatter: { addHook: fn => { hooks.push(text => fn(text, {})); } },
    eventTypes: Object.fromEntries(Object.entries({ GENERATION_STARTED: 'start', GENERATION_ENDED: 'end', GENERATION_STOPPED: 'stop', MESSAGE_SWIPED: 'swipe', MESSAGE_SWIPE_DELETED: 'swipeDeleted', CHAT_CHANGED: 'chat', MESSAGE_EDITED: 'edit', MESSAGE_DELETED: 'delete' })),
    eventSource: { on: (name, fn) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name)!.add(fn); }, removeListener: (name, fn) => { handlers.get(name)?.delete(fn); } } };
  const fetcher = (async (url: any, opts?: any) => {
    if (url === '/version') return Response.json({ pkgVersion: '1.19.0' });
    const body = JSON.parse(opts.body);
    if (url === '/api/chats/get') return Response.json(files.get(body.file_name) ?? {});
    if (url === '/api/chats/save') {
      if (failure === 'before') throw new Error('保存前网络断开');
      files.set(body.file_name, structuredClone(body.chat));
      if (failure === 'after') throw new Error('保存响应丢失');
      return Response.json({ ok: true });
    }
    throw new Error(`未知请求${url}`);
  }) as typeof fetch;
  const emit = async (name: string, ...args: any[]) => { for (const handler of [...handlers.get(name) ?? []]) await handler(...args); };
  const addReply = (operations = '{"$inc":{"@alice.hp":-15}}') => {
    ctx.chat.push({ mes: `受伤。<solve_operate>${operations}</solve_operate>`, extra: {} }); return ctx.chat.length - 1;
  };
  const saveNative = () => files.set(ctx.chatId, structuredClone([{ chat_metadata: ctx.chatMetadata }, ...ctx.chat]));
  const switchChat = (chatId: string) => {
    const saved = files.get(chatId); ctx.chatId = chatId;
    ctx.chat = saved ? structuredClone(saved.slice(1)) : [{ mes: '开场', extra: {} }];
    ctx.chatMetadata = saved ? structuredClone(saved[0].chat_metadata) : { integrity: 'test' };
  };
  return { def, ctx, fetcher, emit, addReply, macros, handlers, hooks, files, saveNative, switchChat,
    setFail: (value: boolean) => { failure = value ? 'after' : 'none'; }, setFailBefore: (value: boolean) => { failure = value ? 'before' : 'none'; } };
}
export async function setup(options: AttachOptions = {}) {
  const env = await hostEnvironment();
  const controller = await attachSillyTavern(env.def, () => env.ctx, options, env.fetcher);
  return { ...env, controller };
}
