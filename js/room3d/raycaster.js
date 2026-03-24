/**
 * Ceiling plane raycasting for water spray targeting in 3D view.
 */

import { ROOM_W, ROOM_D, ROOM_H } from '../constants.js';
import { scene, camera, renderer } from './scene.js';

const raycaster = typeof THREE !== 'undefined' ? new THREE.Raycaster() : null;
const ndcMouse = typeof THREE !== 'undefined' ? new THREE.Vector2() : null;
const ceilingPlane = typeof THREE !== 'undefined'
  ? new THREE.Plane(new THREE.Vector3(0, -1, 0), ROOM_H)
  : null;
const rayHitPoint = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;

export function raycastCeiling(clientX, clientY) {
  if (!raycaster || !renderer) return null;

  const rect = renderer.domElement.getBoundingClientRect();
  ndcMouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndcMouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndcMouse, camera);

  const hit = raycaster.ray.intersectPlane(ceilingPlane, rayHitPoint);
  if (hit && hit.x >= 0 && hit.x <= ROOM_W && hit.z >= 0 && hit.z <= ROOM_D) {
    return { worldX: hit.x, worldZ: hit.z };
  }
  return null;
}

// Water spray visual indicator – elliptical shape built in XZ plane (ceiling).
// We rebuild geometry each frame to avoid scale+quaternion interaction issues.
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
    depthTest: false,
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

/**
 * Build an ellipse fan directly in world XZ at the given position.
 * majorR along sprayAngle direction, minorR perpendicular to it.
 */
function buildEllipseGeometry(worldX, worldZ, majorR, minorR, sprayAngle) {
  const cosA = Math.cos(sprayAngle);
  const sinA = Math.sin(sprayAngle);

  // Center vertex at (0, 0, 0) — we position via mesh.position
  _ellipsePositions[0] = 0;
  _ellipsePositions[1] = 0;
  _ellipsePositions[2] = 0;

  for (let i = 0; i < SPRAY_SEGMENTS; i++) {
    const t = (i / SPRAY_SEGMENTS) * Math.PI * 2;
    // Ellipse point in local spray coords (major along X, minor along Z)
    const lx = Math.cos(t) * majorR;
    const lz = Math.sin(t) * minorR;
    // Rotate to world XZ by sprayAngle
    const wx = lx * cosA - lz * sinA;
    const wz = lx * sinA + lz * cosA;
    const off = (i + 1) * 3;
    _ellipsePositions[off]     = wx;
    _ellipsePositions[off + 1] = 0;
    _ellipsePositions[off + 2] = wz;
  }

  const geo = sprayIndicator.geometry;
  geo.setAttribute('position', new THREE.BufferAttribute(_ellipsePositions, 3));
  geo.setIndex(_ellipseIndices);
  geo.attributes.position.needsUpdate = true;
  geo.computeBoundingSphere();
}

/**
 * Show the spray indicator with elliptical shape.
 * params: { majorR, minorR, sprayAngle, strengthFactor } from sim.getSprayParams()
 */
export function showWaterSpray(worldX, worldZ, params) {
  if (!sprayIndicator) return;
  if (!params) {
    sprayIndicator.visible = false;
    return;
  }
  sprayIndicator.position.set(worldX, ROOM_H - 0.02, worldZ);
  sprayIndicator.scale.set(1, 1, 1);
  sprayIndicator.quaternion.identity();
  buildEllipseGeometry(worldX, worldZ, params.majorR, params.minorR, params.sprayAngle);
  // Fade opacity with distance
  sprayMat.opacity = 0.15 + 0.35 * params.strengthFactor;
  sprayIndicator.visible = true;
}

export function hideWaterSpray() {
  if (sprayIndicator) sprayIndicator.visible = false;
}
