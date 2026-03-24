/**
 * Main app controller – orchestrates simulation, rendering, input, and networking.
 *
 * The admin app has two views:
 *   1. 2D view: grid-based room design
 *   2. 3D view: orbit camera for visual inspection of the room design
 *
 * Fire simulation runs in whichever view is active when Play is pressed.
 * The first-person firefighter experience lives in the Simulator (viewer.html).
 */

import { GRID_COLS, GRID_ROWS, ROOM_W, ROOM_D, ROOM_H } from './constants.js';
import { FireSimulation } from './simulation.js';
import { SimNetwork } from './network.js';
import { render2D, resizeCanvas } from './render2d.js';
import { setupInput2D } from './input2d.js';
import { setupAdminPanel, updateStats } from './adminPanel.js';
import { setupShareModal } from './shareModal.js';
import room3d from './room3d/index.js';
import { camera } from './room3d/scene.js';

// ── Simulation ────────────────────────────────────────────
const sim = new FireSimulation(GRID_COLS, GRID_ROWS);

// Expose globally for room3d modules and viewer
window.fireSim = sim;

// ── Network (remote viewing) ────────────────────────────
let net = null;
let lastNetSend = 0;
// Track active remote water sprays – updated by viewer messages,
// applied each frame with the controller's own dt.
let remoteWater = null; // { gridX, gridY, playerPos, lastSeen }

try {
  net = new SimNetwork('controller');
  net.onWater = (msg) => {
    remoteWater = {
      gridX: msg.gridX,
      gridY: msg.gridY,
      playerPos: { x: msg.playerX, z: msg.playerZ },
      lastSeen: performance.now(),
    };
  };
} catch (e) { /* no server */ }

// ── Shared mutable state ──────────────────────────────────
const state = {
  paused: false,
  playing: false,      // true when scenario is actively running
  showGrid: true,
  activeView: '2d',
  designMode: null,    // 'start-location' | 'ceiling-vent' | 'door' | 'obstacle' | null
};

// ── Design click handler (shared by 2D and 3D views) ─────
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
const viewTabs = document.querySelectorAll('.view-tab[data-view]');
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
      room3d.setOrbitMode(true);
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
setupAdminPanel(sim, state, net);
setupShareModal(sim);

// ── 3D design click handling (orbit view) ─────────────────
const room3dContainer = document.getElementById('room3d-container');

