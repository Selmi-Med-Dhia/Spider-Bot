import { createServer } from "node:http";
import { existsSync, createReadStream, statSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

export function createAppServer({ port = 8787, host = "127.0.0.1", dist = resolve("dist") } = {}) {
  dist = resolve(dist);
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://local");
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    let path;
    try {
      path = resolve(dist, "." + decodeURIComponent(url.pathname));
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!path.startsWith(dist + sep) && path !== dist) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(path) || !statSync(path).isFile())
      path = resolve(dist, "index.html");
    if (!existsSync(path)) {
      res.writeHead(404).end("Run pnpm build or use the dev UI on port 5173.");
      return;
    }
    const mime = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".json": "application/json",
    };
    res.writeHead(200, {
      "Content-Type": mime[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(path).pipe(res);
  });
  return {
    server,
    listen: () => new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(port, host, done);
    }),
    close: () => new Promise((done) => server.close(done)),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  const app = createAppServer({ port });
  await app.listen();
  console.log(`Open http://localhost:${port}`);
  console.log("Join SpiderBot Wi-Fi (no password), choose Real robot, then Connect.");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => { await app.close(); process.exit(0); });
}
