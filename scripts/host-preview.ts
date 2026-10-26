// Development-only harness: exercises the same-origin host bridge without touching real chats.
import { createDemo } from "../src/debug/demo.js";
import {
  closeDebugger,
  installLauncher,
  openDebugger,
} from "../src/debug/launcher.js";
const demo = await createDemo();
Object.assign(window, {
  SOLVE: { version: demo.version, sessions: demo.sessions, closeDebugger },
});
const url = new URL("./debug.html", import.meta.url).href;
installLauncher(url);
document
  .getElementById("open")!
  .addEventListener("click", () => openDebugger(url));
document.getElementById("detach")!.addEventListener("click", () => {
  (
    demo.sessions as import("../src/host/sessions.js").SolveSessionManager
  ).detach();
  document.getElementById("status")!.textContent =
    "控制器已解绑，可打开面板验证只读归档检查。";
});
