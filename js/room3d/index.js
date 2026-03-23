/**
 * 3D Room View – public API module.
 *
 * Imports all 3D sub-modules and exposes the public interface
 * used by app.js and viewer-app.js.
 */

import { ROOM_H } from '../constants.js';
import { heatToColor } from '../colorUtils.js';
import { container, scene, camera, renderer, fireLight } from './scene.js';
import { buildWalls } from './walls.js';
import { panelMeshes } from './ceiling.js';
import { buildVentMeshes } from './vents.js';
import { arrowMeshes } from './arrows.js';
import { raycastCeiling, showWaterSpray, hideWaterSpray } from './raycaster.js';
import { updateCamera, resetToStart } from './fpCamera.js';

// Track last vent config to know when to rebuild
let lastVentKey = '';

// Bail out if Three.js not available
const available = !!(container && scene);

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

    // Update airflow arrows
    if (sim.vents.length > 0) {
      for (const arrow of arrowMeshes) {
        const af = sim.getAirflow(arrow.col, arrow.row);
        const mag = Math.sqrt(af.vx * af.vx + af.vy * af.vy);

        if (mag > 0.02) {
          const angle = Math.atan2(-af.vx, -af.vy);
          arrow.mesh.rotation.x = -Math.PI / 2;
          arrow.mesh.rotation.y = 0;
          arrow.mesh.rotation.z = angle;
          arrow.mesh.material.opacity = Math.min(0.6, mag * 0.8);
        } else {
          arrow.mesh.material.opacity = 0;
        }
      }
    } else {
      for (const arrow of arrowMeshes) {
        arrow.mesh.material.opacity = 0;
      }
    }

    // Update dynamic fire light
    if (fireLight) {
      const avgHeat = totalGlow / panelMeshes.length;
      fireLight.intensity = avgHeat * 3;
      fireLight.color.setHSL(0.05, 1, 0.5 + avgHeat * 0.3);
    }
  },

  /** Render the 3D scene (includes first-person camera update) */
  render(sim) {
    if (!available) return;
    updateCamera(sim);
    renderer.render(scene, camera);
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
};

export default room3d;
