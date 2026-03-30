/**
 * Simulator application – fullscreen 3D firefighter experience.
 * Receives fire state over WebSocket from the controller and
 * sends water spray data back to affect the simulation.
 */

import { GRID_COLS, GRID_ROWS, ROOM_H } from './constants.js';
import { FireSimulation } from './simulation.js';
import { SimNetwork } from './network.js';
import room3d from './room3d/index.js';
import { enableFPCamera, setSprayScreenPosition, clearSprayScreenPosition } from './room3d/fpCamera.js';
import { updateArcDebug, toggleArcDebug, updateCellDebug, isArcDebugEnabled } from './room3d/arcDebug.js';

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
  // Layout: [heat × n] [metadata × 5] [cellState × n] [heatExposure × n] [moisture × n]
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
  if (heatArray.length > meta + 4) sim.ventLimited = heatArray[meta + 4] > 0;
  // Cell state + heat exposure + moisture
  const csBase = meta + 5;
  const exBase = csBase + n;
  const moBase = exBase + n;
  if (heatArray.length >= exBase + n) {
    for (let i = 0; i < n; i++) {
      sim.cellState[i] = heatArray[csBase + i];
      sim.heatExposure[i] = heatArray[exBase + i];
    }
  }
  if (heatArray.length >= moBase + n) {
    for (let i = 0; i < n; i++) {
      sim.moisture[i] = heatArray[moBase + i];
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

// ── Cursor tracking (for debug cell info) ───────────────
let cursorX = 0;
let cursorY = 0;

// ── Water spray input ────────────────────────────────────
// Desktop: left-click = spray at cursor position
// Mobile: spray button = spray at screen center (crosshair)
let spraying = false;
let fogMode = false;  // true = fog pattern (gas layer cooling), false = direct attack
let sprayX = 0;  // screen coords for spray target
let sprayY = 0;

const room3dContainer = document.getElementById('room3d-container');
const sprayBtnLeft = document.getElementById('spray-btn-left');
const sprayBtnRight = document.getElementById('spray-btn-right');

if (room3dContainer) {
  room3dContainer.addEventListener('contextmenu', e => e.preventDefault());

  // Desktop: Shift key toggles fog mode (hold Shift + click = fog)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') fogMode = true;
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') fogMode = false;
  });

  // Desktop: left-click to spray at cursor position
  room3dContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    spraying = true;
    sprayX = e.clientX;
    sprayY = e.clientY;
  });
  room3dContainer.addEventListener('mousemove', (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
    if (!spraying) return;
    sprayX = e.clientX;
    sprayY = e.clientY;
  });
  room3dContainer.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    spraying = false;
    room3d.hideWaterSpray();
    clearSprayScreenPosition();
  });
  room3dContainer.addEventListener('mouseleave', () => {
    spraying = false;
    room3d.hideWaterSpray();
    clearSprayScreenPosition();
  });

  // Mobile: single-finger press+drag to spray at touch position
  let sprayTouchId = -1;
  room3dContainer.addEventListener('touchstart', (e) => {
    if (sprayTouchId !== -1) return;           // already tracking a spray touch
    const t = e.changedTouches[0];
    sprayTouchId = t.identifier;
    spraying = true;
    sprayX = t.clientX;
    sprayY = t.clientY;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (sprayTouchId === -1) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== sprayTouchId) continue;
      sprayX = t.clientX;
      sprayY = t.clientY;
    }
  }, { passive: true });
  function endSprayTouch(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier !== sprayTouchId) continue;
      sprayTouchId = -1;
      spraying = false;
      room3d.hideWaterSpray();
      clearSprayScreenPosition();
    }
  }
  document.addEventListener('touchend', endSprayTouch, { passive: true });
  document.addEventListener('touchcancel', endSprayTouch, { passive: true });
}

