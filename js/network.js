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
      if (!simState) { this.ws.send(float32Array.buffer); return; }
      const n = float32Array.length; // number of cells (heat values)
      // Layout: [heat × n] [metadata × 5] [cellState × n] [heatExposure × n] [moisture × n]
      const meta = 5;
      const combined = new Float32Array(n + meta + n + n + n);
      combined.set(float32Array);
      const base = n;
      combined[base] = simState.gasLayerTemp || 0;
      combined[base + 1] = simState.oxygenLevel || 20.9;
      const gsMap = { idle: 0, running: 0, win: 1, lose_flashover: 2, lose_oxygen: 3 };
      combined[base + 2] = gsMap[simState.gameState] || 0;
      combined[base + 3] = simState.totalHRR || 0;
      combined[base + 4] = simState.ventLimited ? 1 : 0;
      // Append cellState, heatExposure, and moisture as floats
      const csBase = base + meta;
      const exBase = csBase + n;
      const moBase = exBase + n;
      for (let i = 0; i < n; i++) {
        combined[csBase + i] = simState.cellState ? simState.cellState[i] : 0;
        combined[exBase + i] = simState.heatExposure ? simState.heatExposure[i] : 0;
        combined[moBase + i] = simState.moisture ? simState.moisture[i] : 0;
      }
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

  sendWater(worldX, worldZ, playerPos, sprayParams) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'water',
        worldX, worldZ,
        playerX: playerPos.x,
        playerY: playerPos.y,
        playerZ: playerPos.z,
        // Send pre-computed spray params so controller doesn't recalculate
        // with wrong surface/nozzleY assumptions
        majorR: sprayParams.majorR,
        minorR: sprayParams.minorR,
        sprayAngle: sprayParams.sprayAngle,
        strengthFactor: sprayParams.strengthFactor,
        centerOffset: sprayParams.centerOffset,
        mode: sprayParams.mode || 'direct',
      }));
    }
  }

  sendScenario(scenarioData) {
    if (this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'scenario', data: scenarioData }));
    }
  }
}
