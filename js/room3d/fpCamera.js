/**
 * First-person camera controller.
 *
 * Arrow keys / on-screen D-pad: forward/back/strafe
 * Left-click+drag: look around (yaw + pitch)
 * Mobile 1-finger drag: look around
 * Camera always at eye level (6ft), anchored to ground.
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

// Left-click drag state for look
let lookDragging = false;
let lookLastX = 0;
let lookLastY = 0;

// Mobile 1-finger look state
let touchLookActive = false;
let touchLookLastX = 0;
let touchLookLastY = 0;
let touchLookId = -1; // track which touch is the look touch

// Clock for deltaTime
const fpClock = typeof THREE !== 'undefined' ? new THREE.Clock() : null;

// Track whether we've set the starting position
let startPositionComputed = false;
let lastVentKeyForStart = '';

// ── Event listeners ─────────────────────────────────────────

if (renderer) {
  // Suppress context menu on 3D canvas (right-click is water spray)
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      // Don't capture if focus is on an input element (admin panel sliders)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      e.preventDefault();
      keysPressed.add(e.key);
    }
  });

  document.addEventListener('keyup', (e) => {
    keysPressed.delete(e.key);
  });

  // Left-click look
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      lookDragging = true;
      lookLastX = e.clientX;
      lookLastY = e.clientY;
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!lookDragging) return;
    const dx = e.clientX - lookLastX;
    const dy = e.clientY - lookLastY;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    fpYaw -= dx * LOOK_SENSITIVITY;
    fpPitch -= dy * LOOK_SENSITIVITY;
    fpPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, fpPitch));
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) lookDragging = false;
  });

  // Mobile 1-finger look (single finger drags to look around)
  renderer.domElement.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchLookActive = true;
      touchLookId = e.touches[0].identifier;
      touchLookLastX = e.touches[0].clientX;
      touchLookLastY = e.touches[0].clientY;
    }
  }, { passive: true });

  renderer.domElement.addEventListener('touchmove', (e) => {
    if (!touchLookActive) return;
    // Find our tracked touch
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === touchLookId) {
        const t = e.touches[i];
        const dx = t.clientX - touchLookLastX;
        const dy = t.clientY - touchLookLastY;
        touchLookLastX = t.clientX;
        touchLookLastY = t.clientY;
        fpYaw += dx * LOOK_SENSITIVITY;
        fpPitch += dy * LOOK_SENSITIVITY;
        fpPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, fpPitch));
        break;
      }
    }
    // If a second finger arrives, cancel look (2-finger = water spray)
    if (e.touches.length >= 2) {
      touchLookActive = false;
      touchLookId = -1;
    }
  }, { passive: true });

  renderer.domElement.addEventListener('touchend', (e) => {
    // Check if our tracked touch is gone
    let found = false;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === touchLookId) { found = true; break; }
    }
    if (!found) {
      touchLookActive = false;
      touchLookId = -1;
    }
  }, { passive: true });
}

// ── On-screen D-pad support ──────────────────────────────────

// Arrow buttons fire synthetic key presses
function setupDpadButton(id, key) {
  const btn = document.getElementById(id);
  if (!btn) return;

  function startPress(e) {
    e.preventDefault();
    keysPressed.add(key);
  }
  function endPress(e) {
    e.preventDefault();
    keysPressed.delete(key);
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
    // Default: outside back wall, facing room
    fpPosition.set(ROOM_W / 2, EYE_HEIGHT, ROOM_D + 5);
    fpYaw = 0;
    return;
  }

  const door = doors[0];
  const STANDOFF = 2;

  if (door.wall === 'far') {
    fpPosition.set(door.x + 0.5, EYE_HEIGHT, -STANDOFF);
    fpYaw = Math.PI; // face +z (into room)
  } else if (door.wall === 'back') {
    fpPosition.set(door.x + 0.5, EYE_HEIGHT, ROOM_D + STANDOFF);
    fpYaw = 0; // face -z (into room)
  } else if (door.wall === 'left') {
    fpPosition.set(-STANDOFF, EYE_HEIGHT, door.y + 0.5);
    fpYaw = -Math.PI / 2; // face +x (into room)
  } else if (door.wall === 'right') {
    fpPosition.set(ROOM_W + STANDOFF, EYE_HEIGHT, door.y + 0.5);
    fpYaw = Math.PI / 2; // face -x (into room)
  }

  fpPitch = 0;
}

// ── Per-frame update ──────────────────────────────────────

export function updateCamera(sim) {
  if (!camera || !fpPosition || !fpClock) return;

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

  // Forward vector on XZ plane (ignoring pitch)
  const forwardX = -Math.sin(fpYaw);
  const forwardZ = -Math.cos(fpYaw);
  // Right (strafe) vector
  const rightX = Math.cos(fpYaw);
  const rightZ = -Math.sin(fpYaw);

  let moveX = 0, moveZ = 0;
  if (keysPressed.has('ArrowUp'))    { moveX += forwardX; moveZ += forwardZ; }
  if (keysPressed.has('ArrowDown'))  { moveX -= forwardX; moveZ -= forwardZ; }
  if (keysPressed.has('ArrowLeft'))  { moveX -= rightX;   moveZ -= rightZ;   }
  if (keysPressed.has('ArrowRight')) { moveX += rightX;   moveZ += rightZ;   }

  // Normalize diagonal movement
  const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (moveLen > 0) {
    moveX = (moveX / moveLen) * MOVE_SPEED * dt;
    moveZ = (moveZ / moveLen) * MOVE_SPEED * dt;

    let newX = fpPosition.x + moveX;
    let newZ = fpPosition.z + moveZ;

    // Wall collision
    const resolved = resolveCollision(newX, newZ, fpPosition.x, fpPosition.z, sim);
    newX = resolved.x;
    newZ = resolved.z;

    // Soft bounds (don't wander too far outside)
    newX = Math.max(-BOUNDS_MARGIN, Math.min(ROOM_W + BOUNDS_MARGIN, newX));
    newZ = Math.max(-BOUNDS_MARGIN, Math.min(ROOM_D + BOUNDS_MARGIN, newZ));

    fpPosition.x = newX;
    fpPosition.z = newZ;
  }

  // Always at eye height
  fpPosition.y = EYE_HEIGHT;

  // Apply camera transform
  camera.position.copy(fpPosition);

  // Look-at target from yaw + pitch
  const lookX = fpPosition.x + forwardX * Math.cos(fpPitch);
  const lookY = fpPosition.y + Math.sin(fpPitch);
  const lookZ = fpPosition.z + forwardZ * Math.cos(fpPitch);
  camera.lookAt(lookX, lookY, lookZ);
}

/**
 * Reposition camera outside the first door (called when doors change).
 */
export function resetToStart(sim) {
  computeStartPosition(sim);
}

/**
 * Return player position {x, y, z} for spray distance calculations.
 */
export function getPlayerPosition() {
  if (!fpPosition) return { x: 0, y: EYE_HEIGHT, z: 0 };
  return { x: fpPosition.x, y: fpPosition.y, z: fpPosition.z };
}
