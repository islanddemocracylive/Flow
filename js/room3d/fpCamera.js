/**
 * First-person camera controller.
 *
 * Desktop: WASD/Arrow keys to move, right-click drag to look.
 * Mobile: D-pad (bottom-left) to move, right-side touch-drag to look.
 * Camera always at eye level (5.5ft), anchored to ground.
 *
 * Must call enableFPCamera() to activate — starts disabled so the admin
 * orbit view isn't disrupted.
 */

import { ROOM_W, ROOM_D, ROOM_H } from '../constants.js';
import { camera, renderer } from './scene.js';
import { resolveCollision } from './collision.js';

const EYE_HEIGHT = 5.5;
const MOVE_SPEED = 5;           // ft/sec
const LOOK_SENSITIVITY = 0.003; // radians/pixel
const PITCH_LIMIT = Math.PI / 3; // 60° up/down
const BOUNDS_MARGIN = 10;       // max distance outside room

// Camera state
let fpYaw = 0;
let fpPitch = 0;
const fpPosition = typeof THREE !== 'undefined'
  ? new THREE.Vector3(ROOM_W / 2, EYE_HEIGHT, ROOM_D + 5)
  : null;

const keysPressed = new Set();

// Right-click drag state for look (desktop)
let lookDragging = false;
let lookLastX = 0;
let lookLastY = 0;

// Touch look state — any single-finger touch on the right half of screen
let touchLookId = -1;
let touchLookLastX = 0;
let touchLookLastY = 0;

// Clock for deltaTime
const fpClock = typeof THREE !== 'undefined' ? new THREE.Clock() : null;

// Track whether we've set the starting position
let startPositionComputed = false;
let lastVentKeyForStart = '';

// Whether FP camera is active (listeners attached)
let fpEnabled = false;

// Spray edge-scroll
let sprayEdgeActive = false;
let sprayEdgeNdcX = 0;
let sprayEdgeNdcY = 0;
const EDGE_DEAD_ZONE = 0.4;
const EDGE_TURN_SPEED = 1.0;

// ── Event handler functions ──────────────────────────────

function onKeyDown(e) {
  const key = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(key)) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    e.preventDefault();
    keysPressed.add(key.toLowerCase());
  }
}

function onKeyUp(e) {
  keysPressed.delete(e.key.toLowerCase());
}

function onMouseDown(e) {
  if (e.button === 2) {
    lookDragging = true;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
  }
}

function onMouseMove(e) {
  if (!lookDragging) return;
  const dx = e.clientX - lookLastX;
  const dy = e.clientY - lookLastY;
  lookLastX = e.clientX;
  lookLastY = e.clientY;
  fpYaw -= dx * LOOK_SENSITIVITY;
  fpPitch -= dy * LOOK_SENSITIVITY;
  fpPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, fpPitch));
}

function onMouseUp(e) {
  if (e.button === 2) lookDragging = false;
}

function onContextMenu(e) {
  e.preventDefault();
}

// Touch look: any finger on the right half of the screen (excluding spray button area)
function isLookTouch(touch) {
  return touch.clientX > window.innerWidth * 0.35;
}

function onTouchStart(e) {
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i];
    if (touchLookId === -1 && isLookTouch(t)) {
      // Check it's not on the spray button or dpad
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && (el.id === 'spray-btn' || el.classList.contains('dpad-btn'))) continue;
      touchLookId = t.identifier;
      touchLookLastX = t.clientX;
      touchLookLastY = t.clientY;
    }
  }
}

function onTouchMove(e) {
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i];
    if (t.identifier === touchLookId) {
      const dx = t.clientX - touchLookLastX;
      const dy = t.clientY - touchLookLastY;
      touchLookLastX = t.clientX;
      touchLookLastY = t.clientY;
      fpYaw += dx * LOOK_SENSITIVITY;
      fpPitch += dy * LOOK_SENSITIVITY;
      fpPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, fpPitch));
    }
  }
}

function onTouchEnd(e) {
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === touchLookId) {
      touchLookId = -1;
    }
  }
}

// ── Enable / Disable ─────────────────────────────────────

export function enableFPCamera() {
  if (fpEnabled || !renderer) return;
  fpEnabled = true;

  renderer.domElement.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true });
  renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: true });
  renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: true });

  // Reset clock so first getDelta isn't huge
  if (fpClock) fpClock.getDelta();
}

export function disableFPCamera() {
  if (!fpEnabled || !renderer) return;
  fpEnabled = false;
  keysPressed.clear();
  lookDragging = false;
  touchLookId = -1;

  renderer.domElement.removeEventListener('contextmenu', onContextMenu);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  renderer.domElement.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  renderer.domElement.removeEventListener('touchstart', onTouchStart);
  renderer.domElement.removeEventListener('touchmove', onTouchMove);
  renderer.domElement.removeEventListener('touchend', onTouchEnd);
}

// ── On-screen D-pad support ──────────────────────────────────

function setupDpadButton(id, key) {
  const btn = document.getElementById(id);
  if (!btn) return;

  function startPress(e) {
    e.preventDefault();
    e.stopPropagation(); // prevent touch from reaching canvas look handler
    keysPressed.add(key.toLowerCase());
  }
  function endPress(e) {
    e.preventDefault();
    e.stopPropagation();
    keysPressed.delete(key.toLowerCase());
  }

  btn.addEventListener('mousedown', startPress);
  btn.addEventListener('mouseup', endPress);
  btn.addEventListener('mouseleave', endPress);
  btn.addEventListener('touchstart', startPress, { passive: false });
  btn.addEventListener('touchend', endPress, { passive: false });
  btn.addEventListener('touchcancel', endPress, { passive: false });
}

