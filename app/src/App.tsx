import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  RotateCcw,
  Maximize,
  Settings2,
  ArrowUp,
  ArrowDown,
  RotateCcw as TurnLeft,
  RotateCw,
  Square,
  Plug,
  ShieldOff,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Viewport from "./RobotViewport";
import { useRobot } from "./useRobot";
import type { RobotConfig, ServoConfig } from "./types";
import {
  defaults,
  validateConfig,
  anglesFromServos,
  displayedGeometry,
  physicalAngle,
  servoForJoint,
  gaitPose,
  validateGait,
  JOINT_NAMES,
  clamp,
} from "../shared/robot.mjs";

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const focused = useRef(false);
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (!focused.current) setText(String(Math.round(value * 100) / 100));
  }, [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() && Number.isFinite(n)) onChange(clamp(n, min, max));
    else setText(String(value));
  };
  return (
    <div className="field">
      <div className="field-title">
        <label>{label}</label>
        <div className="number-box">
          <input
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={step}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
              commit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commit();
                e.currentTarget.blur();
              }
            }}
          />
          <span>{unit}</span>
        </div>
      </div>
      <Slider
        aria-label={label + " slider"}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        value={[clamp(value, min, max)]}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}
const legNames = ["Front left", "Front right", "Rear left", "Rear right"];
export default function App() {
  const robot = useRobot();
  const [draft, setDraft] = useState<RobotConfig>(() => {
    try {
      const c = JSON.parse(
        localStorage.getItem("spiderbot.config.v1") || "null",
      );
      return validateConfig(c).length ? defaults() : c;
    } catch {
      return defaults();
    }
  });
  const [preview, setPreview] = useState(true),
    [tab, setTab] = useState("control"),
    [channel, setChannel] = useState(0),
    [leg, setLeg] = useState(0),
    [grid, setGrid] = useState(true),
    [axes, setAxes] = useState(false),
    [view, setView] = useState("Perspective"),
    [revision, setRevision] = useState(0),
    [supported, setSupported] = useState(false);
  const [simAngles, setSimAngles] = useState<number[]>(() =>
      draft.servos.map((s) => s.center),
    ),
    [drive, setDrive] = useState("");
  const driveRef = useRef(drive);
  driveRef.current = drive;
  const lastPhysical = useRef([...simAngles]);
  const sim = useRef({
    angles: [...simAngles],
    targets: [...simAngles],
    drive: "",
    started: 0,
  });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const errors = useMemo(() => validateConfig(draft), [draft]);
  const dirty = robot.config
    ? JSON.stringify(draft) !== JSON.stringify(robot.config)
    : false;
  const currentConfig = !preview && robot.config ? robot.config : draft;
  if (robot.state) lastPhysical.current = robot.state.angles;
  const physical = preview ? simAngles : lastPhysical.current;
  const targets = preview
    ? sim.current.targets
    : robot.state?.targets || lastPhysical.current;
  const targetJoints = anglesFromServos(currentConfig, targets);
  const jointAngles = anglesFromServos(currentConfig, physical);
  const geometry = displayedGeometry(currentConfig, jointAngles);
  const selected = draft.servos[channel];
  const liveReady =
    robot.connected &&
    robot.online &&
    !!robot.config &&
    !!robot.state &&
    robot.state.hardwareReady &&
    !dirty &&
    !errors.length;
  const mayMove = preview || !!(liveReady && robot.state?.armed);
  const mayDrive = preview || !!(mayMove && robot.state?.active.length === 12);
  const configLocked = !preview && (!!robot.state?.armed || !robot.config);
  useEffect(() => {
    if (robot.config) {
      setDraft(robot.config);
      setSupported(false);
    }
  }, [robot.config]);
  useEffect(() => {
    if (!errors.length)
      localStorage.setItem("spiderbot.config.v1", JSON.stringify(draft));
  }, [draft, errors.length]);
  useEffect(() => {
    if (!preview) return;
    sim.current.angles = draft.servos.map((s) => s.center);
    sim.current.targets = [...sim.current.angles];
    sim.current.drive = "";
    setDrive("");
    setSimAngles([...sim.current.angles]);
  }, [preview, draft]);
  useEffect(() => {
    if (!preview) return;
    let last = performance.now();
    const interval = setInterval(() => {
      const now = performance.now(),
        dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const c = draftRef.current,
        p = sim.current;
      if (p.drive) {
        try {
          const elapsed = (now - p.started) / 1000,
            pose = gaitPose(c, elapsed, p.drive, Math.min(elapsed, 1));
          for (let j = 0; j < 12; j++) {
            const s = servoForJoint(c, j);
            if (s) p.targets[s.channel] = physicalAngle(s, pose[j]);
          }
        } catch (e) {
          p.drive = "";
          setDrive("");
          robot.setMessage((e as Error).message);
        }
      }
      p.angles = p.angles.map(
        (a, i) =>
          a +
          clamp(
            p.targets[i] - a,
            -c.servos[i].speed * dt,
            c.servos[i].speed * dt,
          ),
      );
      setSimAngles([...p.angles]);
    }, 50);
    return () => clearInterval(interval);
  }, [preview]);
  const stop = () => {
    sim.current.drive = "";
    sim.current.targets = [...sim.current.angles];
    setDrive("");
    if (!preview) robot.send("stop");
  };
  const disarm = () => {
    stop();
    if (!preview) robot.send("disarm");
    setSupported(false);
  };
  useEffect(() => {
    const release = () => {
      sim.current.drive = "";
      sim.current.targets = [...sim.current.angles];
      setDrive("");
      robot.send("stop");
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        release();
        robot.send("disarm");
        setSupported(false);
      }
    };
    window.addEventListener("blur", release);
    const pointerUp = () => {
      if (driveRef.current) release();
    };
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("blur", release);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("keydown", key);
    };
  }, [robot.send]);
  useEffect(() => {
    if (preview || !drive) return;
    robot.send("drive", { direction: drive });
    const interval = setInterval(
      () => robot.send("drive", { direction: drive }),
      150,
    );
    return () => clearInterval(interval);
  }, [drive, preview, robot.send]);
  useEffect(() => {
    if (!preview && !robot.state?.armed) setDrive("");
  }, [robot.state?.armed, preview]);
  const beginDrive = (direction: string) => {
    if (!mayDrive) return;
    const c = preview
      ? {
          ...draft,
          servos: draft.servos.map((s) => ({ ...s, calibrated: true })),
        }
      : draft;
    const issue = validateGait(c, direction);
    if (issue) {
      robot.setMessage(issue);
      return;
    }
    sim.current.drive = direction;
    sim.current.started = performance.now();
    setDrive(direction);
  };
  const moveServo = (angle: number) => {
    if (!mayMove) return;
    stop();
    if (preview)
      sim.current.targets[channel] = clamp(angle, selected.min, selected.max);
    else robot.send("servo", { channel, angle });
  };
  const moveJoint = (joint: number, angle: number) => {
    if (!mayMove) return;
    stop();
    if (preview) {
      const s = servoForJoint(draft, joint);
      if (s) sim.current.targets[s.channel] = physicalAngle(s, angle);
    } else robot.send("joint", { joint, angle });
  };
  const updateServo = (patch: Partial<ServoConfig>) =>
    setDraft((c) => ({
      ...c,
      servos: c.servos.map((s, i) => (i === channel ? { ...s, ...patch } : s)),
    }));
  const setGeometry = (key: string, value: number) =>
    setDraft((c) => ({ ...c, geometry: { ...c.geometry, [key]: value } }));
  const setLegValue = (key: string, value: number) =>
    setDraft((c) => ({
      ...c,
      geometry: {
        ...c.geometry,
        legs: c.geometry.legs.map((l, i) =>
          i === leg ? { ...l, [key]: value } : l,
        ),
      },
    }));
  const home = () => {
    stop();
    if (!preview) {
      robot.send("home");
      return;
    }
    try {
      const p = gaitPose(draft, 0, "forward", 0);
      for (let j = 0; j < 12; j++) {
        const s = servoForJoint(draft, j);
        if (s) sim.current.targets[s.channel] = physicalAngle(s, p[j]);
      }
    } catch (e) {
      robot.setMessage((e as Error).message);
    }
  };
  const apply = () => {
    if (errors.length) {
      robot.setMessage(errors[0]);
      return;
    }
    if (preview) {
      robot.setMessage("Preview configuration saved on this device");
      return;
    }
    robot.send("configure", { config: draft });
    robot.setMessage("Saving configuration to ESP32…");
  };
  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Box size={23} />
          </div>
          <h1>
            spiderbot<span>studio</span>
          </h1>
          <span className="version">Q4 / ESP32</span>
        </div>
        <div className="mode-tabs">
          <button
            className={preview ? "active" : ""}
            onClick={() => {
              disarm();
              robot.disconnect();
              setPreview(true);
            }}
          >
            Preview
          </button>
          <button
            className={!preview ? "active" : ""}
            onClick={() => {
              stop();
              setPreview(false);
            }}
          >
            Real robot
          </button>
        </div>
        <button className="emergency" onClick={disarm}>
          <ShieldOff size={17} /> DISABLE OUTPUTS <kbd>Esc</kbd>
        </button>
      </header>
      <div className="workspace">
        <section className="viewport" aria-label="3D robot workspace">
          <Viewport
            config={geometry}
            selected={selected.joint >= 0 ? Math.floor(selected.joint / 3) : -1}
            grid={grid}
            axes={axes}
            view={view}
            revision={revision}
          />
          <div className="viewport-title">
            <span className="eyebrow">
              {preview ? "SIMULATION" : "ROBOT COMMAND TELEMETRY"}
            </span>
            <h2>Spider / Q4</h2>
            <p>4 legs · 12 joints · PCA9685</p>
          </div>
          <div className="view-controls">
            {["Perspective", "Top", "Front", "Side"].map((v) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                onClick={() => {
                  setView(v);
                  setRevision((r) => r + 1);
                }}
              >
                {v}
              </button>
            ))}
            <button
              aria-label="Recenter view"
              onClick={() => setRevision((r) => r + 1)}
            >
              <Maximize size={16} />
            </button>
          </div>
          <div
            className={
              "connection-badge " +
              (!preview && robot.state?.armed ? "armed" : "")
            }
          >
            {preview
              ? "Preview only"
              : !robot.online
                ? "ESP32 offline"
                : !robot.state
                  ? "Telemetry stale"
                  : robot.state.armed
                    ? "Outputs enabled"
                    : "Outputs disabled"}
          </div>
          <div className="motion-dock">
            <div className="dock-label">
              {preview ? "Preview motion" : "Hold to walk"}
              <span>{drive || robot.state?.mode || "idle"}</span>
            </div>
            <div className="drive-buttons">
              {[
                { name: "left", label: "Rotate left", Icon: TurnLeft },
                { name: "forward", label: "Forward", Icon: ArrowUp },
                { name: "backward", label: "Backward", Icon: ArrowDown },
                { name: "right", label: "Rotate right", Icon: RotateCw },
              ].map(({ name, label, Icon }) => (
                <button
                  key={name}
                  aria-label={label}
                  disabled={!mayDrive || !!errors.length}
                  className={drive === name ? "held" : ""}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    beginDrive(name);
                  }}
                  onPointerUp={stop}
                  onPointerCancel={stop}
                  onLostPointerCapture={stop}
                  onKeyDown={(e) => {
                    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                      e.preventDefault();
                      beginDrive(name);
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === " " || e.key === "Enter") stop();
                  }}
                >
                  <Icon size={21} />
                  <span>{label}</span>
                </button>
              ))}
              <button onClick={stop} className="stop-button">
                <Square size={18} />
                <span>Stop</span>
              </button>
            </div>
            <p>
              {preview
                ? "Simulated gait · no hardware output"
                : "Release to stop · missing drive commands stop within 400 ms"}
            </p>
          </div>
          <div className="viewport-bottom">
            <span>Drag to orbit · Scroll to zoom · Right-drag to pan</span>
            <span>
              {preview
                ? "Virtual joint positions"
                : "Commanded angles, not encoder feedback"}
            </span>
          </div>
        </section>
        <aside className="sidebar">
          <div className="panel-heading">
            <div>
              <Settings2 size={18} />
              <h2>Robot workspace</h2>
            </div>
            <span>mm / °</span>
          </div>
          {!preview && (
            <section className="connection-panel">
              <p>
                Join Wi-Fi <strong>SpiderBot</strong> (no password), then connect.
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={robot.connected || robot.connecting}
                  onClick={robot.connect}
                >
                  <Plug size={14} />
                  {robot.connecting ? "Connecting…" : "Connect"}
                </button>
                <button
                  disabled={!robot.connected && !robot.connecting}
                  onClick={robot.disconnect}
                >
                  Disconnect
                </button>
              </div>
              <p>
                Robot: 192.168.4.1 · Stay connected if Wi-Fi says “No internet”.
              </p>
              {robot.state && (
                <small>
                  Direct Wi-Fi · Config r
                  {robot.state.configRevision}
                </small>
              )}
            </section>
          )}
          <div className="message" role="status">
            {robot.state?.fault || robot.message}
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="config-tabs">
              <TabsTrigger value="control">Control</TabsTrigger>
              <TabsTrigger value="calibration">Calibration</TabsTrigger>
              <TabsTrigger value="geometry">Geometry</TabsTrigger>
            </TabsList>
          </Tabs>
          <section className="control-section">
            <div className="section-title">
              <span>01</span>
              <h3>PCA9685 channel</h3>
              <span>{channel.toString().padStart(2, "0")}</span>
            </div>
            <div className="channel-grid">
              {draft.servos.map((s) => (
                <button
                  key={s.channel}
                  aria-label={`Channel ${s.channel}`}
                  onClick={() => setChannel(s.channel)}
                  className={channel === s.channel ? "selected" : ""}
                >
                  {s.channel}
                  <span>{s.joint < 0 ? "—" : JOINT_NAMES[s.joint]}</span>
                </button>
              ))}
            </div>
          </section>
          {tab === "control" && (
            <>
              <section className="control-section">
                <div className="section-title">
                  <span>02</span>
                  <h3>
                    {selected.joint < 0
                      ? "Unassigned servo"
                      : JOINT_NAMES[selected.joint]}
                  </h3>
                </div>
                <div className="telemetry">
                  <span>Channel {channel}</span>
                  <strong>{physical[channel]?.toFixed(1)}°</strong>
                  <span>{preview ? "preview output" : "commanded output"}</span>
                </div>
                <NumberField
                  label="Servo angle"
                  value={targets[channel] ?? 90}
                  min={selected.min}
                  max={selected.max}
                  unit="°"
                  disabled={
                    !mayMove ||
                    !selected.enabled ||
                    (!preview && !robot.state?.active.includes(channel))
                  }
                  onChange={moveServo}
                />
                {selected.joint >= 0 && (
                  <NumberField
                    label="Joint angle"
                    value={targetJoints[selected.joint]}
                    min={-180}
                    max={180}
                    unit="°"
                    disabled={
                      !mayMove ||
                      (!preview && !robot.state?.active.includes(channel))
                    }
                    onChange={(v) => moveJoint(selected.joint, v)}
                  />
                )}
                <p className="selection-note">
                  Servo limits: {selected.min}°–{selected.max}°. Joint requests
                  are clamped to these limits.
                </p>
                <button
                  className="wide-button"
                  disabled={!mayDrive}
                  onClick={home}
                >
                  Move to standing pose
                </button>
              </section>
              {!preview && (
                <section className="control-section">
                  <div className="section-title">
                    <span>03</span>
                    <h3>Output enable</h3>
                  </div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={supported}
                      onChange={(e) => setSupported(e.target.checked)}
                    />{" "}
                    Robot supported; servos clear to move
                  </label>
                  <p className="selection-note">
                    Enabling starts at the stored center angles. Calibrate one
                    channel at a time before enabling all joints.
                  </p>
                  <div className="button-stack">
                    <button
                      className="primary"
                      disabled={
                        !liveReady ||
                        !supported ||
                        !selected.enabled ||
                        robot.state?.armed
                      }
                      onClick={() => robot.send("arm", { channel })}
                    >
                      Enable channel {channel} only
                    </button>
                    <button
                      disabled={
                        !liveReady ||
                        !supported ||
                        robot.state?.armed ||
                        draft.servos.filter(
                          (s) => s.enabled && s.calibrated && s.joint >= 0,
                        ).length !== 12
                      }
                      onClick={() => robot.send("arm", { channel: -1 })}
                    >
                      Enable all 12 calibrated joints
                    </button>
                  </div>
                </section>
              )}
              <section className="control-section">
                <div className="section-title">
                  <span>04</span>
                  <h3>Walking parameters</h3>
                </div>
                {(["stride", "lift", "period", "turn"] as const).map((k, i) => (
                  <NumberField
                    key={k}
                    label={
                      [
                        "Stride",
                        "Foot lift",
                        "Cycle duration",
                        "Turn per cycle",
                      ][i]
                    }
                    value={draft.gait[k]}
                    min={[5, 5, 2, 2][i]}
                    max={[80, 50, 12, 15][i]}
                    step={k === "period" ? 0.1 : 1}
                    unit={["mm", "mm", "s", "°"][i]}
                    disabled={configLocked}
                    onChange={(v) =>
                      setDraft((c) => ({ ...c, gait: { ...c.gait, [k]: v } }))
                    }
                  />
                ))}
                <p className="selection-note">
                  Open-loop crawl. Start with short steps; traction and
                  stability need testing on your robot.
                </p>
              </section>
            </>
          )}
          {tab === "calibration" && (
            <section className="control-section">
              <div className="section-title">
                <span>02</span>
                <h3>Channel {channel} calibration</h3>
              </div>
              <fieldset disabled={configLocked}>
                <label className="text-label">
                  Assigned joint
                  <select
                    aria-label="Assigned joint"
                    value={selected.joint}
                    onChange={(e) =>
                      updateServo({ joint: +e.target.value, calibrated: false })
                    }
                  >
                    <option value={-1}>Unassigned</option>
                    {JOINT_NAMES.map((name, j) => (
                      <option key={j} value={j}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-label">
                  Direction
                  <select
                    aria-label="Direction"
                    value={selected.direction}
                    onChange={(e) =>
                      updateServo({
                        direction: +e.target.value,
                        calibrated: false,
                      })
                    }
                  >
                    <option value={1}>+1 · normal</option>
                    <option value={-1}>−1 · reversed</option>
                  </select>
                </label>
                <label className="toggle-row">
                  <span>Channel enabled</span>
                  <Switch
                    aria-label="Channel enabled"
                    checked={selected.enabled}
                    onCheckedChange={(v) => updateServo({ enabled: v })}
                  />
                </label>
                {(
                  [
                    "min",
                    "max",
                    "center",
                    "reference",
                    "pulseMin",
                    "pulseMax",
                    "speed",
                  ] as const
                ).map((k, i) => (
                  <NumberField
                    key={k}
                    label={
                      [
                        "Minimum angle",
                        "Maximum angle",
                        "Servo center",
                        "Joint angle at center",
                        "Pulse at 0°",
                        "Pulse at 180°",
                        "Maximum speed",
                      ][i]
                    }
                    value={selected[k]}
                    min={[0, 0, 0, -180, 500, 500, 5][i]}
                    max={[180, 180, 180, 180, 2500, 2500, 180][i]}
                    unit={["°", "°", "°", "°", "µs", "µs", "°/s"][i]}
                    disabled={configLocked}
                    onChange={(v) => updateServo({ [k]: v, calibrated: false })}
                  />
                ))}
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={selected.calibrated}
                    onChange={(e) =>
                      updateServo({ calibrated: e.target.checked })
                    }
                  />{" "}
                  Mapping, direction and travel tested
                </label>
              </fieldset>
              <p className="selection-note">
                Servo = center + direction × (joint − reference). Disarm before
                editing. Duplicate joint assignments are rejected.
              </p>
            </section>
          )}
          {tab === "geometry" && (
            <>
              <section className="control-section">
                <div className="section-title">
                  <span>02</span>
                  <h3>Body dimensions</h3>
                </div>
                {(["width", "length", "height", "thickness"] as const).map(
                  (k, i) => (
                    <NumberField
                      key={k}
                      label={["Width", "Length", "Body height", "Thickness"][i]}
                      value={draft.geometry[k]}
                      min={[80, 100, 60, 12][i]}
                      max={[260, 320, 300, 60][i]}
                      unit="mm"
                      disabled={configLocked}
                      onChange={(v) => setGeometry(k, v)}
                    />
                  ),
                )}
              </section>
              <section className="control-section">
                <label className="text-label">
                  Leg
                  <select
                    aria-label="Leg geometry selection"
                    value={leg}
                    onChange={(e) => setLeg(+e.target.value)}
                  >
                    {legNames.map((n, i) => (
                      <option key={n} value={i}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                {(
                  ["coxa", "femur", "tibia", "offsetX", "offsetZ"] as const
                ).map((k, i) => (
                  <NumberField
                    key={k}
                    label={
                      [
                        "Coxa",
                        "Femur",
                        "Tibia",
                        "Mount X offset",
                        "Mount Z offset",
                      ][i]
                    }
                    value={draft.geometry.legs[leg][k]}
                    min={
                      [
                        25,
                        40,
                        Math.max(
                          draft.geometry.legs[leg].coxa,
                          draft.geometry.legs[leg].femur,
                        ) + 1,
                        -60,
                        -60,
                      ][i]
                    }
                    max={[100, 160, 320, 60, 60][i]}
                    unit="mm"
                    disabled={configLocked}
                    onChange={(v) => setLegValue(k, v)}
                  />
                ))}
                <p className="selection-note">
                  Measure pivot-to-pivot lengths. Geometry is used by the ESP32
                  inverse kinematics.
                </p>
              </section>
            </>
          )}
          <section className="control-section apply-panel">
            {errors.length > 0 && (
              <p className="validation-error" role="alert">
                {errors[0]}
              </p>
            )}
            <button
              className="primary wide-button"
              disabled={configLocked || !!errors.length || (!preview && !dirty)}
              onClick={apply}
            >
              {preview ? "Save preview configuration" : "Apply & save to ESP32"}
            </button>
            {!preview && dirty && (
              <p className="selection-note">
                Unsaved edits — controls use the last ESP32 configuration.
              </p>
            )}
            <div className="button-row">
              <button
                disabled={configLocked}
                onClick={() => {
                  if (robot.config) setDraft(robot.config);
                  else setDraft(defaults());
                }}
              >
                Discard edits
              </button>
              {preview && (
                <button
                  onClick={() => {
                    stop();
                    setDraft(defaults());
                    setRevision((r) => r + 1);
                  }}
                >
                  <RotateCcw size={14} />
                  Reset preview
                </button>
              )}
            </div>
          </section>
          <section className="control-section">
            <label className="toggle-row">
              <span>Ground grid</span>
              <Switch
                aria-label="Ground grid"
                checked={grid}
                onCheckedChange={setGrid}
              />
            </label>
            <label className="toggle-row">
              <span>Coordinate axes</span>
              <Switch
                aria-label="Coordinate axes"
                checked={axes}
                onCheckedChange={setAxes}
              />
            </label>
          </section>
        </aside>
      </div>
      <footer className="statusbar">
        <span>Q4 / ROBOT CONTROL</span>
        <span>
          {preview
            ? "No hardware commands"
            : "1000 ms heartbeat timeout · output disable on connection loss"}{" "}
          · Y up
        </span>
      </footer>
    </main>
  );
}
