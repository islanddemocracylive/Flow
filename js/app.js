/**
 * Main app controller – orchestrates simulation, rendering, input, and networking.
 *
 * The app has two modes:
 *   1. Design mode (2D view): Admin designs room scenarios
 *   2. Play mode (3D view): Firefighter trains with water spray
 */

import { GRID_COLS, GRID_ROWS, DRAG_THRESHOLD } from './constants.js';
import { FireSimulation } from './simulation.js';
import { SimNetwork } from './network.js';
import { render2D, resizeCanvas, canvasToGrid } from './render2d.js';
import { setupInput2D } from './input2d.js';
import { setupInput3D } from './input3d.js';
import { setupAdminPanel, updateStats } from './adminPanel.js';
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
  playing: false,      // true when scenario is actively running
  showGrid: true,
  activeView: '2d',
  designMode: null,    // 'start-location' | 'ceiling-vent' | 'door' | 'obstacle' | null
  // 3D input state (set by input3d.js)
  mouse3dDown: false,
  mouseX3d: 0,
  mouseY3d: 0,
  dragDistance3d: 0,
  DRAG_THRESHOLD,
};

// ── Design click handler (2D view) ───────────────────────
function handleDesignClick(gx, gy) {
  if (gx < 0 || gx >= sim.cols || gy < 0 || gy >= sim.rows) return;

  switch (state.designMode) {
    case 'start-location':
      sim.toggleStartLocation(gx, gy);
      break;

    case 'ceiling-vent':
      sim.toggleVent(gx, gy, 'ceiling');
      break;

    case 'door': {
      // Doors can only go on wall edges
      let wall = null;
      if (gy === 0) wall = 'far';
      else if (gy === sim.rows - 1) wall = 'back';
      else if (gx === 0) wall = 'left';
      else if (gx === sim.cols - 1) wall = 'right';
      if (wall) {
        sim.toggleVent(gx, gy, 'door', wall);
      }
      break;
    }

    case 'obstacle':
      sim.addObstacleBlock(gx, gy);
      break;
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
setupInput2D(sim, state, handleDesignClick);
setupInput3D(sim, state, room3d);
setupAdminPanel(sim, state, net, {
  onPlay: () => {
    if (room3d.available) room3d.resetToStart(sim);
  },
});

// ── Main loop ─────────────────────────────────────────────
let lastTime = performance.now();
const FIXED_DT = 1 / 30;

function loop(now) {
  const elapsed = (now - lastTime) / 1000;
  lastTime = now;

  if (state.playing && !state.paused) {
    // Apply water while dragging in 3D view
    if (state.mouse3dDown && state.dragDistance3d > DRAG_THRESHOLD && state.activeView === '3d' && room3d.available) {
      const hit = room3d.raycastCeiling(state.mouseX3d, state.mouseY3d);
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
