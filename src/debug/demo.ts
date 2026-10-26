import { z } from "zod";
import { SolveSessionManager } from "../host/sessions.js";
import { VERSION } from "../version.js";
import type { HostContext } from "../host/sillytavern.js";
import type { Definition } from "../types.js";
import type { DebugConnection } from "./connection.js";

const definition: Definition = {
  id: "solve-garden-demo",
  version: "1.0.0",
  schema: z.object({
    world: z.object({
      location: z.string(),
      weather: z.string(),
      day: z.number().int().min(1),
    }),
    characters: z.record(
      z.string(),
      z.object({
        name: z.string(),
        hp: z.number().min(0).max(100),
        gold: z.number().int().min(0),
        inventory: z.record(
          z.string(),
          z.object({ name: z.string(), count: z.number().int().min(0) }),
        ),
      }),
    ),
    notes: z.object({ quest: z.string(), secret: z.string() }),
  }),
  initialData: {
    world: { location: "青岚镇 · 植物工坊", weather: "雨后初晴", day: 3 },
    characters: {
      player: {
        name: "林间旅人",
        hp: 85,
        gold: 120,
        inventory: { herb: { name: "月光草", count: 3 } },
      },
      gardener: { name: "园艺师 · 青禾", hp: 100, gold: 60, inventory: {} },
    },
    notes: { quest: "为温室收集三株月光草", secret: "北侧小径通往旧温室" },
  },
  entities: [
    { path: "characters", type: "character" },
    { path: "characters.*.inventory", type: "item" },
  ],
  modules: {
    journal: { paths: ["notes"], enabled: true, guide: "记录旅途线索。" },
  },
  internal: ["notes.secret"],
  readonly: ["world.day"],
  guide:
    "根据故事更新世界和角色。交易应使用 $group 将扣款和物品变化放在同一组。",
};

export async function createDemo(): Promise<DebugConnection> {
  const handlers = new Map<string, Set<(...args: any[]) => unknown>>();
  let failure = false;
  const files = new Map<string, unknown>();
  const ctx: HostContext = {
    chatId: "青岚 · 演示沙盒",
    characterId: 0,
    groupId: null,
    characters: [{ name: "青禾", avatar: "solve-demo.png" }],
    chat: [
      {
        mes: "雨后的青岚镇，草木带着清新的气息。青禾正在工坊里整理月光草。",
        extra: {},
      },
    ],
    chatMetadata: {},
    getRequestHeaders: () => ({}),
    updateChatMetadata: (metadata) => {
      ctx.chatMetadata = metadata;
    },
    macros: {
      registry: {
        registerMacro: () => undefined,
        unregisterMacro: () => undefined,
      },
    },
    messageFormatter: { addHook: () => undefined },
    eventTypes: Object.fromEntries(
      [
        "GENERATION_STARTED",
        "GENERATION_ENDED",
        "GENERATION_STOPPED",
        "MESSAGE_SWIPED",
        "MESSAGE_SWIPE_DELETED",
        "CHAT_CHANGED",
        "MESSAGE_EDITED",
        "MESSAGE_DELETED",
      ].map((name) => [name, name]),
    ),
    eventSource: {
      on(name, fn) {
        if (!handlers.has(name)) handlers.set(name, new Set());
        handlers.get(name)!.add(fn);
      },
      removeListener(name, fn) {
        handlers.get(name)?.delete(fn);
      },
    },
  };
  const fetcher = (async (url: string, options?: RequestInit) => {
    if (url === "/version") return Response.json({ pkgVersion: "1.19.0" });
    const body = JSON.parse(options!.body as string);
    if (url === "/api/chats/get")
      return Response.json(files.get(body.file_name) ?? {});
    if (url === "/api/chats/save") {
      if (failure)
        throw new Error("演示：保存前连接中断。关闭故障模拟后可重试保存。");
      files.set(body.file_name, structuredClone(body.chat));
      return Response.json({ ok: true });
    }
    throw new Error("演示环境不发起外部请求");
  }) as typeof fetch;
  const sessions = new SolveSessionManager(() => ctx, fetcher);
  await sessions.attach(definition, { cache: false });
  return {
    demo: true,
    version: VERSION,
    sessions,
    close() {},
    dispose: () => sessions.dispose(),
    simulation: {
      setFailure(value) {
        failure = value;
      },
      async addMessage() {
        ctx.chat.push({
          mes: '旅人休息片刻，恢复了一些体力。<solve_operate>{"$inc":{"@player.hp":2}}</solve_operate>',
          extra: {},
        });
        await sessions.controller!.processMessage(ctx.chat.length - 1);
      },
    },
  };
}
