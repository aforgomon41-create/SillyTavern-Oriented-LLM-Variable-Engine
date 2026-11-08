import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
const variant = process.env.SOLVE_PIPE_VARIANT ?? 'current';
if (!/^[A-Za-z0-9_-]{1,64}$/u.test(variant)) throw new Error('Invalid variant label');
const output = `test-results/commit-pipeline-${variant}-runner.mjs`;
await build({ entryPoints: ['scripts/benchmark-commit-pipeline.ts'], outfile: output, bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node22' });
execFileSync(process.execPath, [output], { cwd: process.cwd(), stdio: 'inherit', windowsHide: true });
