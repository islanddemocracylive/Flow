/**
 * Water arc trajectory debug visualization.
 *
 * Shows the parabolic path water follows from nozzle to target surface,
 * accounting for gravity. Computes impact angle and effective application
 * fraction. Toggle with 'B' key.
 *
 * Physics:
 *   Exit velocity: v = Cv * sqrt(2 * P / rho)  (Bernoulli nozzle formula)
 *   Trajectory: standard projectile in the vertical plane
 *   Impact angle: angle between velocity vector and surface normal at impact
 */

import { ROOM_W, ROOM_D, ROOM_H } from '../constants.js';
import { scene } from './scene.js';
import { getSprayInfo } from './raycaster.js';

const G = 32.174;       // gravity in ft/s²
const ARC_SEGMENTS = 48;
const Cv = 0.97;        // nozzle velocity coefficient
const RHO = 998;        // water density kg/m³
const PSI_TO_PA = 6894.76;
const FT_PER_M = 1 / 0.3048;

let arcLine = null;
let arcPositions = null;
let arcMaterial = null;
let coneMesh = null;
let conePositions = null;
let coneMaterial = null;
const CONE_RINGS = 8;     // rings along the cone length
const CONE_SEGMENTS = 24; // segments around each ring
let enabled = false;
let debugOverlay = null;
let lastInfo = null;

if (scene) {
  // Arc line
  arcPositions = new Float32Array((ARC_SEGMENTS + 1) * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
  arcMaterial = new THREE.LineBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.8,
    depthTest: true,
  });
  arcLine = new THREE.Line(geo, arcMaterial);
  arcLine.renderOrder = 1001;
  arcLine.frustumCulled = false;
  arcLine.visible = false;
  scene.add(arcLine);

  // Cone wireframe: rings along the beam + longitudinal lines
  // Each ring has CONE_SEGMENTS line segments, plus CONE_SEGMENTS longitudinal lines
  // Total line segments: CONE_RINGS * CONE_SEGMENTS (rings) + CONE_SEGMENTS (longitudinals)
  const totalVerts = (CONE_RINGS * CONE_SEGMENTS + CONE_SEGMENTS) * 2;
  conePositions = new Float32Array(totalVerts * 3);
  const coneGeo = new THREE.BufferGeometry();
  coneGeo.setAttribute('position', new THREE.BufferAttribute(conePositions, 3));
  coneMaterial = new THREE.LineBasicMaterial({
    color: 0x44aaff,
    transparent: true,
    opacity: 0.3,
    depthTest: true,
  });
  coneMesh = new THREE.LineSegments(coneGeo, coneMaterial);
  coneMesh.renderOrder = 998;
  coneMesh.frustumCulled = false;
  coneMesh.visible = false;
  scene.add(coneMesh);
}

/** Compute nozzle exit velocity in ft/s from PSI */
function exitVelocity(psi) {
  const P = psi * PSI_TO_PA;
  const v_mps = Cv * Math.sqrt(2 * P / RHO);
  return v_mps * FT_PER_M;
}

/**
 * Solve for low-trajectory launch angle to hit target (R, H) with speed v0.
 * Returns angle in radians from horizontal, or null if unreachable.
 */
