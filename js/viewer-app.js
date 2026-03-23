/**
 * Viewer application – receives simulation state over WebSocket
 * and renders the fullscreen 3D room view.
 */

import { GRID_COLS, GRID_ROWS } from './constants.js';
import { FireSimulation } from './simulation.js';
import { SimNetwork } from './network.js';
import room3d from './room3d/index.js';

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

// Render loop
function loop() {
  if (room3d.available) {
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
