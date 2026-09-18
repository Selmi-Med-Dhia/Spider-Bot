import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["server/bridge.mjs"], { stdio: "inherit" }),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "0.0.0.0",
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  ),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const p of children) p.kill();
  process.exitCode = code;
}
for (const p of children) {
  p.on("error", (e) => {
    console.error(e.message);
    stop(1);
  });
  p.on("exit", (c) => stop(c ?? 1));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
