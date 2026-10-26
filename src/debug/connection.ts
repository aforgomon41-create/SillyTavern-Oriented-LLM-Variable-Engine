import type { SillyTavernController } from "../host/controller.js";
import type { SolveSessionManager } from "../host/sessions.js";

export interface DebugConnection {
  demo: boolean;
  version: string;
  sessions: Pick<
    SolveSessionManager,
    "controller" | "subscribe" | "getStatus" | "reconcile" | "inspectArchive"
  >;
  close(): void;
  dispose?(): void;
  simulation?: {
    setFailure(value: boolean): void;
    addMessage(): Promise<void>;
  };
}
export async function connect(): Promise<DebugConnection> {
  if (new URLSearchParams(location.search).get("demo") === "1") {
    const { createDemo } = await import("./demo.js");
    return createDemo();
  }
  let api:
    | {
        version: string;
        sessions: SolveSessionManager;
        closeDebugger?: () => void;
      }
    | undefined;
  try {
    api = (window.parent as Window & { SOLVE?: typeof api }).SOLVE;
  } catch {
    /* same-origin host required */
  }
  if (!api)
    throw new Error(
      "没有连接到 SOLVE。请从酒馆内的 SOLVE 入口打开；独立试用请使用演示链接。",
    );
  const host = api;
  return {
    demo: false,
    version: host.version,
    sessions: host.sessions,
    close: () => host.closeDebugger?.(),
  };
}
export type Controller = SillyTavernController;
