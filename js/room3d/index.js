/**
 * 3D Room View – public API module.
 *
 * Imports all 3D sub-modules and exposes the public interface
 * used by app.js and viewer-app.js.
 */

import { ROOM_W, ROOM_D, ROOM_H, DOOR_H } from '../constants.js';
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

// ── Placement hover highlight ────────────────────────────
let hoverHighlight = null;

if (available) {
  const hoverGeo = new THREE.PlaneGeometry(1, 1);
  const hoverMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  hoverHighlight = new THREE.Mesh(hoverGeo, hoverMat);
  hoverHighlight.visible = false;
  hoverHighlight.renderOrder = 998;
  scene.add(hoverHighlight);
}

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

  /** Handle container resize – caps aspect ratio to avoid fish-eye distortion */
  onResize() {
    if (!available) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0) return;

    const MAX_ASPECT = 16 / 9;
    const containerAspect = cw / ch;

    let w, h;
    if (containerAspect > MAX_ASPECT) {
      // Too wide – constrain width, use full height
      h = ch;
      w = Math.round(ch * MAX_ASPECT);
    } else {
      // Fits within 16:9 – use full container
      w = cw;
      h = ch;
    }

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  },

  /** Show hover highlight on a grid cell. surface: 'floor' | 'ceiling' */
  showHoverCell(gridX, gridY, surface, color) {
    if (!hoverHighlight) return;
    const y = surface === 'ceiling' ? ROOM_H - 0.005 : 0.01;
    hoverHighlight.position.set(gridX + 0.5, y, gridY + 0.5);
    hoverHighlight.rotation.x = -Math.PI / 2;
    hoverHighlight.rotation.y = 0;
    hoverHighlight.rotation.z = 0;
    hoverHighlight.material.color.set(color || 0xffffff);
    hoverHighlight.visible = true;
  },

  /** Show hover highlight on a wall cell for door placement */
  showHoverWall(gridX, gridY, wall, color) {
    if (!hoverHighlight) return;
    const halfDoor = DOOR_H / 2;
    hoverHighlight.scale.set(1, 1, 1);
    hoverHighlight.material.color.set(color || 0x44aaff);
    hoverHighlight.rotation.x = 0;

    if (wall === 'far') {
      hoverHighlight.position.set(gridX + 0.5, halfDoor, 0.01);
      hoverHighlight.rotation.y = 0;
      hoverHighlight.rotation.z = 0;
      hoverHighlight.scale.y = DOOR_H;
    } else if (wall === 'back') {
      hoverHighlight.position.set(gridX + 0.5, halfDoor, ROOM_D - 0.01);
      hoverHighlight.rotation.y = 0;
      hoverHighlight.rotation.z = 0;
      hoverHighlight.scale.y = DOOR_H;
    } else if (wall === 'left') {
      hoverHighlight.position.set(0.01, halfDoor, gridY + 0.5);
      hoverHighlight.rotation.y = Math.PI / 2;
      hoverHighlight.rotation.z = 0;
      hoverHighlight.scale.y = DOOR_H;
    } else if (wall === 'right') {
      hoverHighlight.position.set(ROOM_W - 0.01, halfDoor, gridY + 0.5);
      hoverHighlight.rotation.y = Math.PI / 2;
      hoverHighlight.rotation.z = 0;
      hoverHighlight.scale.y = DOOR_H;
    }
    hoverHighlight.visible = true;
  },

  hideHoverCell() {
    if (hoverHighlight) {
      hoverHighlight.visible = false;
      hoverHighlight.scale.set(1, 1, 1);
    }
  },

  raycastCeiling,
  showWaterSpray,
  hideWaterSpray,
  resetToStart,
  getPlayerPosition,
};

export default room3d;
