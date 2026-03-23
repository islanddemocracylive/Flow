/**
 * Viewer application – receives simulation state over WebSocket
 * and renders the fullscreen 3D room view.
 */

import { GRID_COLS, GRID_ROWS, DRAG_THRESHOLD } from './constants.js';
import { FireSimulation } from './simulation.js';
import { SimNetwork } from './network.js';
import room3d from './room3d/index.js';
import { enableFPCamera } from './room3d/fpCamera.js';

// Create simulation as a data container (no stepping)
const sim = new FireSimulation(GRID_COLS, GRID_ROWS);
window.fireSim = sim;

const statusEl = document.getElementById('status');

// Connect to server as viewer
const net = new SimNetwork('viewer');

net.onHeatData = (heatArray) => {
  sim.heat.set(heatArray);
};

net.onParams = (params) => {
  if (params.spreadSpeed !== undefined) sim.spreadSpeed = params.spreadSpeed;
  if (params.ignitionThreshold !== undefined) sim.ignitionThreshold = params.ignitionThreshold;
  if (params.maxIntensity !== undefined) sim.maxIntensity = params.maxIntensity;
  if (params.waterStrength !== undefined) sim.waterStrength = params.waterStrength;
  if (params.waterRadius !== undefined) sim.waterRadius = params.waterRadius;
  if (params.sprayPSI !== undefined) sim.sprayPSI = params.sprayPSI;
};

net.onReset = () => {
  sim.reset();
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

// Setup water spray input (right-click + drag)
const room3dContainer = document.getElementById('room3d-container');
if (room3dContainer) {
  room3dContainer.addEventListener('contextmenu', e => e.preventDefault());

  let mouseDownX = 0, mouseDownY = 0;
  room3dContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
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
    if (e.button !== 2) return;
    sprayState.mouse3dDown = false;
    sprayState.dragDistance3d = 0;
    room3d.hideWaterSpray();
  });

  room3dContainer.addEventListener('mouseleave', () => {
    sprayState.mouse3dDown = false;
    sprayState.dragDistance3d = 0;
    room3d.hideWaterSpray();
  });

  // 2-finger water spray (touch)
  room3dContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      sprayState.mouse3dDown = true;
      sprayState.mouseX3d = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      sprayState.mouseY3d = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      sprayState.dragDistance3d = DRAG_THRESHOLD + 1;
    }
  }, { passive: false });

  room3dContainer.addEventListener('touchmove', (e) => {
    if (sprayState.mouse3dDown && e.touches.length >= 2) {
      e.preventDefault();
      sprayState.mouseX3d = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      sprayState.mouseY3d = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      sprayState.dragDistance3d = DRAG_THRESHOLD + 1;
    }
  }, { passive: false });

  room3dContainer.addEventListener('touchend', (e) => {
    if (sprayState.mouse3dDown && e.touches.length < 2) {
      sprayState.mouse3dDown = false;
      sprayState.dragDistance3d = 0;
      room3d.hideWaterSpray();
    }
  }, { passive: true });
}

const FIXED_DT = 1 / 30;

// Render loop
function loop() {
  if (room3d.available) {
    // Apply water spray
    if (sprayState.mouse3dDown && sprayState.dragDistance3d > DRAG_THRESHOLD) {
      const hit = room3d.raycastCeiling(sprayState.mouseX3d, sprayState.mouseY3d);
      if (hit) {
        const playerPos = room3d.getPlayerPosition();
        const sprayParams = sim.getSprayParams(hit.gridX, hit.gridY, playerPos);
        if (sprayParams) {
          sim.applyWater(hit.gridX, hit.gridY, FIXED_DT, playerPos);
          room3d.showWaterSpray(hit.gridX, hit.gridY, sprayParams);
        } else {
          room3d.hideWaterSpray();
        }
      }
    }

    room3d.updatePanels(sim);
    room3d.render(sim);
  }

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

window.addEventListener('resize', () => {
  if (room3d.available) room3d.onResize();
});
