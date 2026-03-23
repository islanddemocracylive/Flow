/**
 * Wall collision detection for first-person movement.
 *
 * Uses simple axis-aligned collision against room walls.
 * Movement is blocked by walls but allowed through door openings.
 * Each axis is resolved independently for natural wall-sliding.
 */

import { ROOM_W, ROOM_D, DOOR_W } from '../constants.js';

const PLAYER_RADIUS = 0.4; // collision radius in feet

/**
 * Resolve movement so the player doesn't pass through walls.
 * Returns the adjusted position { x, z }.
 *
 * @param {number} newX - desired X position
 * @param {number} newZ - desired Z position
 * @param {number} oldX - current X position
 * @param {number} oldZ - current Z position
 * @param {object} sim - FireSimulation instance (for door data)
 */
export function resolveCollision(newX, newZ, oldX, oldZ, sim) {
  const doors = sim ? sim.vents.filter(v => v.type === 'door') : [];

  // Resolve X axis
  let resolvedX = newX;
  // Left wall (x = 0)
  if (newX - PLAYER_RADIUS < 0) {
    if (!isInDoorOpening('left', newZ, doors)) {
      resolvedX = PLAYER_RADIUS;
    }
  }
  // Right wall (x = ROOM_W)
  if (newX + PLAYER_RADIUS > ROOM_W) {
    if (!isInDoorOpening('right', newZ, doors)) {
      resolvedX = ROOM_W - PLAYER_RADIUS;
    }
  }

  // Resolve Z axis
  let resolvedZ = newZ;
  // Far wall (z = 0)
  if (newZ - PLAYER_RADIUS < 0) {
    if (!isInDoorOpening('far', resolvedX, doors)) {
      resolvedZ = PLAYER_RADIUS;
    }
  }
  // Back wall (z = ROOM_D)
  if (newZ + PLAYER_RADIUS > ROOM_D) {
    if (!isInDoorOpening('back', resolvedX, doors)) {
      resolvedZ = ROOM_D - PLAYER_RADIUS;
    }
  }

  return { x: resolvedX, z: resolvedZ };
}

/**
 * Check if a position is aligned with a door opening on a given wall.
 *
 * For far/back walls, `pos` is the X coordinate.
 * For left/right walls, `pos` is the Z coordinate.
 */
function isInDoorOpening(wallName, pos, doors) {
  const wallDoors = doors.filter(d => d.wall === wallName);
  for (const door of wallDoors) {
    // Door center in world coordinates
    let doorCenter;
    if (wallName === 'far' || wallName === 'back') {
      doorCenter = door.x + 0.5;
    } else {
      doorCenter = door.y + 0.5;
    }
    const halfW = DOOR_W / 2;
    if (pos >= doorCenter - halfW + PLAYER_RADIUS && pos <= doorCenter + halfW - PLAYER_RADIUS) {
      return true;
    }
  }
  return false;
}
