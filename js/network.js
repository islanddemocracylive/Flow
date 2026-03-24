/**
 * SimNetwork – WebSocket client for real-time simulation sync.
 * Used by both the controller (sends data) and viewer (receives data).
 */

export class SimNetwork {
  constructor(role) {
    this.role = role;
    this.ws = null;
    this.connected = false;
    this.onHeatData = null;
    this.onParams = null;
    this.onReset = null;
    this.onWater = null;
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
          if (msg.type === 'water' && this.onWater) this.onWater(msg);
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

  sendHeat(float32Array) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(float32Array.buffer);
    }
  }

  sendParams(params) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'params', ...params }));
    }
  }

  sendReset() {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'reset' }));
    }
  }

  sendWater(gridX, gridY, playerPos) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'water',
        gridX, gridY,
        playerX: playerPos.x,
        playerZ: playerPos.z,
      }));
    }
  }
}
