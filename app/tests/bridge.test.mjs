import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { once } from "node:events";
import { createBridge } from "../server/bridge.mjs";
const waitFor = async (fn) => {
  const end = Date.now() + 2500;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Condition timed out");
};
const open = async (url, opts = {}) => {
  const ws = new WebSocket(url, opts);
  ws.messages = [];
  ws.on("message", (s) => ws.messages.push(JSON.parse(s)));
  await once(ws, "open");
  return ws;
};
test("paired bridge validates, forwards, isolates controllers and disarms after heartbeat loss", async () => {
  const token = "test-token-not-for-hardware-12345";
  const b = createBridge({ token, port: 0, host: "127.0.0.1" });
  await b.listen();
  const port = b.server.address().port,
    base = `http://127.0.0.1:${port}`,
    wsbase = `ws://127.0.0.1:${port}`;
  let device, ui;
  try {
    const denied = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "incorrect" }),
    });
    assert.equal(denied.status, 401);
    const origin = await fetch(base + "/api/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example",
      },
      body: JSON.stringify({ token }),
    });
    assert.equal(origin.status, 403);
    const response = await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    device = await open(wsbase + "/robot", {
      headers: { Authorization: `Bearer ${token}` },
    });
    await waitFor(() => device.messages.find((m) => m.type === "disarm"));
    assert.ok(!device.messages.some((m) => m.type === "arm"));
    ui = await open(wsbase + "/control", {
      headers: { Cookie: cookie, Origin: base },
    });
    await waitFor(() =>
      ui.messages.find((m) => m.type === "bridge" && m.robotOnline),
    );
    ui.send(
      JSON.stringify({ v: 1, id: 1, type: "servo", channel: 99, angle: 90 }),
    );
    await waitFor(() =>
      ui.messages.find((m) => m.id === 1 && m.type === "error"),
    );
    assert.ok(!device.messages.some((m) => m.id === 1));
    ui.send(
      JSON.stringify({ v: 1, id: 2, type: "servo", channel: 2, angle: 110 }),
    );
    const cmd = await waitFor(() => device.messages.find((m) => m.id === 2));
    assert.equal(cmd.angle, 110);
    device.send(
      JSON.stringify({
        v: 1,
        type: "state",
        angles: Array(16).fill(110),
        armed: true,
      }),
    );
    await waitFor(() => ui.messages.find((m) => m.type === "state"));
    const duplicate = new WebSocket(wsbase + "/control", {
      headers: { Cookie: cookie, Origin: base },
    });
    const duplicateError = await once(duplicate, "error");
    assert.match(duplicateError[0].message, /409/);
    const previous = device.messages.filter((m) => m.type === "disarm").length;
    await waitFor(
      () =>
        device.messages.filter((m) => m.type === "disarm").length > previous,
    );
    assert.ok(device.messages.every((m) => m.type !== "arm"));
  } finally {
    ui?.terminate();
    device?.terminate();
    await b.close();
  }
});
