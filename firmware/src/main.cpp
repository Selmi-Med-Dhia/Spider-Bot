#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebSocketsServer.h>
#include <Adafruit_PWMServoDriver.h>
#include <ArduinoJson.h>

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef SPIDER_WIFI_SSID
#define SPIDER_WIFI_SSID ""
#endif

#ifndef SPIDER_WIFI_PASSWORD
#define SPIDER_WIFI_PASSWORD ""
#endif

namespace {
constexpr uint8_t JOINT_COUNT = 12;
constexpr uint8_t SERVO_COUNT = 16;
constexpr uint8_t PCA9685_ADDRESS = 0x40;
constexpr uint16_t SERVO_MIN_US = 500;
constexpr uint16_t SERVO_MAX_US = 2500;
constexpr float SERVO_HZ = 50.0f;
constexpr uint16_t CONFIG_VERSION = 2;
constexpr char AP_SSID[] = "SpiderBot";
constexpr char AP_PASSWORD[] = "spiderbot";
constexpr char MDNS_NAME[] = "spiderbot";

const char* JOINT_NAMES[JOINT_COUNT] = {
  "FL_YAW", "FL_HIP", "FL_KNEE",
  "FR_YAW", "FR_HIP", "FR_KNEE",
  "RL_YAW", "RL_HIP", "RL_KNEE",
  "RR_YAW", "RR_HIP", "RR_KNEE"
};

enum class MotionMode : uint8_t {
  Stop,
  Forward,
  Backward,
  Left,
  Right
};

struct JointConfig {
  int8_t channel;
  float minAngle;
  float maxAngle;
  float centerAngle;
  int8_t direction;
};

Adafruit_PWMServoDriver pwm(PCA9685_ADDRESS);
WebSocketsServer webSocket(81);
Preferences preferences;

JointConfig jointConfig[JOINT_COUNT];
float jointAngles[JOINT_COUNT];
bool outputsEnabled = false;
MotionMode motionMode = MotionMode::Stop;
uint8_t gaitSpeed = 55;
uint32_t motionStartedAt = 0;
uint32_t lastGaitUpdate = 0;
uint32_t lastStateBroadcast = 0;
uint32_t lastStatusBroadcast = 0;
bool pcaReady = false;

float baseAngleForIndex(uint8_t index) {
  switch (index % 3) {
    case 1: return 25.0f;
    case 2: return -70.0f;
    default: return 0.0f;
  }
}

float defaultCenterForIndex(uint8_t index) {
  return (index % 3 == 2) ? 135.0f : 90.0f;
}

void loadDefaults() {
  for (uint8_t i = 0; i < JOINT_COUNT; ++i) {
    jointConfig[i].channel = static_cast<int8_t>(i);
    jointConfig[i].minAngle = 10.0f;
    jointConfig[i].maxAngle = 170.0f;
    jointConfig[i].centerAngle = defaultCenterForIndex(i);
    jointConfig[i].direction = 1;
    jointAngles[i] = baseAngleForIndex(i);
  }
  gaitSpeed = 55;
}

bool configLooksValid(const JointConfig& config) {
  return config.channel >= -1 &&
         config.channel < SERVO_COUNT &&
         config.minAngle >= 0.0f &&
         config.maxAngle <= 180.0f &&
         config.minAngle < config.maxAngle &&
         config.centerAngle > config.minAngle &&
         config.centerAngle < config.maxAngle &&
         (config.direction == 1 || config.direction == -1);
}

bool allConfigLooksValid() {
  for (uint8_t i = 0; i < JOINT_COUNT; ++i) {
    if (!configLooksValid(jointConfig[i])) return false;
  }
  return true;
}

void saveConfig() {
  preferences.begin("spiderbot", false);
  preferences.putUShort("version", CONFIG_VERSION);
  preferences.putBytes("joint_cfg", jointConfig, sizeof(jointConfig));
  preferences.putUChar("gait_speed", gaitSpeed);
  preferences.end();
}

void loadConfig() {
  loadDefaults();
  preferences.begin("spiderbot", true);
  const uint16_t version = preferences.getUShort("version", 0);
  const size_t storedSize = preferences.getBytesLength("joint_cfg");
  if (version == CONFIG_VERSION && storedSize == sizeof(jointConfig)) {
    preferences.getBytes("joint_cfg", jointConfig, sizeof(jointConfig));
    gaitSpeed = preferences.getUChar("gait_speed", 55);
  }
  preferences.end();

  gaitSpeed = constrain(gaitSpeed, 20, 100);
  if (!allConfigLooksValid()) {
    Serial.println("Stored servo configuration was invalid. Restoring defaults.");
    loadDefaults();
    saveConfig();
  }
}

int findJoint(const char* name) {
  if (!name) return -1;
  for (uint8_t i = 0; i < JOINT_COUNT; ++i) {
    if (strcmp(name, JOINT_NAMES[i]) == 0) return static_cast<int>(i);
  }
  return -1;
}

const char* motionName(MotionMode mode) {
  switch (mode) {
    case MotionMode::Forward: return "forward";
    case MotionMode::Backward: return "backward";
    case MotionMode::Left: return "left";
    case MotionMode::Right: return "right";
    default: return "stop";
  }
}

uint16_t microsecondsToTicks(float microseconds) {
  const float periodUs = 1000000.0f / SERVO_HZ;
  const float ticks = microseconds * 4096.0f / periodUs;
  return static_cast<uint16_t>(constrain(ticks, 0.0f, 4095.0f));
}

uint16_t angleToTicks(float physicalAngle) {
  const float bounded = constrain(physicalAngle, 0.0f, 180.0f);
  const float pulseUs = SERVO_MIN_US + (SERVO_MAX_US - SERVO_MIN_US) * (bounded / 180.0f);
  return microsecondsToTicks(pulseUs);
}

float setLogicalAngle(uint8_t index, float requestedAngle) {
  const JointConfig& config = jointConfig[index];
  float physical = config.centerAngle + static_cast<float>(config.direction) * requestedAngle;
  physical = constrain(physical, config.minAngle, config.maxAngle);
  const float actualLogical = (physical - config.centerAngle) / static_cast<float>(config.direction);
  jointAngles[index] = actualLogical;

  if (outputsEnabled && pcaReady && config.channel >= 0) {
    pwm.setPWM(static_cast<uint8_t>(config.channel), 0, angleToTicks(physical));
  }
  return actualLogical;
}

void disableAllChannels() {
  if (!pcaReady) return;
  for (uint8_t channel = 0; channel < SERVO_COUNT; ++channel) {
    pwm.setPWM(channel, 0, 4096);
  }
}

void applyAllJoints() {
  if (!outputsEnabled) {
    disableAllChannels();
    return;
  }
  for (uint8_t i = 0; i < JOINT_COUNT; ++i) {
    setLogicalAngle(i, jointAngles[i]);
  }
}

void setStandingPose() {
  for (uint8_t i = 0; i < JOINT_COUNT; ++i) {
    setLogicalAngle(i, baseAngleForIndex(i));
  }
}

String stationIp() {
  if (WiFi.status() == WL_CONNECTED) return WiFi.localIP().toString();
  return "";
}

void sendJson(uint8_t client, JsonDocument& doc) {
  String payload;
  serializeJson(doc, payload);
  webSocket.sendTXT(client, payload);
}

void broadcastJson(JsonDocument& doc) {
  String payload;
  serializeJson(doc, payload);
  webSocket.broadcastTXT(payload);
}

void fillAngles(JsonObject object) {
  for (uint8_t i = 0; i < JOINT_COUNT; ++i) {
    object[JOINT_NAMES[i]] = jointAngles[i];
  }
}

void fillConfig(JsonArray array) {
  for (uint8_t i = 0; i < JOINT_COUNT; ++i) {
    JsonObject item = array.add<JsonObject>();
    item["joint"] = JOINT_NAMES[i];
    item["channel"] = jointConfig[i].channel;
    item["min"] = jointConfig[i].minAngle;
    item["max"] = jointConfig[i].maxAngle;
    item["center"] = jointConfig[i].centerAngle;
    item["direction"] = jointConfig[i].direction;
  }
}

void sendSnapshot(uint8_t client) {
  JsonDocument doc;
  doc["type"] = "snapshot";
  doc["outputsEnabled"] = outputsEnabled;
  doc["gaitSpeed"] = gaitSpeed;
  doc["motion"] = motionName(motionMode);
  JsonObject angles = doc["angles"].to<JsonObject>();
  fillAngles(angles);
  JsonArray config = doc["config"].to<JsonArray>();
  fillConfig(config);
  sendJson(client, doc);
}

void broadcastSnapshot() {
  JsonDocument doc;
  doc["type"] = "snapshot";
  doc["outputsEnabled"] = outputsEnabled;
  doc["gaitSpeed"] = gaitSpeed;
  doc["motion"] = motionName(motionMode);
  JsonObject angles = doc["angles"].to<JsonObject>();
  fillAngles(angles);
  JsonArray config = doc["config"].to<JsonArray>();
  fillConfig(config);
  broadcastJson(doc);
}

void broadcastJointState() {
  JsonDocument doc;
  doc["type"] = "joint_state";
  doc["motion"] = motionName(motionMode);
  JsonObject angles = doc["angles"].to<JsonObject>();
  fillAngles(angles);
  broadcastJson(doc);
}

void sendAck(uint8_t client, const char* message) {
  JsonDocument doc;
  doc["type"] = "ack";
  doc["message"] = message;
  sendJson(client, doc);
}

void sendError(uint8_t client, const char* message) {
  JsonDocument doc;
  doc["type"] = "error";
  doc["message"] = message;
  sendJson(client, doc);
}

void broadcastStatus() {
  JsonDocument doc;
  doc["type"] = "status";
  doc["motion"] = motionName(motionMode);
  doc["outputsEnabled"] = outputsEnabled;
  doc["staConnected"] = WiFi.status() == WL_CONNECTED;
  doc["ip"] = stationIp();
  doc["apIp"] = WiFi.softAPIP().toString();
  doc["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  broadcastJson(doc);
}

bool channelAlreadyUsed(int channel, int exceptIndex) {
  if (channel < 0) return false;
  for (uint8_t i = 0; i < JOINT_COUNT; ++i) {
    if (static_cast<int>(i) == exceptIndex) continue;
    if (jointConfig[i].channel == channel) return true;
  }
  return false;
}

bool parseMotion(const char* command, MotionMode& mode) {
  if (!command) return false;
  if (strcmp(command, "stop") == 0) mode = MotionMode::Stop;
  else if (strcmp(command, "forward") == 0) mode = MotionMode::Forward;
  else if (strcmp(command, "backward") == 0) mode = MotionMode::Backward;
  else if (strcmp(command, "left") == 0) mode = MotionMode::Left;
  else if (strcmp(command, "right") == 0) mode = MotionMode::Right;
  else return false;
  return true;
}

void stopMotionAndStand() {
  motionMode = MotionMode::Stop;
  setStandingPose();
  broadcastJointState();
}

void handleText(uint8_t client, uint8_t* payload, size_t length) {
  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    sendError(client, "Invalid JSON command.");
    return;
  }

  const char* type = doc["type"] | "";

  if (strcmp(type, "hello") == 0 || strcmp(type, "config_get") == 0) {
    sendSnapshot(client);
    return;
  }

  if (strcmp(type, "joint") == 0) {
    const int index = findJoint(doc["joint"] | "");
    if (index < 0) {
      sendError(client, "Unknown joint.");
      return;
    }
    motionMode = MotionMode::Stop;
    const float requested = doc["angle"] | 0.0f;
    setLogicalAngle(static_cast<uint8_t>(index), requested);
    broadcastJointState();
    return;
  }

  if (strcmp(type, "config_set") == 0) {
    const int index = findJoint(doc["joint"] | "");
    if (index < 0) {
      sendError(client, "Unknown joint.");
      return;
    }

    JointConfig candidate = jointConfig[index];
    candidate.channel = static_cast<int8_t>(doc["channel"] | candidate.channel);
    candidate.minAngle = doc["min"] | candidate.minAngle;
    candidate.maxAngle = doc["max"] | candidate.maxAngle;
    candidate.centerAngle = doc["center"] | candidate.centerAngle;
    candidate.direction = static_cast<int8_t>(doc["direction"] | candidate.direction);

    if (!configLooksValid(candidate)) {
      sendError(client, "Invalid servo mapping or angle bounds.");
      return;
    }
    if (channelAlreadyUsed(candidate.channel, index)) {
      sendError(client, "That PCA9685 channel is already assigned to another joint.");
      return;
    }

    const int oldChannel = jointConfig[index].channel;
    if (pcaReady && oldChannel >= 0 && oldChannel != candidate.channel) {
      pwm.setPWM(static_cast<uint8_t>(oldChannel), 0, 4096);
    }

    jointConfig[index] = candidate;
    setLogicalAngle(static_cast<uint8_t>(index), jointAngles[index]);
    saveConfig();
    sendAck(client, "Servo mapping saved to ESP32 flash.");
    broadcastSnapshot();
    return;
  }

  if (strcmp(type, "motion") == 0) {
    MotionMode nextMode;
    if (!parseMotion(doc["command"] | "", nextMode)) {
      sendError(client, "Unknown motion command.");
      return;
    }

    if (nextMode == MotionMode::Stop) {
      stopMotionAndStand();
    } else {
      motionMode = nextMode;
      motionStartedAt = millis();
      sendAck(client, "Motion started.");
    }
    return;
  }

  if (strcmp(type, "gait_speed") == 0) {
    gaitSpeed = constrain(static_cast<int>(doc["value"] | gaitSpeed), 20, 100);
    saveConfig();
    sendAck(client, "Gait speed saved.");
    return;
  }

  if (strcmp(type, "outputs") == 0) {
    outputsEnabled = doc["enabled"] | false;
    if (outputsEnabled) applyAllJoints();
    else disableAllChannels();
    broadcastSnapshot();
    return;
  }

  if (strcmp(type, "stance") == 0) {
    motionMode = MotionMode::Stop;
    setStandingPose();
    broadcastJointState();
    return;
  }

  if (strcmp(type, "config_reset") == 0) {
    loadDefaults();
    saveConfig();
    applyAllJoints();
    broadcastSnapshot();
    return;
  }

  if (strcmp(type, "ping") == 0) {
    JsonDocument reply;
    reply["type"] = "pong";
    reply["millis"] = millis();
    sendJson(client, reply);
    return;
  }

  sendError(client, "Unsupported command type.");
}

void webSocketEvent(uint8_t client, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.printf("Web client %u connected from %s\n", client, webSocket.remoteIP(client).toString().c_str());
      sendSnapshot(client);
      break;
    case WStype_DISCONNECTED:
      Serial.printf("Web client %u disconnected\n", client);
      break;
    case WStype_TEXT:
      handleText(client, payload, length);
      break;
    default:
      break;
  }
}

