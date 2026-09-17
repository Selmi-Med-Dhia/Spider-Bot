# SpiderBot firmware

This PlatformIO project turns an ESP32 plus PCA9685 servo driver into the hardware side of SpiderBot Control Studio.

## Hardware

- ESP32 DevKit / ESP32-WROOM-32
- PCA9685 16-channel PWM servo driver at I2C address 0x40
- Up to 12 servos, one for each logical joint
- External servo power supply sized for the robot

Important: do not power twelve servos from the ESP32 board. Use a separate servo supply and connect its ground to ESP32 ground.

Default ESP32 I2C pins are SDA GPIO21 and SCL GPIO22.

## Network

The ESP32 always creates:

- Wi-Fi SSID: SpiderBot
- Password: spiderbot
- Access-point IP: 192.168.4.1
- WebSocket port: 81

The web app therefore defaults to 192.168.4.1:81.

For normal LAN access, copy include/secrets.example.h to include/secrets.h and set SPIDER_WIFI_SSID and SPIDER_WIFI_PASSWORD. The ESP32 keeps the access point enabled as a fallback.

## Servo model

Each logical joint has:

- PCA9685 channel, -1 means unassigned
- minimum physical servo angle
- maximum physical servo angle
- center physical servo angle
- direction, normal or reversed

The app and firmware communicate in logical angles. Firmware converts them with:

physical servo angle = center + direction × logical angle

then clamps to min/max before generating PWM.

The mapping is saved in ESP32 NVS flash and survives reboot.

## First calibration

1. Put the robot on a stand so its feet cannot load or hit the floor.
2. Power the ESP32 and servo supply with a common ground.
3. Open the web app locally over HTTP.
4. Join the SpiderBot Wi-Fi network.
5. Connect to 192.168.4.1:81.
6. For each joint, assign the correct channel.
7. Set conservative min and max values before moving it.
8. Set center and direction.
9. Test every joint manually with small angle changes.
10. Only after all twelve joints are correct, use the movement pad.

The included gait is an open-loop starting gait. Real leg geometry, servo horn placement, load, floor friction and center of mass can require tuning before reliable walking.
