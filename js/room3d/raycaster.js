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
    return { gridX: Math.floor(hit.x), gridY: Math.floor(hit.z) };
  }
  return null;
}

// Water spray visual indicator – elliptical shape
let sprayIndicator = null;

if (scene) {
  const sprayGeo = new THREE.CircleGeometry(1, 32);
  const sprayMat = new THREE.MeshBasicMaterial({
    color: 0x44aaff,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  sprayIndicator = new THREE.Mesh(sprayGeo, sprayMat);
  sprayIndicator.renderOrder = 999;
  sprayIndicator.visible = false;
  scene.add(sprayIndicator);
}

/**
 * Show the spray indicator with elliptical shape.
 * params: { majorR, minorR, sprayAngle, strengthFactor } from sim.getSprayParams()
 */
export function showWaterSpray(gridX, gridY, params) {
  if (!sprayIndicator) return;
  if (!params) {
    sprayIndicator.visible = false;
    return;
  }
  sprayIndicator.position.set(gridX + 0.5, ROOM_H - 0.02, gridY + 0.5);
  sprayIndicator.scale.set(params.majorR, params.minorR, 1);
  // Lay flat on ceiling (rotate -90° around X), then rotate around world Y
  // for spray direction. Negate angle because Three.js Y rotation goes
  // from +X toward -Z (right-hand rule), but sprayAngle=atan2(dz,dx)
  // points from +X toward +Z.
  const qFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const qDir = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -params.sprayAngle);
  sprayIndicator.quaternion.copy(qDir.multiply(qFlat));
  // Fade opacity with distance
  sprayIndicator.material.opacity = 0.15 + 0.35 * params.strengthFactor;
  sprayIndicator.visible = true;
}

export function hideWaterSpray() {
  if (sprayIndicator) sprayIndicator.visible = false;
}