// Mobile: spray buttons target screen center (crosshair)
function setupSprayButton(btn) {
  if (!btn) return;
  function startSpray(e) {
    e.preventDefault();
    e.stopPropagation();
    spraying = true;
    btn.classList.add('active');
    const rect = room3dContainer.getBoundingClientRect();
    sprayX = rect.left + rect.width / 2;
    sprayY = rect.top + rect.height / 2;
  }
  function stopSpray(e) {
    e.preventDefault();
    e.stopPropagation();
    spraying = false;
    btn.classList.remove('active');
    sprayBtnLeft?.classList.remove('active');
    sprayBtnRight?.classList.remove('active');
    room3d.hideWaterSpray();
    clearSprayScreenPosition();
  }
  btn.addEventListener('mousedown', startSpray);
  btn.addEventListener('mouseup', stopSpray);
  btn.addEventListener('mouseleave', stopSpray);
  btn.addEventListener('touchstart', startSpray, { passive: false });
  btn.addEventListener('touchend', stopSpray, { passive: false });
  btn.addEventListener('touchcancel', stopSpray, { passive: false });
}
setupSprayButton(sprayBtnLeft);
setupSprayButton(sprayBtnRight);

// Mobile: fog buttons — same as spray but sets fogMode
const fogBtnLeft = document.getElementById('fog-btn-left');
const fogBtnRight = document.getElementById('fog-btn-right');
function setupFogButton(btn) {
  if (!btn) return;
  function startFog(e) {
    e.preventDefault();
    e.stopPropagation();
    spraying = true;
    fogMode = true;
    btn.classList.add('active');
    const rect = room3dContainer.getBoundingClientRect();
    sprayX = rect.left + rect.width / 2;
    sprayY = rect.top + rect.height / 2;
  }
  function stopFog(e) {
    e.preventDefault();
    e.stopPropagation();
    spraying = false;
    fogMode = false;
    btn.classList.remove('active');
    fogBtnLeft?.classList.remove('active');
    fogBtnRight?.classList.remove('active');
    room3d.hideWaterSpray();
    clearSprayScreenPosition();
  }
  btn.addEventListener('mousedown', startFog);
  btn.addEventListener('mouseup', stopFog);
  btn.addEventListener('mouseleave', stopFog);
  btn.addEventListener('touchstart', startFog, { passive: false });
  btn.addEventListener('touchend', stopFog, { passive: false });
  btn.addEventListener('touchcancel', stopFog, { passive: false });
}
setupFogButton(fogBtnLeft);
setupFogButton(fogBtnRight);