function solveLaunchAngle(v0, R, H) {
  if (R < 0.01) {
    // Nearly vertical — aim straight up/down
    return H >= 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  const v2 = v0 * v0;
  const v4 = v2 * v2;
  const D = v4 - G * (G * R * R + 2 * H * v2);
  if (D < 0) return null; // out of range

  // Low trajectory (minus sqrt)
  const tanTheta = (v2 - Math.sqrt(D)) / (G * R);
  return Math.atan(tanTheta);
}

/**
 * Resolve the 3D target point from a raycast hit.
 */
function hitTo3D(hit) {
  const s = hit.surface;
  if (s === 'ceiling') return { x: hit.worldX, y: ROOM_H, z: hit.worldZ };
  if (s === 'floor')   return { x: hit.worldX, y: 0, z: hit.worldZ };
  if (s === 'wall-x0') return { x: 0, y: hit.wallY || ROOM_H / 2, z: hit.worldZ };
  if (s === 'wall-xW') return { x: ROOM_W, y: hit.wallY || ROOM_H / 2, z: hit.worldZ };
  if (s === 'wall-z0') return { x: hit.worldX, y: hit.wallY || ROOM_H / 2, z: 0 };
  if (s === 'wall-zD') return { x: hit.worldX, y: hit.wallY || ROOM_H / 2, z: ROOM_D };
  return { x: hit.worldX, y: ROOM_H, z: hit.worldZ };
}

/**
 * Update the arc debug visualization.
 * Call every frame while spraying.
 *
 * @param {{x,y,z}} playerPos
 * @param {object} hit - from raycastCeiling()
 * @param {number} sprayPSI
 * @returns {object|null} debug info
 */
export function updateArcDebug(playerPos, hit, sprayPSI) {
  if (!arcLine) return null;
  if (!enabled || !playerPos || !hit) {
    arcLine.visible = false;
    if (coneMesh) coneMesh.visible = false;
    _updateOverlay(null);
    lastInfo = null;
    return null;
  }

  // playerPos is now the nozzle position (from getNozzlePosition)
  const nozzle = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
  const target = hitTo3D(hit);

  // Horizontal range and vertical displacement
  const dx = target.x - nozzle.x;
  const dz = target.z - nozzle.z;
  const R = Math.sqrt(dx * dx + dz * dz);
  const H = target.y - nozzle.y;

  const v0 = exitVelocity(sprayPSI);
  const theta = solveLaunchAngle(v0, R, H);

  if (theta === null) {
    // Out of range — draw straight red line
    arcMaterial.color.setHex(0xff4444);
    _drawStraightLine(nozzle, target);
    if (coneMesh) coneMesh.visible = false;
    const info = { exitVelocity: v0, launchAngle: null, impactAngle: null, effectiveFraction: 0, range: R, reachable: false };
    _updateOverlay(info);
    lastInfo = info;
    return info;
  }

  arcMaterial.color.setHex(0x00ff88);

  // 3D velocity components
  const azimuth = Math.atan2(dz, dx);
  const cosTheta = Math.cos(theta);
  const vx = v0 * cosTheta * Math.cos(azimuth);
  const vy = v0 * Math.sin(theta);
  const vz = v0 * cosTheta * Math.sin(azimuth);

  // Time to reach target horizontally
  const horizSpeed = v0 * cosTheta;
  const tImpact = horizSpeed > 0.01 ? R / horizSpeed : 0.5;

  // Sample arc points
  let ceilingHitT = tImpact;
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const t = (i / ARC_SEGMENTS) * tImpact;
    const px = nozzle.x + vx * t;
    const py = nozzle.y + vy * t - 0.5 * G * t * t;
    const pz = nozzle.z + vz * t;

    // Check ceiling intersection
    if (py > ROOM_H && i > 0) {
      ceilingHitT = Math.min(ceilingHitT, t);
    }

    const off = i * 3;
    arcPositions[off] = px;
    arcPositions[off + 1] = Math.min(py, ROOM_H);
    arcPositions[off + 2] = pz;
  }

  arcLine.geometry.attributes.position.needsUpdate = true;
  arcLine.geometry.computeBoundingSphere();
  arcLine.geometry.setDrawRange(0, ARC_SEGMENTS + 1);
  arcLine.visible = true;

  // --- Cone wireframe ---
  if (coneMesh && conePositions) {
    // Beam direction (normalized)
    const beamLen = Math.sqrt(dx * dx + (target.y - nozzle.y) * (target.y - nozzle.y) + dz * dz);
    const bdx = dx / beamLen, bdy = (target.y - nozzle.y) / beamLen, bdz = dz / beamLen;

    // Basis vectors perpendicular to beam
    let upx = 0, upy = 1, upz = 0;
    if (Math.abs(bdy) > 0.95) { upx = 1; upy = 0; upz = 0; }
    let u1x = bdy * upz - bdz * upy, u1y = bdz * upx - bdx * upz, u1z = bdx * upy - bdy * upx;
    const u1L = Math.sqrt(u1x * u1x + u1y * u1y + u1z * u1z);
    u1x /= u1L; u1y /= u1L; u1z /= u1L;
    let u2x = bdy * u1z - bdz * u1y, u2y = bdz * u1x - bdx * u1z, u2z = bdx * u1y - bdy * u1x;
    const u2L = Math.sqrt(u2x * u2x + u2y * u2y + u2z * u2z);
    u2x /= u2L; u2y /= u2L; u2z /= u2L;

    // Cone half-angle from spray params
    const halfAngleDeg = 8 * Math.sqrt(100 / sprayPSI); // waterRadius=2 default
    const halfAngleRad = halfAngleDeg * Math.PI / 180;

    let vi = 0; // vertex index into conePositions
    const NOZZLE_R = 0.073; // ft — 1.75" nozzle opening radius
    // Rings along the cone — radius interpolates from nozzle to full cone spread
    for (let r = 1; r <= CONE_RINGS; r++) {
      const frac = r / CONE_RINGS;
      const dist = beamLen * frac;
      const coneR = dist * Math.tan(halfAngleRad);
      const ringR = NOZZLE_R + (coneR - NOZZLE_R) * frac;
      // Center of ring along beam
      const rcx = nozzle.x + bdx * dist;
      const rcy = nozzle.y + bdy * dist;
      const rcz = nozzle.z + bdz * dist;

      for (let s = 0; s < CONE_SEGMENTS; s++) {
        const a1 = (s / CONE_SEGMENTS) * Math.PI * 2;
        const a2 = ((s + 1) / CONE_SEGMENTS) * Math.PI * 2;
        const cos1 = Math.cos(a1), sin1 = Math.sin(a1);
        const cos2 = Math.cos(a2), sin2 = Math.sin(a2);
        // Point 1
        conePositions[vi++] = rcx + (u1x * cos1 + u2x * sin1) * ringR;
        conePositions[vi++] = rcy + (u1y * cos1 + u2y * sin1) * ringR;
        conePositions[vi++] = rcz + (u1z * cos1 + u2z * sin1) * ringR;
        // Point 2
        conePositions[vi++] = rcx + (u1x * cos2 + u2x * sin2) * ringR;
        conePositions[vi++] = rcy + (u1y * cos2 + u2y * sin2) * ringR;
        conePositions[vi++] = rcz + (u1z * cos2 + u2z * sin2) * ringR;
      }
    }
    // Longitudinal lines from nozzle opening (1.75" diameter) to outer ring
    const NOZZLE_RADIUS = 0.073; // ft — 1.75" diameter / 2
    const outerR = beamLen * Math.tan(halfAngleRad);
    const ocx = target.x, ocy = target.y, ocz = target.z;
    for (let s = 0; s < CONE_SEGMENTS; s++) {
      const a = (s / CONE_SEGMENTS) * Math.PI * 2;
      const cosA = Math.cos(a), sinA = Math.sin(a);
      // Nozzle opening point (small circle at nozzle tip)
      conePositions[vi++] = nozzle.x + (u1x * cosA + u2x * sinA) * NOZZLE_RADIUS;
      conePositions[vi++] = nozzle.y + (u1y * cosA + u2y * sinA) * NOZZLE_RADIUS;
      conePositions[vi++] = nozzle.z + (u1z * cosA + u2z * sinA) * NOZZLE_RADIUS;
      // Outer ring point
      conePositions[vi++] = ocx + (u1x * cosA + u2x * sinA) * outerR;
      conePositions[vi++] = ocy + (u1y * cosA + u2y * sinA) * outerR;
      conePositions[vi++] = ocz + (u1z * cosA + u2z * sinA) * outerR;
    }
    // Zero out any remaining
    while (vi < conePositions.length) conePositions[vi++] = 0;

    coneMesh.geometry.attributes.position.needsUpdate = true;
    coneMesh.geometry.computeBoundingSphere();
    coneMesh.visible = true;
  }

  // Impact velocity
  const vyImpact = vy - G * tImpact;
  const speedImpact = Math.sqrt(vx * vx + vyImpact * vyImpact + vz * vz);

  // Impact angle relative to surface normal
  let impactAngle;
  const surface = hit.surface;
  if (surface === 'ceiling') {
    // Normal is (0, -1, 0)
    impactAngle = Math.acos(Math.abs(vyImpact) / speedImpact);
  } else if (surface === 'floor') {
    impactAngle = Math.acos(Math.abs(vyImpact) / speedImpact);
  } else if (surface === 'wall-x0' || surface === 'wall-xW') {
    impactAngle = Math.acos(Math.abs(vx) / speedImpact);
  } else if (surface === 'wall-z0' || surface === 'wall-zD') {
    impactAngle = Math.acos(Math.abs(vz) / speedImpact);
  } else {
    impactAngle = 0;
  }

  // Arc sag at midpoint (max deviation from straight line)
  const tMid = tImpact / 2;
  const straightMidY = nozzle.y + H * 0.5;
  const arcMidY = nozzle.y + vy * tMid - 0.5 * G * tMid * tMid;
  const sag = Math.abs(arcMidY - straightMidY);

  // Cone radius at impact distance
  const totalDist = Math.sqrt(R * R + H * H);
  const halfAngleDeg = 8 * 2 / 2 * Math.sqrt(100 / sprayPSI); // waterRadius=2 default
  const halfAngleRad = halfAngleDeg * Math.PI / 180;
  const coneRadius = totalDist * Math.tan(halfAngleRad);

  // Effective fraction: perpendicularity × gravity dropout
  const perpFraction = Math.cos(impactAngle);
  const dropoutFraction = coneRadius > 0.01 ? Math.max(0, 1 - sag / coneRadius) : 1;
  const effectiveFraction = perpFraction * dropoutFraction;

  const info = {
    exitVelocity: v0,
    launchAngle: theta * 180 / Math.PI,
    impactAngle: impactAngle * 180 / Math.PI,
    effectiveFraction,
    perpFraction,
    dropoutFraction,
    range: R,
    totalDist,
    sag,
    coneRadius,
    reachable: true,
  };
  _updateOverlay(info);
  lastInfo = info;
  return info;
}