void updateGait(uint32_t now) {
  if (motionMode == MotionMode::Stop) return;
  if (now - lastGaitUpdate < 20) return;
  lastGaitUpdate = now;

  const float speedNormalized = (constrain(gaitSpeed, 20, 100) - 20.0f) / 80.0f;
  const float cycleMs = 1900.0f - speedNormalized * 1200.0f;
  const float phase = fmodf(static_cast<float>(now - motionStartedAt) / cycleMs, 1.0f);
  constexpr float twoPi = 6.28318530718f;
  constexpr float stride = 26.0f;
  constexpr float hipLift = 17.0f;
  constexpr float kneeLift = 31.0f;

  for (uint8_t leg = 0; leg < 4; ++leg) {
    const float offset = (leg == 1 || leg == 2) ? 0.5f : 0.0f;
    const float legPhase = fmodf(phase + offset, 1.0f);
    const float wave = sinf(twoPi * legPhase);
    const float lift = max(0.0f, sinf(twoPi * legPhase));
    const bool isLeft = leg == 0 || leg == 2;

    float strideSign = 0.0f;
    switch (motionMode) {
      case MotionMode::Forward: strideSign = 1.0f; break;
      case MotionMode::Backward: strideSign = -1.0f; break;
      case MotionMode::Left: strideSign = isLeft ? -1.0f : 1.0f; break;
      case MotionMode::Right: strideSign = isLeft ? 1.0f : -1.0f; break;
      default: break;
    }

    const uint8_t base = leg * 3;
    setLogicalAngle(base, stride * wave * strideSign);
    setLogicalAngle(base + 1, 25.0f + hipLift * lift);
    setLogicalAngle(base + 2, -70.0f + kneeLift * lift);
  }

  if (now - lastStateBroadcast >= 80) {
    lastStateBroadcast = now;
    broadcastJointState();
  }
}

