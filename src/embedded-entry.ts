import { installRuntime } from './host/install.js';
declare const SOLVE_DEBUG_HTML: string;
installRuntime({ debugger: { html: SOLVE_DEBUG_HTML } });
