# Spider-Bot — simulator + ESP32 robot control

Two projects, one robot:

- **[`app/`](app/)** — React/Three.js 3D configurator and a Node.js WebSocket bridge.
- **[`firmware/`](firmware/)** — PlatformIO ESP32 firmware for a **PCA9685** servo driver.

The ESP32 connects **outbound** to the app computer over Wi-Fi. The browser connects
to the same app bridge. Run the app locally on the robot's LAN; the earlier static
hosted demo cannot host this Node WebSocket bridge.

## What is implemented

- Sixteen individually configurable PCA9685 channels; twelve articulated robot joints.
- Assign a channel to a joint, reverse its direction, set center/reference angles,
  physical angle limits, pulse endpoints, and movement speed.
- Single-servo bench control, all-joint control, and live 3D display of the
  **commanded** servo positions streamed by the ESP32 at 20 Hz.
- Four-leg inverse kinematics and an 80% stance crawl for forward, backward,
  clockwise and counterclockwise movement, with adjustable stride, lift, period,
  and turn angle. The body stays centered in the visualization; it is not odometry.
- Press-and-hold walking controls; release/Stop holds the current commanded pose.
  Disable outputs/Escape removes PWM output. Loss of control heartbeat also disables output.
- Configuration validation on both sides and persistent ESP32 NVS configuration.
- Separate offline preview mode, which sends **no hardware commands**.

Ordinary PWM servos do not report position. The displayed movement follows the
firmware's rate-limited commands, not measured encoder feedback. Walking is
open-loop: ground traction, center of mass, mechanical dimensions and servo travel
must be calibrated and tested on the physical robot. There is no IMU stabilization,
collision avoidance, load sensing or automatic balance compensation.

## Quick start

### 1. Start the app

Install Node.js **22.13+** (Node.js 24 LTS recommended), then:

```sh
cd app
npx pnpm@11.25.0 install --frozen-lockfile
npx pnpm@11.25.0 dev
```

Open **http://localhost:5173**. The bridge listens on **port 8787** and prints a
pairing token. A generated token is retained in `app/.robot-token` (git-ignored).
You can instead supply `SPIDER_TOKEN` in the process environment (16+ characters).
Do not paste Wi-Fi passwords or the real pairing token into Git.

For a production local server:

```sh
npx pnpm@11.25.0 build
npx pnpm@11.25.0 start
```

Then open **http://localhost:8787**, or `http://<app-computer-LAN-IP>:8787`
from another device on the same LAN. Keep the server running. If a firewall blocks
the ESP32, permit incoming TCP 8787 on the trusted/private network.

### 2. Wire and flash the ESP32

Follow the [firmware wiring and flashing guide](firmware/README.md).
Copy `firmware/include/secrets.example.h` to `firmware/include/secrets.h` and set:

- `WIFI_SSID` / `WIFI_PASSWORD`: a 2.4 GHz Wi-Fi network.
- `APP_HOST`: the app computer's LAN IP, **not** `localhost` and not the ESP32 IP.
- `APP_PORT`: `8787` by default.
- `ROBOT_TOKEN`: the token printed by the app bridge.

Open `firmware/` in VS Code with PlatformIO, then Build and Upload. Or:

```sh
cd firmware
pio run
pio run --target upload
pio device monitor
```

The firmware boots with all outputs disabled and reconnects to the app automatically.
Reconnection never automatically re-enables the servos or resumes walking.

### 3. Calibrate, one channel at a time

1. Support the body so the legs are free to move. Use a suitable separate servo
   power supply and the PCA9685 **OE** wiring in the firmware guide.
2. In the app choose **Real robot**, paste the pairing token, and **Connect**.
3. The app downloads the ESP32's saved settings. In **Calibration**, select a channel,
   set its joint and direction, servo angle limits, center/reference and pulse range.
   A joint can be assigned to only one channel. To swap assignments, first set one
   channel to Unassigned, make the swap, and save the final valid configuration.
4. **Apply & save to ESP32** while outputs are disabled.
5. In **Control**, check that the robot is supported and choose **Enable channel N only**.
   Move **Servo angle** in small increments; the simulator follows the commanded joint.
6. Disable outputs before editing calibration. Once mapping, direction and travel are
   tested, mark that channel calibrated and save. Repeat for all twelve joints.
7. Enter measured pivot-to-pivot leg lengths and body geometry in **Geometry**, then save.
8. **Enable all 12 calibrated joints**, **Move to standing pose**, then test short
   press-and-hold Forward/Backward/Rotate movements. Start with small stride/lift.

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

Channels 12–15 start disabled/unassigned and can be reassigned. Defaults are not
hardware calibration. Default center is 90°, neutral joint references are
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
| Release walking control / Stop | Cancel gait; hold current commanded position |
| No renewed drive command for 400 ms | Cancel gait; hold current commanded position |
| Disable outputs / Escape | Disable PCA9685 outputs through OE |
| App tab hidden or window loses focus | Send disable command; heartbeat remains independently enforced |
| No browser heartbeat for 1000 ms | Firmware disables outputs on its independent control task |
| WebSocket disconnect / reconnect | Disable; explicit enable required again |
| PCA9685 I²C write error | Disable outputs; fault shown; check wiring and reboot |

Disabling output releases holding torque and can let the robot drop; support it
during calibration. Software output-disable is not a substitute for a physical
servo power cutoff. Do not expose this plain HTTP/WebSocket LAN bridge directly to
the internet. The token is authentication, not transport encryption.

## Tests

```sh
cd app
npx pnpm@11.25.0 test        # JS math/protocol tests and real WebSocket integration
npx pnpm@11.25.0 test:core   # C++ control assertions + JS/C++ gait parity (needs g++)
npx pnpm@11.25.0 build      # TypeScript check + production UI build
cd ../firmware
pio run                    # ESP32 build, no board needed
```

The tests cover mapping/direction, bounds and invalid configurations, forward/inverse
kinematics, gait preflight, command validation, pairing, exclusive control, reconnect
behavior, watchdog timing including millis rollover, and 64 matching JS/C++ gait poses.
No physical robot is needed for these tests; they do not establish hardware walking
performance. See [protocol details](app/PROTOCOL.md) and [firmware guide](firmware/README.md).

## Reference project

`malekhmadi/aankbouta` was inspected. Its current `main` contains an MPU6050 BLE air
mouse, not a robot servo controller. No air-mouse source or dependencies were copied;
this firmware was implemented separately for the PCA9685 setup.
