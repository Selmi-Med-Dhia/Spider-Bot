# ESP32 + PCA9685 firmware

Target: classic ESP32 DevKit / ESP32-WROOM-32 (`esp32dev`), Arduino framework,
PlatformIO `espressif32@6.5.0`, PCA9685 at I²C address `0x40` and 50 Hz PWM.

## Wiring

| ESP32 / supply | PCA9685 / robot |
| --- | --- |
| GPIO21 | SDA |
| GPIO22 | SCL |
| 3.3 V | VCC (logic supply) |
| GND | GND |
| GPIO23 | OE (active-high output disable) |
| 10 kΩ resistor from 3.3 V | OE, so PWM is disabled while the ESP32 resets |
| Separate servo supply positive | V+ (voltage appropriate to your servo model) |
| Servo supply negative | PCA9685 GND and ESP32 GND (common ground) |
| PCA9685 channel signal/V+/GND | Corresponding servo signal/power/ground |

Do not power twelve servos from the ESP32 3.3 V or USB pin. Select supply voltage
and current capacity for the actual servos, including stall current. A physical
servo-power cutoff is recommended. OE only gates the signal; it does not remove
servo supply power. Set PCA9685 logic VCC to 3.3 V so I²C pull-ups stay at ESP32 levels.

The OE pin and external pull-up provide deterministic signal disable during ESP32
reset and during PCA9685 fault recovery. An unconnected OE defeats that hardware
gate. Do not tie OE permanently low with this firmware.

## Setup

No Wi-Fi credentials, tokens, or secrets file are needed. Hardware pin settings
are in `include/Hardware.h`. PlatformIO installs all libraries automatically,
including `links2004/WebSockets@2.6.1`.

```sh
pio run
pio run --target upload
pio device monitor
```

The ESP32 creates open Wi-Fi **SpiderBot**, with no password, at **192.168.4.1**.
Join it from the computer running the local app, choose Real robot and click Connect.
The browser connects directly to the ESP32 WebSocket server on port **81**.
There is no router or app bridge. The firmware accepts one controller at a time;
a second tab receives an error. All sixteen servo channels are live while the PCA9685
is healthy. Disconnect/reconnect stops walking but keeps the current servo positions.
After 1500 ms without a browser heartbeat, the stale client is dropped so another
controller can connect; a drive command still expires after 400 ms.

Old `secrets.h` files are ignored. Normal firmware updates retain calibration in NVS.
Serial Monitor should print the Wi-Fi name and robot address at startup.

## Firmware layout

- `src/main.cpp`: Wi-Fi/WebSocket transport, JSON commands, NVS and PCA9685 I/O.
- `include/RobotCore.h`: hardware-independent mapping, forward/inverse kinematics,
  crawl generator, servo rate limits and stop/watchdog behavior.
- `include/ConfigJson.h`: complete, validated JSON configuration conversion.
- `test/core_test.cpp`: native control checks and trajectory fixtures.

The network loop runs separately from a 50 Hz servo-control FreeRTOS task. Network
processing does not suspend heartbeat/drive timeout handling. A mutex protects
state, and I²C calls have a 20 ms bus timeout. Validated configuration can be changed
live; existing servo angles are preserved and clamped only when new limits require it.
One full validated configuration is stored under NVS namespace
`spider-q4`, key `config`. It is not written on every servo move.

Servo targets start at configured centers after boot. Live configuration changes keep
the current commanded angles instead of snapping back to center. Actual shaft positions
are unknown after power or PWM loss. Always support the robot and check clearances
before commanding motion.

## Calibrating physical hardware

The default pulse range is **600–2400 µs across 0–180°**, with 10–170° travel bounds.
These values are configurable, not a promise of compatibility with every servo.
Use the manufacturer's pulse range and verify each mechanical stop with the robot
supported. Start with a narrow physical angle range around a suitable center.
Set reversal from the observed joint rotation, not from a generic left/right assumption.

The neutral kinematic angles are yaw 0°, elbow +25°, knee −95°. `reference` tells
which joint angle is physically represented at the servo's configured center.
Measure lengths between joint axes. The final segment must be the longest.

The crawling trajectory has one swing leg at a time and 80% stance duty factor.
There is no center-of-mass controller, gait odometry or IMU feedback. Calibration,
mechanical rigidity and a suitable support polygon are necessary; validate actual
walking on the robot before increasing stride, lift or speed.

## Sources

- [PCA9685 driver API](https://adafruit.github.io/Adafruit-PWM-Servo-Driver-Library/html/class_adafruit___p_w_m_servo_driver.html)
- [Arduino WebSockets](https://github.com/Links2004/arduinoWebSockets)
- [PlatformIO ESP32 Dev Module](https://docs.platformio.org/en/latest/boards/espressif32/esp32dev.html)
