#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
namespace spider {
constexpr int Channels = 16, Joints = 12;
constexpr float Pi = 3.14159265358979323846f;
inline float rad(float d) { return d * Pi / 180; }
inline float deg(float r) { return r * 180 / Pi; }
inline float clamp(float v, float a, float b) {
  return std::max(a, std::min(b, v));
}
struct Leg {
  float coxa = 45, femur = 85, tibia = 190, offsetX = 0, offsetZ = 0;
};
struct Geometry {
  float width = 150, length = 190, height = 153, thickness = 26;
  Leg legs[4];
};
struct ServoConfig {
  int channel = 0, joint = -1, direction = 1;
  bool enabled = false, calibrated = false;
  float center = 90, reference = 0, min = 10, max = 170, pulseMin = 600,
        pulseMax = 2400, speed = 90;
};
struct Gait {
  float stride = 30, lift = 20, period = 4, turn = 8;
};
struct Config {
  int schema = 1;
  Geometry geometry;
  ServoConfig servos[Channels];
  Gait gait;
};
inline Config defaults() {
  Config c;
  for (int i = 0; i < Channels; i++) {
    auto &s = c.servos[i];
    s.channel = i;
    s.joint = i < Joints ? i : -1;
    s.enabled = true;
    s.reference = i % 3 == 0 ? 0 : i % 3 == 1 ? 25 : -95;
  }
  return c;
}
inline bool range(float x, float a, float b) {
  return std::isfinite(x) && x >= a && x <= b;
}
inline bool validConfig(const Config &c) {
  if (c.schema != 1)
    return false;
  const auto &g = c.geometry;
  if (!range(g.width, 80, 260) || !range(g.length, 100, 320) ||
      !range(g.height, 60, 300) || !range(g.thickness, 12, 60))
    return false;
  for (const auto &l : g.legs)
    if (!range(l.coxa, 25, 100) || !range(l.femur, 40, 160) ||
        !range(l.tibia, 50, 320) || l.tibia <= std::max(l.coxa, l.femur) ||
        !range(l.offsetX, -60, 60) || !range(l.offsetZ, -60, 60))
      return false;
  bool seen[Joints] = {};
  for (int i = 0; i < Channels; i++) {
    const auto &s = c.servos[i];
    if (s.channel != i || s.joint < -1 || s.joint >= Joints ||
        !(s.direction == 1 || s.direction == -1))
      return false;
    if (s.joint >= 0) {
      if (seen[s.joint])
        return false;
      seen[s.joint] = true;
    }
    if (!range(s.min, 0, 180) || !range(s.max, 0, 180) || s.min >= s.max ||
        !range(s.center, s.min, s.max) || !range(s.reference, -180, 180) ||
        !range(s.pulseMin, 500, 2500) || !range(s.pulseMax, 500, 2500) ||
        s.pulseMin >= s.pulseMax || !range(s.speed, 5, 180))
      return false;
  }
  return range(c.gait.stride, 5, 80) && range(c.gait.lift, 5, 50) &&
         range(c.gait.period, 2, 12) && range(c.gait.turn, 2, 15);
}
inline int channelFor(const Config &c, int j) {
  for (int i = 0; i < Channels; i++)
    if (c.servos[i].joint == j)
      return i;
  return -1;
}
inline float jointAngle(const ServoConfig &s, float a) {
  return s.reference + s.direction * (a - s.center);
}
inline float rawAngle(const ServoConfig &s, float j) {
  return s.center + s.direction * (j - s.reference);
}
struct Point {
  float x, y, z;
};
inline Point mount(const Geometry &g, int i) {
  return {(i % 2 == 0 ? -1.f : 1.f) * g.width / 2 + g.legs[i].offsetX, 0,
          (i < 2 ? 1.f : -1.f) * (g.length / 2 - 18) + g.legs[i].offsetZ};
}
inline float baseAngle(int i) {
  return std::atan2(i < 2 ? .8f : -.8f, i % 2 == 0 ? -1.f : 1.f);
}
inline Point footPosition(const Geometry &g, int i, const float *a) {
  const auto &l = g.legs[i];
  const auto m = mount(g, i);
  float yawSign = i % 2 == 0 ? -1.f : 1.f,
        t = baseAngle(i) + yawSign * rad(a[0]), h = rad(a[1]), k = rad(a[2]),
        r = l.coxa + l.femur * std::cos(h) + l.tibia * std::cos(h + k);
  return {m.x + r * std::cos(t),
          l.femur * std::sin(h) + l.tibia * std::sin(h + k),
          m.z + r * std::sin(t)};
}
inline bool solveLeg(const Geometry &g, int i, Point p, float *out) {
  const auto m = mount(g, i);
  const auto &l = g.legs[i];
  float x = p.x - m.x, z = p.z - m.z, r = std::hypot(x, z) - l.coxa,
        d = std::hypot(r, p.y);
  if (r <= 0 || d >= l.femur + l.tibia - .01f ||
      d <= std::abs(l.tibia - l.femur) + .01f)
    return false;
  float k = -std::acos(clamp((d * d - l.femur * l.femur - l.tibia * l.tibia) /
                                 (2 * l.femur * l.tibia),
                             -1, 1)),
        h = std::atan2(p.y, r) -
            std::atan2(l.tibia * std::sin(k), l.femur + l.tibia * std::cos(k));
  float yawSign = i % 2 == 0 ? -1.f : 1.f,
        delta = std::atan2(z, x) - baseAngle(i);
  delta = std::fmod(delta + 3 * Pi, 2 * Pi) - Pi;
  out[0] = deg(delta / yawSign);
  out[1] = deg(h);
  out[2] = deg(k);
  return true;
}
// direction: 0 forward, 1 backward, 2 left, 3 right. 80% stance duty cycle.
inline bool gaitPose(const Config &c, float time, int direction, float ramp,
                     float *out) {
  if (direction < 0 || direction > 3)
    return false;
  const float offsets[4] = {0, .5, .75, .25}, neutral[3] = {0, 25, -95};
  for (int i = 0; i < 4; i++) {
    float phase = std::fmod(time / c.gait.period + offsets[i], 1);
    bool swing = phase < .2f;
    float t = swing ? phase / .2f : (phase - .2f) / .8f,
          u = swing ? -.5f + t * t * (3 - 2 * t) : .5f - t;
    Point p = footPosition(c.geometry, i, neutral);
    p.y = 10 - c.geometry.height +
          (swing ? std::sin(Pi * t) * c.gait.lift * ramp : 0);
    if (direction < 2)
      p.z += u * c.gait.stride * ramp * (direction == 0 ? 1 : -1);
    else {
      float a = rad(u * c.gait.turn * ramp * (direction == 2 ? 1 : -1)),
            x = p.x, z = p.z;
      p.x = x * std::cos(a) - z * std::sin(a);
      p.z = x * std::sin(a) + z * std::cos(a);
    }
    if (!solveLeg(c.geometry, i, p, out + i * 3))
      return false;
  }
  return true;
}
inline bool withinBounds(const Config &c, const float *pose) {
  for (int j = 0; j < Joints; j++) {
    int i = channelFor(c, j);
    if (i < 0)
      return false;
    const auto &s = c.servos[i];
    if (!range(rawAngle(s, pose[j]), s.min, s.max))
      return false;
  }
  return true;
}
inline bool gaitReady(const Config &c, int direction) {
  for (int j = 0; j < Joints; j++) {
    int i = channelFor(c, j);
    if (i < 0 || !c.servos[i].calibrated)
      return false;
  }
  float pose[Joints];
  for (int n = 0; n < 80; n++)
    if (!gaitPose(c, n * c.gait.period / 80, direction, 1, pose) ||
        !withinBounds(c, pose))
      return false;
  return true;
}
struct Controller {
  Config config = defaults();
  float angles[Channels] = {}, targets[Channels] = {};
  // Kept for protocol-v1 telemetry compatibility. Every channel is always live.
  bool active[Channels] = {};
  bool armed = true;
  int direction = -1;
  uint32_t driveStart = 0, lastDrive = 0, lastHeartbeat = 0;
  const char *fault = "";
  Controller() { apply(config); }
  void apply(const Config &c, bool resetAngles = true) {
    config = c;
    direction = -1;
    for (int i = 0; i < Channels; i++) {
      active[i] = true;
      if (resetAngles)
        angles[i] = c.servos[i].center;
      else
        angles[i] = clamp(angles[i], c.servos[i].min, c.servos[i].max);
      targets[i] = angles[i];
    }
    armed = true;
    fault = "";
  }
  void stop() {
    direction = -1;
    for (int i = 0; i < Channels; i++)
      targets[i] = angles[i];
  }
  // Legacy "disarm" now means stop motion; it never releases servo outputs.
  void disarm() {
    stop();
    armed = true;
    for (auto &v : active)
      v = true;
  }
  // Legacy arm selection is accepted but all channels remain active.
  bool arm(int channel, uint32_t now) {
    if (channel < -1 || channel >= Channels)
      return false;
    for (auto &v : active)
      v = true;
    armed = true;
    lastHeartbeat = now;
    fault = "";
    return true;
  }
  bool servo(int i, float angle) {
    if (i < 0 || i >= Channels || !range(angle, 0, 180))
      return false;
    // Manual commands interrupt gait without cancelling other servo targets.
    direction = -1;
    targets[i] = clamp(angle, config.servos[i].min, config.servos[i].max);
    return true;
  }
  // Apply all 16 physical servo targets as one validated checkpoint.
  // Validate every angle first so a bad checkpoint can never partially update.
  bool servoPose(const float *p) {
    if (!p)
      return false;
    for (int i = 0; i < Channels; i++)
      if (!range(p[i], 0, 180) || p[i] < config.servos[i].min ||
          p[i] > config.servos[i].max)
        return false;
    direction = -1;
    for (int i = 0; i < Channels; i++)
      targets[i] = p[i];
    return true;
  }
  bool joint(int j, float a) {
    if (j < 0 || j >= Joints || !range(a, -180, 180))
      return false;
    int i = channelFor(config, j);
    if (i < 0)
      return false;
    return servo(i, clamp(rawAngle(config.servos[i], a), 0, 180));
  }
  bool allActive() const {
    for (int j = 0; j < Joints; j++)
      if (channelFor(config, j) < 0)
        return false;
    return true;
  }
  bool pose(const float *p) {
    if (!withinBounds(config, p))
      return false;
    for (int j = 0; j < Joints; j++) {
      int i = channelFor(config, j);
      targets[i] = rawAngle(config.servos[i], p[j]);
    }
    return true;
  }
  bool home() {
    if (!allActive())
      return false;
    float p[Joints];
    if (!gaitPose(config, 0, 0, 0, p) || !withinBounds(config, p))
      return false;
    stop();
    return pose(p);
  }
  bool drive(int d, uint32_t now) {
    if (!allActive() || d < 0 || d > 3)
      return false;
    if (direction != d) {
      if (!gaitReady(config, d))
        return false;
      direction = d;
      driveStart = now;
    }
    lastDrive = now;
    return true;
  }
  void tick(uint32_t now, float dt) {
    if (direction >= 0 && uint32_t(now - lastDrive) > 400)
      stop();
    if (direction >= 0) {
      float p[Joints], elapsed = uint32_t(now - driveStart) / 1000.f;
      if (!gaitPose(config, elapsed, direction, std::min(elapsed, 1.f), p) ||
          !pose(p)) {
        stop();
        fault = "Gait target unreachable or outside servo limits";
      }
    }
    dt = clamp(dt, 0, .05f);
    for (int i = 0; i < Channels; i++) {
      float step = config.servos[i].speed * dt;
      angles[i] =
          clamp(angles[i] + clamp(targets[i] - angles[i], -step, step),
                config.servos[i].min, config.servos[i].max);
    }
  }
};
} // namespace spider
