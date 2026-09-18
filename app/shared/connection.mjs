import { validateConfig, validState, validateCommand } from './robot.mjs';
export const ROBOT_URL = 'ws://192.168.4.1:81/';
const HELP = 'Join SpiderBot Wi-Fi (no password), stay connected without internet, and allow local network access if your browser asks.';

// The same transport is used by React and the socket integration tests.
export class RobotConnection {
  constructor(onChange, { WebSocketImpl = globalThis.WebSocket, url = ROBOT_URL, timeout = 6000 } = {}) {
    this.onChange = onChange;
    this.WebSocketImpl = WebSocketImpl;
    this.url = url;
    this.timeout = timeout;
    this.seq = 0;
    this.socket = null;
    this.lastState = 0;
    this.snapshot = { connected: false, connecting: false, online: false, state: null, config: null, message: 'Preview mode — no hardware connected' };
  }
  update(data) {
    Object.assign(this.snapshot, data);
    this.onChange({ ...this.snapshot });
  }
  send(type, data = {}) {
    const command = { v: 1, id: ++this.seq, type, ...data };
    if (validateCommand(command) || this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify(command));
    return true;
  }
  disconnect(message = 'Disconnected') {
    clearTimeout(this.timer);
    this.send('stop');
    const ws = this.socket;
    this.socket = null;
    ws?.close();
    this.lastState = 0;
    this.update({ connected: false, connecting: false, online: false, state: null, config: null, message });
  }
  connect() {
    this.disconnect();
    this.update({ connecting: true, message: 'Connecting directly to SpiderBot…' });
    try {
      const ws = new this.WebSocketImpl(this.url);
      this.socket = ws;
      this.timer = setTimeout(() => {
        if (this.socket === ws) this.disconnect(`No response from the robot. ${HELP}`);
      }, this.timeout);
      ws.onopen = () => {
        if (this.socket !== ws) return;
        this.update({ connected: true, message: 'Connected; loading robot settings…' });
        this.lastState = Date.now();
        this.send('heartbeat');
        this.send('getConfig');
      };
      ws.onmessage = (event) => {
        if (this.socket !== ws) return;
        try {
          const m = JSON.parse(event.data);
          if (m.type === 'error') {
            this.update({ message: m.message || 'Robot rejected the command' });
            if (this.snapshot.connecting) this.lastError = m.message;
          } else if (m.type === 'config') {
            if (m.v !== 1 || validateConfig(m.config).length) throw Error('Invalid configuration');
            this.update({ config: m.config });
          } else if (m.type === 'state') {
            if (!validState(m)) throw Error('Invalid telemetry');
            this.lastState = Date.now();
            this.update({ state: m, online: true });
          }
          if (this.snapshot.connecting && this.snapshot.config && this.snapshot.state) {
            clearTimeout(this.timer);
            this.update({ connecting: false, message: 'SpiderBot connected — all servo outputs are live' });
          }
        } catch {
          this.disconnect('Invalid robot response. Flash the firmware from this branch and reconnect.');
        }
      };
      ws.onerror = () => {
        if (this.socket === ws) this.disconnect(`Cannot reach SpiderBot. ${HELP}`);
      };
      ws.onclose = () => {
        if (this.socket === ws) this.disconnect(this.lastError || `Robot disconnected. ${HELP}`);
      };
      this.lastError = null;
    } catch {
      this.disconnect(`Connection blocked. Open the app at http://localhost:8787. ${HELP}`);
    }
  }
  tick(visible = true) {
    if (visible) this.send('heartbeat');
    if (!this.snapshot.connecting && this.lastState && Date.now() - this.lastState > 1500)
      this.disconnect('Robot stopped responding. Rejoin SpiderBot Wi-Fi and reconnect.');
  }
}
