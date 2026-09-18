#include "ConfigJson.h"
#include "Hardware.h"
#include <Adafruit_PWMServoDriver.h>
#include <Arduino.h>
#include <Preferences.h>
#include <WebSocketsServer.h>
#include <WiFi.h>
#include <Wire.h>

Controller robot;
SemaphoreHandle_t mutex;
WebSocketsServer socket(81);
int controllerClient = -1;
uint32_t lastClientHeartbeat = 0;
Adafruit_PWMServoDriver pwm(PCA_ADDRESS);
Preferences prefs;
bool hardwareReady = false, wsConnected = false;
uint32_t configRevision = 0;
void lock() { xSemaphoreTake(mutex, portMAX_DELAY); }
void unlock() { xSemaphoreGive(mutex); }
void sendDoc(JsonDocument &doc) {
  String text;
  serializeJson(doc, text);
  if (controllerClient >= 0)
    socket.sendTXT((uint8_t)controllerClient, text);
}
void reply(uint32_t id, bool ok, const char *message = "") {
  StaticJsonDocument<256> d;
  d["v"] = 1;
  d["id"] = id;
  d["type"] = ok ? "ack" : "error";
  d["message"] = message;
  sendDoc(d);
}
void sendConfig() {
  Config c;
  lock();
  c = robot.config;
  unlock();
  DynamicJsonDocument d(16384);
  d["v"] = 1;
  d["type"] = "config";
  d["revision"] = configRevision;
  writeConfig(d.createNestedObject("config"), c);
  sendDoc(d);
}
void sendState() {
  StaticJsonDocument<3072> d;
  d["v"] = 1;
  d["type"] = "state";
  d["uptime"] = millis();
  d["rssi"] = 0; // Direct access-point mode; no upstream Wi-Fi RSSI.
  d["configRevision"] = configRevision;
  auto a = d.createNestedArray("angles"), t = d.createNestedArray("targets"),
       active = d.createNestedArray("active");
  lock();
  d["armed"] = robot.armed;
  d["hardwareReady"] = hardwareReady;
  d["fault"] = robot.fault;
  d["mode"] = robot.direction < 0 ? "manual"
                                  : (robot.direction == 0   ? "forward"
                                     : robot.direction == 1 ? "backward"
                                     : robot.direction == 2 ? "left"
                                                            : "right");
  for (int i = 0; i < 16; i++) {
    a.add(robot.angles[i]);
    t.add(robot.targets[i]);
    if (robot.active[i])
      active.add(i);
  }
  unlock();
  sendDoc(d);
}
// This independent task enforces timeouts even when TCP reconnects or NVS
// writes block the network loop.
void controlTask(void *) {
  TickType_t last = xTaskGetTickCount();
  uint32_t previous = millis(), lastPwmRetry = 0;
  uint8_t consecutivePwmFailures = 0;
  for (;;) {
    const uint32_t now = millis();
    lock();
    robot.tick(now, (uint32_t)(now - previous) / 1000.f);
    previous = now;

    if (!hardwareReady) {
      digitalWrite(SERVO_OE_PIN, HIGH);
      if ((uint32_t)(now - lastPwmRetry) >= 1000) {
        lastPwmRetry = now;
        hardwareReady = pwm.begin();
        if (hardwareReady) {
          pwm.setPWMFreq(50);
          robot.fault = "";
          consecutivePwmFailures = 0;
        }
      }
    } else {
      bool ok = true;
      for (int i = 0; i < 16; i++) {
        const auto &s = robot.config.servos[i];
        float us =
            s.pulseMin + (s.pulseMax - s.pulseMin) * robot.angles[i] / 180.f;
        uint16_t ticks = lroundf(us * 4096.f / 20000.f);
        if (pwm.setPWM(i, 0, ticks) != 0)
          ok = false;
      }
      if (ok) {
        consecutivePwmFailures = 0;
        digitalWrite(SERVO_OE_PIN, LOW);
      } else {
        digitalWrite(SERVO_OE_PIN, HIGH);
        if (++consecutivePwmFailures >= 3) {
          consecutivePwmFailures = 0;
          hardwareReady = false;
          robot.fault =
              "PCA9685 I2C write failed; outputs paused while retrying";
        }
      }
    }
    unlock();
    vTaskDelayUntil(&last, pdMS_TO_TICKS(20));
  }
}
void handleMessage(uint8_t *data, size_t size) {
  if (size > 15000)
    return;
  DynamicJsonDocument doc(16384);
  if (deserializeJson(doc, data, size)) {
    reply(0, false, "Malformed JSON");
    return;
  }
  if (!doc["v"].is<int>() || doc["v"] != 1 || !doc["id"].is<uint32_t>() ||
      !doc["type"].is<const char *>()) {
    reply(0, false, "Invalid envelope");
    return;
  }
  uint32_t id = doc["id"];
  String type = doc["type"].as<String>();
  bool ok = false;
  const char *why =
      "Command rejected: check channel, calibration and configured limits";
  if (type == "getConfig") {
    sendConfig();
    return;
  }
  if (type == "configure") {
    Config next;
    if (!readConfig(doc["config"], next)) {
      reply(id, false, "Invalid configuration; no changes applied");
      return;
    }
    DynamicJsonDocument saved(16384);
    writeConfig(saved.to<JsonObject>(), next);
    String text;
    serializeJson(saved, text);
    if (prefs.putString("config", text) != text.length()) {
      reply(id, false, "Flash save failed; previous configuration retained");
      return;
    }
    lock();
    robot.apply(next, false);
    configRevision++;
    unlock();
    reply(id, true);
    sendConfig();
    return;
  }
  lock();
  if (type == "heartbeat") {
    robot.lastHeartbeat = millis();
    lastClientHeartbeat = millis();
    ok = true;
  } else if (type == "disarm") {
    robot.disarm(); // compatibility: stop motion, keep outputs live
    ok = true;
  } else if (type == "stop") {
    robot.stop();
    ok = true;
  } else if (type == "arm") {
    if (doc["channel"].is<int>() && hardwareReady)
      ok = robot.arm(doc["channel"], millis());
  } else if (type == "servo") {
    if (doc["channel"].is<int>() && doc["angle"].is<float>())
      ok = robot.servo(doc["channel"], doc["angle"]);
  } else if (type == "joint") {
    if (doc["joint"].is<int>() && doc["angle"].is<float>())
      ok = robot.joint(doc["joint"], doc["angle"]);
  } else if (type == "home") {
    ok = robot.home();
  } else if (type == "drive") {
    String d = doc["direction"] | "";
    int direction = d == "forward"    ? 0
                    : d == "backward" ? 1
                    : d == "left"     ? 2
                    : d == "right"    ? 3
                                      : -1;
    ok = robot.drive(direction, millis());
  } else
    why = "Unknown command";
  unlock();
  if (type != "heartbeat")
    reply(id, ok, ok ? "" : why);
}
void stopMotion() {
  lock();
  robot.stop();
  unlock();
}
void onSocket(uint8_t client, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
  case WStype_CONNECTED:
    if (controllerClient >= 0 && controllerClient != client) {
      socket.sendTXT(client,
                     "{\"v\":1,\"type\":\"error\",\"message\":\"Robot already "
                     "connected in another tab. Disconnect it first.\"}");
      socket.disconnect(client);
      return;
    }
    controllerClient = client;
    lastClientHeartbeat = millis();
    wsConnected = true;
    stopMotion();
    Serial.println("App connected; all servo outputs live");
    sendConfig();
    sendState();
    break;
  case WStype_DISCONNECTED:
    if (controllerClient != client)
      return;
    controllerClient = -1;
    wsConnected = false;
    stopMotion();
    Serial.println("App disconnected; holding current servo positions");
    break;
  case WStype_TEXT:
    if (controllerClient == client)
      handleMessage(payload, length);
    break;
  default:
    break;
  }
}

