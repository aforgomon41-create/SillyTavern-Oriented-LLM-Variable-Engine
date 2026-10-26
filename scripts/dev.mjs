import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("dist"),
  port = Number(process.env.SOLVE_DEBUG_PORT || 4173);
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".map": "application/json",
};
createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const file = resolve(root, `.${path === "/" ? "/debug.html" : path}`);
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`SOLVE 演示：http://127.0.0.1:${port}/debug.html?demo=1`),
);
