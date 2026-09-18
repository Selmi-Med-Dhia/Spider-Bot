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
constexpr uint16_t CONFIG_VERSION = 3;
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

struct ServoConfig {
  float minAngle;
  float maxAngle;
  float centerAngle;
  int8_t direction;
  int8_t joint;
};

struct LegacyJointConfig {
  int8_t channel;
  float minAngle;
  float maxAngle;
  float centerAngle;
  int8_t direction;
};

Adafruit_PWMServoDriver pwm(PCA9685_ADDRESS);
WebSocketsServer webSocket(81);
Preferences preferences;

ServoConfig servoConfig[SERVO_COUNT];
float servoPhysicalAngles[SERVO_COUNT];
float jointAngles[JOINT_COUNT];

bool outputsEnabled = false;
MotionMode motionMode = MotionMode::Stop;
uint8_t gaitSpeed = 55;
uint32_t motionStartedAt = 0;
uint32_t lastGaitUpdate = 0;
uint32_t lastStateBroadcast = 0;
uint32_t lastStatusBroadcast = 0;
bool pcaReady = false;

float baseAngleForJoint(uint8_t joint) {
  switch (joint % 3) {
    case 1: return 25.0f;
    case 2: return -70.0f;
    default: return 0.0f;
  }
}

void loadDefaults() {
  for (uint8_t channel = 0; channel < SERVO_COUNT; ++channel) {
    servoConfig[channel].minAngle = 10.0f;
    servoConfig[channel].maxAngle = 170.0f;
    servoConfig[channel].centerAngle = 90.0f;
    servoConfig[channel].direction = 1;
    servoConfig[channel].joint = -1;
    servoPhysicalAngles[channel] = servoConfig[channel].centerAngle;
  }

  for (uint8_t joint = 0; joint < JOINT_COUNT; ++joint) {
    jointAngles[joint] = baseAngleForJoint(joint);
  }

  gaitSpeed = 55;
}

bool servoConfigLooksValid(const ServoConfig& config) {
  return config.minAngle >= 0.0f &&
         config.maxAngle <= 180.0f &&
         config.minAngle < config.maxAngle &&
         config.centerAngle > config.minAngle &&
         config.centerAngle < config.maxAngle &&
         (config.direction == 1 || config.direction == -1) &&
         config.joint >= -1 &&
         config.joint < JOINT_COUNT;
}

bool allConfigLooksValid() {
  bool jointSeen[JOINT_COUNT] = { false };

  for (uint8_t channel = 0; channel < SERVO_COUNT; ++channel) {
    if (!servoConfigLooksValid(servoConfig[channel])) return false;

    const int joint = servoConfig[channel].joint;
    if (joint >= 0) {
      if (jointSeen[joint]) return false;
      jointSeen[joint] = true;
    }
  }
  return true;
}

void saveConfig() {
  preferences.begin("spiderbot", false);
  preferences.putUShort("version", CONFIG_VERSION);
  preferences.putBytes("servo_cfg", servoConfig, sizeof(servoConfig));
  preferences.putUChar("gait_speed", gaitSpeed);
  preferences.end();
}

void migrateLegacyV2() {
  const size_t expected = sizeof(LegacyJointConfig) * JOINT_COUNT;
  if (preferences.getBytesLength("joint_cfg") != expected) return;

  LegacyJointConfig legacy[JOINT_COUNT];
  preferences.getBytes("joint_cfg", legacy, sizeof(legacy));

  bool channelUsed[SERVO_COUNT] = { false };
  for (uint8_t joint = 0; joint < JOINT_COUNT; ++joint) {
    const int channel = legacy[joint].channel;
    if (channel < 0 || channel >= SERVO_COUNT || channelUsed[channel]) continue;

    ServoConfig migrated;
    migrated.minAngle = legacy[joint].minAngle;
    migrated.maxAngle = legacy[joint].maxAngle;
    migrated.centerAngle = legacy[joint].centerAngle;
    migrated.direction = legacy[joint].direction;
    migrated.joint = static_cast<int8_t>(joint);

    if (!servoConfigLooksValid(migrated)) continue;

    servoConfig[channel] = migrated;
    servoPhysicalAngles[channel] = migrated.centerAngle;
    channelUsed[channel] = true;
  }
}

