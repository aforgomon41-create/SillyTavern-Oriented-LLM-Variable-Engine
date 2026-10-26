import { installRuntime } from './host/install.js';
installRuntime({ native: true, debugger: { url: typeof document === 'undefined' ? '' : new URL('./debug.html', import.meta.url).href } });
