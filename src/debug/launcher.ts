/** The host only owns the launcher; all React/Radix UI is isolated in a same-origin iframe. */
let frame: HTMLIFrameElement | undefined;
let modal: HTMLDialogElement | undefined;
let returnFocus: HTMLElement | null = null;
const escapeClose = (event: KeyboardEvent) => {
  if (event.key === "Escape") closeDebugger();
};
export function closeDebugger(): void {
  if (!frame) return;
  modal?.close();
  modal?.remove();
  modal = undefined;
  frame = undefined;
  document.removeEventListener("keydown", escapeClose);
  returnFocus?.focus();
  returnFocus = null;
}
export function openDebugger(url: string): void {
  if (frame) {
    frame.focus();
    return;
  }
  returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  frame = document.createElement("iframe");
  frame.src = url;
  frame.title = "SOLVE 变量调试面板";
  frame.style.cssText =
    "display:block;width:100%;height:100%;border:0;background:#f5f5ef;color-scheme:light;";
  modal = document.createElement("dialog");
  modal.setAttribute("aria-label", "SOLVE 调试工作台");
  modal.style.cssText =
    "position:fixed;inset:0;margin:0;padding:0;border:0;width:100vw;max-width:none;height:100dvh;max-height:none;z-index:2147483646;background:#f5f5ef;";
  modal.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDebugger();
  });
  modal.append(frame);
  document.body.append(modal);
  modal.showModal();
  frame.focus();
  document.addEventListener("keydown", escapeClose);
}
export function installLauncher(url: string): void {
  if (document.getElementById("solve-debug-launcher")) return;
  const button = document.createElement("button");
  button.id = "solve-debug-launcher";
  button.type = "button";
  button.textContent = "◈ SOLVE";
  button.title = "打开 SOLVE 变量调试面板";
  button.setAttribute("aria-label", "打开 SOLVE 变量调试面板");
  button.style.cssText =
    "position:fixed;right:14px;bottom:18px;z-index:2147483645;border:1px solid #bac8bd;border-radius:24px;padding:12px 18px;background:#365c49;color:#fff;font:600 13px system-ui;box-shadow:0 4px 18px #172e2826;cursor:pointer;min-height:44px;";
  button.addEventListener("click", () => openDebugger(url));
  document.body.append(button);
}
