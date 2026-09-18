#include "RobotCore.h"
#include <cassert>
#include <cstdio>
using namespace spider;
int main() {
  Config c = defaults();
  assert(validConfig(c));
  Config bad = c;
  bad.servos[1].joint = 0;
  assert(!validConfig(bad));
  bad = c;
  bad.servos[0].min = 100;
  assert(!validConfig(bad));
  bad = c;
  bad.geometry.legs[0].tibia = 20;
  assert(!validConfig(bad));
  bad = c;
  bad.gait.stride = NAN;
  assert(!validConfig(bad));
  auto s = c.servos[2];
  s.direction = -1;
  float raw = rawAngle(s, -115);
  assert(std::abs(raw - 110) < .01);
  assert(std::abs(jointAngle(s, raw) + 115) < .01);
  float q[3] = {15, 35, -90};
  for (int i = 0; i < 4; i++) {
    float out[3];
    assert(solveLeg(c.geometry, i, footPosition(c.geometry, i, q), out));
    for (int j = 0; j < 3; j++)
      assert(std::abs(out[j] - q[j]) < .001);
  }
  for (int pair = 0; pair < 2; pair++) {
    int left = pair * 2, right = left + 1;
    Point a = footPosition(c.geometry, left, q);
    Point b = footPosition(c.geometry, right, q);
    assert(std::abs(a.x + b.x) < .001);
    assert(std::abs(a.y - b.y) < .001);
    assert(std::abs(a.z - b.z) < .001);
  }
  Controller r;
  assert(r.armed);
  for (int i = 0; i < 16; i++)
    assert(r.active[i]);
  assert(r.servo(0, 180));
  assert(r.targets[0] == 170);
  assert(r.servo(1, 100));
  r.tick(120, .02);
  assert(std::abs(r.angles[0] - 91.8) < .01);
  assert(std::abs(r.angles[1] - 91.8) < .01);
  float savedPose[16];
  for (int i = 0; i < 16; i++)
    savedPose[i] = 80.f + i;
  assert(r.servoPose(savedPose));
  for (int i = 0; i < 16; i++)
    assert(std::abs(r.targets[i] - savedPose[i]) < .001);
  float beforeInvalid[16];
  for (int i = 0; i < 16; i++)
    beforeInvalid[i] = r.targets[i];
  savedPose[7] = 181;
  assert(!r.servoPose(savedPose));
  for (int i = 0; i < 16; i++)
    assert(std::abs(r.targets[i] - beforeInvalid[i]) < .001);
  assert(r.arm(0, 100));
  r.disarm();
  assert(r.armed);
  for (int i = 0; i < 16; i++)
    assert(r.active[i]);
  r.lastHeartbeat = 0;
  r.tick(5000, .02);
  assert(r.armed);
  for (auto &servo : c.servos)
    servo.calibrated = true;
  assert(gaitReady(c, 0));
  r.apply(c);
  assert(r.drive(0, 100));
  r.tick(550, .02);
  assert(r.direction == -1);
  r.angles[0] = 123;
  r.apply(c, false);
  assert(std::abs(r.angles[0] - 123) < .01);
  assert(std::abs(r.targets[0] - 123) < .01);
  // Golden trajectory fixtures consumed by the JavaScript test suite.
  std::printf("[");
  bool first = true;
  for (int direction = 0; direction < 4; direction++)
    for (int step = 0; step < 16; step++) {
      float q[12], time = step * .25f;
      assert(gaitPose(c, time, direction, 1, q));
      assert(withinBounds(c, q));
      if (!first)
        std::printf(",");
      first = false;
      std::printf("{\"direction\":%d,\"time\":%.2f,\"angles\":[", direction,
                  time);
      for (int j = 0; j < 12; j++)
        std::printf(j ? ",%.6f" : "%.6f", q[j]);
      std::printf("]}");
    }
  std::printf("]\n");
  return 0;
}
