import { useCallback, useEffect, useRef, useState } from "react";
import type { RobotConfig, RobotState } from "./types";
import { RobotConnection } from "../shared/connection.mjs";

type ConnectionState = {
  connected: boolean;
  connecting: boolean;
  online: boolean;
  state: RobotState | null;
  config: RobotConfig | null;
  message: string;
};
export function useRobot() {
  const [status, setStatus] = useState<ConnectionState>({
    connected: false, connecting: false, online: false,
    state: null, config: null, message: "Preview mode — no hardware connected",
  });
  const connection = useRef<RobotConnection | null>(null);
  if (!connection.current) connection.current = new RobotConnection(setStatus);
  const send = useCallback((type: string, data: Record<string, unknown> = {}) =>
    connection.current!.send(type, data), []);
  const connect = useCallback(() => connection.current!.connect(), []);
  const disconnect = useCallback(() => connection.current!.disconnect(), []);
  const setMessage = useCallback((message: string) => connection.current!.update({ message }), []);
  useEffect(() => {
    const timer = setInterval(() => connection.current!.tick(document.visibilityState === "visible"), 250);
    const stop = () => { send("stop"); };
    const hidden = () => { if (document.visibilityState !== "visible") stop(); };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(timer);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", hidden);
      disconnect();
    };
  }, [send, disconnect]);
  return { ...status, send, connect, disconnect, setMessage };
}
