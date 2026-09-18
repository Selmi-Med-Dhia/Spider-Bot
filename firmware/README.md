# SpiderBot firmware

This PlatformIO project turns an ESP32 plus PCA9685 into the hardware side of SpiderBot Control Studio.

## Hardware

- ESP32 DevKit / ESP32-WROOM-32
- PCA9685 16-channel PWM servo driver at I2C address `0x40`
- Up to 16 physical servo channels; the robot currently uses 12 logical joints
- External servo power supply sized for the robot

Do not power the servos from the ESP32 board. Use a separate servo supply and connect the servo-supply ground, PCA9685 ground and ESP32 ground together.

Default ESP32 I2C pins are SDA GPIO21 and SCL GPIO22.

## Network

The ESP32 always creates:

- Wi-Fi SSID: `SpiderBot`
- Password: `spiderbot`
- Access-point IP: `192.168.4.1`
- WebSocket port: `81`

For normal LAN access, copy `include/secrets.example.h` to `include/secrets.h` and set `SPIDER_WIFI_SSID` and `SPIDER_WIFI_PASSWORD`. The access point remains available as a fallback.

## Servo-first configuration model

Calibration belongs to the **physical PCA9685 servo channel**, not to the joint.

Each of the 16 servo channels stores:

- minimum physical angle
- center physical angle
- maximum physical angle
- direction: normal or reversed
- optional logical-joint assignment

Each logical joint can have at most one servo assigned. Each servo can control at most one joint.

Reassigning servo 5 from one joint to another keeps servo 5's min/center/max calibration. If the target joint was already controlled by another servo, the previous servo is automatically unassigned.

All of this is stored in ESP32 NVS flash.

Logical robot commands are converted with:

`physical servo angle = center + direction × logical joint angle`

and then clamped to that servo's calibrated min/max range.

## First calibration

1. Put the robot on a stand so the feet and links cannot strike the floor.
2. Power the ESP32 and the external servo supply with common ground.
3. Open the web app locally over HTTP.
4. Join the `SpiderBot` Wi-Fi network.
5. Connect the app to `192.168.4.1:81`.
6. Keep all servos unassigned initially.
7. Select a physical servo channel, for example Servo 0.
8. Set conservative min, center and max values and save the calibration.
9. Enable servo outputs and use the physical-servo jog slider to identify and test that servo.
10. Adjust the bounds until its safe physical range is known.
11. Choose its logical joint from the assignment selector.
12. Repeat for the remaining servos.
13. Use the assignment map to confirm every one of the 12 joints has exactly one servo.
14. Only then test standing and gait controls.

The firmware rejects gait commands until all 12 logical joints have a servo assigned, and outputs start disabled after boot.

Existing version-2 joint-based mappings are migrated to the new servo-based storage format when possible.

## Gait

The included gait is an open-loop starting gait. Actual geometry, horn indexing, load, floor friction, backlash and center of mass can require tuning before reliable walking.
