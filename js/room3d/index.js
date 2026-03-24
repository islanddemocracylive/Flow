/**
 * 3D Room View – public API module.
 *
 * Imports all 3D sub-modules and exposes the public interface
 * used by app.js and viewer-app.js.
 */

import { ROOM_W, ROOM_D, ROOM_H } from '../constants.js';
import { heatToColor } from '../colorUtils.js';
import { container, scene, camera, renderer, fireLight } from './scene.js';
import { buildWalls, wallGroup, doorFrameGroup } from './walls.js';
import { panelMeshes } from './ceiling.js';
import { buildVentMeshes } from './vents.js';
import { buildObstacleMeshes } from './obstacles.js';
import { raycastCeiling, showWaterSpray, hideWaterSpray } from './raycaster.js';
import { updateCamera, resetToStart, getPlayerPosition } from './fpCamera.js';
import { initOrbitCamera, enableOrbit, disableOrbit, updateOrbit } from './orbitCamera.js';
import { buildStartMarkers } from './startMarkers.js';

// Track last vent config to know when to rebuild
let lastVentKey = '';

// Bail out if Three.js not available
const available = !!(container && scene);

// Track current camera mode
let orbitMode = false;

// Initialize orbit controls
if (available) {
  initOrbitCamera();
}

const room3d = {
  available,

  /** Update ceiling panel colours from the fire simulation */
  updatePanels(sim) {
    if (!sim || !available) return;

    // Check if vents changed – rebuild meshes if needed
    const ventKey = JSON.stringify(sim.vents);
    if (ventKey !== lastVentKey) {
      lastVentKey = ventKey;
      buildVentMeshes(sim);
      buildWalls(sim);
    }

    // Always rebuild obstacles and start markers (uses internal change detection)
    buildObstacleMeshes(sim);
    buildStartMarkers(sim);

    let totalGlow = 0;

    for (let i = 0; i < panelMeshes.length; i++) {
      const { mesh, col, row } = panelMeshes[i];
      const heat = sim.heat[sim.idx(col, row)];

      if (sim.isCeilingVent(col, row)) {
        mesh.material.color.set(0x050510);
        mesh.material.opacity = 0.3;
        mesh.material.transparent = true;
      } else {
        const color = heatToColor(heat);
        mesh.material.color.copy(color);
        mesh.material.opacity = 1;
        mesh.material.transparent = false;
      }

      totalGlow += heat;
    }


    // Update dynamic fire light
    if (fireLight) {
      const avgHeat = totalGlow / panelMeshes.length;
      fireLight.intensity = avgHeat * 3;
      fireLight.color.setHSL(0.05, 1, 0.5 + avgHeat * 0.3);
    }
  },

  /** Render the 3D scene with first-person camera (for viewer) */
  render(sim) {
    if (!available) return;
    updateCamera(sim);
    renderer.render(scene, camera);
  },

  /** Render the 3D scene with orbit camera (for admin) */
  renderOrbit() {
    if (!available) return;
    updateOrbit();
    renderer.render(scene, camera);
  },

  /** Switch between orbit mode (admin design) and FP mode (viewer) */
  setOrbitMode(enabled) {
    if (!available) return;
    orbitMode = enabled;
    if (enabled) {
      // Hide walls so we can see inside
      if (wallGroup) wallGroup.visible = false;
      enableOrbit();
    } else {
      // Show walls for FP mode
      if (wallGroup) wallGroup.visible = true;
      disableOrbit();
    }
  },

  /** Whether we're currently in orbit mode */
  isOrbitMode() {
    return orbitMode;
  },

  /** Handle container resize */
  onResize() {
    if (!available) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  },

  raycastCeiling,
  showWaterSpray,
  hideWaterSpray,
  resetToStart,
  getPlayerPosition,
};

export default room3d;
