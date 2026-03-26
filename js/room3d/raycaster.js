/**
 * Ceiling + wall plane raycasting for water spray targeting in 3D view.
 * Tests ray against ceiling (y=ROOM_H) and 4 walls, picks closest hit.
 */

import { ROOM_W, ROOM_D, ROOM_H } from '../constants.js';
import { scene, camera, renderer } from './scene.js';

const raycaster = typeof THREE !== 'undefined' ? new THREE.Raycaster() : null;
const ndcMouse = typeof THREE !== 'undefined' ? new THREE.Vector2() : null;

/**
 * Cast a ray from the camera through the given screen coordinates.
 * Returns the closest hit on any room surface (ceiling or walls).
 * { worldX, worldZ, surface, wallY }
 * - surface: 'ceiling' | 'wall-x0' | 'wall-xW' | 'wall-z0' | 'wall-zD'
 * - wallY: y-coordinate of wall hit (only for wall surfaces)
 * - worldX/worldZ: always clamped to room bounds (used for simulation water targeting)
 */
export function raycastCeiling(clientX, clientY) {
  if (!raycaster || !renderer) return null;

  const rect = renderer.domElement.getBoundingClientRect();
  ndcMouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndcMouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndcMouse, camera);

  const origin = raycaster.ray.origin;
  const dir = raycaster.ray.direction;

  let bestT = Infinity;
  let bestHit = null;

  // --- Ceiling plane (y = ROOM_H) ---
  if (Math.abs(dir.y) > 0.001) {
    const t = (ROOM_H - origin.y) / dir.y;
    if (t > 0) {
      const hx = origin.x + dir.x * t;
      const hz = origin.z + dir.z * t;
      if (hx >= 0 && hx <= ROOM_W && hz >= 0 && hz <= ROOM_D) {
        bestT = t;
        bestHit = { worldX: hx, worldZ: hz, surface: 'ceiling' };
      }
    }
  }

  // --- Wall at x=0 (left wall) ---
  if (Math.abs(dir.x) > 0.001) {
    const t = (0 - origin.x) / dir.x;
    if (t > 0 && t < bestT) {
      const hy = origin.y + dir.y * t;
      const hz = origin.z + dir.z * t;
      if (hy >= 0 && hy <= ROOM_H && hz >= 0 && hz <= ROOM_D) {
        bestT = t;
        bestHit = { worldX: 0, worldZ: hz, surface: 'wall-x0', wallY: hy };
      }
    }
  }

  // --- Wall at x=ROOM_W (right wall) ---
  if (Math.abs(dir.x) > 0.001) {
    const t = (ROOM_W - origin.x) / dir.x;
    if (t > 0 && t < bestT) {
      const hy = origin.y + dir.y * t;
      const hz = origin.z + dir.z * t;
      if (hy >= 0 && hy <= ROOM_H && hz >= 0 && hz <= ROOM_D) {
        bestT = t;
        bestHit = { worldX: ROOM_W, worldZ: hz, surface: 'wall-xW', wallY: hy };
      }
    }
  }

  // --- Wall at z=0 (far wall) ---
  if (Math.abs(dir.z) > 0.001) {
    const t = (0 - origin.z) / dir.z;
    if (t > 0 && t < bestT) {
      const hy = origin.y + dir.y * t;
      const hx = origin.x + dir.x * t;
      if (hy >= 0 && hy <= ROOM_H && hx >= 0 && hx <= ROOM_W) {
        bestT = t;
        bestHit = { worldX: hx, worldZ: 0, surface: 'wall-z0', wallY: hy };
      }
    }
  }

  // --- Wall at z=ROOM_D (back wall) ---
  if (Math.abs(dir.z) > 0.001) {
    const t = (ROOM_D - origin.z) / dir.z;
    if (t > 0 && t < bestT) {
      const hy = origin.y + dir.y * t;
      const hx = origin.x + dir.x * t;
      if (hy >= 0 && hy <= ROOM_H && hx >= 0 && hx <= ROOM_W) {
        bestT = t;
        bestHit = { worldX: hx, worldZ: ROOM_D, surface: 'wall-zD', wallY: hy };
      }
    }
  }

  // --- Floor plane (y=0) as fallback ---
  if (!bestHit && Math.abs(dir.y) > 0.001) {
    const t = (0 - origin.y) / dir.y;
    if (t > 0) {
      const hx = Math.max(0, Math.min(ROOM_W, origin.x + dir.x * t));
      const hz = Math.max(0, Math.min(ROOM_D, origin.z + dir.z * t));
      bestHit = { worldX: hx, worldZ: hz, surface: 'ceiling' };
    }
  }

  // Last resort forward projection
  if (!bestHit) {
    const fwd = 10;
    bestHit = {
      worldX: Math.max(0, Math.min(ROOM_W, origin.x + dir.x * fwd)),
      worldZ: Math.max(0, Math.min(ROOM_D, origin.z + dir.z * fwd)),
      surface: 'ceiling',
    };
  }

  bestHit.worldX = Math.max(0, Math.min(ROOM_W, bestHit.worldX));
  bestHit.worldZ = Math.max(0, Math.min(ROOM_D, bestHit.worldZ));
  return bestHit;
}

