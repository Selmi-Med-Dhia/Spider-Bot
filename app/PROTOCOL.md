# Spider Q4 wire protocol, version 1

All frames are UTF-8 JSON. Units: millimeters and degrees; Y up, +Z forward.
Firmware rejects command documents larger than 15000 bytes.

## Connections

- ESP32 runs open Wi-Fi `SpiderBot`, fixed IP `192.168.4.1`, and a WebSocket server
  on port 81. The browser connects directly to `ws://192.168.4.1:81/`.
- No session endpoint, cookies, Authorization headers or pairing tokens.
- One controlling browser is accepted. A second receives an error frame and closes.
- On connection the firmware disables outputs and sends config/state. Browser sends
  heartbeat and getConfig. Disconnect disables outputs. Motion is never replayed.
- The browser sends heartbeat every 250 ms while visible. Firmware independently
  disables outputs after 1000 ms without heartbeat, and drops the client after 1500 ms.
- The browser clears controls on stale telemetry (1500 ms) or failed setup (6000 ms).
- Node serves static app files on localhost:8787; it does not relay robot traffic.

## Commands

Every browser command has `v: 1`, a positive integer `id`, and `type`.


| Type | Additional fields | Behavior |
| --- | --- | --- |
| `getConfig` | none | Return entire persisted configuration |
| `configure` | `config` | Validate and atomically adopt/persist while disarmed |
| `heartbeat` | none | Renew control lease; does not resume walking |
| `arm` | `channel: 0..15`, or `-1` | Enable one channel; `-1` requires all 12 joints calibrated |
| `disarm` | none | Cancel gait, freeze targets, disable OE |
| `stop` | none | Cancel gait and hold current commanded positions |
| `servo` | `channel`, `angle: 0..180` | Manual physical angle, clamp to channel min/max |
| `joint` | `joint: 0..11`, `angle: -180..180` | Apply mapping/direction and physical limits |
| `home` | none | Rate-limited standing pose; all joints must be enabled |
| `drive` | `direction: forward/backward/left/right` | Start/renew crawl, refresh every 150 ms |

Manual moves cancel an active gait. Configuration and physical moves use the same
mapping and limits in firmware. A rejected command does not enable output.
A drive stream expires after 400 ms even if heartbeats keep arriving.

```json
{"v":1,"id":10,"type":"servo","channel":2,"angle":105}
```

## Responses

- `config`: `{v:1,type:"config",revision:number,config:{schema:1,geometry,servos,gait}}`.
- `ack` / `error`: `{v:1,type:"ack"|"error",id,message}`. Heartbeats are not acknowledged.
- `state`: emitted at 20 Hz with `v`, `armed`, `active` (channel numbers), `angles`
  (16 rate-limited commanded angles), `targets` (16 requested/clamped angles), `mode`,
  `fault`, `hardwareReady`, `uptime`, `rssi`, `configRevision`.

The browser renders telemetry using the configuration last received from the ESP32,
not unsaved local edits. Stale/missing telemetry disables UI motion controls.
The firmware remains the authority for motion validity, calibration and limits.

## Configuration

See `shared/robot.mjs::defaults()` for the full schema and numeric limits. A config
contains four leg geometries, exactly sixteen channel records, and gait parameters.
Each channel record has `channel`, `joint` (-1 for unassigned), `enabled`, `calibrated`,
`direction` (+1/-1), `center`, `reference`, `min`, `max`, `pulseMin`, `pulseMax`, `speed`.
Physical bounds are within 0–180°; pulses within 500–2500 µs; speed is 5–180°/s.
A joint may not be assigned twice, even on a disabled channel.

JS and firmware reject non-finite values, missing arrays, invalid dimensions,
duplicate joints, invalid directions, inverted bounds/pulses and out-of-range gait
parameters. Both the app and firmware validate commands and configuration.
