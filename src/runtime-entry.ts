import { installRuntime } from './host/install.js';
const start = () => installRuntime({ debugger: { url: new URL('./debug.html', import.meta.url).href } });
// A module runs once per page: after SOLVE uninstalled itself (its last script turned off), the next import starts it
// again through this hook instead of downloading the runtime anew.
(globalThis as any)[Symbol.for('solve.runtime.start')] = Object.assign(start, { url: import.meta.url });
start();
