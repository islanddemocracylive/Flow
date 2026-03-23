/**
 * Wall and obstacle collision detection for first-person movement.
 *
 * Uses simple axis-aligned collision against room walls and obstacle blocks.
 * Movement is blocked by walls but allowed through door openings.
 * Movement is blocked by obstacle cells that have height > 0.
 * Each axis is resolved independently for natural wall-sliding.
 */

import { ROOM_W, ROOM_D, DOOR_W } from '../constants.js';

const PLAYER_RADIUS = 0.4; // collision radius in feet

/**
 * Resolve movement so the player doesn't pass through walls or obstacles.
 * Returns the adjusted position { x, z }.
 */
export function resolveCollision(newX, newZ, oldX, oldZ, sim) {
  const doors = sim ? sim.vents.filter(v => v.type === 'door') : [];

  // Resolve X axis against walls
  let resolvedX = newX;
  if (newX - PLAYER_RADIUS < 0) {
    if (!isInDoorOpening('left', newZ, doors)) {
      resolvedX = PLAYER_RADIUS;
    }
  }
  if (newX + PLAYER_RADIUS > ROOM_W) {
    if (!isInDoorOpening('right', newZ, doors)) {
      resolvedX = ROOM_W - PLAYER_RADIUS;
    }
  }

  // Resolve Z axis against walls
  let resolvedZ = newZ;
  if (newZ - PLAYER_RADIUS < 0) {
    if (!isInDoorOpening('far', resolvedX, doors)) {
      resolvedZ = PLAYER_RADIUS;
    }
  }
  if (newZ + PLAYER_RADIUS > ROOM_D) {
    if (!isInDoorOpening('back', resolvedX, doors)) {
      resolvedZ = ROOM_D - PLAYER_RADIUS;
    }
  }

  // Resolve against obstacles
  if (sim && sim.obstacles) {
    // Check cells the player would overlap
    const minGX = Math.floor(resolvedX - PLAYER_RADIUS);
    const maxGX = Math.floor(resolvedX + PLAYER_RADIUS);
    const minGY = Math.floor(resolvedZ - PLAYER_RADIUS);
    const maxGY = Math.floor(resolvedZ + PLAYER_RADIUS);

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        if (gx < 0 || gx >= sim.cols || gy < 0 || gy >= sim.rows) continue;
        const h = sim.getObstacleHeight(gx, gy);
        if (h <= 0) continue; // no obstacle

        // AABB collision: obstacle occupies [gx, gx+1] x [gy, gy+1]
        // Find closest point on obstacle to player center
        const closestX = Math.max(gx, Math.min(gx + 1, resolvedX));
        const closestZ = Math.max(gy, Math.min(gy + 1, resolvedZ));
        const dx = resolvedX - closestX;
        const dz = resolvedZ - closestZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < PLAYER_RADIUS) {
          if (dist === 0) {
            // Player center is inside obstacle – push out toward old position
            const toOldX = oldX - resolvedX;
            const toOldZ = oldZ - resolvedZ;
            const toOldLen = Math.sqrt(toOldX * toOldX + toOldZ * toOldZ);
            if (toOldLen > 0) {
              resolvedX += (toOldX / toOldLen) * PLAYER_RADIUS;
              resolvedZ += (toOldZ / toOldLen) * PLAYER_RADIUS;
            }
          } else {
            // Push player out along the collision normal
            const pushDist = PLAYER_RADIUS - dist;
            resolvedX += (dx / dist) * pushDist;
            resolvedZ += (dz / dist) * pushDist;
          }
        }
      }
    }
  }

  return { x: resolvedX, z: resolvedZ };
}

function isInDoorOpening(wallName, pos, doors) {
  const wallDoors = doors.filter(d => d.wall === wallName);
  for (const door of wallDoors) {
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
