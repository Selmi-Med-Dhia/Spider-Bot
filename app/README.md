# Spiderbot app

See the [repository README](../README.md) for setup, pairing and calibration.

```sh
npx pnpm@11.25.0 install --frozen-lockfile
npx pnpm@11.25.0 dev
```

This runs the Vite UI on 5173 and Node WebSocket bridge on 8787. The ESP32 connects
to the app computer's port 8787, not to the browser or the UI development port.
`pnpm build` creates `dist/`; `pnpm start` serves it and the bridge together on 8787.

## Code map

- `src/App.tsx`: control/calibration/geometry panels and offline preview.
- `src/RobotViewport.tsx`: Three.js articulation; joint changes do not rebuild meshes.
- `src/useRobot.ts`: authenticated browser session, telemetry, heartbeat and reconnect state.
- `shared/robot.mjs`: protocol validation, mapping, FK/IK and preview gait.
- `server/bridge.mjs`: authenticated WebSocket relay, exclusive control and static hosting.
- `tests/`: mathematical and WebSocket integration tests.
- `scripts/test-core.mjs`: compiles the firmware core tests using g++ and verifies JS/C++ parity.

The installed UI catalog and existing dependency lockfile were retained from the
original app. Hosting-specific server code was replaced with the local bridge,
because real ESP32 control needs a continuously running WebSocket server.