setupDpadButton('dpad-up', 'ArrowUp');
setupDpadButton('dpad-down', 'ArrowDown');
setupDpadButton('dpad-left', 'ArrowLeft');
setupDpadButton('dpad-right', 'ArrowRight');

// ── Starting position based on door placement ─────────────

function computeStartPosition(sim) {
  if (!sim || !fpPosition) return;

  const doors = sim.vents.filter(v => v.type === 'door');
  if (doors.length === 0) {
    fpPosition.set(ROOM_W / 2, EYE_HEIGHT, ROOM_D + 5);
    fpYaw = 0;
    return;
  }

  const door = doors[0];
  const STANDOFF = 2;

  if (door.wall === 'far') {
    fpPosition.set(door.x + 0.5, EYE_HEIGHT, -STANDOFF);
    fpYaw = Math.PI;
  } else if (door.wall === 'back') {
    fpPosition.set(door.x + 0.5, EYE_HEIGHT, ROOM_D + STANDOFF);
    fpYaw = 0;
  } else if (door.wall === 'left') {
    fpPosition.set(-STANDOFF, EYE_HEIGHT, door.y + 0.5);
    fpYaw = -Math.PI / 2;
  } else if (door.wall === 'right') {
    fpPosition.set(ROOM_W + STANDOFF, EYE_HEIGHT, door.y + 0.5);
    fpYaw = Math.PI / 2;
  }

  fpPitch = 0;
}

// ── Per-frame update ──────────────────────────────────────

export function updateCamera(sim) {
  if (!camera || !fpPosition || !fpClock || !fpEnabled) return;

  // Recompute start position when vents change
  const ventKey = sim ? JSON.stringify(sim.vents) : '';
  if (ventKey !== lastVentKeyForStart) {
    lastVentKeyForStart = ventKey;
    if (!startPositionComputed) {
      computeStartPosition(sim);
      startPositionComputed = true;
    }
  }

  const dt = fpClock.getDelta();

  const forwardX = -Math.sin(fpYaw);
  const forwardZ = -Math.cos(fpYaw);
  const rightX = Math.cos(fpYaw);
  const rightZ = -Math.sin(fpYaw);

  let moveX = 0, moveZ = 0;
  if (keysPressed.has('arrowup') || keysPressed.has('w'))    { moveX += forwardX; moveZ += forwardZ; }
  if (keysPressed.has('arrowdown') || keysPressed.has('s'))  { moveX -= forwardX; moveZ -= forwardZ; }
  if (keysPressed.has('arrowleft') || keysPressed.has('a'))  { moveX -= rightX;   moveZ -= rightZ;   }
  if (keysPressed.has('arrowright') || keysPressed.has('d')) { moveX += rightX;   moveZ += rightZ;   }

  const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (moveLen > 0) {
    moveX = (moveX / moveLen) * MOVE_SPEED * dt;
    moveZ = (moveZ / moveLen) * MOVE_SPEED * dt;

    let newX = fpPosition.x + moveX;
    let newZ = fpPosition.z + moveZ;

    const resolved = resolveCollision(newX, newZ, fpPosition.x, fpPosition.z, sim);
    newX = resolved.x;
    newZ = resolved.z;

    newX = Math.max(-BOUNDS_MARGIN, Math.min(ROOM_W + BOUNDS_MARGIN, newX));
    newZ = Math.max(-BOUNDS_MARGIN, Math.min(ROOM_D + BOUNDS_MARGIN, newZ));

    fpPosition.x = newX;
    fpPosition.z = newZ;
  }

  fpPosition.y = EYE_HEIGHT;

  // Edge-scroll: gently rotate view toward spray when near screen edges
  if (sprayEdgeActive) {
    const absX = Math.abs(sprayEdgeNdcX);
    if (absX > EDGE_DEAD_ZONE) {
      const t = (absX - EDGE_DEAD_ZONE) / (1 - EDGE_DEAD_ZONE);
      fpYaw -= Math.sign(sprayEdgeNdcX) * t * EDGE_TURN_SPEED * dt;
    }
    const absY = Math.abs(sprayEdgeNdcY);
    if (absY > EDGE_DEAD_ZONE) {
      const t = (absY - EDGE_DEAD_ZONE) / (1 - EDGE_DEAD_ZONE);
      fpPitch += Math.sign(sprayEdgeNdcY) * t * EDGE_TURN_SPEED * dt;
      fpPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, fpPitch));
    }
  }

  camera.position.copy(fpPosition);

  const lookX = fpPosition.x + forwardX * Math.cos(fpPitch);
  const lookY = fpPosition.y + Math.sin(fpPitch);
  const lookZ = fpPosition.z + forwardZ * Math.cos(fpPitch);
  camera.lookAt(lookX, lookY, lookZ);
}

export function resetToStart(sim) {
  computeStartPosition(sim);
}

export function getPlayerPosition() {
  if (!fpPosition) return { x: 0, y: EYE_HEIGHT, z: 0 };
  return { x: fpPosition.x, y: fpPosition.y, z: fpPosition.z };
}

/** Call each frame while spraying with the mouse's NDC position (-1..1). */
export function setSprayScreenPosition(ndcX, ndcY) {
  sprayEdgeActive = true;
  sprayEdgeNdcX = ndcX;
  sprayEdgeNdcY = ndcY;
}

/** Call when spraying stops. */
export function clearSprayScreenPosition() {
  sprayEdgeActive = false;
}
