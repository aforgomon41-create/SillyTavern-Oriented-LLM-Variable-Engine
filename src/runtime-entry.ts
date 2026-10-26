import { installRuntime } from './host/install.js';
installRuntime({ debugger: { url: new URL('./debug.html', import.meta.url).href } });
