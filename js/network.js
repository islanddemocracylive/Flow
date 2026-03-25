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
          if (msg.type === 'scenario' && this.onScenario) this.onScenario(msg.data);
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

  sendHeat(float32Array, simState) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      // Append metadata floats after the heat array:
      // [gasLayerTemp, oxygenLevel, gameStateCode, totalHRR]
      const extra = 4;
      const combined = new Float32Array(float32Array.length + extra);
      combined.set(float32Array);
      const base = float32Array.length;
      combined[base] = (simState && simState.gasLayerTemp) || 0;
      combined[base + 1] = (simState && simState.oxygenLevel) || 20.9;
      const gsMap = { idle: 0, running: 0, win: 1, lose_flashover: 2, lose_oxygen: 3 };
      combined[base + 2] = (simState && gsMap[simState.gameState]) || 0;
      combined[base + 3] = (simState && simState.totalHRR) || 0;
      this.ws.send(combined.buffer);
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

  sendWater(worldX, worldZ, playerPos) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'water',
        worldX, worldZ,
        playerX: playerPos.x,
        playerZ: playerPos.z,
      }));
    }
  }

  sendScenario(scenarioData) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'scenario', data: scenarioData }));
    }
  }
}