// ── Water spray visual indicator ─────────────────────────

let sprayIndicator = null;
let sprayMat = null;
const SPRAY_SEGMENTS = 48;

if (scene) {
  sprayMat = new THREE.MeshBasicMaterial({
    color: 0x44aaff,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });
  sprayIndicator = new THREE.Mesh(new THREE.BufferGeometry(), sprayMat);
  sprayIndicator.renderOrder = 999;
  sprayIndicator.visible = false;
  scene.add(sprayIndicator);
}

// Reusable arrays for ellipse geometry
const _ellipsePositions = new Float32Array((SPRAY_SEGMENTS + 2) * 3);
const _ellipseIndices = [];
for (let i = 0; i < SPRAY_SEGMENTS; i++) {
  _ellipseIndices.push(0, i + 1, (i + 1) % SPRAY_SEGMENTS + 1);
}

/** Build ceiling ellipse (XZ plane) */
function buildCeilingEllipse(majorR, minorR, sprayAngle) {
  const cosA = Math.cos(sprayAngle);
  const sinA = Math.sin(sprayAngle);

  _ellipsePositions[0] = 0; _ellipsePositions[1] = 0; _ellipsePositions[2] = 0;
  for (let i = 0; i < SPRAY_SEGMENTS; i++) {
    const t = (i / SPRAY_SEGMENTS) * Math.PI * 2;
    const lx = Math.cos(t) * majorR;
    const lz = Math.sin(t) * minorR;
    const wx = lx * cosA - lz * sinA;
    const wz = lx * sinA + lz * cosA;
    const off = (i + 1) * 3;
    _ellipsePositions[off] = wx; _ellipsePositions[off + 1] = 0; _ellipsePositions[off + 2] = wz;
  }
  _applyGeometry();
}

/** Build wall ellipse (YZ or XY plane depending on wall orientation) */
function buildWallEllipse(majorR, minorR, surface) {
  const isXWall = (surface === 'wall-x0' || surface === 'wall-xW');
  _ellipsePositions[0] = 0; _ellipsePositions[1] = 0; _ellipsePositions[2] = 0;

  for (let i = 0; i < SPRAY_SEGMENTS; i++) {
    const t = (i / SPRAY_SEGMENTS) * Math.PI * 2;
    const lMajor = Math.cos(t) * majorR;
    const lMinor = Math.sin(t) * minorR;
    const off = (i + 1) * 3;
    if (isXWall) {
      // Ellipse in YZ plane
      _ellipsePositions[off] = 0; _ellipsePositions[off + 1] = lMajor; _ellipsePositions[off + 2] = lMinor;
    } else {
      // Ellipse in XY plane
      _ellipsePositions[off] = lMinor; _ellipsePositions[off + 1] = lMajor; _ellipsePositions[off + 2] = 0;
    }
  }
  _applyGeometry();
}

function _applyGeometry() {
  const geo = sprayIndicator.geometry;
  if (!geo.attributes.position) {
    geo.setAttribute('position', new THREE.BufferAttribute(_ellipsePositions, 3));
    geo.setIndex(_ellipseIndices);
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeBoundingSphere();
}

/**
 * Show the spray indicator. For ceiling hits, draws ellipse on ceiling.
 * For wall hits, draws ellipse on the wall surface.
 * @param {number} worldX - hit X
 * @param {number} worldZ - hit Z
 * @param {object} params - from sim.getSprayParams()
 * @param {object} [hit] - from raycastCeiling() with surface info
 */
export function showWaterSpray(worldX, worldZ, params, hit) {
  if (!sprayIndicator) return;
  if (!params) { sprayIndicator.visible = false; return; }

  const surface = (hit && hit.surface) || 'ceiling';

  if (surface === 'ceiling') {
    const off = params.centerOffset || 0;
    const cx = worldX + Math.cos(params.sprayAngle) * off;
    const cz = worldZ + Math.sin(params.sprayAngle) * off;
    sprayIndicator.position.set(cx, ROOM_H - 0.02, cz);
    sprayIndicator.quaternion.identity();
    sprayIndicator.scale.set(1, 1, 1);
    buildCeilingEllipse(params.majorR, params.minorR, params.sprayAngle);
  } else {
    const wallY = (hit && hit.wallY) || (ROOM_H / 2);
    buildWallEllipse(params.majorR, params.minorR, surface);
    sprayIndicator.quaternion.identity();
    sprayIndicator.scale.set(1, 1, 1);

    const OFFSET = 0.02; // slight offset from wall to prevent z-fighting
    if (surface === 'wall-x0') {
      sprayIndicator.position.set(OFFSET, wallY, worldZ);
    } else if (surface === 'wall-xW') {
      sprayIndicator.position.set(ROOM_W - OFFSET, wallY, worldZ);
    } else if (surface === 'wall-z0') {
      sprayIndicator.position.set(worldX, wallY, OFFSET);
    } else if (surface === 'wall-zD') {
      sprayIndicator.position.set(worldX, wallY, ROOM_D - OFFSET);
    }
  }

  sprayMat.opacity = 0.15 + 0.35 * params.strengthFactor;
  sprayIndicator.visible = true;
}

export function hideWaterSpray() {
  if (sprayIndicator) sprayIndicator.visible = false;
}
