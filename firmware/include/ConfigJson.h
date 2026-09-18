#pragma once
#include "RobotCore.h"
#include <ArduinoJson.h>
using namespace spider;
inline bool readConfig(JsonVariantConst v, Config &c) {
  if (!v.is<JsonObjectConst>() || !v["schema"].is<int>())
    return false;
  c.schema = v["schema"];
  auto g = v["geometry"];
  auto legs = g["legs"].as<JsonArrayConst>();
  auto servos = v["servos"].as<JsonArrayConst>();
  if (legs.size() != 4 || servos.size() != 16)
    return false;
#define RF(obj, key, dst)                                                      \
  if (!(obj)[key].is<float>())                                                 \
    return false;                                                              \
  (dst) = (obj)[key].as<float>();
  RF(g, "width", c.geometry.width);
  RF(g, "length", c.geometry.length);
  RF(g, "height", c.geometry.height);
  RF(g, "thickness", c.geometry.thickness);
  for (int i = 0; i < 4; i++) {
    auto x = legs[i];
    auto &l = c.geometry.legs[i];
    RF(x, "coxa", l.coxa);
    RF(x, "femur", l.femur);
    RF(x, "tibia", l.tibia);
    RF(x, "offsetX", l.offsetX);
    RF(x, "offsetZ", l.offsetZ);
  }
  for (int i = 0; i < 16; i++) {
    auto x = servos[i];
    auto &s = c.servos[i];
    if (!x["channel"].is<int>() || !x["joint"].is<int>() ||
        !x["direction"].is<int>() || !x["enabled"].is<bool>() ||
        !x["calibrated"].is<bool>())
      return false;
    s.channel = x["channel"];
    s.joint = x["joint"];
    s.direction = x["direction"];
    s.enabled = x["enabled"];
    s.calibrated = x["calibrated"];
    RF(x, "center", s.center);
    RF(x, "reference", s.reference);
    RF(x, "min", s.min);
    RF(x, "max", s.max);
    RF(x, "pulseMin", s.pulseMin);
    RF(x, "pulseMax", s.pulseMax);
    RF(x, "speed", s.speed);
  }
  auto x = v["gait"];
  RF(x, "stride", c.gait.stride);
  RF(x, "lift", c.gait.lift);
  RF(x, "period", c.gait.period);
  RF(x, "turn", c.gait.turn);
#undef RF
  return validConfig(c);
}
inline void writeConfig(JsonObject o, const Config &c) {
  o["schema"] = c.schema;
  auto g = o.createNestedObject("geometry");
  g["width"] = c.geometry.width;
  g["length"] = c.geometry.length;
  g["height"] = c.geometry.height;
  g["thickness"] = c.geometry.thickness;
  auto legs = g.createNestedArray("legs");
  for (const auto &l : c.geometry.legs) {
    auto x = legs.createNestedObject();
    x["coxa"] = l.coxa;
    x["femur"] = l.femur;
    x["tibia"] = l.tibia;
    x["offsetX"] = l.offsetX;
    x["offsetZ"] = l.offsetZ;
  }
  auto ss = o.createNestedArray("servos");
  for (const auto &s : c.servos) {
    auto x = ss.createNestedObject();
    x["channel"] = s.channel;
    x["joint"] = s.joint;
    x["direction"] = s.direction;
    x["enabled"] = s.enabled;
    x["calibrated"] = s.calibrated;
    x["center"] = s.center;
    x["reference"] = s.reference;
    x["min"] = s.min;
    x["max"] = s.max;
    x["pulseMin"] = s.pulseMin;
    x["pulseMax"] = s.pulseMax;
    x["speed"] = s.speed;
  }
  auto gait = o.createNestedObject("gait");
  gait["stride"] = c.gait.stride;
  gait["lift"] = c.gait.lift;
  gait["period"] = c.gait.period;
  gait["turn"] = c.gait.turn;
}
