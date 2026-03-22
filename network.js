/**
 * SimNetwork – WebSocket client for real-time simulation sync.
 * Used by both the controller (sends data) and viewer (receives data).
 */
class SimNetwork {
  constructor(role) {
    this.role = role;          // 'controller' | 'viewer'
    this.ws = null;
    this.connected = false;
    this.onHeatData = null;    // viewer callback: (Float32Array) => void
    this.onParams = null;      // viewer callback: (object) => void
    this.onReset = null;       // viewer callback: () => void
    this._connect();
  }

  _connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}`);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.connected = true;
      this.ws.send(JSON.stringify({ type: 'register', role: this.role }));
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        if (this.onHeatData) this.onHeatData(new Float32Array(event.data));
      } else {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'params' && this.onParams) this.onParams(msg);
          if (msg.type === 'reset' && this.onReset) this.onReset();
        } catch (e) { /* ignore bad JSON */ }
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      setTimeout(() => this._connect(), 1000);
    };

    this.ws.onerror = () => {
      this.ws.close();
    };
  }

  /** Send heat array (controller only, binary) */
  sendHeat(float32Array) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(float32Array.buffer);
    }
  }

  /** Send parameter change (controller only, JSON) */
  sendParams(params) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'params', ...params }));
    }
  }

  /** Send reset signal (controller only, JSON) */
  sendReset() {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'reset' }));
    }
  }
}
