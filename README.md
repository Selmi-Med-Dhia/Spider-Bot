# SpiderBot

This branch is organized as two independent projects:

- app/ — the existing Next.js 3D SpiderBot studio, extended with ESP32 hardware control
- firmware/ — a PlatformIO ESP32 controller for twelve servos through a PCA9685

## What is implemented

The app and robot share the same twelve logical joints: FL, FR, RL and RR, each with yaw, hip and knee.

From the app you can:

- connect directly to the ESP32 over WebSocket
- move any joint to a logical angle and see the 3D robot update
- assign each logical joint to PCA9685 servo channel 0–15
- leave a joint unassigned with channel -1
- set physical servo minimum, center and maximum angles
- reverse individual servo directions
- persist configuration in ESP32 flash
- enable or disable servo outputs
- change gait speed
- hold buttons for forward, backward, rotate left and rotate right
- receive live joint state from the ESP32 so the simulation follows the real gait

## Run the web app

From app/:

1. Install dependencies with pnpm install
2. Start development mode with pnpm dev
3. Open the local HTTP address printed by Next.js

Direct ws:// access to an ESP32 can be blocked by browsers when the web page itself is loaded over HTTPS, so local HTTP is the recommended control mode.

## Flash the ESP32

From firmware/:

1. Install PlatformIO
2. Connect the ESP32
3. Run pio run -t upload
4. Optionally run pio device monitor

The ESP32 creates a SpiderBot Wi-Fi access point with password spiderbot. Connect the computer to it, then use 192.168.4.1:81 in the app.

See firmware/README.md for wiring and the calibration sequence.

## Safety

Calibrate with the robot lifted. Start with conservative servo bounds. Use a properly sized external servo power supply with common ground. The movement gait is an open-loop baseline and must be validated on the actual mechanical build before unattended use.
