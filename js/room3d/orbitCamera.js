/**
 * Orbit camera controller for admin 3D design view.
 *
 * Uses THREE.OrbitControls to let the user click-drag to rotate
 * around the room and scroll to zoom. The orbit target is the
 * room center.
 */

import { ROOM_W, ROOM_D, ROOM_H } from '../constants.js';
import { camera, renderer } from './scene.js';

let controls = null;

// Saved orbit camera state so we can restore after FP mode
const savedOrbitPos = typeof THREE !== 'undefined'
  ? new THREE.Vector3(ROOM_W + 6, ROOM_H * 0.7, ROOM_D + 8)
  : null;
const savedOrbitTarget = typeof THREE !== 'undefined'
  ? new THREE.Vector3(ROOM_W / 2, ROOM_H * 0.3, ROOM_D / 2)
  : null;

export function initOrbitCamera() {
  if (!renderer || typeof THREE === 'undefined' || typeof THREE.OrbitControls === 'undefined') return;

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.copy(savedOrbitTarget);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 5;
  controls.maxDistance = 50;
  controls.maxPolarAngle = Math.PI * 0.85;

  // Left-click = orbit, middle = pan, scroll = zoom
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  // Set initial camera position
  camera.position.copy(savedOrbitPos);
  controls.update();

  // Start disabled – enableOrbit() will activate
  controls.enabled = false;
}

export function enableOrbit() {
  if (!controls) return;
  // Restore saved orbit camera position
  camera.position.copy(savedOrbitPos);
  controls.target.copy(savedOrbitTarget);
  controls.enabled = true;
  controls.update();
}

export function disableOrbit() {
  if (!controls) return;
  // Save current camera state before switching away
  savedOrbitPos.copy(camera.position);
  savedOrbitTarget.copy(controls.target);
  controls.enabled = false;
}

export function updateOrbit() {
  if (!controls || !controls.enabled) return;
  controls.update();
}
