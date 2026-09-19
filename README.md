# Spider-Bot — simulator + ESP32 robot control

Two projects, one robot:

- **[`app/`](app/)** — React/Three.js 3D configurator with direct robot control.
- **[`firmware/`](firmware/)** — PlatformIO ESP32 firmware for a **PCA9685** servo driver.

The ESP32 creates **SpiderBot** Wi-Fi with **no password**. Join that network on
your computer and click Connect in the local app. The browser talks directly to
`ws://192.168.4.1:81/`. No token, router, computer IP, or Wi-Fi credentials to configure.

## What is implemented

- Sixteen individually configurable PCA9685 channels; twelve articulated robot joints.
- Assign a channel to a joint, reverse its direction, set center/reference angles,
  physical angle limits, pulse endpoints, and movement speed.
- Single-servo bench control, all-joint control, and live 3D display of the
  **commanded** servo positions streamed by the ESP32 at 20 Hz.
- Four-leg inverse kinematics and an 80% stance crawl for forward, backward,
  clockwise and counterclockwise movement, with adjustable stride, lift, period,
  and turn angle. The body stays centered in the visualization; it is not odometry.
- Press-and-hold walking controls; release/Stop/Escape holds the current commanded pose.
  All sixteen servo channels stay live while the PCA9685 is healthy; a lost controller stops
  walking and is disconnected without dropping the held servo outputs.
- Configuration validation on both sides and persistent ESP32 NVS configuration.
- Named saved movements with ordered checkpoints. Each checkpoint captures all sixteen
  commanded servo targets, can have a delay from the previous checkpoint, and replays as
  one atomic controller update for simple poses, standing sequences, or slow scripted motion.
- Separate offline preview mode, which sends **no hardware commands**.

Ordinary PWM servos do not report position. The displayed movement follows the
firmware's rate-limited commands, not measured encoder feedback. Walking is
open-loop: ground traction, center of mass, mechanical dimensions and servo travel
must be calibrated and tested on the physical robot. There is no IMU stabilization,
collision avoidance, load sensing or automatic balance compensation.

## Quick start

### 1. Install and start the app