function _drawStraightLine(nozzle, target) {
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const t = i / ARC_SEGMENTS;
    const off = i * 3;
    arcPositions[off] = nozzle.x + (target.x - nozzle.x) * t;
    arcPositions[off + 1] = nozzle.y + (target.y - nozzle.y) * t;
    arcPositions[off + 2] = nozzle.z + (target.z - nozzle.z) * t;
  }
  arcLine.geometry.attributes.position.needsUpdate = true;
  arcLine.geometry.computeBoundingSphere();
  arcLine.geometry.setDrawRange(0, ARC_SEGMENTS + 1);
  arcLine.visible = true;
}

// ── Debug overlay ────────────────────────────────────────

function _ensureOverlay() {
  if (debugOverlay) return;
  debugOverlay = document.createElement('div');
  debugOverlay.id = 'arc-debug-overlay';
  debugOverlay.style.cssText = `
    position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.75); color: #0f8; font: 11px/1.4 monospace;
    padding: 6px 12px; border-radius: 4px; z-index: 100;
    pointer-events: none; white-space: pre;
  `;
  document.body.appendChild(debugOverlay);
}

function _updateOverlay(info) {
  if (!enabled) {
    if (debugOverlay) debugOverlay.style.display = 'none';
    return;
  }
  _ensureOverlay();
  if (!info) {
    debugOverlay.style.display = 'none';
    return;
  }
  debugOverlay.style.display = 'block';
  const lines = [
    `v₀: ${info.exitVelocity.toFixed(1)} ft/s   range: ${info.range.toFixed(1)} ft`,
  ];
  if (info.reachable) {
    lines.push(`launch: ${info.launchAngle.toFixed(1)}°   impact: ${info.impactAngle.toFixed(1)}° from normal`);
    lines.push(`perp: ${(info.perpFraction * 100).toFixed(0)}%   dropout: ${(info.dropoutFraction * 100).toFixed(0)}%   effective: ${(info.effectiveFraction * 100).toFixed(0)}%`);
    lines.push(`sag: ${info.sag.toFixed(2)} ft   cone ø: ${(info.coneRadius * 2).toFixed(2)} ft`);
  } else {
    lines.push('OUT OF RANGE');
  }
  // Surface area info from projected disc
  const si = getSprayInfo();
  if (si) {
    lines.push(`───── surface ─────`);
    lines.push(`projected: ${si.projectedArea.toFixed(2)} ft²   ideal: ${si.idealArea.toFixed(2)} ft²`);
    lines.push(`area ratio: ${(si.areaRatio * 100).toFixed(0)}%   attack: ${si.impactAngle.toFixed(1)}°   eff: ${(si.effectiveFraction * 100).toFixed(0)}%`);
  }
  debugOverlay.textContent = lines.join('\n');
}

// ── Toggle ───────────────────────────────────────────────

export function toggleArcDebug() {
  enabled = !enabled;
  if (!enabled) {
    if (arcLine) arcLine.visible = false;
    if (coneMesh) coneMesh.visible = false;
    if (debugOverlay) debugOverlay.style.display = 'none';
    lastInfo = null;
  }
}

export function isArcDebugEnabled() { return enabled; }
export function getArcDebugInfo() { return lastInfo; }
