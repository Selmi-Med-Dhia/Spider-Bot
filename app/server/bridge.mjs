import { createServer } from "node:http";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  createReadStream,
  statSync,
} from "node:fs";
import { resolve, extname, sep } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { validateCommand } from "../shared/robot.mjs";

export function createBridge({
  token,
  port = 8787,
  host = "0.0.0.0",
  dist = resolve("dist"),
} = {}) {
  if (!token || token.length < 16)
    throw new Error("SPIDER_TOKEN must have at least 16 characters");
  let robot = null,
    ui = null,
    lastUi = 0,
    lastRobot = 0;
  const sessions = new Map();
  const equal = (t) =>
    typeof t === "string" &&
    Buffer.byteLength(t) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(t), Buffer.from(token));
  const send = (ws, m) => {
    if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536)
      ws.send(JSON.stringify(m));
  };
  const disable = () => send(robot, { v: 1, id: 0, type: "disarm" });
  const status = () =>
    send(ui, {
      type: "bridge",
      robotOnline: robot?.readyState === WebSocket.OPEN,
    });
  const sameOrigin = (req) => {
    try {
      return (
        !req.headers.origin ||
        new URL(req.headers.origin).host === req.headers.host
      );
    } catch {
      return false;
    }
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    if (url.pathname === "/api/session" && req.method === "POST") {
      if (!sameOrigin(req)) {
        res.writeHead(403).end();
        return;
      }
      let text = "";
      try {
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 512) throw Error("Too large");
        }
        const data = JSON.parse(text);
        if (!equal(data.token)) {
          res.writeHead(401).end("Invalid pairing token");
          return;
        }
        if (sessions.size > 1000) sessions.clear();
        const session = randomBytes(24).toString("hex");
        sessions.set(session, Date.now() + 8 * 3600 * 1000);
        res
          .writeHead(200, {
            "Set-Cookie": `spider_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
            "Content-Type": "application/json",
          })
          .end('{"ok":true}');
      } catch {
        res.writeHead(400).end("Invalid request");
      }
      return;
    }
    if (url.pathname === "/api/health") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ok: true, protocol: 1 }));
      return;
    }
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
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://local");
    const session = /spider_session=([a-f0-9]+)/.exec(
      req.headers.cookie || "",
    )?.[1];
    const authorized =
      url.pathname === "/robot"
        ? equal(req.headers.authorization?.replace(/^Bearer /, ""))
        : url.pathname === "/control" &&
          sameOrigin(req) &&
          sessions.get(session) > Date.now();
    if (!authorized) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    if (
      (url.pathname === "/robot" && robot) ||
      (url.pathname === "/control" && ui)
    ) {
      socket.write("HTTP/1.1 409 Conflict\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const device = url.pathname === "/robot";
      if (device) {
        robot = ws;
        lastRobot = Date.now();
        disable();
        send(robot, { v: 1, id: 0, type: "getConfig" });
        status();
      } else {
        ui = ws;
        lastUi = Date.now();
        status();
        send(robot, { v: 1, id: 0, type: "getConfig" });
      }
      let windowStart = Date.now(),
        count = 0;
      ws.on("message", (bytes, binary) => {
        if (binary) {
          ws.close(1003, "Text JSON only");
          return;
        }
        try {
          if (Date.now() - windowStart > 1000) {
            windowStart = Date.now();
            count = 0;
          }
          if (++count > 100) {
            disable();
            ws.close(1008, "Rate limit");
            return;
          }
          const m = JSON.parse(bytes.toString());
          if (device) {
            lastRobot = Date.now();
            if (
              m.v !== 1 ||
              !["state", "config", "ack", "error", "hello"].includes(m.type)
            )
              return;
            send(ui, m);
          } else {
            const error = validateCommand(m);
            if (error) {
              send(ui, { type: "error", id: m?.id, message: error });
              return;
            }
            if (m.type === "heartbeat") lastUi = Date.now();
            if (!robot) {
              if (m.type !== "heartbeat")
                send(ui, {
                  type: "error",
                  id: m.id,
                  message: "Robot is offline",
                });
              return;
            }
            send(robot, m);
          }
        } catch {
          send(ws, { type: "error", message: "Malformed JSON" });
        }
      });
      ws.on("error", () => {});
      ws.on("close", () => {
        if (device && robot === ws) {
          robot = null;
          status();
        }
        if (!device && ui === ws) {
          ui = null;
          disable();
        }
      });
    });
  });
  const timer = setInterval(() => {
    const now = Date.now();
    if (ui && now - lastUi > 1000) {
      disable();
      ui.close(1008, "Controller heartbeat expired");
      ui = null;
    }
    if (robot && now - lastRobot > 2000) {
      robot.terminate();
      robot = null;
      status();
    }
    for (const [s, expires] of sessions) if (expires < now) sessions.delete(s);
  }, 200);
  return {
    server,
    listen: () => new Promise((r) => server.listen(port, host, r)),
    close: () =>
      new Promise((r) => {
        clearInterval(timer);
        disable();
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(r);
      }),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let token = process.env.SPIDER_TOKEN;
  if (!token) {
    if (existsSync(".robot-token"))
      token = readFileSync(".robot-token", "utf8").trim();
    else {
      token = randomBytes(24).toString("hex");
      writeFileSync(".robot-token", token + "\n", { mode: 0o600 });
    }
    console.log(
      `Pairing token (copy into firmware secrets.h and the app): ${token}`,
    );
  }
  const port = Number(process.env.PORT || 8787);
  const bridge = createBridge({ token, port });
  await bridge.listen();
  console.log(
    `Spiderbot app/robot bridge: http://localhost:${port} (robot uses this computer's LAN IP)`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await bridge.close();
      process.exit(0);
    });
}
