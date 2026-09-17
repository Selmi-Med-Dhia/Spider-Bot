"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Cable,
  CircleStop,
  Power,
  RotateCcw,
  Save,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Wifi,
  WifiOff,
} from 'lucide-react';

const JOINT_META = [
  { key: 'FL_YAW', label: 'Front left · yaw', short: 'FL J1', leg: 0, part: 'yaw' },
  { key: 'FL_HIP', label: 'Front left · hip', short: 'FL J2', leg: 0, part: 'hip' },
  { key: 'FL_KNEE', label: 'Front left · knee', short: 'FL J3', leg: 0, part: 'knee' },
  { key: 'FR_YAW', label: 'Front right · yaw', short: 'FR J1', leg: 1, part: 'yaw' },
  { key: 'FR_HIP', label: 'Front right · hip', short: 'FR J2', leg: 1, part: 'hip' },
  { key: 'FR_KNEE', label: 'Front right · knee', short: 'FR J3', leg: 1, part: 'knee' },
  { key: 'RL_YAW', label: 'Rear left · yaw', short: 'RL J1', leg: 2, part: 'yaw' },
  { key: 'RL_HIP', label: 'Rear left · hip', short: 'RL J2', leg: 2, part: 'hip' },
  { key: 'RL_KNEE', label: 'Rear left · knee', short: 'RL J3', leg: 2, part: 'knee' },
  { key: 'RR_YAW', label: 'Rear right · yaw', short: 'RR J1', leg: 3, part: 'yaw' },
  { key: 'RR_HIP', label: 'Rear right · hip', short: 'RR J2', leg: 3, part: 'hip' },
  { key: 'RR_KNEE', label: 'Rear right · knee', short: 'RR J3', leg: 3, part: 'knee' },
] as const;

type JointKey = (typeof JOINT_META)[number]['key'];
type JointPart = (typeof JOINT_META)[number]['part'];
type MotionCommand = 'stop' | 'forward' | 'backward' | 'left' | 'right';
type ConnectionState = 'disconnected' | 'connecting' | 'connected';

type Geometry = {
  width: number;
  length: number;
  height: number;
  coxa: number;
  femur: number;
  tibia: number;
};

type ServoConfig = {
  channel: number;
  min: number;
  max: number;
  center: number;
  direction: 1 | -1;
};

type JointAngles = Record<JointKey, number>;
type ServoConfigs = Record<JointKey, ServoConfig>;

const INITIAL_GEOMETRY: Geometry = {
  width: 150,
  length: 190,
  height: 153,
  coxa: 45,
  femur: 85,
  tibia: 190,
};

function makeRecord<T>(factory: (key: JointKey, index: number, part: JointPart) => T): Record<JointKey, T> {
  const result = {} as Record<JointKey, T>;
  JOINT_META.forEach((meta, index) => {
    result[meta.key] = factory(meta.key, index, meta.part);
  });
  return result;
}

function makeInitialAngles(): JointAngles {
  return makeRecord((_key, _index, part) => {
    if (part === 'hip') return 25;
    if (part === 'knee') return -70;
    return 0;
  });
}

function makeInitialServoConfig(): ServoConfigs {
  return makeRecord((_key, index, part) => ({
    channel: index,
    min: 10,
    max: 170,
    center: part === 'knee' ? 135 : 90,
    direction: 1,
  }));
}

function normalizeWebSocketUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 'ws://192.168.4.1:81';
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed;
  if (trimmed.includes(':')) return 'ws://' + trimmed;
  return 'ws://' + trimmed + ':81';
}

function logicalBounds(config: ServoConfig) {
  const a = (config.min - config.center) / config.direction;
  const b = (config.max - config.center) / config.direction;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function gaitPose(command: MotionCommand, phase: number): JointAngles {
  const pose = makeInitialAngles();
  const stride = 26;
  const liftHip = 17;
  const liftKnee = 31;

  for (let leg = 0; leg < 4; leg += 1) {
    const diagonalOffset = leg === 1 || leg === 2 ? 0.5 : 0;
    const p = (phase + diagonalOffset) % 1;
    const wave = Math.sin(p * Math.PI * 2);
    const lift = Math.max(0, Math.sin(p * Math.PI * 2));
    const isLeft = leg === 0 || leg === 2;

    let strideSign = 0;
    if (command === 'forward') strideSign = 1;
    if (command === 'backward') strideSign = -1;
    if (command === 'left') strideSign = isLeft ? -1 : 1;
    if (command === 'right') strideSign = isLeft ? 1 : -1;

    const prefix = ['FL', 'FR', 'RL', 'RR'][leg];
    const yaw = (prefix + '_YAW') as JointKey;
    const hip = (prefix + '_HIP') as JointKey;
    const knee = (prefix + '_KNEE') as JointKey;
    pose[yaw] = stride * wave * strideSign;
    pose[hip] = 25 + liftHip * lift;
    pose[knee] = -70 + liftKnee * lift;
  }
  return pose;
}

function NumericField({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="numeric-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
        />
        {unit ? <small>{unit}</small> : null}
      </div>
    </label>
  );
}

type Runtime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  model: THREE.Group;
  grid: THREE.GridHelper;
};