void loadConfig() {
  loadDefaults();

  preferences.begin("spiderbot", true);
  const uint16_t version = preferences.getUShort("version", 0);

  if (
    version == CONFIG_VERSION &&
    preferences.getBytesLength("servo_cfg") == sizeof(servoConfig)
  ) {
    preferences.getBytes("servo_cfg", servoConfig, sizeof(servoConfig));
    gaitSpeed = preferences.getUChar("gait_speed", 55);
  } else if (version == 2) {
    migrateLegacyV2();
    gaitSpeed = preferences.getUChar("gait_speed", 55);
  }
  preferences.end();

  gaitSpeed = constrain(gaitSpeed, 20, 100);

  if (!allConfigLooksValid()) {
    Serial.println("Stored servo configuration was invalid. Restoring safe defaults.");
    loadDefaults();
  }

  for (uint8_t channel = 0; channel < SERVO_COUNT; ++channel) {
    servoPhysicalAngles[channel] = constrain(
      servoConfig[channel].centerAngle,
      servoConfig[channel].minAngle,
      servoConfig[channel].maxAngle
    );
  }

  saveConfig();
}

int findJoint(const char* name) {
  if (!name) return -1;
  for (uint8_t joint = 0; joint < JOINT_COUNT; ++joint) {
    if (strcmp(name, JOINT_NAMES[joint]) == 0) return static_cast<int>(joint);
  }
  return -1;
}

int findServoForJoint(uint8_t joint) {
  for (uint8_t channel = 0; channel < SERVO_COUNT; ++channel) {
    if (servoConfig[channel].joint == static_cast<int8_t>(joint)) {
      return static_cast<int>(channel);
    }
  }
  return -1;
}

