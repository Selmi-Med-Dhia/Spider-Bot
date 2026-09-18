# Spiderbot app

```sh
pnpm install --frozen-lockfile
pnpm start
```

Open http://localhost:8787. Join **SpiderBot** Wi-Fi (no password), choose
**Real robot**, then **Connect**. Flash the matching firmware first.
See the [repository README](../README.md) for wiring and calibration.

`pnpm start` builds then serves local assets. `pnpm dev` runs Vite on port 5173.
No internet is needed after dependencies are installed. No pairing token or bridge.

## Code map

- `src/App.tsx`: control/calibration/geometry panels and offline preview.
- `src/RobotViewport.tsx`: Three.js articulation.
- `src/useRobot.ts`: React state and visibility/heartbeat handling.
- `shared/connection.mjs`: direct WebSocket connection, telemetry checks and timeouts.
- `shared/robot.mjs`: validation, mapping, FK/IK and preview gait.
- `server/app.mjs`: local static app hosting only.
- `tests/`: math/protocol and direct WebSocket integration tests.
- `scripts/test-core.mjs`: native firmware assertions and JS/C++ gait parity.