function RobotViewport({ geometry, angles }: { geometry: Geometry; angles: JointAngles }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [rendererError, setRendererError] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setRendererError('WebGL could not start in this browser.');
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0c1116);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0c1116, 1400, 3200);
    const camera = new THREE.PerspectiveCamera(36, 1, 1, 5000);
    camera.position.set(430, 520, 760);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 80, 0);
    controls.minDistance = 250;
    controls.maxDistance = 1800;
    controls.maxPolarAngle = Math.PI * 0.49;

    scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x273039, 2.6));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(320, 680, 340);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(5000, 5000),
      new THREE.MeshStandardMaterial({ color: 0x10171d, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -5;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(2200, 44, 0x33434e, 0x1d2931);
    grid.position.y = -4;
    scene.add(grid);

    const model = new THREE.Group();
    scene.add(model);

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    runtimeRef.current = { renderer, scene, camera, controls, model, grid };

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((object: any) => {
        object.geometry?.dispose?.();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material: any) => material.dispose?.());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const model = runtime.model;

    model.traverse((object: any) => {
      object.geometry?.dispose?.();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material: any) => material.dispose?.());
      }
    });
    model.clear();

    const material = (color: number, metalness = 0.35) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.38 });

    const addBox = (
      parent: THREE.Object3D,
      width: number,
      height: number,
      depth: number,
      color: number,
      x = 0,
      y = 0,
      z = 0,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color));
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    const addJoint = (parent: THREE.Object3D, yaw = false) => {
      const joint = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 22, 20), material(0x25333c, 0.6));
      if (!yaw) joint.rotation.x = Math.PI / 2;
      joint.castShadow = true;
      parent.add(joint);

      const cap = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 24, 16), material(0xa6b7c2, 0.7));
      if (!yaw) cap.rotation.x = Math.PI / 2;
      parent.add(cap);
    };

    const addLink = (parent: THREE.Object3D, length: number, width: number, color: number) => {
      addBox(parent, length, width, width, color, length / 2, 0, 0);
      addBox(parent, length * 0.62, 2, width + 1, 0x1b262d, length / 2, width / 2 + 1, 0);
    };

    const body = new THREE.Group();
    body.position.y = geometry.height;
    model.add(body);
    addBox(body, geometry.width, 25, geometry.length, 0x354754);
    addBox(body, geometry.width + 8, 5, geometry.length + 8, 0xa8bbc6, 0, 15, 0);
    addBox(body, geometry.width * 0.62, 8, geometry.length * 0.62, 0x1c282f, 0, 22, 0);

    for (let legIndex = 0; legIndex < 4; legIndex += 1) {
      const left = legIndex === 0 || legIndex === 2;
      const front = legIndex < 2;
      const signX = left ? -1 : 1;
      const signZ = front ? 1 : -1;
      const prefix = ['FL', 'FR', 'RL', 'RR'][legIndex];
      const yawKey = (prefix + '_YAW') as JointKey;
      const hipKey = (prefix + '_HIP') as JointKey;
      const kneeKey = (prefix + '_KNEE') as JointKey;

      const base = new THREE.Group();
      base.position.set(signX * geometry.width / 2, 0, signZ * (geometry.length / 2 - 18));
      base.rotation.y = -Math.atan2(signZ * 0.8, signX) + THREE.MathUtils.degToRad(angles[yawKey]);
      body.add(base);
      addJoint(base, true);
      addLink(base, geometry.coxa, 14, 0x8298a5);

      const shoulder = new THREE.Group();
      shoulder.position.x = geometry.coxa;
      shoulder.rotation.z = THREE.MathUtils.degToRad(angles[hipKey]);
      base.add(shoulder);
      addJoint(shoulder);
      addLink(shoulder, geometry.femur, 18, 0xb6df77);

      const knee = new THREE.Group();
      knee.position.x = geometry.femur;
      knee.rotation.z = THREE.MathUtils.degToRad(angles[kneeKey]);
      shoulder.add(knee);
      addJoint(knee);
      addLink(knee, geometry.tibia, 12, 0x9fc868);

      const foot = new THREE.Mesh(new THREE.SphereGeometry(10, 14, 10), material(0x17232a, 0.1));
      foot.position.x = geometry.tibia;
      knee.add(foot);
    }
  }, [geometry, angles]);

  return (
    <div className="canvas-host" ref={hostRef}>
      {rendererError ? <div className="renderer-error">{rendererError}</div> : null}
    </div>
  );
}

