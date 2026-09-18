import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  defaults,
  validateConfig,
  physicalAngle,
  jointAngle,
  solveLeg,
  footPosition,
  gaitPose,
  validateGait,
  validateCommand,
} from "../shared/robot.mjs";
test("configuration rejects duplicate assignments and invalid limits, pulses and geometry", () => {
  const c = defaults();
  assert.deepEqual(validateConfig(c), []);
  assert.ok(c.servos.every((servo) => servo.enabled));
  for (const change of [
    (x) => (x.servos[1].joint = 0),
    (x) => (x.servos[0].min = 150),
    (x) => (x.servos[0].pulseMax = 400),
    (x) => (x.geometry.legs[0].tibia = 20),
    (x) => (x.gait.stride = NaN),
  ]) {
    const bad = structuredClone(c);
    change(bad);
    assert.ok(validateConfig(bad).length);
  }
});
test("direction and reference mapping round trip, with physical bounds enforced", () => {
  const s = { ...defaults().servos[2], direction: -1 };
  assert.equal(physicalAngle(s, -115), 110);
  assert.equal(jointAngle(s, 110), -115);
  assert.equal(physicalAngle(s, 500), s.min);
  assert.equal(physicalAngle(s, -500), s.max);
});
test("FK and IK agree and left/right yaw is truly mirrored", () => {
  const g = defaults().geometry;
  const q = [12, 35, -105];
  for (let i = 0; i < 4; i++) {
    const actual = solveLeg(g, i, footPosition(g, i, q));
    actual.forEach((a, j) => assert.ok(Math.abs(a - q[j]) < 1e-8));
  }
  for (const [left, right] of [[0, 1], [2, 3]]) {
    const a = footPosition(g, left, q);
    const b = footPosition(g, right, q);
    assert.ok(Math.abs(a.x + b.x) < 1e-8);
    assert.ok(Math.abs(a.y - b.y) < 1e-8);
    assert.ok(Math.abs(a.z - b.z) < 1e-8);
  }
  assert.throws(
    () => solveLeg(g, 0, { x: 1000, y: 1000, z: 1000 }),
    /unreachable/,
  );
});
test("walk requires calibrated joints and valid full trajectories", () => {
  const c = defaults();
  assert.match(validateGait(c, "forward"), /calibrated/);
  c.servos.forEach((s) => (s.calibrated = true));
  for (const d of ["forward", "backward", "left", "right"])
    assert.equal(validateGait(c, d), "");
  c.servos[0].min = 89;
  c.servos[0].max = 91;
  assert.match(validateGait(c, "forward"), /bounds/);
});
test("forward and backward reverse stance displacement; turn trajectories differ", () => {
  const c = defaults();
  const a = gaitPose(c, 2, "forward"),
    b = gaitPose(c, 2, "backward");
  const pa = footPosition(c.geometry, 0, a.slice(0, 3)),
    pb = footPosition(c.geometry, 0, b.slice(0, 3));
  const neutral = footPosition(c.geometry, 0, [0, 25, -95]);
  assert.ok(Math.abs(pa.z - neutral.z + (pb.z - neutral.z)) < 1e-6);
  assert.notDeepEqual(gaitPose(c, 1, "left"), gaitPose(c, 1, "right"));
});
test("commands reject out-of-range, wrong types and unknown operations", () => {
  for (const cmd of [
    { type: "servo", channel: 16, angle: 90 },
    { type: "servo", channel: 0, angle: "90" },
    { type: "drive", direction: "diagonal" },
    { type: "arm", channel: NaN },
    { type: "configure", config: {} },
  ])
    assert.ok(validateCommand({ v: 1, id: 1, ...cmd }));
  assert.equal(
    validateCommand({ v: 1, id: 1, type: "servo", channel: 15, angle: 180 }),
    "",
  );
});
test(
  "browser gait matches compiled firmware on 64 poses",
  { skip: !process.env.SPIDER_NATIVE_TEST },
  () => {
    const fixtures = JSON.parse(
      execFileSync(process.env.SPIDER_NATIVE_TEST, { encoding: "utf8" }),
    );
    for (const f of fixtures) {
      const q = gaitPose(
        defaults(),
        f.time,
        ["forward", "backward", "left", "right"][f.direction],
      );
      q.forEach((a, j) =>
        assert.ok(
          Math.abs(a - f.angles[j]) < 0.002,
          `direction ${f.direction} t ${f.time} joint ${j}`,
        ),
      );
    }
  },
);
