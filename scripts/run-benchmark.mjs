import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

// Same source as the regular TS runner; keep the launcher independent of tsx's OS probing.
const output = 'test-results/benchmark-runner.mjs';
await build({ entryPoints: ['scripts/benchmark.ts'], outfile: output, bundle: true, packages: 'external',
  format: 'esm', platform: 'node', target: 'node22' });
execFileSync(process.execPath, [output], { cwd: process.cwd(), stdio: 'inherit', windowsHide: true });