export default function Home() {
  const [geometry, setGeometry] = useState<Geometry>(INITIAL_GEOMETRY);
  const [angles, setAngles] = useState<JointAngles>(makeInitialAngles);
  const [servoConfigs, setServoConfigs] = useState<ServoConfigs>(makeInitialServoConfig);
  const [selectedJoint, setSelectedJoint] = useState<JointKey>('FL_YAW');
  const [endpoint, setEndpoint] = useState('192.168.4.1:81');
  const [connection, setConnection] = useState<ConnectionState>('disconnected');
  const [connectionDetail, setConnectionDetail] = useState('ESP32 not connected');
  const [motion, setMotion] = useState<MotionCommand>('stop');
  const [gaitSpeed, setGaitSpeed] = useState(55);
  const [outputsEnabled, setOutputsEnabled] = useState(false);
  const [notice, setNotice] = useState('Connect to the ESP32, calibrate one joint at a time, then test walking.');
  const [httpsWarning, setHttpsWarning] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const selectedMeta = useMemo(
    () => JOINT_META.find((meta) => meta.key === selectedJoint) ?? JOINT_META[0],
    [selectedJoint],
  );
  const selectedConfig = servoConfigs[selectedJoint];
  const selectedBounds = logicalBounds(selectedConfig);

  useEffect(() => {
    setHttpsWarning(window.location.protocol === 'https:');
    const savedEndpoint = window.localStorage.getItem('spiderbot.endpoint');
    if (savedEndpoint) setEndpoint(savedEndpoint);

    const geometryRaw = window.localStorage.getItem('spiderbot.geometry');
    if (geometryRaw) {
      try {
        const parsed = JSON.parse(geometryRaw) as Partial<Geometry>;
        setGeometry((current) => ({ ...current, ...parsed }));
      } catch {
        // Ignore stale local configuration.
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('spiderbot.endpoint', endpoint);
  }, [endpoint]);

  useEffect(() => {
    window.localStorage.setItem('spiderbot.geometry', JSON.stringify(geometry));
  }, [geometry]);

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const applyRemoteAngles = useCallback((payload: any) => {
    if (!payload || typeof payload !== 'object') return;
    setAngles((current) => {
      const next = { ...current };
      JOINT_META.forEach((meta) => {
        const value = Number(payload[meta.key]);
        if (Number.isFinite(value)) next[meta.key] = value;
      });
      return next;
    });
  }, []);

  const applyRemoteConfig = useCallback((payload: any) => {
    if (!Array.isArray(payload)) return;
    setServoConfigs((current) => {
      const next = { ...current };
      payload.forEach((item) => {
        const meta = JOINT_META.find((entry) => entry.key === item?.joint);
        if (!meta) return;
        const direction = Number(item.direction) === -1 ? -1 : 1;
        next[meta.key] = {
          channel: Number(item.channel),
          min: Number(item.min),
          max: Number(item.max),
          center: Number(item.center),
          direction,
        };
      });
      return next;
    });
  }, []);

  const disconnect = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    setConnection('disconnected');
    setConnectionDetail('ESP32 not connected');
  }, []);

  const connect = useCallback(() => {
    disconnect();
    const url = normalizeWebSocketUrl(endpoint);
    setConnection('connecting');
    setConnectionDetail('Opening ' + url);

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      setConnection('disconnected');
      setConnectionDetail('Invalid WebSocket address');
      return;
    }

    socketRef.current = socket;
    socket.onopen = () => {
      if (socketRef.current !== socket) return;
      setConnection('connected');
      setConnectionDetail('Live link to ' + url);
      socket.send(JSON.stringify({ type: 'hello', client: 'spiderbot-studio' }));
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'snapshot') {
          applyRemoteAngles(message.angles);
          applyRemoteConfig(message.config);
          if (typeof message.outputsEnabled === 'boolean') setOutputsEnabled(message.outputsEnabled);
          if (Number.isFinite(Number(message.gaitSpeed))) setGaitSpeed(Number(message.gaitSpeed));
          setNotice('Robot configuration synchronized from ESP32.');
        } else if (message.type === 'joint_state') {
          applyRemoteAngles(message.angles);
        } else if (message.type === 'status') {
          if (typeof message.motion === 'string') setMotion(message.motion as MotionCommand);
          if (typeof message.outputsEnabled === 'boolean') setOutputsEnabled(message.outputsEnabled);
          if (message.ip) setConnectionDetail('ESP32 ' + message.ip + ' · AP ' + (message.apIp || '192.168.4.1'));
        } else if (message.type === 'error') {
          setNotice('ESP32: ' + String(message.message || 'command rejected'));
        } else if (message.type === 'ack' && message.message) {
          setNotice(String(message.message));
        }
      } catch {
        setNotice('Received an unreadable message from ESP32.');
      }
    };
    socket.onerror = () => {
      if (socketRef.current === socket) setConnectionDetail('Connection failed. Check Wi-Fi and ESP32 address.');
    };
    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
        setConnection('disconnected');
        setConnectionDetail('ESP32 disconnected');
      }
    };
  }, [applyRemoteAngles, applyRemoteConfig, disconnect, endpoint]);

  useEffect(() => disconnect, [disconnect]);

  useEffect(() => {
    if (motion === 'stop') return;
    const started = performance.now();
    let frame = 0;
    let lastUpdate = 0;

    const animate = (now: number) => {
      frame = requestAnimationFrame(animate);
      if (now - lastUpdate < 45) return;
      lastUpdate = now;
      const cycleMs = 1900 - (Math.min(100, Math.max(20, gaitSpeed)) - 20) * 15;
      const phase = ((now - started) % cycleMs) / cycleMs;
      setAngles(gaitPose(motion, phase));
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [gaitSpeed, motion]);

  const updateGeometry = (key: keyof Geometry, value: number) => {
    setGeometry((current) => ({ ...current, [key]: value }));
  };

  const changeJointAngle = (joint: JointKey, value: number) => {
    if (motion !== 'stop') {
      setMotion('stop');
      send({ type: 'motion', command: 'stop' });
    }
    const bounds = logicalBounds(servoConfigs[joint]);
    const bounded = Math.min(bounds.max, Math.max(bounds.min, value));
    setAngles((current) => ({ ...current, [joint]: bounded }));
    send({ type: 'joint', joint, angle: bounded });
  };

  const updateSelectedServoConfig = (patch: Partial<ServoConfig>) => {
    setServoConfigs((current) => ({
      ...current,
      [selectedJoint]: { ...current[selectedJoint], ...patch },
    }));
  };

  const saveSelectedServoConfig = () => {
    const config = servoConfigs[selectedJoint];
    if (
      config.channel < -1 ||
      config.channel > 15 ||
      config.min < 0 ||
      config.max > 180 ||
      config.min >= config.max ||
      config.center <= config.min ||
      config.center >= config.max
    ) {
      setNotice('Invalid servo configuration. Channel must be -1..15 and min < center < max within 0..180°.');
      return;
    }
    const ok = send({
      type: 'config_set',
      joint: selectedJoint,
      channel: config.channel,
      min: config.min,
      max: config.max,
      center: config.center,
      direction: config.direction,
    });
    setNotice(ok ? selectedMeta.label + ' mapping sent to ESP32.' : 'Saved locally. Connect the ESP32 to push this mapping.');
  };

  const syncAllServoConfig = () => {
    let sent = 0;
    JOINT_META.forEach((meta) => {
      const config = servoConfigs[meta.key];
      if (
        send({
          type: 'config_set',
          joint: meta.key,
          channel: config.channel,
          min: config.min,
          max: config.max,
          center: config.center,
          direction: config.direction,
        })
      ) {
        sent += 1;
      }
    });
    setNotice(sent ? 'Sent all 12 servo mappings to ESP32.' : 'Connect the ESP32 before pushing servo mappings.');
  };

  const setMotionCommand = (command: MotionCommand) => {
    setMotion(command);
    send({ type: 'motion', command });
    if (command === 'stop') setAngles(makeInitialAngles());
  };

  const setOutputs = (enabled: boolean) => {
    setOutputsEnabled(enabled);
    send({ type: 'outputs', enabled });
    setNotice(enabled ? 'Servo outputs enabled.' : 'Servo outputs disabled.');
  };

  const resetSimulation = () => {
    setGeometry(INITIAL_GEOMETRY);
    setAngles(makeInitialAngles());
    setMotion('stop');
    send({ type: 'motion', command: 'stop' });
  };


  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon"><Box size={22} /></div>
          <div>
            <h1>SpiderBot <span>Control Studio</span></h1>
            <p>12-DOF simulator + ESP32 hardware control</p>
          </div>
        </div>
        <div className="header-actions">
          <div className={'connection-pill ' + connection}>
            {connection === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
            {connection}
          </div>
          <button className="ghost-button" onClick={resetSimulation}><RotateCcw size={15} /> Reset view</button>
        </div>
      </header>

      <div className="workspace">
        <section className="viewport-panel">
          <RobotViewport geometry={geometry} angles={angles} />
          <div className="viewport-copy">
            <span>LIVE DIGITAL TWIN</span>
            <h2>Spider / Q4</h2>
            <p>Move a joint in the panel and the same logical angle is sent to the real robot.</p>
          </div>
          <div className="viewport-badge">
            <Activity size={14} />
            {motion === 'stop' ? 'Manual / stance' : 'Motion: ' + motion}
          </div>
          <div className="viewport-foot">
            <span>Drag to orbit · scroll to zoom · right-drag to pan</span>
            <span>Y up · angles in degrees</span>
          </div>
        </section>

        <aside className="sidebar">
          <section className="side-section">
            <div className="section-heading">
              <div><Cable size={17} /><h3>ESP32 link</h3></div>
              <span>{connection === 'connected' ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
            <label className="stack-field">
              <span>WebSocket address</span>
              <div className="inline-input">
                <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="192.168.4.1:81" />
                <button onClick={connection === 'connected' ? disconnect : connect}>
                  {connection === 'connected' ? 'Disconnect' : connection === 'connecting' ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </label>
            <p className="connection-detail">{connectionDetail}</p>
            {httpsWarning ? (
              <div className="warning">
                <ShieldAlert size={16} />
                Browser security blocks ws:// from an HTTPS page. Run this app locally over HTTP for direct ESP32 control.
              </div>
            ) : null}
          </section>

          <section className="side-section">
            <div className="section-heading">
              <div><SlidersHorizontal size={17} /><h3>Manual joint control</h3></div>
              <span>12 JOINTS</span>
            </div>
            <label className="stack-field">
              <span>Joint</span>
              <select value={selectedJoint} onChange={(event) => setSelectedJoint(event.target.value as JointKey)}>
                {JOINT_META.map((meta) => <option key={meta.key} value={meta.key}>{meta.label}</option>)}
              </select>
            </label>
            <div className="angle-readout">
              <strong>{angles[selectedJoint].toFixed(1)}°</strong>
              <span>logical angle</span>
            </div>
            <input
              className="joint-slider"
              aria-label={selectedMeta.label + ' angle'}
              type="range"
              min={Math.ceil(selectedBounds.min)}
              max={Math.floor(selectedBounds.max)}
              step="1"
              value={Math.min(selectedBounds.max, Math.max(selectedBounds.min, angles[selectedJoint]))}
              onChange={(event) => changeJointAngle(selectedJoint, Number(event.target.value))}
            />
            <div className="range-labels">
              <span>{Math.ceil(selectedBounds.min)}°</span>
              <span>{Math.floor(selectedBounds.max)}°</span>
            </div>
          </section>

          <section className="side-section">
            <div className="section-heading">
              <div><Settings2 size={17} /><h3>Servo mapping</h3></div>
              <span>PCA9685</span>
            </div>
            <p className="section-help">Assign the selected logical joint to a physical servo channel, bound its safe travel, and reverse its direction if needed.</p>
            <div className="servo-grid">
              <NumericField label="Channel" value={selectedConfig.channel} min={-1} max={15} onChange={(value) => updateSelectedServoConfig({ channel: value })} />
              <label className="numeric-field">
                <span>Direction</span>
                <div>
                  <select
                    value={selectedConfig.direction}
                    onChange={(event) => updateSelectedServoConfig({ direction: Number(event.target.value) === -1 ? -1 : 1 })}
                  >
                    <option value={1}>Normal</option>
                    <option value={-1}>Reversed</option>
                  </select>
                </div>
              </label>
              <NumericField label="Min" value={selectedConfig.min} min={0} max={180} unit="°" onChange={(value) => updateSelectedServoConfig({ min: value })} />
              <NumericField label="Center" value={selectedConfig.center} min={0} max={180} unit="°" onChange={(value) => updateSelectedServoConfig({ center: value })} />
              <NumericField label="Max" value={selectedConfig.max} min={0} max={180} unit="°" onChange={(value) => updateSelectedServoConfig({ max: value })} />
            </div>
            <div className="button-row">
              <button className="primary-button" onClick={saveSelectedServoConfig}><Save size={15} /> Save joint</button>
              <button className="secondary-button" onClick={syncAllServoConfig}>Push all 12</button>
            </div>
          </section>

          <section className="side-section">
            <div className="section-heading">
              <div><Activity size={17} /><h3>Drive robot</h3></div>
              <span>HOLD TO MOVE</span>
            </div>
            <label className="stack-field compact">
              <span>Gait speed · {gaitSpeed}%</span>
              <input
                type="range"
                min="20"
                max="100"
                value={gaitSpeed}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setGaitSpeed(value);
                  send({ type: 'gait_speed', value });
                }}
              />
            </label>
            <div className="motion-pad">
              <span />
              <button
                aria-label="Move forward"
                onPointerDown={() => setMotionCommand('forward')}
                onPointerUp={() => setMotionCommand('stop')}
                onPointerCancel={() => setMotionCommand('stop')}
                onPointerLeave={() => setMotionCommand('stop')}
              ><ArrowUp /></button>
              <span />
              <button
                aria-label="Rotate left"
                onPointerDown={() => setMotionCommand('left')}
                onPointerUp={() => setMotionCommand('stop')}
                onPointerCancel={() => setMotionCommand('stop')}
                onPointerLeave={() => setMotionCommand('stop')}
              ><ArrowLeft /></button>
              <button className="stop-button" aria-label="Stop" onClick={() => setMotionCommand('stop')}><CircleStop /></button>
              <button
                aria-label="Rotate right"
                onPointerDown={() => setMotionCommand('right')}
                onPointerUp={() => setMotionCommand('stop')}
                onPointerCancel={() => setMotionCommand('stop')}
                onPointerLeave={() => setMotionCommand('stop')}
              ><ArrowRight /></button>
              <span />
              <button
                aria-label="Move backward"
                onPointerDown={() => setMotionCommand('backward')}
                onPointerUp={() => setMotionCommand('stop')}
                onPointerCancel={() => setMotionCommand('stop')}
                onPointerLeave={() => setMotionCommand('stop')}
              ><ArrowDown /></button>
              <span />
            </div>
            <div className="button-row">
              <button className={outputsEnabled ? 'danger-button' : 'primary-button'} onClick={() => setOutputs(!outputsEnabled)}>
                <Power size={15} /> {outputsEnabled ? 'Disable servos' : 'Enable servos'}
              </button>
              <button className="secondary-button" onClick={() => { setMotionCommand('stop'); send({ type: 'stance', name: 'stand' }); }}>
                Stand
              </button>
            </div>
          </section>

          <section className="side-section">
            <div className="section-heading">
              <div><Box size={17} /><h3>Simulation geometry</h3></div>
              <span>MM</span>
            </div>
            <div className="geometry-grid">
              <NumericField label="Body width" value={geometry.width} min={80} max={260} onChange={(value) => updateGeometry('width', value)} />
              <NumericField label="Body length" value={geometry.length} min={100} max={320} onChange={(value) => updateGeometry('length', value)} />
              <NumericField label="Body height" value={geometry.height} min={60} max={300} onChange={(value) => updateGeometry('height', value)} />
              <NumericField label="Coxa" value={geometry.coxa} min={25} max={100} onChange={(value) => updateGeometry('coxa', value)} />
              <NumericField label="Femur" value={geometry.femur} min={40} max={160} onChange={(value) => updateGeometry('femur', value)} />
              <NumericField label="Tibia" value={geometry.tibia} min={70} max={320} onChange={(value) => updateGeometry('tibia', value)} />
            </div>
          </section>

          <div className="sidebar-notice">{notice}</div>
        </aside>
      </div>

      <footer className="statusbar">
        <span>SPIDERBOT / ESP32 CONTROL BRANCH</span>
        <span>Calibrate with the robot lifted before ground testing.</span>
      </footer>
    </main>
  );
}
