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
      bestHit = { worldX: hx, worldZ: hz, surface: 'floor' };
    }
  }

  // Last resort forward projection
  if (!bestHit) {
    const fwd = 10;
    bestHit = {
      worldX: Math.max(0, Math.min(ROOM_W, origin.x + dir.x * fwd)),
      worldZ: Math.max(0, Math.min(ROOM_D, origin.z + dir.z * fwd)),
      surface: 'floor',
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

// Reusable arrays for disc geometry (world-space positions, triangle fan)
const _discPositions = new Float32Array((SPRAY_SEGMENTS + 2) * 3);
const _discIndices = [];
for (let i = 0; i < SPRAY_SEGMENTS; i++) {
  _discIndices.push(0, i + 1, (i + 1) % SPRAY_SEGMENTS + 1);
}

const SURFACE_OFFSET = 0.03; // offset from surface to prevent z-fighting

/**
 * Resolve a raycast hit to a 3D point.
 */
function _hitTo3D(hit) {
  const s = hit.surface;
  if (s === 'ceiling') return [hit.worldX, ROOM_H, hit.worldZ];
  if (s === 'floor')   return [hit.worldX, 0, hit.worldZ];
  if (s === 'wall-x0') return [0, hit.wallY || ROOM_H / 2, hit.worldZ];
  if (s === 'wall-xW') return [ROOM_W, hit.wallY || ROOM_H / 2, hit.worldZ];
  if (s === 'wall-z0') return [hit.worldX, hit.wallY || ROOM_H / 2, 0];
  if (s === 'wall-zD') return [hit.worldX, hit.wallY || ROOM_H / 2, ROOM_D];
  return [hit.worldX, ROOM_H, hit.worldZ];
}

/**
 * Cast a ray from origin in direction dir, find closest room surface hit.
 * Returns [x, y, z] with surface offset applied, or null.
 */
function _rayHitRoom(ox, oy, oz, dx, dy, dz) {
  let bestT = Infinity;
  let bx, by, bz;

  // Ceiling (y = ROOM_H)
  if (Math.abs(dy) > 0.0001) {
    const t = (ROOM_H - oy) / dy;
    if (t > 0.001 && t < bestT) {
      const hx = ox + dx * t, hz = oz + dz * t;
      if (hx >= 0 && hx <= ROOM_W && hz >= 0 && hz <= ROOM_D) {
        bestT = t; bx = hx; by = ROOM_H - SURFACE_OFFSET; bz = hz;
      }
    }
  }
  // Floor (y = 0)
  if (Math.abs(dy) > 0.0001) {
    const t = (0 - oy) / dy;
    if (t > 0.001 && t < bestT) {
      const hx = ox + dx * t, hz = oz + dz * t;
      if (hx >= 0 && hx <= ROOM_W && hz >= 0 && hz <= ROOM_D) {
        bestT = t; bx = hx; by = SURFACE_OFFSET; bz = hz;
      }
    }
  }
  // Wall x=0
  if (Math.abs(dx) > 0.0001) {
    const t = (0 - ox) / dx;
    if (t > 0.001 && t < bestT) {
      const hy = oy + dy * t, hz = oz + dz * t;
      if (hy >= 0 && hy <= ROOM_H && hz >= 0 && hz <= ROOM_D) {
        bestT = t; bx = SURFACE_OFFSET; by = hy; bz = hz;
      }
    }
  }
  // Wall x=ROOM_W
  if (Math.abs(dx) > 0.0001) {
    const t = (ROOM_W - ox) / dx;
    if (t > 0.001 && t < bestT) {
      const hy = oy + dy * t, hz = oz + dz * t;
      if (hy >= 0 && hy <= ROOM_H && hz >= 0 && hz <= ROOM_D) {
        bestT = t; bx = ROOM_W - SURFACE_OFFSET; by = hy; bz = hz;
      }
    }
  }
  // Wall z=0
  if (Math.abs(dz) > 0.0001) {
    const t = (0 - oz) / dz;
    if (t > 0.001 && t < bestT) {
      const hx = ox + dx * t, hy = oy + dy * t;
      if (hx >= 0 && hx <= ROOM_W && hy >= 0 && hy <= ROOM_H) {
        bestT = t; bx = hx; by = hy; bz = SURFACE_OFFSET;
      }
    }
  }
  // Wall z=ROOM_D
  if (Math.abs(dz) > 0.0001) {
    const t = (ROOM_D - oz) / dz;
    if (t > 0.001 && t < bestT) {
      const hx = ox + dx * t, hy = oy + dy * t;
      if (hx >= 0 && hx <= ROOM_W && hy >= 0 && hy <= ROOM_H) {
        bestT = t; bx = hx; by = hy; bz = ROOM_D - SURFACE_OFFSET;
      }
    }
  }

  return bestT < Infinity ? [bx, by, bz] : null;
}

export function getOverflowParams() { return null; }

/**
 * Show the spray indicator as a 3D disc projected onto room surfaces.
 * The disc is perpendicular to the spray beam at the hit distance,
 * then each vertex is projected onto the nearest room surface.
 * This naturally wraps around corners and edges.
 */
export function showWaterSpray(worldX, worldZ, params, hit, playerPos) {
  if (!sprayIndicator) return;
  if (!params) { sprayIndicator.visible = false; return; }
  if (!playerPos) { sprayIndicator.visible = false; return; }

  // Nozzle and target in 3D
  // playerPos is the nozzle position (from getNozzlePosition)
  const nx = playerPos.x, ny = playerPos.y, nz = playerPos.z;
  const target = _hitTo3D(hit);
  const tx = target[0], ty = target[1], tz = target[2];

  // Beam direction
  let bx = tx - nx, by = ty - ny, bz = tz - nz;
  const bLen = Math.sqrt(bx * bx + by * by + bz * bz);
  if (bLen < 0.01) { sprayIndicator.visible = false; return; }
  bx /= bLen; by /= bLen; bz /= bLen;

  // Disc radius = cone cross-section at hit distance
  const discRadius = params.minorR;

  // Build orthonormal basis for the disc plane (perpendicular to beam)
  // Pick an "up" vector that isn't parallel to beam
  let upx = 0, upy = 1, upz = 0;
  if (Math.abs(by) > 0.95) { upx = 1; upy = 0; upz = 0; }

  // U = normalize(cross(beam, up)) * discRadius
  let ux = by * upz - bz * upy;
  let uy = bz * upx - bx * upz;
  let uz = bx * upy - by * upx;
  let uLen = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux = (ux / uLen) * discRadius;
  uy = (uy / uLen) * discRadius;
  uz = (uz / uLen) * discRadius;

  // V = normalize(cross(beam, U)) * discRadius
  let vx = by * uz - bz * uy;
  let vy = bz * ux - bx * uz;
  let vz = bx * uy - by * ux;
  let vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
  vx = (vx / vLen) * discRadius;
  vy = (vy / vLen) * discRadius;
  vz = (vz / vLen) * discRadius;

  // Center vertex: project hit point onto surface with offset
  const centerHit = _rayHitRoom(nx, ny, nz, bx, by, bz);
  if (!centerHit) { sprayIndicator.visible = false; return; }
  _discPositions[0] = centerHit[0];
  _discPositions[1] = centerHit[1];
  _discPositions[2] = centerHit[2];

  // Edge vertices: for each segment, compute disc point then project
  for (let i = 0; i < SPRAY_SEGMENTS; i++) {
    const t = (i / SPRAY_SEGMENTS) * Math.PI * 2;
    const cosT = Math.cos(t), sinT = Math.sin(t);

    // Point on disc in world space
    const px = tx + ux * cosT + vx * sinT;
    const py = ty + uy * cosT + vy * sinT;
    const pz = tz + uz * cosT + vz * sinT;

    // Ray from nozzle through disc point
    let rdx = px - nx, rdy = py - ny, rdz = pz - nz;
    const rLen = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz);
    rdx /= rLen; rdy /= rLen; rdz /= rLen;

    const edgeHit = _rayHitRoom(nx, ny, nz, rdx, rdy, rdz);
    const off = (i + 1) * 3;
    if (edgeHit) {
      _discPositions[off] = edgeHit[0];
      _discPositions[off + 1] = edgeHit[1];
      _discPositions[off + 2] = edgeHit[2];
    } else {
      // Fallback: place at disc point clamped to room
      _discPositions[off] = Math.max(0, Math.min(ROOM_W, px));
      _discPositions[off + 1] = Math.max(0, Math.min(ROOM_H, py));
      _discPositions[off + 2] = Math.max(0, Math.min(ROOM_D, pz));
    }
  }

  // Position mesh at origin since vertices are in world space
  sprayIndicator.position.set(0, 0, 0);
  sprayIndicator.quaternion.identity();
  sprayIndicator.scale.set(1, 1, 1);

  const geo = sprayIndicator.geometry;
  if (!geo.attributes.position || geo.attributes.position.array !== _discPositions) {
    geo.setAttribute('position', new THREE.BufferAttribute(_discPositions, 3));
    geo.setIndex(_discIndices);
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeBoundingSphere();

  sprayMat.opacity = 0.15 + 0.35 * params.strengthFactor;
  sprayIndicator.visible = true;
}

export function hideWaterSpray() {
  if (sprayIndicator) sprayIndicator.visible = false;
}