bool allJointsAssigned() {
  for (uint8_t joint = 0; joint < JOINT_COUNT; ++joint) {
    if (findServoForJoint(joint) < 0) return false;
  }
  return true;
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

void disableChannel(uint8_t channel) {
  if (!pcaReady || channel >= SERVO_COUNT) return;
  pwm.setPWM(channel, 0, 4096);
}

void disableAllChannels() {
  if (!pcaReady) return;
  for (uint8_t channel = 0; channel < SERVO_COUNT; ++channel) {
    disableChannel(channel);
  }
}

float setServoPhysicalAngle(uint8_t channel, float requestedAngle) {
  ServoConfig& config = servoConfig[channel];
  const float bounded = constrain(requestedAngle, config.minAngle, config.maxAngle);
  servoPhysicalAngles[channel] = bounded;

  if (outputsEnabled && pcaReady) {
    pwm.setPWM(channel, 0, angleToTicks(bounded));
  }
  return bounded;
}

float setLogicalAngle(uint8_t joint, float requestedAngle) {
  const int channel = findServoForJoint(joint);
  if (channel < 0) {
    jointAngles[joint] = requestedAngle;
    return requestedAngle;
  }

  const ServoConfig& config = servoConfig[channel];
  float physical = config.centerAngle + static_cast<float>(config.direction) * requestedAngle;
  physical = constrain(physical, config.minAngle, config.maxAngle);

  const float actualLogical =
    (physical - config.centerAngle) / static_cast<float>(config.direction);

  jointAngles[joint] = actualLogical;
  setServoPhysicalAngle(static_cast<uint8_t>(channel), physical);
  return actualLogical;
}

void applyAllAssignedJoints() {
  disableAllChannels();
  if (!outputsEnabled) return;

  for (uint8_t joint = 0; joint < JOINT_COUNT; ++joint) {
    setLogicalAngle(joint, jointAngles[joint]);
  }
}

void setStandingPose() {
  for (uint8_t joint = 0; joint < JOINT_COUNT; ++joint) {
    setLogicalAngle(joint, baseAngleForJoint(joint));
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
  for (uint8_t joint = 0; joint < JOINT_COUNT; ++joint) {
    object[JOINT_NAMES[joint]] = jointAngles[joint];
  }
}

void fillServos(JsonArray array) {
  for (uint8_t channel = 0; channel < SERVO_COUNT; ++channel) {
    JsonObject item = array.add<JsonObject>();
    item["channel"] = channel;
    item["min"] = servoConfig[channel].minAngle;
    item["max"] = servoConfig[channel].maxAngle;
    item["center"] = servoConfig[channel].centerAngle;
    item["direction"] = servoConfig[channel].direction;
    item["joint"] =
      servoConfig[channel].joint >= 0
        ? JOINT_NAMES[servoConfig[channel].joint]
        : "";
    item["physicalAngle"] = servoPhysicalAngles[channel];
  }
}

void sendSnapshot(uint8_t client) {
  JsonDocument doc;
  doc["type"] = "snapshot";
  doc["outputsEnabled"] = outputsEnabled;
  doc["gaitSpeed"] = gaitSpeed;
  doc["motion"] = motionName(motionMode);
  doc["allJointsAssigned"] = allJointsAssigned();

  JsonObject angles = doc["angles"].to<JsonObject>();
  fillAngles(angles);

  JsonArray servos = doc["servos"].to<JsonArray>();
  fillServos(servos);

  sendJson(client, doc);
}

void broadcastSnapshot() {
  JsonDocument doc;
  doc["type"] = "snapshot";
  doc["outputsEnabled"] = outputsEnabled;
  doc["gaitSpeed"] = gaitSpeed;
  doc["motion"] = motionName(motionMode);
  doc["allJointsAssigned"] = allJointsAssigned();

  JsonObject angles = doc["angles"].to<JsonObject>();
  fillAngles(angles);

  JsonArray servos = doc["servos"].to<JsonArray>();
  fillServos(servos);

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
  doc["allJointsAssigned"] = allJointsAssigned();
  doc["staConnected"] = WiFi.status() == WL_CONNECTED;
  doc["ip"] = stationIp();
  doc["apIp"] = WiFi.softAPIP().toString();
  doc["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  broadcastJson(doc);
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

void handleServoCalibration(uint8_t client, JsonDocument& doc) {
  const int channel = doc["channel"] | -1;
  if (channel < 0 || channel >= SERVO_COUNT) {
    sendError(client, "Servo channel must be 0..15.");
    return;
  }

  ServoConfig candidate = servoConfig[channel];
  candidate.minAngle = doc["min"] | candidate.minAngle;
  candidate.maxAngle = doc["max"] | candidate.maxAngle;
  candidate.centerAngle = doc["center"] | candidate.centerAngle;
  candidate.direction = static_cast<int8_t>(doc["direction"] | candidate.direction);

  if (!servoConfigLooksValid(candidate)) {
    sendError(client, "Invalid servo calibration. Use min < center < max within 0..180 degrees.");
    return;
  }

  servoConfig[channel] = candidate;
  servoPhysicalAngles[channel] = constrain(
    servoPhysicalAngles[channel],
    candidate.minAngle,
    candidate.maxAngle
  );

  if (outputsEnabled) {
    setServoPhysicalAngle(static_cast<uint8_t>(channel), servoPhysicalAngles[channel]);
  }

  saveConfig();
  sendAck(client, "Servo calibration saved to ESP32 flash.");
  broadcastSnapshot();
}

void handleServoAssignment(uint8_t client, JsonDocument& doc) {
  const int channel = doc["channel"] | -1;
  if (channel < 0 || channel >= SERVO_COUNT) {
    sendError(client, "Servo channel must be 0..15.");
    return;
  }

  const char* jointName = doc["joint"] | "";
  const int targetJoint = strlen(jointName) == 0 ? -1 : findJoint(jointName);
  if (strlen(jointName) > 0 && targetJoint < 0) {
    sendError(client, "Unknown joint.");
    return;
  }

  motionMode = MotionMode::Stop;

  if (targetJoint >= 0) {
    const int previousServo = findServoForJoint(static_cast<uint8_t>(targetJoint));
    if (previousServo >= 0 && previousServo != channel) {
      servoConfig[previousServo].joint = -1;
      disableChannel(static_cast<uint8_t>(previousServo));
    }
  }

  const int oldJoint = servoConfig[channel].joint;
  servoConfig[channel].joint = static_cast<int8_t>(targetJoint);

  if (targetJoint < 0) {
    disableChannel(static_cast<uint8_t>(channel));
  } else {
    setLogicalAngle(
      static_cast<uint8_t>(targetJoint),
      jointAngles[targetJoint]
    );
  }

  saveConfig();

  if (oldJoint >= 0 && oldJoint != targetJoint) {
    jointAngles[oldJoint] = baseAngleForJoint(static_cast<uint8_t>(oldJoint));
  }

  sendAck(client, targetJoint >= 0 ? "Servo assigned to joint." : "Servo unassigned.");
  broadcastSnapshot();
}

void handleServoJog(uint8_t client, JsonDocument& doc) {
  const int channel = doc["channel"] | -1;
  if (channel < 0 || channel >= SERVO_COUNT) {
    sendError(client, "Servo channel must be 0..15.");
    return;
  }

  if (!outputsEnabled) {
    sendError(client, "Enable servo outputs before jogging a servo.");
    return;
  }

  motionMode = MotionMode::Stop;
  const float requested = doc["angle"] | servoConfig[channel].centerAngle;
  const float physical = setServoPhysicalAngle(static_cast<uint8_t>(channel), requested);

  const int joint = servoConfig[channel].joint;
  if (joint >= 0) {
    jointAngles[joint] =
      (physical - servoConfig[channel].centerAngle) /
      static_cast<float>(servoConfig[channel].direction);
  }

  broadcastSnapshot();
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
    const int joint = findJoint(doc["joint"] | "");
    if (joint < 0) {
      sendError(client, "Unknown joint.");
      return;
    }

    motionMode = MotionMode::Stop;
    const float requested = doc["angle"] | 0.0f;
    setLogicalAngle(static_cast<uint8_t>(joint), requested);
    broadcastJointState();
    return;
  }

  if (strcmp(type, "servo_config_set") == 0) {
    handleServoCalibration(client, doc);
    return;
  }

  if (strcmp(type, "servo_assign") == 0) {
    handleServoAssignment(client, doc);
    return;
  }

  if (strcmp(type, "servo_jog") == 0) {
    handleServoJog(client, doc);
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
      return;
    }

    if (!outputsEnabled) {
      sendError(client, "Enable servo outputs before starting a gait.");
      return;
    }

    if (!allJointsAssigned()) {
      sendError(client, "Assign one servo to every joint before starting a gait.");
      return;
    }

    motionMode = nextMode;
    motionStartedAt = millis();
    sendAck(client, "Motion started.");
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
    if (outputsEnabled) {
      applyAllAssignedJoints();
    } else {
      motionMode = MotionMode::Stop;
      disableAllChannels();
    }
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
    outputsEnabled = false;
    motionMode = MotionMode::Stop;
    loadDefaults();
    saveConfig();
    disableAllChannels();
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
      Serial.printf(
        "Web client %u connected from %s\n",
        client,
        webSocket.remoteIP(client).toString().c_str()
      );
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

  const float speedNormalized =
    (constrain(gaitSpeed, 20, 100) - 20.0f) / 80.0f;
  const float cycleMs = 1900.0f - speedNormalized * 1200.0f;
  const float phase =
    fmodf(static_cast<float>(now - motionStartedAt) / cycleMs, 1.0f);

  constexpr float twoPi = 6.28318530718f;
  constexpr float stride = 26.0f;
  constexpr float hipLift = 17.0f;
  constexpr float kneeLift = 31.0f;

  for (uint8_t leg = 0; leg < 4; ++leg) {
    const float offset = (leg == 1 || leg == 2) ? 0.5f : 0.0f;
    const float legPhase = fmodf(phase + offset, 1.0f);
    const float wave = sinf(twoPi * legPhase);
    const float lift = fmaxf(0.0f, sinf(twoPi * legPhase));
    const bool isLeft = leg == 0 || leg == 2;

    float strideSign = 0.0f;
    switch (motionMode) {
      case MotionMode::Forward:
        strideSign = 1.0f;
        break;
      case MotionMode::Backward:
        strideSign = -1.0f;
        break;
      case MotionMode::Left:
        strideSign = isLeft ? -1.0f : 1.0f;
        break;
      case MotionMode::Right:
        strideSign = isLeft ? 1.0f : -1.0f;
        break;
      default:
        break;
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

  disableAllChannels();
  setupWiFi();

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);

  Serial.println("WebSocket control server listening on port 81.");
  Serial.println("Servo outputs start disabled.");
  Serial.println("Calibrate each physical servo first, then assign it to a joint.");
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
