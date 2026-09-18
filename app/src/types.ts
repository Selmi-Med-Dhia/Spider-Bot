export type Leg = {
  coxa: number;
  femur: number;
  tibia: number;
  yaw: number;
  hip: number;
  knee: number;
  offsetX: number;
  offsetZ: number;
};
export type Config = {
  width: number;
  length: number;
  height: number;
  thickness: number;
  legs: Leg[];
};
export type ServoConfig = {
  channel: number;
  joint: number;
  enabled: boolean;
  calibrated: boolean;
  direction: number;
  center: number;
  reference: number;
  min: number;
  max: number;
  pulseMin: number;
  pulseMax: number;
  speed: number;
};
export type RobotConfig = {
  schema: number;
  geometry: Omit<Config, "legs"> & {
    legs: Omit<Leg, "yaw" | "hip" | "knee">[];
  };
  servos: ServoConfig[];
  gait: { stride: number; lift: number; period: number; turn: number };
};
export type RobotState = {
  type: "state";
  v: number;
  armed: boolean;
  active: number[];
  angles: number[];
  targets: number[];
  mode: string;
  fault: string;
  hardwareReady: boolean;
  uptime: number;
  rssi: number;
  configRevision: number;
};
