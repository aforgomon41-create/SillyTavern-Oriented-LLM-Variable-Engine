import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
const root = resolve('dist'), gitRoot = resolve('test-results/live-distribution/repos');
const gitExecPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.map': 'application/json' };
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4176');
  if (url.pathname.startsWith('/repos/')) {
    const child = spawn(resolve(gitExecPath, 'git-http-backend.exe'), [], { env: { ...process.env, GIT_PROJECT_ROOT: gitRoot, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: decodeURIComponent(url.pathname.slice('/repos'.length)), QUERY_STRING: url.search.slice(1), REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers['content-type'] ?? '', CONTENT_LENGTH: req.headers['content-length'] ?? '', REMOTE_USER: '', REMOTE_ADDR: '127.0.0.1', SERVER_PROTOCOL: 'HTTP/1.1' }, windowsHide: true });
    let buffer = Buffer.alloc(0), headersDone = false;
    child.stdout.on('data', chunk => {
      if (headersDone) { res.write(chunk); return; }
      buffer = Buffer.concat([buffer, chunk]); const index = buffer.indexOf('\r\n\r\n');
      if (index < 0) return;
      for (const line of buffer.subarray(0, index).toString().split('\r\n')) { const colon = line.indexOf(':'); if (colon > 0) { const key = line.slice(0, colon), value = line.slice(colon + 1).trim(); if (key.toLowerCase() === 'status') res.statusCode = parseInt(value); else res.setHeader(key, value); } }
      headersDone = true; res.write(buffer.subarray(index + 4)); buffer = Buffer.alloc(0);
    });
    child.on('close', () => res.end()); child.on('error', () => { res.statusCode = 500; res.end('git backend failed'); }); req.pipe(child.stdin); return;
  }
  try {
    const offline = await access(resolve('test-results/live-distribution/offline.flag')).then(() => true, () => false);
    if (offline) { res.writeHead(503).end('SOLVE asset server intentionally offline for embedded test'); return; }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': 'http://localhost:11451', 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(4176, '127.0.0.1', () => console.log('SOLVE live distribution assets / local Git: http://localhost:4176'));
