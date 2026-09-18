# SpiderBot

This branch is organized as two independent projects:

- `app/` — the Next.js 3D SpiderBot studio and hardware-control UI
- `firmware/` — the PlatformIO ESP32 controller for the PCA9685 servo board

## Servo-first workflow

The hardware model now separates **physical servos** from **logical robot joints**.

There are 16 selectable PCA9685 servo channels and 12 logical joints: FL, FR, RL and RR, each with yaw, hip and knee.

From the app you can:

- select any physical servo channel 0–15
- jog that servo directly during calibration
- set and persist its physical minimum, center and maximum angle
- set its normal/reversed direction
- assign the calibrated servo to any logical robot joint
- reassign it later without losing the servo calibration
- automatically detach a joint from its previous servo when you reassign it
- leave servos and joints unassigned
- move logical joints manually while the 3D model stays synchronized
- enable/disable servo outputs
- run forward, backward, rotate-left and rotate-right gait commands after all 12 joints are assigned
- receive live ESP32 joint state so the simulation follows the hardware command state

On a fresh configuration, all servo channels start **unassigned** and servo outputs start **disabled**.

## Run the web app

From `app/`:

1. Run `pnpm install`.
2. Run `pnpm dev`.
3. Open the local HTTP address printed by the development server.

Direct `ws://` access to an ESP32 can be blocked when the page itself is served over HTTPS, so local HTTP is the recommended robot-control mode.

## Flash the ESP32

From `firmware/`:

1. Install PlatformIO.
2. Connect the ESP32.
3. Run `pio run -t upload`.
4. Optionally run `pio device monitor`.

The ESP32 creates the Wi-Fi access point `SpiderBot` with password `spiderbot`. Connect the computer to that network, then use `192.168.4.1:81` in the app.

See `firmware/README.md` for wiring and the calibration procedure.

## Safety

Calibrate with the robot lifted. Use conservative servo bounds first. Power the servos from a properly sized external supply with a common ground to the ESP32/PCA9685. The walking gait is an open-loop baseline and must be validated on the actual mechanical build.