// Render loop
function loop() {
  if (room3d.available) {
    // When spray/fog button is held on mobile, keep targeting screen center
    if (spraying && (
      (sprayBtnLeft && sprayBtnLeft.classList.contains('active')) ||
      (sprayBtnRight && sprayBtnRight.classList.contains('active')) ||
      (fogBtnLeft && fogBtnLeft.classList.contains('active')) ||
      (fogBtnRight && fogBtnRight.classList.contains('active'))
    )) {
      const rect = room3dContainer.getBoundingClientRect();
      sprayX = rect.left + rect.width / 2;
      sprayY = rect.top + rect.height / 2;
    }

    // Send water spray to controller
    if (spraying) {
      const hit = room3d.raycastCeiling(sprayX, sprayY);
      if (hit) {
        // Resolve hit to 3D target so nozzle can orbit toward it
        const targetY = hit.surface === 'ceiling' ? 8 : hit.surface === 'floor' ? 0 : (hit.wallY || 4);
        const nozzlePos = room3d.getNozzlePosition(hit.worldX, targetY, hit.worldZ);
        // Use nozzle position for spray visuals and arc (origin of water)
        const sprayParams = sim.getSprayParams(
          hit.worldX, hit.worldZ, nozzlePos, hit.surface, hit.wallY
        );

        // Always show spray visual on whatever surface we hit
        const currentMode = fogMode ? 'fog' : 'direct';
        const fallbackParams = {
          majorR: 1.5, minorR: 1.5, sprayAngle: 0,
          strengthFactor: 0.5, centerOffset: 0,
        };
        const displayParams = sprayParams || fallbackParams;
        displayParams.mode = currentMode;
        room3d.showWaterSpray(hit.worldX, hit.worldZ, displayParams, hit, nozzlePos);

        // Update arc debug visualization (from nozzle, not eye)
        updateArcDebug(nozzlePos, hit, sim.sprayPSI);

        // Send water to controller — but only if spray actually reaches the ceiling.
        // Wall hits below the ceiling don't affect ceiling cells (the grid is the ceiling).
        // Near the ceiling top, splash can still reach cells, so scale by proximity.
        {
          const waterParams = sprayParams || fallbackParams;
          waterParams.mode = currentMode;
          let wallScale = 1.0;
          if (hit.surface && hit.surface.startsWith('wall-')) {
            const wy = hit.wallY != null ? hit.wallY : 0;
            // Only ceiling-adjacent wall hits (top 2 ft) can splash onto ceiling cells
            const WALL_REACH = 2.0; // ft from ceiling where wall spray can still affect cells
            if (wy < ROOM_H - WALL_REACH) {
              wallScale = 0; // too far below ceiling, no effect on cells
            } else {
              wallScale = (wy - (ROOM_H - WALL_REACH)) / WALL_REACH; // 0..1
            }
          } else if (hit.surface === 'floor') {
            wallScale = 0; // floor hits don't affect ceiling cells
          }
          if (wallScale > 0) {
            waterParams.strengthFactor = (waterParams.strengthFactor || 1) * wallScale;
            net.sendWater(hit.worldX, hit.worldZ, nozzlePos, waterParams);
          }
          const rect = room3dContainer.getBoundingClientRect();
          const ndcX = ((sprayX - rect.left) / rect.width) * 2 - 1;
          const ndcY = -((sprayY - rect.top) / rect.height) * 2 + 1;
          setSprayScreenPosition(ndcX, ndcY);
        }
      }
    } else {
      clearSprayScreenPosition();
      updateArcDebug(null, null, 0); // hide arc when not spraying
    }

    // Cell debug: show heat/moisture/state for cell under cursor
    if (isArcDebugEnabled()) {
      const debugHit = room3d.raycastCeiling(cursorX, cursorY);
      if (debugHit) {
        updateCellDebug(sim, debugHit.worldX, debugHit.worldZ);
      } else {
        updateCellDebug(sim, null, null);
      }
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
const heatOverlay = document.getElementById('heat-overlay');
let lastGameState = 'idle';

function _updateHeatOverlay(tempC) {
  if (!heatOverlay) return;
  // Heat effects start at 100°C, max out at UNTENABLE (260°C)
  const lo = 100, hi = 260;
  if (tempC <= lo) { heatOverlay.style.opacity = '0'; return; }
  const t = Math.min((tempC - lo) / (hi - lo), 1); // 0..1

  // Uniform red tint with a wide, gentle gradient toward edges
  const tintAlpha = (t * 0.25).toFixed(3);
  const edgeAlpha = (t * 0.45).toFixed(3);

  heatOverlay.style.opacity = '1';
  heatOverlay.style.background = `
    radial-gradient(ellipse at center,
      rgba(180,30,0,${tintAlpha}) 0%,
      rgba(180,30,0,${tintAlpha}) 30%,
      rgba(170,25,0,${((parseFloat(tintAlpha) + parseFloat(edgeAlpha)) / 2).toFixed(3)}) 65%,
      rgba(160,20,0,${edgeAlpha}) 100%
    )`;
}

function _updateViewerHUD(sim) {
  // Update heat overlay
  _updateHeatOverlay(sim.gasLayerTemp || 20);

  if (hudGas) {
    const tempC = sim.gasLayerTemp || 20;
    const tempF = Math.round(tempC * 9 / 5 + 32);
    hudGas.textContent = `Air Temp: ${tempF}°F`;
    hudGas.style.color = tempC > 500 ? '#e85020' : tempC > 300 ? '#ffcc66' : '#aaa';
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
      endstateEl.textContent = 'UNTENABLE CONDITIONS';
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

// Arc debug toggle (B key)
document.addEventListener('keydown', (e) => {
  if (e.key === 'b' || e.key === 'B') toggleArcDebug();
});

// Initial + dynamic resize
if (room3d.available) {
  setTimeout(() => room3d.onResize(), 0);
}
window.addEventListener('resize', () => {
  if (room3d.available) room3d.onResize();
});
