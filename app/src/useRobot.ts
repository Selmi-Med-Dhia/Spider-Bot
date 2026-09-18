import { useCallback, useEffect, useRef, useState } from "react";
import type { RobotConfig, RobotState } from "./types";
import { validateConfig, validState } from "../shared/robot.mjs";
export function useRobot() {
  const socket = useRef<WebSocket | null>(null),
    seq = useRef(0),
    lastState = useRef(0);
  const [connected, setConnected] = useState(false),
    [online, setOnline] = useState(false),
    [state, setState] = useState<RobotState | null>(null),
    [config, setConfig] = useState<RobotConfig | null>(null),
    [message, setMessage] = useState("Preview mode — no hardware connected");
  const send = useCallback(
    (type: string, data: Record<string, unknown> = {}) => {
      if (socket.current?.readyState !== WebSocket.OPEN) return false;
      socket.current.send(
        JSON.stringify({ v: 1, id: ++seq.current, type, ...data }),
      );
      return true;
    },
    [],
  );
  const disconnect = useCallback(() => {
    send("disarm");
    socket.current?.close();
    socket.current = null;
    setConnected(false);
    setOnline(false);
    setState(null);
    setConfig(null);
  }, [send]);
  const connect = async (token: string) => {
    disconnect();
    setMessage("Connecting to app bridge…");
    try {
      const r = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok)
        throw Error(
          r.status === 401
            ? "Incorrect pairing token"
            : "App bridge unavailable",
        );
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/control`,
      );
      socket.current = ws;
      ws.onopen = () => {
        if (socket.current !== ws) {
          ws.close();
          return;
        }
        setConnected(true);
        setMessage("Bridge connected; waiting for ESP32");
        send("heartbeat");
      };
      ws.onmessage = (e) => {
        if (socket.current !== ws) return;
        try {
          const m = JSON.parse(e.data);
          if (m.type === "bridge") {
            setOnline(!!m.robotOnline);
            if (!m.robotOnline) {
              setState(null);
              setConfig(null);
              setMessage("ESP32 offline — outputs unavailable");
            }
          } else if (m.type === "config") {
            if (m.v !== 1 || validateConfig(m.config).length)
              throw Error("Invalid configuration");
            setConfig(m.config);
            setMessage("Robot configuration loaded");
          } else if (m.type === "state") {
            if (!validState(m)) throw Error("Invalid telemetry");
            lastState.current = Date.now();
            setState(m);
            setOnline(true);
          } else if (m.type === "error")
            setMessage(m.message || "Robot rejected the command");
        } catch {
          setMessage("Invalid robot response");
        }
      };
      ws.onclose = () => {
        if (socket.current !== ws) return;
        socket.current = null;
        setConnected(false);
        setOnline(false);
        setState(null);
        setConfig(null);
        setMessage("Disconnected — reconnect and enable outputs again");
      };
      ws.onerror = () =>
        setMessage(
          "Connection failed. Check the bridge and close any other control tab.",
        );
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") send("heartbeat");
      if (lastState.current && Date.now() - lastState.current > 1500)
        setState(null);
    }, 250);
    const stop = () => {
      send("disarm");
    };
    const hidden = () => {
      if (document.visibilityState !== "visible") stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearInterval(timer);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", hidden);
      disconnect();
    };
  }, [send, disconnect]);
  return {
    connected,
    online,
    state,
    config,
    message,
    setMessage,
    connect,
    disconnect,
    send,
  };
}