if (room3dContainer && camera && typeof THREE !== 'undefined') {
  const raycaster = new THREE.Raycaster();
  const ndcMouse = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ceilingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), ROOM_H);
  const hitPoint = new THREE.Vector3();

  const wallPlanes = [
    { plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),       wall: 'far',   axis: 'x' },
    { plane: new THREE.Plane(new THREE.Vector3(0, 0, -1), ROOM_D), wall: 'back',  axis: 'x' },
    { plane: new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),       wall: 'left',  axis: 'z' },
    { plane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), ROOM_W), wall: 'right', axis: 'z' },
  ];

  let clickStartX = 0, clickStartY = 0;

  room3dContainer.addEventListener('contextmenu', e => e.preventDefault());

  room3dContainer.addEventListener('mousedown', (e) => {
    clickStartX = e.clientX;
    clickStartY = e.clientY;
  });

  // Helper: set up raycaster from client coords
  function setupRay(clientX, clientY) {
    const canvasEl = room3dContainer.querySelector('canvas');
    if (!canvasEl) return false;
    const rect = canvasEl.getBoundingClientRect();
    ndcMouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndcMouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndcMouse, camera);
    return true;
  }

  // Helper: find nearest wall hit for door mode
  function findWallHit() {
    let best = null;
    let bestDist = Infinity;
    for (const wp of wallPlanes) {
      const hp = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(wp.plane, hp);
      if (!hit) continue;
      if (hp.y < 0 || hp.y > ROOM_H) continue;
      const along = wp.axis === 'x' ? hp.x : hp.z;
      const maxAlong = wp.axis === 'x' ? ROOM_W : ROOM_D;
      if (along < 0 || along >= maxAlong) continue;
      const dist = raycaster.ray.origin.distanceTo(hp);
      if (dist < bestDist) {
        bestDist = dist;
        let gx, gy;
        if (wp.wall === 'far')   { gx = Math.floor(hp.x); gy = 0; }
        if (wp.wall === 'back')  { gx = Math.floor(hp.x); gy = GRID_ROWS - 1; }
        if (wp.wall === 'left')  { gx = 0; gy = Math.floor(hp.z); }
        if (wp.wall === 'right') { gx = GRID_COLS - 1; gy = Math.floor(hp.z); }
        best = { gridX: gx, gridY: gy, wall: wp.wall };
      }
    }
    return best;
  }

  // ── Hover highlight on mousemove ──
  room3dContainer.addEventListener('mousemove', (e) => {
    if (!room3d.isOrbitMode() || !state.designMode) {
      room3d.hideHoverCell();
      return;
    }
    if (!setupRay(e.clientX, e.clientY)) return;

    const mode = state.designMode;
    const modeColors = {
      'start-location': 0xff4422,
      'ceiling-vent': 0x44ffaa,
      'door': 0x44aaff,
      'obstacle': 0xffaa22,
    };
    const color = modeColors[mode] || 0xffffff;

    if (mode === 'obstacle') {
      const hit = raycaster.ray.intersectPlane(floorPlane, hitPoint);
      if (hit && hit.x >= 0 && hit.x < ROOM_W && hit.z >= 0 && hit.z < ROOM_D) {
        room3d.showHoverCell(Math.floor(hit.x), Math.floor(hit.z), 'floor', color);
      } else {
        room3d.hideHoverCell();
      }
    } else if (mode === 'door') {
      const best = findWallHit();
      if (best) {
        room3d.showHoverWall(best.gridX, best.gridY, best.wall, color);
      } else {
        room3d.hideHoverCell();
      }
    } else {
      // Fire starts, ceiling vents — ceiling plane
      const hit = raycaster.ray.intersectPlane(ceilingPlane, hitPoint);
      if (hit && hit.x >= 0 && hit.x < ROOM_W && hit.z >= 0 && hit.z < ROOM_D) {
        room3d.showHoverCell(Math.floor(hit.x), Math.floor(hit.z), 'ceiling', color);
      } else {
        room3d.hideHoverCell();
      }
    }
  });

  room3dContainer.addEventListener('mouseleave', () => {
    room3d.hideHoverCell();
  });

  // ── Click handling ──
  room3dContainer.addEventListener('mouseup', (e) => {
    if (!room3d.isOrbitMode() || !state.designMode) return;

    // Only count as click if mouse didn't move much (not an orbit drag)
    const dx = e.clientX - clickStartX;
    const dy = e.clientY - clickStartY;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return;

    if (!setupRay(e.clientX, e.clientY)) return;

    const mode = state.designMode;

    if (mode === 'obstacle') {
      const hit = raycaster.ray.intersectPlane(floorPlane, hitPoint);
      if (hit && hit.x >= 0 && hit.x < ROOM_W && hit.z >= 0 && hit.z < ROOM_D) {
        const gx = Math.floor(hit.x), gy = Math.floor(hit.z);
        if (e.button === 2) {
          sim.removeObstacleBlock(gx, gy);
        } else if (e.button === 0) {
          handleDesignClick(gx, gy);
        }
      }
    } else if (mode === 'door') {
      if (e.button !== 0) return;
      const best = findWallHit();
      if (best) handleDesignClick(best.gridX, best.gridY);
    } else if (e.button === 0) {
      // Fire starts and ceiling vents — ceiling plane
      const hit = raycaster.ray.intersectPlane(ceilingPlane, hitPoint);
      if (hit && hit.x >= 0 && hit.x < ROOM_W && hit.z >= 0 && hit.z < ROOM_D) {
        handleDesignClick(Math.floor(hit.x), Math.floor(hit.z));
      }
    }
  });
}

// ── Main loop ─────────────────────────────────────────────
let lastTime = performance.now();

function loop(now) {
  const elapsed = (now - lastTime) / 1000;
  lastTime = now;

  const dt = Math.min(elapsed, 0.05);

  if (state.playing && !state.paused) {
    sim.step(dt);
  }

  // Apply remote water sprays from viewer clients (server owns the sim clock)
  if (remoteWater && now - remoteWater.lastSeen < 200) {
    const rw = remoteWater;
    sim.applyWater(rw.gridX, rw.gridY, dt, rw.playerPos);
  }

  render2D(sim, state);

  // Update 3D view
  if (room3d.available) {
    room3d.updatePanels(sim);
    if (state.activeView === '3d') {
      room3d.renderOrbit();
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
