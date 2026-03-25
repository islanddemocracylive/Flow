/**
 * Simulator application – fullscreen 3D firefighter experience.
 * Receives fire state over WebSocket from the controller and
 * sends water spray data back to affect the simulation.
 */

import { GRID_COLS, GRID_ROWS, DRAG_THRESHOLD } from './constants.js';
import { FireSimulation } from './simulation.js';
import { SimNetwork } from './network.js';
import room3d from './room3d/index.js';
import { enableFPCamera, setSprayScreenPosition, clearSprayScreenPosition } from './room3d/fpCamera.js';

// Create simulation as a data container (no stepping)
const sim = new FireSimulation(GRID_COLS, GRID_ROWS);
window.fireSim = sim;

// Load scenario from localStorage (saved by admin when "Open Simulator" is clicked)
try {
  const saved = localStorage.getItem('flow_viewer_scenario');
  if (saved) {
    sim.loadScenarioData(JSON.parse(saved));
  }
} catch (e) { /* ignore parse errors */ }

const statusEl = document.getElementById('status');

// Connect to server as viewer
const net = new SimNetwork('viewer');

net.onHeatData = (heatArray) => {
  // Layout: [heat × n] [metadata × 4] [cellState × n] [heatExposure × n]
  const n = sim.cols * sim.rows;
  for (let i = 0; i < n; i++) {
    const v = heatArray[i];
    sim.heat[i] = v > 0 ? (v < 1 ? v : 1) : 0;
  }
  // Metadata
  const meta = n;
  if (heatArray.length > meta) sim.gasLayerTemp = heatArray[meta];
  if (heatArray.length > meta + 1) sim.oxygenLevel = heatArray[meta + 1];
  if (heatArray.length > meta + 2) {
    const gsCode = heatArray[meta + 2];
    const gsNames = ['running', 'win', 'lose_flashover', 'lose_oxygen'];
    sim.gameState = gsNames[gsCode] || 'running';
  }
  if (heatArray.length > meta + 3) sim.totalHRR = heatArray[meta + 3];
  // Cell state + heat exposure
  const csBase = meta + 4;
  const exBase = csBase + n;
  if (heatArray.length >= exBase + n) {
    for (let i = 0; i < n; i++) {
      sim.cellState[i] = heatArray[csBase + i];
      sim.heatExposure[i] = heatArray[exBase + i];
    }
  }
};

net.onParams = (params) => {
  if (params.waterRadius !== undefined) sim.waterRadius = params.waterRadius;
  if (params.sprayPSI !== undefined) sim.sprayPSI = params.sprayPSI;
  if (params.growthAlpha !== undefined) sim.growthAlpha = params.growthAlpha;
};

net.onReset = () => {
  sim.reset();
};

net.onScenario = (data) => {
  sim.loadScenarioData(data);
};

// Enable first-person camera for the viewer
enableFPCamera();

// Water spray state
const sprayState = {
  mouse3dDown: false,
  mouseX3d: 0,
  mouseY3d: 0,
  dragDistance3d: 0,
};

// Setup water spray input (left-click + drag on desktop, 1-finger on mobile)
const room3dContainer = document.getElementById('room3d-container');
if (room3dContainer) {
  room3dContainer.addEventListener('contextmenu', e => e.preventDefault());

  let mouseDownX = 0, mouseDownY = 0;
  room3dContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    sprayState.mouse3dDown = true;
    sprayState.mouseX3d = e.clientX;
    sprayState.mouseY3d = e.clientY;
    sprayState.dragDistance3d = 0;
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
  });

  room3dContainer.addEventListener('mousemove', (e) => {
    if (!sprayState.mouse3dDown) return;
    sprayState.mouseX3d = e.clientX;
    sprayState.mouseY3d = e.clientY;
    const dx = e.clientX - mouseDownX;
    const dy = e.clientY - mouseDownY;
    sprayState.dragDistance3d = Math.sqrt(dx * dx + dy * dy);
  });

  room3dContainer.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    sprayState.mouse3dDown = false;
    sprayState.dragDistance3d = 0;
    room3d.hideWaterSpray();
    clearSprayScreenPosition();
  });

  room3dContainer.addEventListener('mouseleave', () => {
    sprayState.mouse3dDown = false;
    sprayState.dragDistance3d = 0;
    room3d.hideWaterSpray();
    clearSprayScreenPosition();
  });

  // 1-finger water spray (touch) — 2nd finger cancels spray (used for look)
  room3dContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      sprayState.mouse3dDown = true;
      sprayState.mouseX3d = e.touches[0].clientX;
      sprayState.mouseY3d = e.touches[0].clientY;
      sprayState.dragDistance3d = DRAG_THRESHOLD + 1;
    }
    if (e.touches.length >= 2) {
      // Second finger added — stop spraying, let look-around take over
      sprayState.mouse3dDown = false;
      sprayState.dragDistance3d = 0;
      room3d.hideWaterSpray();
      clearSprayScreenPosition();
    }
  }, { passive: true });

  room3dContainer.addEventListener('touchmove', (e) => {
    if (sprayState.mouse3dDown && e.touches.length === 1) {
      sprayState.mouseX3d = e.touches[0].clientX;
      sprayState.mouseY3d = e.touches[0].clientY;
      sprayState.dragDistance3d = DRAG_THRESHOLD + 1;
    }
    if (sprayState.mouse3dDown && e.touches.length >= 2) {
      sprayState.mouse3dDown = false;
      sprayState.dragDistance3d = 0;
      room3d.hideWaterSpray();
      clearSprayScreenPosition();
    }
  }, { passive: true });

  room3dContainer.addEventListener('touchend', (e) => {
    if (sprayState.mouse3dDown && e.touches.length === 0) {
      sprayState.mouse3dDown = false;
      sprayState.dragDistance3d = 0;
      room3d.hideWaterSpray();
      clearSprayScreenPosition();
    }
  }, { passive: true });
}

