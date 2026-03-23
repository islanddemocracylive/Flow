/**
 * Main app controller – orchestrates simulation, rendering, input, and networking.
 */

import { GRID_COLS, GRID_ROWS, DRAG_THRESHOLD } from './constants.js';
import { FireSimulation } from './simulation.js';
import { SimNetwork } from './network.js';
import { render2D, resizeCanvas, canvasToGrid } from './render2d.js';
import { setupInput2D } from './input2d.js';
import { setupInput3D } from './input3d.js';
import { setupAdminPanel, updateStats } from './adminPanel.js';
import { setupShareModal } from './shareModal.js';
import room3d from './room3d/index.js';

// ── Simulation ────────────────────────────────────────────
const sim = new FireSimulation(GRID_COLS, GRID_ROWS);

// Expose globally for room3d modules and viewer
window.fireSim = sim;

// ── Network (remote viewing) ────────────────────────────
let net = null;
let lastNetSend = 0;
try { net = new SimNetwork('controller'); } catch (e) { /* no server */ }

// ── Shared mutable state ──────────────────────────────────
const state = {
  paused: false,
  showGrid: true,
  mouseDown: false,
  mouseX: -1,
  mouseY: -1,
  mouseDownX: 0,
  mouseDownY: 0,
  dragDistance: 0,
  activeView: '2d',
  placementMode: null,
  // 3D input state (set by input3d.js)
  mouse3dDown: false,
  mouseX3d: 0,
  mouseY3d: 0,
  dragDistance3d: 0,
  // Constants exposed for render2d
  DRAG_THRESHOLD,
};

// ── Placement handler ─────────────────────────────────────
function handlePlacement(gx, gy) {
  if (gx < 0 || gx >= sim.cols || gy < 0 || gy >= sim.rows) return;

  if (state.placementMode === 'ceiling-vent') {
    sim.toggleVent(gx, gy, 'ceiling');
  } else if (state.placementMode === 'door-far') {
    if (gy === 0) sim.toggleVent(gx, 0, 'door', 'far');
  } else if (state.placementMode === 'door-left') {
    if (gx === 0) sim.toggleVent(0, gy, 'door', 'left');
  }
}

// ── View tab switching ────────────────────────────────────
const viewTabs = document.querySelectorAll('.view-tab');
const viewPanels = document.querySelectorAll('.view-panel');

viewTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const viewId = tab.dataset.view;
    state.activeView = viewId;

    viewTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    viewPanels.forEach(p => p.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');

    if (viewId === '2d') {
      resizeCanvas();
    } else if (viewId === '3d' && room3d.available) {
      room3d.onResize();
    }
  });
});

// ── Canvas sizing ─────────────────────────────────────────
window.addEventListener('resize', () => {
  if (state.activeView === '2d') {
    resizeCanvas();
  } else if (room3d.available) {
    room3d.onResize();
  }
});
resizeCanvas();

// ── Setup input + UI ──────────────────────────────────────
setupInput2D(sim, state, handlePlacement);
setupInput3D(sim, state, room3d);
setupAdminPanel(sim, state, net);
setupShareModal();

// ── Main loop ─────────────────────────────────────────────
let lastTime = performance.now();
const FIXED_DT = 1 / 30;

function loop(now) {
  const elapsed = (now - lastTime) / 1000;
  lastTime = now;

  if (!state.paused) {
    // Apply water while mouse is being dragged (2D view)
    if (state.mouseDown && state.dragDistance > DRAG_THRESHOLD && state.activeView === '2d' && !state.placementMode) {
      const grid = canvasToGrid(state.mouseX, state.mouseY, sim);
      sim.applyWater(grid.x, grid.y, FIXED_DT);
    }

    // Apply water while dragging in 3D view (water-only — no placement/ignition in 3D)
    if (state.mouse3dDown && state.dragDistance3d > DRAG_THRESHOLD && state.activeView === '3d' && room3d.available) {
      const hit = room3d.raycastCeiling(state.mouseX3d, state.mouseY3d);
      if (hit) {
        sim.applyWater(hit.gridX, hit.gridY, FIXED_DT);
        room3d.showWaterSpray(hit.gridX, hit.gridY, sim.waterRadius);
      }
    }

    sim.step(Math.min(elapsed, 0.05));
  }

  render2D(sim, state);

  // Update 3D view
  if (room3d.available) {
    room3d.updatePanels(sim);
    if (state.activeView === '3d') {
      room3d.render(sim);
    }
  }

  updateStats(sim);

  // Send heat data to remote viewers (throttled to 20fps)
  if (net && net.connected && now - lastNetSend > 50) {
    net.sendHeat(sim.heat);
    lastNetSend = now;
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Initial 3D resize
if (room3d.available) {
  setTimeout(() => room3d.onResize(), 0);
}
