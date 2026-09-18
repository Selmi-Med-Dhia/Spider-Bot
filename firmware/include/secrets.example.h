#pragma once
#define WIFI_SSID "YOUR_2_4_GHZ_WIFI"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
// The computer running app/server/bridge.mjs, NOT localhost or the ESP32 IP.
#define APP_HOST "192.168.1.100"
#define APP_PORT 8787
// Copy the pairing token printed when the app server starts; at least 16 chars.
#define ROBOT_TOKEN "REPLACE_WITH_APP_PAIRING_TOKEN"
#define ROBOT_ID "spider-q4"
#define PCA_ADDRESS 0x40
#define I2C_SDA 21
#define I2C_SCL 22
// Connect PCA9685 OE to GPIO23 AND a 10k pull-up to 3.3V.
#define SERVO_OE_PIN 23
