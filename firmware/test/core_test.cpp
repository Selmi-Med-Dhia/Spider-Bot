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
  for (int i = 0; i < 4; i++) {
    float q[3] = {15, 35, -90}, out[3];
    assert(solveLeg(c.geometry, i, footPosition(c.geometry, i, q), out));
    for (int j = 0; j < 3; j++)
      assert(std::abs(out[j] - q[j]) < .001);
  }
  Controller r;
  assert(!r.armed);
  assert(!r.servo(0, 100));
  assert(!r.arm(-1, 0));
  assert(r.arm(0, 100));
  assert(r.servo(0, 180));
  assert(r.targets[0] == 170);
  assert(!r.servo(1, 100));
  r.tick(120, .02);
  assert(std::abs(r.angles[0] - 91.8) < .01);
  r.tick(1101, .02);
  assert(!r.armed);
  for (auto &servo : c.servos) {
    servo.calibrated = true;
  }
  assert(gaitReady(c, 0));
  r.apply(c);
  assert(r.arm(-1, 100));
  assert(r.drive(0, 100));
  r.lastHeartbeat = 550;
  r.tick(550, .02);
  assert(r.armed && r.direction == -1);
  for (int i = 0; i < 16; i++)
    assert(r.targets[i] == r.angles[i]);
  r.apply(c);
  assert(r.arm(-1, 0xfffffff0));
  r.tick(0x10, .02);
  assert(r.armed);
  r.tick(0x500, .02);
  assert(!r.armed);
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
