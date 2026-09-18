import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "spider-core-"));
const binary = join(dir, process.platform === "win32" ? "core.exe" : "core");
try {
  const build = spawnSync(
    process.env.CXX || "g++",
    [
      "-std=c++17",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-I../firmware/include",
      "../firmware/test/core_test.cpp",
      "-o",
      binary,
    ],
    { stdio: "inherit" },
  );
  if (build.error) throw build.error;
  if (build.status !== 0) process.exitCode = 1;
  else {
    const result = spawnSync(
      process.execPath,
      ["--test", "tests/robot.test.mjs"],
      { stdio: "inherit", env: { ...process.env, SPIDER_NATIVE_TEST: binary } },
    );
    process.exitCode = result.status ?? 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
