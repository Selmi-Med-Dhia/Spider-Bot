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

The OE pin and external pull-up are required for deterministic output disable
through reset/network loss. An unconnected OE defeats the intended hardware gate.
Do not tie OE permanently low with this firmware.

## Setup

Copy `include/secrets.example.h` to `include/secrets.h`, then edit Wi-Fi credentials,
`APP_HOST` (computer LAN IP), `APP_PORT` and the matching app `ROBOT_TOKEN`.
The secrets file is excluded from Git. A build without secrets uses placeholder
values and cannot connect; it can still be used to check compilation.

```sh
pio run
pio run --target upload
pio device monitor
```

Both ESP32 and app computer must be on the same reachable LAN. Allow TCP 8787
through the app computer's private-network firewall. This firmware uses an outbound
WebSocket at `/robot`; it does not run a web server, access point or Bluetooth device.

## Firmware layout

- `src/main.cpp`: Wi-Fi/WebSocket transport, JSON commands, NVS and PCA9685 I/O.
- `include/RobotCore.h`: hardware-independent mapping, forward/inverse kinematics,
  crawl generator, servo rate limits and stop/watchdog behavior.
- `include/ConfigJson.h`: complete, validated JSON configuration conversion.
- `test/core_test.cpp`: native control checks and trajectory fixtures.

The network loop runs separately from a 50 Hz servo-control FreeRTOS task. TCP
reconnection does not suspend heartbeat/drive timeout handling. A mutex protects
state, and I²C calls have a 20 ms bus timeout. Config changes are accepted only while
outputs are disabled. One full validated configuration is stored under NVS namespace
`spider-q4`, key `config`. It is not written on every servo move.

Servo outputs start at the last software-commanded angles on re-enable, or configured
centers after boot/config changes. Actual shaft positions are unknown after power or
PWM loss. Always support the robot and check clearances before enabling.

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