void setup() {
  pinMode(SERVO_OE_PIN, OUTPUT);
  digitalWrite(SERVO_OE_PIN, HIGH);
  Serial.begin(115200);
  mutex = xSemaphoreCreateMutex();
  prefs.begin("spider-q4", false);
  String saved = prefs.getString("config", "");
  if (saved.length()) {
    DynamicJsonDocument d(16384);
    Config c;
    if (!deserializeJson(d, saved) && readConfig(d.as<JsonVariantConst>(), c))
      robot.apply(c);
    else
      Serial.println("Stored config invalid; using uncalibrated defaults");
  }
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setTimeOut(20);
  Wire.setClock(400000);
  hardwareReady = pwm.begin();
  if (hardwareReady) {
    pwm.setPWMFreq(50);
    for (int i = 0; i < 16; i++)
      pwm.setPWM(i, 0, 4096);
  } else
    robot.fault = "PCA9685 not detected; check address and wiring";
  xTaskCreatePinnedToCore(controlTask, "servo-control", 4096, nullptr, 3,
                          nullptr, 1);
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1),
                    IPAddress(255, 255, 255, 0));
  if (!WiFi.softAP("SpiderBot")) {
    Serial.println("Could not start SpiderBot Wi-Fi; reboot ESP32");
    return;
  }
  socket.begin();
  socket.onEvent(onSocket);
  Serial.println("Join Wi-Fi: SpiderBot (no password)");
  Serial.println("In the local app choose Real robot, then Connect.");
  Serial.println("Robot address: ws://192.168.4.1:81/ — all outputs LIVE");
}
void loop() {
  static uint32_t lastState = 0;
  socket.loop();
  uint32_t now = millis();
  // Free a vanished controller even if TCP has not noticed the Wi-Fi loss yet.
  if (wsConnected && (uint32_t)(now - lastClientHeartbeat) > 1500) {
    stopMotion();
    socket.disconnect((uint8_t)controllerClient);
    controllerClient = -1;
    wsConnected = false;
  }
  if (wsConnected && now - lastState >= 50) {
    lastState = now;
    sendState();
  }
  delay(2);
}