// Render loop
function loop() {
  if (room3d.available) {
    // Send water spray to controller (server is the single source of truth
    // for heat — we only send input, never manipulate heat locally)
    if (sprayState.mouse3dDown && sprayState.dragDistance3d > DRAG_THRESHOLD) {
      const hit = room3d.raycastCeiling(sprayState.mouseX3d, sprayState.mouseY3d);
      if (hit) {
        const playerPos = room3d.getPlayerPosition();
        const sprayParams = sim.getSprayParams(hit.worldX, hit.worldZ, playerPos);
        if (sprayParams) {
          net.sendWater(hit.worldX, hit.worldZ, playerPos);
          room3d.showWaterSpray(hit.worldX, hit.worldZ, sprayParams);
          // Feed mouse NDC to camera for edge-scroll
          const rect = room3dContainer.getBoundingClientRect();
          const ndcX = ((sprayState.mouseX3d - rect.left) / rect.width) * 2 - 1;
          const ndcY = -((sprayState.mouseY3d - rect.top) / rect.height) * 2 + 1;
          setSprayScreenPosition(ndcX, ndcY);
        } else {
          room3d.hideWaterSpray();
          clearSprayScreenPosition();
        }
      }
    } else {
      clearSprayScreenPosition();
    }

    room3d.updatePanels(sim);
    room3d.render(sim);
  }

  // Update HUD
  _updateViewerHUD(sim);

  if (statusEl) {
    if (net.connected) {
      statusEl.textContent = 'Connected';
      statusEl.className = 'connected';
    } else {
      statusEl.textContent = 'Reconnecting...';
      statusEl.className = '';
    }
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// ── Viewer HUD ──────────────────────────────────────────
const hudGas = document.getElementById('hud-gas');
const hudHRR = document.getElementById('hud-hrr');
const hudO2 = document.getElementById('hud-o2');
const hudVent = document.getElementById('hud-vent');
const endstateEl = document.getElementById('viewer-endstate');
let lastGameState = 'idle';

function _updateViewerHUD(sim) {
  if (hudGas) {
    const temp = Math.round(sim.gasLayerTemp || 20);
    hudGas.textContent = `Gas: ${temp}°C`;
    hudGas.style.color = temp > 500 ? '#e85020' : temp > 300 ? '#ffcc66' : '#aaa';
  }
  if (hudHRR) {
    hudHRR.textContent = `HRR: ${((sim.totalHRR || 0) / 1000).toFixed(1)} MW`;
  }
  if (hudO2) {
    const o2 = sim.oxygenLevel || 20.9;
    hudO2.textContent = `O\u2082: ${o2.toFixed(1)}%`;
    hudO2.style.color = o2 > 18 ? 'rgba(100,200,100,0.8)' : o2 > 15 ? 'rgba(255,200,80,0.9)' : 'rgba(255,80,60,0.9)';
  }
  if (hudVent) {
    hudVent.style.display = sim.ventLimited ? 'block' : 'none';
  }
  // Win/lose overlay
  if (endstateEl && sim.gameState !== lastGameState) {
    lastGameState = sim.gameState;
    if (sim.gameState === 'win') {
      endstateEl.style.display = 'flex';
      endstateEl.style.background = 'rgba(0,40,0,0.5)';
      endstateEl.style.color = 'rgba(40,180,60,0.9)';
      endstateEl.textContent = 'FIRE SUPPRESSED';
    } else if (sim.gameState === 'lose_flashover') {
      endstateEl.style.display = 'flex';
      endstateEl.style.background = 'rgba(60,10,0,0.6)';
      endstateEl.style.color = 'rgba(255,80,20,0.95)';
      endstateEl.textContent = 'FLASHOVER';
    } else if (sim.gameState === 'lose_oxygen') {
      endstateEl.style.display = 'flex';
      endstateEl.style.background = 'rgba(0,10,40,0.6)';
      endstateEl.style.color = 'rgba(100,160,255,0.95)';
      endstateEl.textContent = 'OXYGEN DEPLETED';
    } else {
      endstateEl.style.display = 'none';
    }
  }
}

// Initial + dynamic resize
if (room3d.available) {
  setTimeout(() => room3d.onResize(), 0);
}
window.addEventListener('resize', () => {
  if (room3d.available) room3d.onResize();
});
