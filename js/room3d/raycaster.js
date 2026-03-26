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
let hoseBarrel = null;
let sprayCone = null;
let sprayConePositions = null;
const SPRAY_SEGMENTS = 48;
const BARREL_LENGTH = 1.0;  // ft — visible nozzle barrel
const BARREL_RADIUS = 0.073; // ft — 1.75 inch diameter (standard nozzle)
const CONE_RINGS = 8;
const CONE_SEGMENTS = 24;
const NOZZLE_RADIUS = 0.073; // ft — matches barrel

if (scene) {
  // Spray disc with vertex colors for gradient (center bright, edges fade)
  sprayMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });
  sprayIndicator = new THREE.Mesh(new THREE.BufferGeometry(), sprayMat);
  sprayIndicator.renderOrder = 999;
  sprayIndicator.visible = false;
  scene.add(sprayIndicator);

  // Hose barrel — a cylinder representing the nozzle
  const barrelGeo = new THREE.CylinderBufferGeometry(BARREL_RADIUS, BARREL_RADIUS * 0.8, BARREL_LENGTH, 8);
  const barrelMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
  hoseBarrel = new THREE.Mesh(barrelGeo, barrelMat);
  hoseBarrel.renderOrder = 1002;
  hoseBarrel.visible = false;
  scene.add(hoseBarrel);

  // Spray cone — wireframe from nozzle to disc, always visible while spraying
  const totalConeVerts = (CONE_RINGS * CONE_SEGMENTS + CONE_SEGMENTS) * 2;
  sprayConePositions = new Float32Array(totalConeVerts * 3);
  const coneGeo = new THREE.BufferGeometry();
  coneGeo.setAttribute('position', new THREE.BufferAttribute(sprayConePositions, 3));
  const coneMat = new THREE.LineBasicMaterial({
    color: 0x44aaff,
    transparent: true,
    opacity: 0.2,
    depthTest: true,
  });
  sprayCone = new THREE.LineSegments(coneGeo, coneMat);
  sprayCone.renderOrder = 998;
  sprayCone.frustumCulled = false;
  sprayCone.visible = false;
  scene.add(sprayCone);
}

// Vertex color arrays for gradient disc
const _discColors = new Float32Array((SPRAY_SEGMENTS + 2) * 3);

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

/**
 * Show the spray indicator as a 3D disc projected onto room surfaces.
 * The disc is perpendicular to the spray beam at the hit distance,
 * then each vertex is projected onto the nearest room surface.
 * This naturally wraps around corners and edges.
 */
