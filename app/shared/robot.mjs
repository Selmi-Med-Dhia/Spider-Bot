/** Wire protocol v1. Angles are degrees; distances millimeters. Y is up, +Z forward. */
export const PROTOCOL = 1;
export const JOINT_NAMES = [
  "FL yaw",
  "FL elbow",
  "FL knee",
  "FR yaw",
  "FR elbow",
  "FR knee",
  "RL yaw",
  "RL elbow",
  "RL knee",
  "RR yaw",
  "RR elbow",
  "RR knee",
];
export const JOINT_KEYS = ["yaw", "hip", "knee"];
export const DIRECTIONS = ["forward", "backward", "left", "right"];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rad = (d) => (d * Math.PI) / 180,
  deg = (r) => (r * 180) / Math.PI;
export function defaults() {
  return {
    schema: 1,
    geometry: {
      width: 150,
      length: 190,
      height: 153,
      thickness: 26,
      legs: Array.from({ length: 4 }, () => ({
        coxa: 45,
        femur: 85,
        tibia: 190,
        offsetX: 0,
        offsetZ: 0,
      })),
    },
    servos: Array.from({ length: 16 }, (_, channel) => ({
      channel,
      joint: channel < 12 ? channel : -1,
      enabled: channel < 12,
      calibrated: false,
      direction: 1,
      center: 90,
      reference: [0, 25, -95][channel % 3],
      min: 10,
      max: 170,
      pulseMin: 600,
      pulseMax: 2400,
      speed: 90,
    })),
    gait: { stride: 30, lift: 20, period: 4, turn: 8 },
  };
}
export function validateConfig(c) {
  const errors = [];
  const num = (o, k, min, max, p) => {
    if (
      typeof o?.[k] !== "number" ||
      !Number.isFinite(o[k]) ||
      o[k] < min ||
      o[k] > max
    )
      errors.push(`${p}${k} must be ${min}…${max}`);
  };
  if (c?.schema !== 1) errors.push("Unsupported configuration schema");
  const g = c?.geometry;
  for (const [k, a, b] of [
    ["width", 80, 260],
    ["length", 100, 320],
    ["height", 60, 300],
    ["thickness", 12, 60],
  ])
    num(g, k, a, b, "geometry.");
  if (!Array.isArray(g?.legs) || g.legs.length !== 4)
    errors.push("Exactly four legs required");
  else
    g.legs.forEach((l, i) => {
      for (const [k, a, b] of [
        ["coxa", 25, 100],
        ["femur", 40, 160],
        ["tibia", 50, 320],
        ["offsetX", -60, 60],
        ["offsetZ", -60, 60],
      ])
        num(l, k, a, b, `leg ${i}.`);
      if (l.tibia <= Math.max(l.coxa, l.femur))
        errors.push(`Leg ${i}: tibia must be longest`);
    });
  const assigned = new Set();
  if (!Array.isArray(c?.servos) || c.servos.length !== 16)
    errors.push("Exactly sixteen channel configurations required");
  else
    c.servos.forEach((s, i) => {
      if (s.channel !== i) errors.push(`Channel ${i} out of order`);
      if (!Number.isInteger(s.joint) || s.joint < -1 || s.joint > 11)
        errors.push(`Channel ${i}: invalid joint`);
      if (s.joint >= 0) {
        if (assigned.has(s.joint))
          errors.push("Each joint may be assigned only once");
        assigned.add(s.joint);
      }
      if (typeof s.enabled !== "boolean" || typeof s.calibrated !== "boolean")
        errors.push("Enable/calibration flags must be boolean");
      if (![1, -1].includes(s.direction))
        errors.push("Direction must be +1 or -1");
      for (const [k, a, b] of [
        ["min", 0, 180],
        ["max", 0, 180],
        ["center", 0, 180],
        ["reference", -180, 180],
        ["pulseMin", 500, 2500],
        ["pulseMax", 500, 2500],
        ["speed", 5, 180],
      ])
        num(s, k, a, b, `channel ${i}.`);
      if (!(s.min < s.max && s.center >= s.min && s.center <= s.max))
        errors.push(`Channel ${i}: min ≤ center ≤ max required`);
      if (!(s.pulseMin < s.pulseMax))
        errors.push(`Channel ${i}: pulse minimum must be below maximum`);
    });
  for (const [k, a, b] of [
    ["stride", 5, 80],
    ["lift", 5, 50],
    ["period", 2, 12],
    ["turn", 2, 15],
  ])
    num(c?.gait, k, a, b, "gait.");
  return errors;
}
export function servoForJoint(c, j) {
  return c.servos.find((s) => s.enabled && s.joint === j);
}
export function physicalAngle(s, jointAngle) {
  return clamp(
    s.center + s.direction * (jointAngle - s.reference),
    s.min,
    s.max,
  );
}
export function jointAngle(s, servoAngle) {
  return s.reference + s.direction * (servoAngle - s.center);
}
export function anglesFromServos(c, angles) {
  return Array.from({ length: 12 }, (_, j) => {
    const s = servoForJoint(c, j);
    return s ? jointAngle(s, angles[s.channel]) : [0, 25, -95][j % 3];
  });
}
export function displayedGeometry(c, angles) {
  return {
    ...c.geometry,
    legs: c.geometry.legs.map((l, i) => ({
      ...l,
      yaw: angles[i * 3],
      hip: angles[i * 3 + 1],
      knee: angles[i * 3 + 2],
    })),
  };
}
export function mount(g, i) {
  return {
    x: ((i % 2 === 0 ? -1 : 1) * g.width) / 2 + g.legs[i].offsetX,
    z: (i < 2 ? 1 : -1) * (g.length / 2 - 18) + g.legs[i].offsetZ,
  };
}
export function baseAngle(i) {
  return Math.atan2(i < 2 ? 0.8 : -0.8, i % 2 === 0 ? -1 : 1);
}
export function footPosition(g, i, angles) {
  const l = g.legs[i],
    a = baseAngle(i) - rad(angles[0]),
    h = rad(angles[1]),
    k = rad(angles[2]),
    r = l.coxa + l.femur * Math.cos(h) + l.tibia * Math.cos(h + k),
    m = mount(g, i);
  return {
    x: m.x + r * Math.cos(a),
    y: l.femur * Math.sin(h) + l.tibia * Math.sin(h + k),
    z: m.z + r * Math.sin(a),
  };
}
export function solveLeg(g, i, p) {
  const m = mount(g, i),
    l = g.legs[i],
    x = p.x - m.x,
    z = p.z - m.z,
    r = Math.hypot(x, z) - l.coxa,
    d = Math.hypot(r, p.y);
  if (
    r <= 0 ||
    d >= l.femur + l.tibia - 0.01 ||
    d <= Math.abs(l.tibia - l.femur) + 0.01
  )
    throw new Error(`Leg ${i + 1}: unreachable foot target`);
  const k = -Math.acos(
    clamp(
      (d * d - l.femur * l.femur - l.tibia * l.tibia) / (2 * l.femur * l.tibia),
      -1,
      1,
    ),
  );
  const h =
    Math.atan2(p.y, r) -
    Math.atan2(l.tibia * Math.sin(k), l.femur + l.tibia * Math.cos(k));
  let yaw = deg(baseAngle(i) - Math.atan2(z, x));
  yaw = ((yaw + 540) % 360) - 180;
  return [yaw, deg(h), deg(k)];
}
/** One swing leg at a time (80% stance). Local frame only; no odometry implied. */
export function gaitPose(c, time, direction, ramp = 1) {
  if (!DIRECTIONS.includes(direction)) throw new Error("Invalid direction");
  const offsets = [0, 0.5, 0.75, 0.25];
  return c.geometry.legs.flatMap((l, i) => {
    const phase = (time / c.gait.period + offsets[i]) % 1,
      swing = phase < 0.2,
      t = swing ? phase / 0.2 : (phase - 0.2) / 0.8,
      u = swing ? -0.5 + t * t * (3 - 2 * t) : 0.5 - t;
    const p = footPosition(c.geometry, i, [0, 25, -95]);
    p.y =
      10 -
      c.geometry.height +
      (swing ? Math.sin(Math.PI * t) * c.gait.lift * ramp : 0);
    if (direction === "forward" || direction === "backward")
      p.z += u * c.gait.stride * ramp * (direction === "forward" ? 1 : -1);
    else {
      const a = rad(u * c.gait.turn * ramp * (direction === "left" ? 1 : -1)),
        x = p.x,
        z = p.z;
      p.x = x * Math.cos(a) - z * Math.sin(a);
      p.z = x * Math.sin(a) + z * Math.cos(a);
    }
    return solveLeg(c.geometry, i, p);
  });
}
export function validateGait(c, direction) {
  try {
    for (let j = 0; j < 12; j++) {
      const s = servoForJoint(c, j);
      if (!s || !s.calibrated)
        return "All 12 joints need an enabled, calibrated servo";
    }
    for (let n = 0; n < 80; n++) {
      const pose = gaitPose(c, (n * c.gait.period) / 80, direction);
      for (let j = 0; j < 12; j++) {
        const s = servoForJoint(c, j),
          raw = s.center + s.direction * (pose[j] - s.reference);
        if (raw < s.min || raw > s.max)
          return `${JOINT_NAMES[j]} exceeds calibrated bounds; reduce stride/lift or adjust geometry`;
      }
    }
    return "";
  } catch (e) {
    return e.message;
  }
}
export function validateCommand(m) {
  if (!m || typeof m !== "object" || Array.isArray(m))
    return "Expected command object";
  if (!Number.isSafeInteger(m.id) || m.id < 1)
    return "Positive command id required";
  if (m.v !== 1) return "Protocol version mismatch";
  const number = (v, a, b) =>
    typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;
  switch (m.type) {
    case "heartbeat":
    case "stop":
    case "disarm":
    case "getConfig":
    case "home":
      return "";
    case "arm":
      return Number.isInteger(m.channel) && m.channel >= -1 && m.channel < 16
        ? ""
        : "Invalid channel";
    case "servo":
      return Number.isInteger(m.channel) &&
        m.channel >= 0 &&
        m.channel < 16 &&
        number(m.angle, 0, 180)
        ? ""
        : "Invalid servo target";
    case "joint":
      return Number.isInteger(m.joint) &&
        m.joint >= 0 &&
        m.joint < 12 &&
        number(m.angle, -180, 180)
        ? ""
        : "Invalid joint target";
    case "drive":
      return DIRECTIONS.includes(m.direction) ? "" : "Invalid drive direction";
    case "configure":
      return validateConfig(m.config).join("; ");
    default:
      return "Unknown command";
  }
}

export function validState(m) {
  const angles = (v) =>
    Array.isArray(v) &&
    v.length === 16 &&
    v.every(
      (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 180,
    );
  return (
    m?.v === 1 &&
    m.type === "state" &&
    typeof m.armed === "boolean" &&
    typeof m.hardwareReady === "boolean" &&
    typeof m.fault === "string" &&
    ["manual", "forward", "backward", "left", "right"].includes(m.mode) &&
    angles(m.angles) &&
    angles(m.targets) &&
    Array.isArray(m.active) &&
    m.active.every((x) => Number.isInteger(x) && x >= 0 && x < 16) &&
    new Set(m.active).size === m.active.length &&
    Number.isFinite(m.rssi) &&
    Number.isFinite(m.uptime) &&
    Number.isInteger(m.configRevision)
  );
}