Install [Node.js](https://nodejs.org/) 22.13+ and [pnpm](https://pnpm.io/installation).
While your computer still has internet, run:

```sh
cd app
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` builds and serves the app. Open **http://localhost:8787** and leave the
terminal running. All app assets are local; internet is not needed after installation.
For development, `pnpm dev` runs the UI on http://localhost:5173.

### 2. Flash and connect

1. Open **firmware/** in VS Code with PlatformIO and click **Upload**. PlatformIO
   automatically installs the WebSockets, ArduinoJson and PCA9685 dependencies from
   `platformio.ini`. Do this while you still have internet for the initial downloads.
   **Upload the new firmware even if an older version is already on the ESP32.**
2. On your computer join Wi-Fi **SpiderBot**. **There is no password.** Choose to
   stay connected if Windows says the network has no internet.
3. In http://localhost:8787 choose **Real robot**, then **Connect**. If your browser
   asks for local network access, allow it. Settings and live angles load automatically.

No `secrets.h` is needed; old Wi-Fi/token settings are ignored. Hardware pins are
in `firmware/include/Hardware.h`. See [wiring](firmware/README.md) before moving servos.
Saved servo calibration is retained when updating firmware normally (without erasing flash).

If connection fails: verify that **SpiderBot** is your active Wi-Fi network, close
other control tabs, and check PlatformIO Serial Monitor at 115200 baud. It should
print `Join Wi-Fi: SpiderBot (no password)`. If it prints the old bridge message,
flash this branch's firmware. Use the **local app URL**, not the old hosted demo.
The app reports a connection failure after six seconds instead of waiting forever.
The ESP32 address is for the app's WebSocket; it is not an HTTP webpage.

### 3. Calibrate and assign channels

1. Support the body so the legs are free to move. Use a suitable separate servo
   power supply and the PCA9685 **OE** wiring in the firmware guide.
2. In the app choose **Real robot** and **Connect**. All sixteen servo channels are live;
   start with conservative limits and keep the robot physically supported.
3. In **Calibration**, select any PCA9685 channel, assign its joint and direction, then
   set angle limits, center/reference, pulse range and speed. Assigning a joint to a new
   channel automatically unassigns it from the previous channel, so remapping is direct.
4. In **Control**, move **Servo angle** or **Joint angle** in small increments to test the
   selected channel. You can move another channel immediately; no enable/arm step exists.
5. Once mapping, direction and travel are tested, mark that channel calibrated and
   **Apply & save to ESP32**. Saving configuration preserves the current servo positions
   (clamped only if a newly configured limit requires it).
6. Repeat for all twelve joints, then enter measured pivot-to-pivot leg lengths and body
   geometry in **Geometry**.
7. When all twelve joints are assigned/calibrated, use **Move to standing pose**, then
   test short press-and-hold Forward/Backward/Rotate movements with small stride/lift.
8. To record a scripted movement, place the servos with **Control**, open **Movements**,
   create a movement and save the current position as a checkpoint. Reposition the servos,
   save more checkpoints, set the delay before each later checkpoint, then press
   **Run movement**. Saved movements stay in that browser's local storage.

Changing a servo's mapping, direction or calibration parameters clears its tested
flag in the app. Firmware rejects walks with missing calibration, unreachable foot
paths or joint targets outside the configured bounds. It evaluates the full cycle
before starting and checks every generated pose at runtime.

## Joint conventions

Front is **+Z**, up is **+Y**. Channel defaults:

| Leg | Yaw | Elbow | Knee |
| --- | --- | --- | --- |
| Front left | 0 | 1 | 2 |
| Front right | 3 | 4 | 5 |
| Rear left | 6 | 7 | 8 |
| Rear right | 9 | 10 | 11 |

Channels 12–15 start unassigned but are still live and can be assigned to any joint.
Defaults are not hardware calibration. Default center is 90°, neutral joint references are
`[0°, 25°, -95°]` and physical limits are 10°–170°.

```text
servoAngle = center + direction * (jointAngle - reference)
jointAngle = reference + direction * (servoAngle - center)
```

The firmware clamps manual motion to physical bounds and rate-limits movement.
Pulse endpoints describe pulses at **physical servo 0° and 180°**, independently
of the travel bounds. Use the range specified for your actual servos.

## Connection and stop behavior

| Event | Behavior |
| --- | --- |
| Release walking control / Stop / Escape | Cancel gait; hold current commanded position |
| No renewed drive command for 400 ms | Cancel gait; hold current commanded position |
| App tab hidden or window loses focus | Send Stop; held servo targets remain live |
| No browser heartbeat for 1500 ms | Drop the stale WebSocket controller; hold current servo positions |
| WebSocket disconnect / reconnect | Stop walking; hold current servo positions; no re-enable step |
| Repeated PCA9685 I²C write errors | Temporarily raise OE, retry PCA9685 initialization every second, then resume automatically |

All servo outputs are intentionally live whenever the PCA9685 is healthy. Support the
robot during calibration and use a physical servo-power cutoff for emergency isolation. This version intentionally uses an open local Wi-Fi connection
without authentication. Only one controlling app connection is accepted at a time.

## Tests

```sh
cd app
npx pnpm@11.25.0 test        # JS math/protocol tests and real WebSocket integration
npx pnpm@11.25.0 test:core   # C++ control assertions + JS/C++ gait parity (needs g++)
npx pnpm@11.25.0 build      # TypeScript check + production UI build
cd ../firmware
pio run                    # ESP32 build, no board needed
```

The tests cover mapping/direction, bounds and invalid configurations, mirrored
forward/inverse kinematics, repeated independent servo commands, gait preflight,
atomic 16-servo checkpoint application/rejection, movement delay sequencing,
direct token-free connection/reconnect behavior, live configuration preservation,
and 64 matching JS/C++ gait poses.
No physical robot is needed for these tests; they do not establish hardware walking
performance. See [protocol details](app/PROTOCOL.md) and [firmware guide](firmware/README.md).

## Reference project

`malekhmadi/aankbouta` was inspected. Its current `main` contains an MPU6050 BLE air
mouse, not a robot servo controller. No air-mouse source or dependencies were copied;
this firmware was implemented separately for the PCA9685 setup.
