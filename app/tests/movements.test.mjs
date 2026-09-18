import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMovementLibrary,
  playbackPlan,
  validateCheckpoint,
  validateMovement,
} from "../shared/movements.mjs";

const angles = (offset = 0) =>
  Array.from({ length: 16 }, (_, channel) => 80 + offset + channel * 0.25);

test("movement library accepts complete 16-servo checkpoints and normalizes first delay", () => {
  const movement = {
    id: "stand",
    name: "Stand",
    checkpoints: [
      { id: "a", angles: angles(), delayMs: 900 },
      { id: "b", angles: angles(2), delayMs: 350 },
    ],
  };
  assert.equal(validateMovement(movement), "");
  const parsed = parseMovementLibrary(JSON.stringify([movement]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].checkpoints[0].delayMs, 0);
  assert.equal(parsed[0].checkpoints[1].delayMs, 350);
  assert.deepEqual(parsed[0].checkpoints[1].angles, angles(2));
});

test("playback plan uses each checkpoint delay from the previous checkpoint", () => {
  const movement = {
    id: "lazy-walk",
    name: "Lazy walk",
    checkpoints: [
      { id: "a", angles: angles(), delayMs: 0 },
      { id: "b", angles: angles(1), delayMs: 250 },
      { id: "c", angles: angles(2), delayMs: 700 },
    ],
  };
  const plan = playbackPlan(movement);
  assert.deepEqual(
    plan.map(({ index, atMs }) => ({ index, atMs })),
    [
      { index: 0, atMs: 0 },
      { index: 1, atMs: 250 },
      { index: 2, atMs: 950 },
    ],
  );
  plan[0].angles[0] = 1;
  assert.notEqual(movement.checkpoints[0].angles[0], 1);
});

test("invalid or partial checkpoints are rejected instead of partially replayed", () => {
  assert.match(
    validateCheckpoint({ angles: Array(15).fill(90), delayMs: 0 }),
    /16 servo angles/,
  );
  assert.match(
    validateCheckpoint({ angles: [...Array(15).fill(90), 181], delayMs: 0 }),
    /between 0 and 180/,
  );
  assert.match(
    validateCheckpoint({ angles: Array(16).fill(90), delayMs: 60001 }),
    /60000/,
  );
  assert.deepEqual(parseMovementLibrary("{not-json"), []);
  assert.deepEqual(
    parseMovementLibrary(
      JSON.stringify([
        {
          id: "bad",
          name: "Bad",
          checkpoints: [{ angles: Array(15).fill(90), delayMs: 0 }],
        },
      ]),
    ),
    [],
  );
});