void setupWiFi() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.setSleep(false);

  if (!WiFi.softAP(AP_SSID, AP_PASSWORD)) {
    Serial.println("Failed to start SpiderBot access point.");
  } else {
    Serial.print("SpiderBot AP: ");
    Serial.print(AP_SSID);
    Serial.print("  IP: ");
    Serial.println(WiFi.softAPIP());
  }

  if (strlen(SPIDER_WIFI_SSID) > 0) {
    Serial.print("Connecting to Wi-Fi: ");
    Serial.println(SPIDER_WIFI_SSID);
    WiFi.begin(SPIDER_WIFI_SSID, SPIDER_WIFI_PASSWORD);
  }

  if (MDNS.begin(MDNS_NAME)) {
    MDNS.addService("ws", "tcp", 81);
    Serial.println("mDNS: spiderbot.local");
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("=== SpiderBot ESP32 Controller ===");

  loadConfig();

  Wire.begin();
  Wire.setClock(400000);

  pwm.begin();
  pwm.setPWMFreq(SERVO_HZ);
  delay(10);
  pcaReady = true;

  applyAllJoints();
  setupWiFi();

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("WebSocket control server listening on port 81.");
  Serial.println("Safety: calibrate servo channels, centers, bounds and directions with the robot lifted.");
}

void loop() {
  webSocket.loop();

  const uint32_t now = millis();
  updateGait(now);

  if (now - lastStatusBroadcast >= 2000) {
    lastStatusBroadcast = now;
    broadcastStatus();
  }

  delay(1);
}