export function showWaterSpray(worldX, worldZ, params, hit, playerPos) {
  if (!sprayIndicator) return;
  const _hide = () => {
    sprayIndicator.visible = false;
    if (hoseBarrel) hoseBarrel.visible = false;
    if (sprayCone) sprayCone.visible = false;
  };
  if (!params) { _hide(); return; }
  if (!playerPos) { _hide(); return; }

  // Nozzle and target in 3D
  // playerPos is the nozzle position (from getNozzlePosition)
  const nx = playerPos.x, ny = playerPos.y, nz = playerPos.z;
  const target = _hitTo3D(hit);
  const tx = target[0], ty = target[1], tz = target[2];

  // Beam direction
  let bx = tx - nx, by = ty - ny, bz = tz - nz;
  const bLen = Math.sqrt(bx * bx + by * by + bz * bz);
  if (bLen < 0.01) { _hide(); return; }
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
  if (!centerHit) { _hide(); return; }
  _discPositions[0] = centerHit[0];
  _discPositions[1] = centerHit[1];
  _discPositions[2] = centerHit[2];
  // Center color: bright blue (full intensity)
  _discColors[0] = 0.27; _discColors[1] = 0.67; _discColors[2] = 1.0;

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
      _discPositions[off] = Math.max(0, Math.min(ROOM_W, px));
      _discPositions[off + 1] = Math.max(0, Math.min(ROOM_H, py));
      _discPositions[off + 2] = Math.max(0, Math.min(ROOM_D, pz));
    }
    // Edge color: faded (dark, blends to transparent with material opacity)
    _discColors[off] = 0.05; _discColors[off + 1] = 0.15; _discColors[off + 2] = 0.3;
  }

  // --- Compute projected surface area and impact angle ---
  // Area from triangle fan: sum of cross-product magnitudes / 2
  let totalArea = 0;
  const cx = _discPositions[0], cy = _discPositions[1], cz = _discPositions[2];
  for (let i = 0; i < SPRAY_SEGMENTS; i++) {
    const i1 = (i + 1) * 3;
    const i2 = ((i + 1) % SPRAY_SEGMENTS + 1) * 3;
    // Edge vectors from center to each vertex
    const e1x = _discPositions[i1] - cx, e1y = _discPositions[i1 + 1] - cy, e1z = _discPositions[i1 + 2] - cz;
    const e2x = _discPositions[i2] - cx, e2y = _discPositions[i2 + 1] - cy, e2z = _discPositions[i2 + 2] - cz;
    // Cross product magnitude = 2 * triangle area
    const crossX = e1y * e2z - e1z * e2y;
    const crossY = e1z * e2x - e1x * e2z;
    const crossZ = e1x * e2y - e1y * e2x;
    totalArea += Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
  }
  totalArea *= 0.5; // each cross product gives 2× triangle area

  // Ideal disc area (perpendicular circle at this distance)
  const idealArea = Math.PI * discRadius * discRadius;

  // Impact angle at center: angle between beam direction and surface normal
  // Detect which surface the center hit is on from its position
  let impactCos = 1; // 1 = perpendicular (ideal)
  const hx = centerHit[0], hy = centerHit[1], hz = centerHit[2];
  if (Math.abs(hy - (ROOM_H - SURFACE_OFFSET)) < 0.01)      impactCos = Math.abs(by); // ceiling
  else if (Math.abs(hy - SURFACE_OFFSET) < 0.01)             impactCos = Math.abs(by); // floor
  else if (Math.abs(hx - SURFACE_OFFSET) < 0.01)             impactCos = Math.abs(bx); // wall-x0
  else if (Math.abs(hx - (ROOM_W - SURFACE_OFFSET)) < 0.01) impactCos = Math.abs(bx); // wall-xW
  else if (Math.abs(hz - SURFACE_OFFSET) < 0.01)             impactCos = Math.abs(bz); // wall-z0
  else if (Math.abs(hz - (ROOM_D - SURFACE_OFFSET)) < 0.01) impactCos = Math.abs(bz); // wall-zD

  // Effective fraction: combines geometric projection with attack angle
  // At perpendicular: impactCos=1, areaRatio≈1 → 100% effective
  // At oblique angles: impactCos<1, area stretches → less effective per unit area
  const areaRatio = idealArea > 0.01 ? Math.min(1, idealArea / totalArea) : 1;
  const effectiveFraction = impactCos * areaRatio;

  _lastSprayInfo = {
    projectedArea: totalArea,
    idealArea,
    areaRatio,
    impactAngle: Math.acos(Math.min(1, impactCos)) * 180 / Math.PI,
    impactCos,
    effectiveFraction,
    discRadius,
    beamLength: bLen,
  };

  // Position mesh at origin since vertices are in world space
  sprayIndicator.position.set(0, 0, 0);
  sprayIndicator.quaternion.identity();
  sprayIndicator.scale.set(1, 1, 1);

  const geo = sprayIndicator.geometry;
  if (!geo.attributes.position || geo.attributes.position.array !== _discPositions) {
    geo.setAttribute('position', new THREE.BufferAttribute(_discPositions, 3));
    geo.setIndex(_discIndices);
  }
  if (!geo.attributes.color || geo.attributes.color.array !== _discColors) {
    geo.setAttribute('color', new THREE.BufferAttribute(_discColors, 3));
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
  geo.computeBoundingSphere();

  sprayMat.opacity = 0.5;
  sprayIndicator.visible = true;

  // --- Spray cone wireframe (short, near nozzle only) ---
  if (sprayCone && sprayConePositions) {
    const CONE_MAX_LEN = 3.0; // ft — only show first 3 ft of cone
    const coneLen = Math.min(bLen, CONE_MAX_LEN);

    // Quadratic spread model matching simulation: r = nozzleR + spreadK * d²
    // Use same spreadK as getSprayParams (baseSpreadK=0.014 at 100 PSI, waterRadius=2)
    const SPREAD_K = 0.014; // TODO: pass from params if waterRadius/PSI change
    const _coneR = (d) => NOZZLE_RADIUS + SPREAD_K * d * d;

    // Unit basis vectors perpendicular to beam
    const u1x = ux / discRadius, u1y = uy / discRadius, u1z = uz / discRadius;
    const u2x = vx / discRadius, u2y = vy / discRadius, u2z = vz / discRadius;

    let vi = 0;
    // Rings along the short cone
    for (let r = 1; r <= CONE_RINGS; r++) {
      const frac = r / CONE_RINGS;
      const dist = coneLen * frac;
      const ringR = _coneR(dist);
      const rcx = nx + bx * dist, rcy = ny + by * dist, rcz = nz + bz * dist;
      for (let s = 0; s < CONE_SEGMENTS; s++) {
        const a1 = (s / CONE_SEGMENTS) * Math.PI * 2;
        const a2 = ((s + 1) / CONE_SEGMENTS) * Math.PI * 2;
        sprayConePositions[vi++] = rcx + (u1x * Math.cos(a1) + u2x * Math.sin(a1)) * ringR;
        sprayConePositions[vi++] = rcy + (u1y * Math.cos(a1) + u2y * Math.sin(a1)) * ringR;
        sprayConePositions[vi++] = rcz + (u1z * Math.cos(a1) + u2z * Math.sin(a1)) * ringR;
        sprayConePositions[vi++] = rcx + (u1x * Math.cos(a2) + u2x * Math.sin(a2)) * ringR;
        sprayConePositions[vi++] = rcy + (u1y * Math.cos(a2) + u2y * Math.sin(a2)) * ringR;
        sprayConePositions[vi++] = rcz + (u1z * Math.cos(a2) + u2z * Math.sin(a2)) * ringR;
      }
    }
    // Longitudinal lines from nozzle opening to end of short cone
    const endR = _coneR(coneLen);
    const ex = nx + bx * coneLen, ey = ny + by * coneLen, ez = nz + bz * coneLen;
    for (let s = 0; s < CONE_SEGMENTS; s++) {
      const a = (s / CONE_SEGMENTS) * Math.PI * 2;
      const cosA = Math.cos(a), sinA = Math.sin(a);
      sprayConePositions[vi++] = nx + (u1x * cosA + u2x * sinA) * NOZZLE_RADIUS;
      sprayConePositions[vi++] = ny + (u1y * cosA + u2y * sinA) * NOZZLE_RADIUS;
      sprayConePositions[vi++] = nz + (u1z * cosA + u2z * sinA) * NOZZLE_RADIUS;
      sprayConePositions[vi++] = ex + (u1x * cosA + u2x * sinA) * endR;
      sprayConePositions[vi++] = ey + (u1y * cosA + u2y * sinA) * endR;
      sprayConePositions[vi++] = ez + (u1z * cosA + u2z * sinA) * endR;
    }
    while (vi < sprayConePositions.length) sprayConePositions[vi++] = 0;
    sprayCone.geometry.attributes.position.needsUpdate = true;
    sprayCone.geometry.computeBoundingSphere();
    sprayCone.visible = true;
  }

  // --- Hose barrel: position from grip to nozzle tip ---
  if (hoseBarrel) {
    // Barrel center is halfway along the barrel, behind the nozzle
    const halfLen = BARREL_LENGTH / 2;
    hoseBarrel.position.set(
      nx - bx * halfLen,
      ny - by * halfLen,
      nz - bz * halfLen,
    );
    // Orient barrel along beam direction
    // THREE.js CylinderGeometry is along +Y, so we need to rotate to align with beam
    // Use lookAt trick: place a target along the beam from the barrel center
    const lookTarget = new THREE.Vector3(
      nx + bx * halfLen,
      ny + by * halfLen,
      nz + bz * halfLen,
    );
    hoseBarrel.lookAt(lookTarget);
    // CylinderGeometry is along Y, but lookAt aligns -Z. Rotate 90° on X to fix.
    hoseBarrel.rotateX(Math.PI / 2);
    hoseBarrel.visible = true;
  }

  return _lastSprayInfo;
}

/** Spray info from last showWaterSpray call */
let _lastSprayInfo = null;
export function getSprayInfo() { return _lastSprayInfo; }

export function hideWaterSpray() {
  if (sprayIndicator) sprayIndicator.visible = false;
  if (hoseBarrel) hoseBarrel.visible = false;
  if (sprayCone) sprayCone.visible = false;
  _lastSprayInfo = null;
}
