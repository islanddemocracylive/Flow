/**
 * First-person camera controller.
 *
 * Desktop: WASD/Arrow keys to move, right-click drag to look.
 * Mobile: Left joystick to move, right joystick to look.
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
const JOYSTICK_RADIUS = 50;     // half of 100px ring — matches CSS
const LOOK_JOYSTICK_SPEED = 2.0; // radians/sec at full deflection

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

// Virtual joystick state
let moveJoystickId = -1;
let moveJoystickX = 0;   // -1..1 normalized
let moveJoystickY = 0;

let lookJoystickId = -1;
let lookJoystickX = 0;
let lookJoystickY = 0;

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

// ── Keyboard handlers ────────────────────────────────────

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

// ── Mouse handlers (desktop) ─────────────────────────────

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

// ── Virtual joystick setup ───────────────────────────────

function setupJoystick(elementId, isMove) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const thumb = el.querySelector('.joystick-thumb');
  const ring = el.querySelector('.joystick-ring');

  function getCenter() {
    const rect = ring.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  el.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = e.changedTouches[0];
    if (isMove && moveJoystickId === -1) {
      moveJoystickId = t.identifier;
    } else if (!isMove && lookJoystickId === -1) {
      lookJoystickId = t.identifier;
    }
  }, { passive: false });

  // Track on document so finger can slide outside the joystick element
  document.addEventListener('touchmove', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const activeId = isMove ? moveJoystickId : lookJoystickId;
      if (t.identifier !== activeId) continue;

      const center = getCenter();
      let dx = t.clientX - center.x;
      let dy = t.clientY - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clamped = Math.min(dist, JOYSTICK_RADIUS);
      if (dist > 0) { dx = (dx / dist) * clamped; dy = (dy / dist) * clamped; }
      const normX = dx / JOYSTICK_RADIUS;
      const normY = dy / JOYSTICK_RADIUS;

      if (isMove) { moveJoystickX = normX; moveJoystickY = normY; }
      else { lookJoystickX = normX; lookJoystickY = normY; }

      if (thumb) {
        thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      }
    }
  }, { passive: true });

  function endTouch(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (isMove && t.identifier === moveJoystickId) {
        moveJoystickId = -1; moveJoystickX = 0; moveJoystickY = 0;
      } else if (!isMove && t.identifier === lookJoystickId) {
        lookJoystickId = -1; lookJoystickX = 0; lookJoystickY = 0;
      }
      if (thumb) thumb.style.transform = 'translate(-50%, -50%)';
    }
  }
  document.addEventListener('touchend', endTouch, { passive: true });
  document.addEventListener('touchcancel', endTouch, { passive: true });
}

setupJoystick('joystick-left', true);
setupJoystick('joystick-right', false);

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

  if (fpClock) fpClock.getDelta();
}

export function disableFPCamera() {
  if (!fpEnabled || !renderer) return;
  fpEnabled = false;
  keysPressed.clear();
  lookDragging = false;
  moveJoystickId = -1; moveJoystickX = 0; moveJoystickY = 0;
  lookJoystickId = -1; lookJoystickX = 0; lookJoystickY = 0;

  renderer.domElement.removeEventListener('contextmenu', onContextMenu);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('keyup', onKeyUp);
  renderer.domElement.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
}

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

  // Look joystick rotation
  if (lookJoystickX !== 0 || lookJoystickY !== 0) {
    fpYaw += lookJoystickX * LOOK_JOYSTICK_SPEED * dt;
    fpPitch -= lookJoystickY * LOOK_JOYSTICK_SPEED * dt;
    fpPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, fpPitch));
  }

  const forwardX = -Math.sin(fpYaw);
  const forwardZ = -Math.cos(fpYaw);
  const rightX = Math.cos(fpYaw);
  const rightZ = -Math.sin(fpYaw);

  let moveX = 0, moveZ = 0;
  // Keyboard movement
  if (keysPressed.has('arrowup') || keysPressed.has('w'))    { moveX += forwardX; moveZ += forwardZ; }
  if (keysPressed.has('arrowdown') || keysPressed.has('s'))  { moveX -= forwardX; moveZ -= forwardZ; }
  if (keysPressed.has('arrowleft') || keysPressed.has('a'))  { moveX -= rightX;   moveZ -= rightZ;   }
  if (keysPressed.has('arrowright') || keysPressed.has('d')) { moveX += rightX;   moveZ += rightZ;   }
  // Joystick movement (Y inverted: screen-down = backward)
  moveX += forwardX * (-moveJoystickY) + rightX * moveJoystickX;
  moveZ += forwardZ * (-moveJoystickY) + rightZ * moveJoystickX;

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

/**
 * Get the nozzle position in world space.
 * The nozzle orbits around the player at a fixed radius, always pointing
 * toward the spray target. This models the firefighter rotating the hose
 * to aim — the nozzle tip follows the aim direction, not the body facing.
 *
 * @param {number} targetX - world X of spray target
 * @param {number} targetY - world Y of spray target
 * @param {number} targetZ - world Z of spray target
 */
const NOZZLE_FORWARD = 1.5;  // ft in front of body (horizontal orbit radius)
const NOZZLE_DROP = 1.5;     // ft below eye level
export function getNozzlePosition(targetX, targetY, targetZ) {
  if (!fpPosition) return { x: 0, y: EYE_HEIGHT - NOZZLE_DROP, z: 0 };

  const nozzleY = fpPosition.y - NOZZLE_DROP;

  if (targetX == null) {
    // No target — use look direction as fallback
    const fx = -Math.sin(fpYaw);
    const fz = -Math.cos(fpYaw);
    return {
      x: fpPosition.x + fx * NOZZLE_FORWARD,
      y: nozzleY,
      z: fpPosition.z + fz * NOZZLE_FORWARD,
    };
  }

  // Direction from player body to target (horizontal only for the orbit)
  let dx = targetX - fpPosition.x;
  let dz = targetZ - fpPosition.z;
  const hLen = Math.sqrt(dx * dx + dz * dz);
  if (hLen < 0.01) {
    // Target directly above/below — use look direction
    const fx = -Math.sin(fpYaw);
    const fz = -Math.cos(fpYaw);
    return {
      x: fpPosition.x + fx * NOZZLE_FORWARD,
      y: nozzleY,
      z: fpPosition.z + fz * NOZZLE_FORWARD,
    };
  }
  dx /= hLen;
  dz /= hLen;

  return {
    x: fpPosition.x + dx * NOZZLE_FORWARD,
    y: nozzleY,
    z: fpPosition.z + dz * NOZZLE_FORWARD,
  };
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
