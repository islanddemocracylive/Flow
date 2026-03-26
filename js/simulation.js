/**
 * Fire & Water Ceiling Simulation Engine
 *
 * Grid-based cellular automaton where each cell holds a heat value [0, 1].
 * Fire spreads to neighbors based on heat diffusion; water suppresses heat.
 *
 * Vent mechanics model real fire dynamics:
 *   - Ceiling vents (holes) allow hot gas to escape (stack/chimney effect)
 *   - Doors allow fresh air intake at floor level
 *   - Airflow creates a directional bias: air enters doors → feeds fire →
 *     hot gas rises → flows along ceiling toward vents → exits
 *   - Fire spreads faster in the direction of airflow (oxygen supply path)
 *
 * Obstacles represent furniture/fixtures that block player movement in 3D.
 * Each obstacle cell has a height (stackable 1ft blocks).
 *
 * Fire start locations define where fire ignites when a scenario is played.
 */

import {
  ROOM_W, ROOM_D, ROOM_H, ROOM_H_M, FT_TO_M,
  GAS_LAYER_MASS, GAS_CP, FLASHOVER_TEMP, REIGNITION_TEMP,
  AMBIENT_TEMP, CELL_HRR_MAX,
  ROOM_AIR_MASS, AMBIENT_O2, O2_FLAMING_LIMIT, O2_LETHAL_LIMIT, O2_PER_MJ,
  DOOR_AREA_M2, DOOR_HEIGHT_M, VENT_AREA_M2,
} from './constants.js';

// Cell states (spec §3.4)
export const CELL_UNIGNITED  = 0;
export const CELL_PREHEATING = 1;
export const CELL_BURNING    = 2;
export const CELL_SUPPRESSED = 3;

export class FireSimulation {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.heat = new Float32Array(cols * rows);           // [0-1] fire intensity (burning cells only)
    this.nextHeat = new Float32Array(cols * rows);
    this.heatExposure = new Float32Array(cols * rows);   // accumulated kJ toward ignition
    this.cellState = new Uint8Array(cols * rows);        // CELL_* state per cell

    // Tunable parameters (set from admin panel)
    this.waterRadius = 2;
    this.sprayPSI = 100;          // nozzle pressure – controls reach & flow rate
    this.growthAlpha = 0.047;     // t² fire growth coefficient (default: fast)

    // Vent mechanics
    this.vents = [];

    // Airflow vector field: (vx, vy) per cell
    this.airflow = new Float32Array(cols * rows * 2);

    // Obstacles: height per cell (0 = no obstacle, 1+ = stacked blocks in feet)
    this.obstacles = new Uint8Array(cols * rows);

    // Moisture: residual wetness per cell [0, 1].
    this.moisture = new Float32Array(cols * rows);

    // Fire start locations: set of grid indices
    this.startLocations = new Set();

    // HRR & gas layer state
    this.simTime = 0;
    this.totalHRR = 0;
    this.gasLayerTemp = AMBIENT_TEMP;
    this.flashedOver = false;
    this.flashoverTimer = 0;

    // Oxygen model
    this.oxygenLevel = AMBIENT_O2;
    this.ventLimited = false;

    // Win/lose
    this.gameState = 'idle';
    this.winTimer = 0;

    // Pre-computed edge multiplier for wall-junction spread bonus
    this._edgeMul = new Float32Array(cols * rows);
    this._computeEdgeMultipliers();
  }

  /** Pre-compute spread multiplier: 2.0× at corners, 1.5× at wall edges, 1.0× interior. */
  _computeEdgeMultipliers() {
    const { cols, rows } = this;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const atLeft = x === 0;
        const atRight = x === cols - 1;
        const atTop = y === 0;
        const atBottom = y === rows - 1;
        const edgeCount = (atLeft ? 1 : 0) + (atRight ? 1 : 0) + (atTop ? 1 : 0) + (atBottom ? 1 : 0);
        // Spec: wall-ceiling junction = 1.5×, corner (two walls) = 2.0× (effectively 0.6× threshold)
        this._edgeMul[y * cols + x] = edgeCount >= 2 ? 2.0 : edgeCount === 1 ? 1.5 : 1.0;
      }
    }
  }

  idx(x, y) {
    return y * this.cols + x;
  }

  reset() {
    this.heat.fill(0);
    this.nextHeat.fill(0);
    this.heatExposure.fill(0);
    this.cellState.fill(CELL_UNIGNITED);
    this.moisture.fill(0);
    this.simTime = 0;
    this.totalHRR = 0;
    this.gasLayerTemp = AMBIENT_TEMP;
    this.flashedOver = false;
    this.flashoverTimer = 0;
    this.oxygenLevel = AMBIENT_O2;
    this.ventLimited = false;
    this.gameState = 'idle';
    this.winTimer = 0;
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.heat = new Float32Array(cols * rows);
    this.nextHeat = new Float32Array(cols * rows);
    this.heatExposure = new Float32Array(cols * rows);
    this.cellState = new Uint8Array(cols * rows);
    this.airflow = new Float32Array(cols * rows * 2);
    this.obstacles = new Uint8Array(cols * rows);
    this.moisture = new Float32Array(cols * rows);
    this.startLocations = new Set();
    this._edgeMul = new Float32Array(cols * rows);
    this._computeEdgeMultipliers();
  }

  ignite(cx, cy, radius = 2) {
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          const strength = 1.0 - (dist / radius) * 0.5;
          const i = this.idx(x, y);
          this.heat[i] = Math.min(1.0, Math.max(this.heat[i], strength));
          this.cellState[i] = CELL_BURNING;
          this.heatExposure[i] = 0;
        }
      }
    }
  }

  /** Ignite all fire start locations (called when playing a scenario) */
  igniteStartLocations() {
    for (const i of this.startLocations) {
      const x = i % this.cols;
      const y = Math.floor(i / this.cols);
      this.ignite(x, y, 2);
    }
  }

  /**
   * Compute spray parameters based on cone geometry from nozzle to a surface.
   *
   * The nozzle produces a cone of water. The spray footprint on any surface is
   * determined by the cone's half-angle and incidence angle against that surface.
   * Spraying perpendicular gives a tight circle; oblique angles elongate into
   * an ellipse as the cone intersects the plane at a slant.
   *
   * Cone half-angle scales inversely with PSI (higher pressure = tighter
   * stream). The Spray Width slider acts as a multiplier on the cone angle.
   *
   * Strength is constant until 70% of max reach, then fades linearly.
   * The cone geometry handles natural per-cell reduction at distance.
   *
   * @param {number} worldX - hit X in room coords
   * @param {number} worldZ - hit Z in room coords
   * @param {{x,y,z}} playerPos - player position in room coords
   * @param {string} [surface='ceiling'] - 'ceiling'|'floor'|'wall-x0'|'wall-xW'|'wall-z0'|'wall-zD'
   * @param {number} [wallY] - y-coordinate of wall hit (only for wall surfaces)
   * @returns {object|null} { majorR, minorR, sprayAngle, strengthFactor, centerOffset, surface }
   */
  getSprayParams(worldX, worldZ, playerPos, surface, wallY) {
    // playerPos is now the nozzle position (from getNozzlePosition)
    const nozzleY = playerPos.y || 4;   // fallback for legacy callers
    if (!surface) surface = 'ceiling';

    // Perpendicular distance from nozzle to the hit surface plane,
    // and the "surface distance" (distance along the surface from the
    // perpendicular foot to the actual hit point).
    let perpDist, surfaceDist, sprayAngle;

    if (surface === 'ceiling') {
      perpDist = ROOM_H - nozzleY;
      const dx = worldX - playerPos.x;
      const dz = worldZ - playerPos.z;
      surfaceDist = Math.sqrt(dx * dx + dz * dz);
      sprayAngle = Math.atan2(dz, dx);
    } else if (surface === 'floor') {
      perpDist = nozzleY;
      const dx = worldX - playerPos.x;
      const dz = worldZ - playerPos.z;
      surfaceDist = Math.sqrt(dx * dx + dz * dz);
      sprayAngle = Math.atan2(dz, dx);
    } else {
      // Wall surfaces
      const wy = (wallY != null) ? wallY : (ROOM_H / 2);
      const dy = wy - nozzleY;

      if (surface === 'wall-x0') {
        perpDist = playerPos.x;
        const dz = worldZ - playerPos.z;
        surfaceDist = Math.sqrt(dy * dy + dz * dz);
        // Spray angle on wall: direction from perpendicular foot to hit point
        // For x-wall, the surface axes are (Z horizontal, Y vertical)
        sprayAngle = Math.atan2(dz, dy);
      } else if (surface === 'wall-xW') {
        perpDist = ROOM_W - playerPos.x;
        const dz = worldZ - playerPos.z;
        surfaceDist = Math.sqrt(dy * dy + dz * dz);
        sprayAngle = Math.atan2(dz, dy);
      } else if (surface === 'wall-z0') {
        perpDist = playerPos.z;
        const dx = worldX - playerPos.x;
        surfaceDist = Math.sqrt(dy * dy + dx * dx);
        // For z-wall, surface axes are (X horizontal, Y vertical)
        sprayAngle = Math.atan2(dx, dy);
      } else if (surface === 'wall-zD') {
        perpDist = ROOM_D - playerPos.z;
        const dx = worldX - playerPos.x;
        surfaceDist = Math.sqrt(dy * dy + dx * dx);
        sprayAngle = Math.atan2(dx, dy);
      } else {
        // Unknown surface, fall back to ceiling
        perpDist = ROOM_H - nozzleY;
        const dx = worldX - playerPos.x;
        const dz = worldZ - playerPos.z;
        surfaceDist = Math.sqrt(dx * dx + dz * dz);
        sprayAngle = Math.atan2(dz, dx);
      }
    }

    // Ensure perpDist is positive (player could be right at a wall)
    perpDist = Math.max(perpDist, 0.1);

    // 3D distance from hose to surface hit point
    const totalDist = Math.sqrt(surfaceDist * surfaceDist + perpDist * perpDist);

    // Max reach scales with PSI: ~20 ft at 100 PSI (spec §5.1: 15-25 ft effective)
    const maxReach = this.sprayPSI * 0.2;
    if (totalDist > maxReach) return null;

    // Cone half-angle (radians): ~8° at 100 PSI with waterRadius=2 (narrow fog).
    // Higher PSI = tighter cone. waterRadius slider scales the angle.
    const baseDeg = 8;
    const halfAngleDeg = baseDeg * (this.waterRadius / 2) * Math.sqrt(100 / this.sprayPSI);
    const halfAngleRad = halfAngleDeg * Math.PI / 180;

    // Incidence angle: 0 = perpendicular to surface, π/2 = parallel
    const incidenceAngle = Math.atan2(surfaceDist, perpDist);

    // Cone radius perpendicular to beam axis (for minor axis)
    const coneRadius = totalDist * Math.tan(halfAngleRad);

    // Cone-surface intersection: trace near/far edge rays to the surface plane.
    const nearAngle = incidenceAngle - halfAngleRad;
    const farAngle  = incidenceAngle + halfAngleRad;
    const clampedFar = Math.min(farAngle, Math.PI / 2 - 0.05);
    const nearDist = perpDist * Math.tan(nearAngle);
    const farDist  = perpDist * Math.tan(clampedFar);

    const rawMajor = (farDist - nearDist) / 2;
    const minorR = Math.max(0.25, coneRadius);
    // Cap major axis: at grazing incidence tan() blows up, producing absurdly
    // elongated ellipses. Limit to 4× the minor radius — still visibly elongated
    // but not a floor-to-ceiling sliver.
    const majorR = Math.max(0.25, Math.min(rawMajor, minorR * 4));
    const ellipseCenterDist = (nearDist + farDist) / 2;
    const centerOffset = ellipseCenterDist - surfaceDist;

    // Strength: mild dropoff near max reach where the stream breaks apart.
    const reachRatio = totalDist / maxReach;
    const strengthFactor = reachRatio > 0.7
      ? 1.0 - (reachRatio - 0.7) / 0.3
      : 1.0;

    return {
      majorR,
      minorR,
      sprayAngle,
      strengthFactor,
      centerOffset,
      surface,
    };
  }

  /**
   * Compute flow rate from nozzle pressure.
   * Uses standard nozzle coefficient formula: GPM = K × √PSI
   * K=15 models a typical 1¾" combination nozzle (150 GPM @ 100 PSI).
   */
  getGPM() {
    return 15 * Math.sqrt(this.sprayPSI);
  }

  applyWater(worldX, worldZ, dt, playerPos) {
    const params = playerPos ? this.getSprayParams(worldX, worldZ, playerPos) : null;

    if (playerPos && !params) return; // out of range

    const majorR = params ? params.majorR : this.waterRadius;
    const minorR = params ? params.minorR : this.waterRadius;
    const angle = params ? params.sprayAngle : 0;
    const strengthMul = params ? params.strengthFactor : 1.0;

    // Derive suppression rate from physics:
    // GPM → gallons/sec, distributed over spray ellipse area.
    // Peak density at cone center = 3× average (cone falloff profile integrates
    // to 1/3 of area × peak). COOLING_FACTOR converts peak gal/s/sqft to heat
    // reduction rate.
    // CF=5 compensates for background-tab throttling (controller at ~1fps
    // while viewer tab is focused, dt capped at 0.05).
    // At 100 PSI overhead: ~instant. 7ft: ~0.2s. 10ft: ~0.5s.
    // Moisture mechanic handles re-ignition resistance separately.
    const COOLING_FACTOR = 5;
    const gps = this.getGPM() / 60;                      // gallons per second
    const sprayArea = Math.PI * majorR * minorR;          // sq ft
    const peakDensity = 3 * gps / sprayArea;              // gal/s/sqft at center
    const suppressionRate = peakDensity * COOLING_FACTOR * strengthMul;

    // Shift from hit point to true ellipse center along the spray direction
    const off = params ? (params.centerOffset || 0) : 0;
    const sprayX = worldX + Math.cos(angle) * off;
    const sprayZ = worldZ + Math.sin(angle) * off;

    const cosA = Math.cos(-angle);
    const sinA = Math.sin(-angle);
    const rMax = Math.ceil(Math.max(majorR, minorR));

    // Grid cell containing the spray center
    const cx = Math.floor(sprayX);
    const cz = Math.floor(sprayZ);

    let totalWaterApplied = 0; // track water for gas layer cooling

    for (let dy = -rMax; dy <= rMax; dy++) {
      for (let dx = -rMax; dx <= rMax; dx++) {
        const gx = cx + dx;
        const gy = cz + dy;
        if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) continue;

        // Sub-cell precision: distance from cell center to spray center
        const offX = (gx + 0.5) - sprayX;
        const offZ = (gy + 0.5) - sprayZ;

        // Rotate offset into ellipse-local coords (aligned with spray direction)
        const lx = offX * cosA - offZ * sinA;
        const ly = offX * sinA + offZ * cosA;

        // Elliptical distance: (lx/majorR)^2 + (ly/minorR)^2 <= 1
        const ellipseDist = (lx * lx) / (majorR * majorR) + (ly * ly) / (minorR * minorR);
        if (ellipseDist > 1.0) continue;

        const falloff = 1.0 - Math.sqrt(ellipseDist);
        const i = this.idx(gx, gy);
        const cooled = this.heat[i] - suppressionRate * falloff * dt;
        this.heat[i] = cooled > 0 ? cooled : 0; // also handles NaN → 0

        // When water knocks down a cell, transition to suppressed state
        if (this.heat[i] <= 0 && this.cellState[i] === CELL_BURNING) {
          this.cellState[i] = CELL_SUPPRESSED;
          this.heatExposure[i] = 0;
        }

        // Water cools preheating cells — reduce accumulated heat exposure
        if (this.cellState[i] === CELL_PREHEATING) {
          this.heatExposure[i] = Math.max(0, this.heatExposure[i] - suppressionRate * falloff * dt * 10);
          if (this.heatExposure[i] < 0.5) {
            this.cellState[i] = CELL_SUPPRESSED;
            this.heatExposure[i] = 0;
          }
        }

        // Accumulate moisture – peak water density × falloff at this cell.
        // Saturates at 1.0 in ~0.5s of continuous direct spray overhead.
        const waterDensity = peakDensity * falloff * strengthMul;
        const m = this.moisture[i] + waterDensity * dt;
        this.moisture[i] = m < 1 ? m : 1;

        totalWaterApplied += waterDensity * dt;
      }
    }

    // Cool the gas layer ("penciling the ceiling", spec §5.6).
    // Total gallons actually sprayed this tick = GPM/60 × dt.
    // Each gallon of water: 1 gal = 3.785 kg. Absorbs 2.6 MJ/kg = 9.84 MJ/gal.
    // dT = -(gallons × 9840 kJ/gal × efficiency) / (m_layer × Cp)
    // At 150 GPM, 1s burst: 2.5 gal × 9840 × 0.08 / (200 × 1.0) = 9.84°C drop.
    // Spec says 7-10°C per 1s burst — 8% efficiency accounts for most water
    // hitting the ceiling surface rather than evaporating in the gas layer.
    if (totalWaterApplied > 0 && this.gasLayerTemp > AMBIENT_TEMP) {
      const PENCIL_EFFICIENCY = 0.08; // most water hits ceiling surface, not gas layer
      const gallonsThisTick = gps * dt; // actual gallons sprayed
      const coolingKJ = gallonsThisTick * 9840 * PENCIL_EFFICIENCY; // kJ absorbed
      const dT = coolingKJ / (GAS_LAYER_MASS * GAS_CP);
      this.gasLayerTemp = Math.max(AMBIENT_TEMP, this.gasLayerTemp - dT);
    }
  }

  // ── Start location management ────────────────────────────

  toggleStartLocation(x, y) {
    const i = this.idx(x, y);
    if (this.startLocations.has(i)) {
      this.startLocations.delete(i);
      return false;
    } else {
      this.startLocations.add(i);
      return true;
    }
  }

  isStartLocation(x, y) {
    return this.startLocations.has(this.idx(x, y));
  }

  // ── Obstacle management ──────────────────────────────────

  addObstacleBlock(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const i = this.idx(x, y);
    if (this.obstacles[i] < 8) { // max 8ft high (room height)
      this.obstacles[i]++;
    }
  }

  removeObstacleBlock(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    const i = this.idx(x, y);
    if (this.obstacles[i] > 0) {
      this.obstacles[i]--;
    }
  }

  getObstacleHeight(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return 0;
    return this.obstacles[this.idx(x, y)];
  }

  // ── Vent management ─────────────────────────────────────

  addVent(x, y, type, wall) {
    const existing = this.vents.find(v => v.x === x && v.y === y && v.type === type);
    if (existing) return existing;
    const vent = { x, y, type, wall: wall || null };
    this.vents.push(vent);
    this.recalcAirflow();
    return vent;
  }

  removeVent(x, y, type) {
    this.vents = this.vents.filter(v => !(v.x === x && v.y === y && v.type === type));
    this.recalcAirflow();
  }

  toggleVent(x, y, type, wall) {
    const idx = this.vents.findIndex(v => v.x === x && v.y === y && v.type === type);
    if (idx >= 0) {
      this.vents.splice(idx, 1);
      this.recalcAirflow();
      return false;
    } else {
      this.addVent(x, y, type, wall);
      return true;
    }
  }

  clearVents() {
    this.vents = [];
    this.airflow.fill(0);
  }

  recalcAirflow() {
    const { cols, rows, vents } = this;
    this.airflow.fill(0);

    if (vents.length === 0) return;

    const ceilingVents = vents.filter(v => v.type === 'ceiling');
    const doors = vents.filter(v => v.type === 'door');
    const maxDist = Math.sqrt(cols * cols + rows * rows);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let vx = 0;
        let vy = 0;
        const ai = (y * cols + x) * 2;

        // Baseline: all cells pull toward ceiling vents (heat rises, draws air)
        for (const cv of ceilingVents) {
          const dx = cv.x - x;
          const dy = cv.y - y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.5) continue;

          const influence = Math.max(0, 1.0 - dist / maxDist);
          const strength = influence * influence;

          vx += (dx / dist) * strength;
          vy += (dy / dist) * strength;
        }

        // Door-to-vent corridor flow: curved streamlines from each door
        // toward each vent, strongest along the direct path between them.
        for (const door of doors) {
          for (const cv of ceilingVents) {
            // Vectors: door→cell and cell→vent
            const fromDoorX = x - door.x;
            const fromDoorY = y - door.y;
            const distFromDoor = Math.sqrt(fromDoorX * fromDoorX + fromDoorY * fromDoorY);

            const toVentX = cv.x - x;
            const toVentY = cv.y - y;
            const distToVent = Math.sqrt(toVentX * toVentX + toVentY * toVentY);

            if (distFromDoor < 0.5 && distToVent < 0.5) continue;

            // Blend parameter: 0 near door (flow away from door), 1 near vent (flow toward vent)
            const t = distFromDoor / (distFromDoor + distToVent);

            // Unit direction vectors
            const fdNorm = distFromDoor > 0.5 ? 1 / distFromDoor : 0;
            const tvNorm = distToVent > 0.5 ? 1 / distToVent : 0;
            const fdx = fromDoorX * fdNorm;
            const fdy = fromDoorY * fdNorm;
            const tvx = toVentX * tvNorm;
            const tvy = toVentY * tvNorm;

            // Smoothly lerp direction: curves from "away from door" to "toward vent"
            let dirX = fdx * (1 - t) + tvx * t;
            let dirY = fdy * (1 - t) + tvy * t;
            const dirMag = Math.sqrt(dirX * dirX + dirY * dirY);
            if (dirMag < 0.001) continue;
            dirX /= dirMag;
            dirY /= dirMag;

            // Strength: strongest along the door-vent corridor, fades with distance from it
            const dvX = cv.x - door.x;
            const dvY = cv.y - door.y;
            const dvDist2 = dvX * dvX + dvY * dvY;
            // Project cell onto the door→vent line segment
            const projT = dvDist2 > 0
              ? Math.max(0, Math.min(1, (fromDoorX * dvX + fromDoorY * dvY) / dvDist2))
              : 0;
            const nearX = door.x + projT * dvX;
            const nearY = door.y + projT * dvY;
            const distFromLine = Math.sqrt((x - nearX) * (x - nearX) + (y - nearY) * (y - nearY));

            // Corridor falloff: strong near the line, fades laterally
            const corridorFalloff = Math.max(0, 1 - distFromLine / (maxDist * 0.45));
            // Distance falloff: weaker as total path gets longer
            const pathFalloff = Math.max(0, 1 - (distFromDoor + distToVent) / (maxDist * 1.8));

            const strength = corridorFalloff * corridorFalloff * pathFalloff * 0.8;

            vx += dirX * strength;
            vy += dirY * strength;
          }

          // If no vents, door air just flows weakly into the room
          if (ceilingVents.length === 0) {
            const dx = x - door.x;
            const dy = y - door.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= 0.5) {
              const influence = Math.max(0, 1 - dist / maxDist);
              const strength = influence * influence * 0.3;
              vx += (dx / dist) * strength;
              vy += (dy / dist) * strength;
            }
          }
        }

        const mag = Math.sqrt(vx * vx + vy * vy);
        if (mag > 0) {
          const clampedMag = Math.min(mag, 1.0);
          this.airflow[ai] = (vx / mag) * clampedMag;
          this.airflow[ai + 1] = (vy / mag) * clampedMag;
        }
      }
    }
  }

  getAirflow(x, y) {
    const ai = (y * this.cols + x) * 2;
    return { vx: this.airflow[ai], vy: this.airflow[ai + 1] };
  }

  isCeilingVent(x, y) {
    return this.vents.some(v => v.type === 'ceiling' && v.x === x && v.y === y);
  }

  step(dt) {
    const { cols, rows, heat, nextHeat, moisture, heatExposure, airflow } = this;
    const hasAirflow = this.vents.length > 0;
    const edgeMul = this._edgeMul;

    // Don't tick if game is over
    if (this.gameState === 'win' || this.gameState === 'lose_flashover' || this.gameState === 'lose_oxygen') return;
    if (this.gameState === 'idle') this.gameState = 'running';

    this.simTime += dt;

    // ── 1. t² HRR target ────────────────────────────────────
    // The fire's total HRR should follow Q(t) = α · t².
    // We compute the target HRR for this moment and use it to govern
    // how hot individual cells can get (capping the feedback loop).
    const tSquaredHRR = this.growthAlpha * this.simTime * this.simTime; // kW
    const fuelPeak = 5000; // max fuel-controlled HRR (kW) for this room size

    // ── 2. Compute actual total HRR from burning cells ──────
    let totalHRR = 0;
    let burningCells = 0;
    const totalCells = cols * rows;
    const cellState = this.cellState;
    for (let i = 0; i < totalCells; i++) {
      if (cellState[i] === CELL_BURNING && heat[i] > 0) {
        totalHRR += heat[i] * CELL_HRR_MAX;
        burningCells++;
      }
    }

    // ── 3. Ventilation-limited HRR cap ──────────────────────
    // Spec §2.2: Q_max = Σ(1518 · Av_i · √Hv_i) per opening
    const ceilingVents = this.vents.filter(v => v.type === 'ceiling');
    const doors = this.vents.filter(v => v.type === 'door');
    let ventMaxHRR = 0;
    for (let j = 0; j < doors.length; j++) {
      ventMaxHRR += 1518 * DOOR_AREA_M2 * Math.sqrt(DOOR_HEIGHT_M);
    }
    for (let j = 0; j < ceilingVents.length; j++) {
      ventMaxHRR += 1518 * VENT_AREA_M2 * Math.sqrt(0.5);
    }

    this.ventLimited = this.oxygenLevel < O2_FLAMING_LIMIT;

    // Effective HRR: min of t² target, fuel peak, ventilation cap, and actual burning output
    let effectiveHRR = Math.min(totalHRR, tSquaredHRR, fuelPeak);
    if (this.ventLimited) {
      effectiveHRR = 0;
    } else if (ventMaxHRR > 0 && effectiveHRR > ventMaxHRR) {
      effectiveHRR = ventMaxHRR;
    }
    this.totalHRR = effectiveHRR;

    // ── 4. O₂ update ────────────────────────────────────────
    // Spec §4.2: sealed 500 kW fire depletes 20.9%→15% in 5-7 minutes.
    // The well-mixed calculation gives ~81s — too fast by ~4×.
    // In reality, fire consumes O₂ from the lower cool layer; stratification
    // means the effective air mass available for combustion is larger than the
    // simple room volume suggests (hot upper layer recirculates partially).
    // A mixing factor of 0.25 calibrates to ~5 minutes at 500 kW.
    const O2_MIXING_FACTOR = 0.25;
    const o2ConsumedKg = (effectiveHRR * dt / 1000) * O2_PER_MJ * O2_MIXING_FACTOR;
    // Convert kg O₂ consumed to absolute change in O₂ percentage of air.
    // o2ChangePercent = (consumed_kg / total_air_mass) × 100
    // (NOT divided by O₂ mass — that would give fraction-of-O₂, not pp change)
    const o2ChangePercent = (o2ConsumedKg / ROOM_AIR_MASS) * 100;
    this.oxygenLevel -= o2ChangePercent;

    let airInflowKgPerSec = 0;
    for (const d of doors) {
      airInflowKgPerSec += 0.5 * DOOR_AREA_M2 * Math.sqrt(DOOR_HEIGHT_M);
    }
    for (const v of ceilingVents) {
      airInflowKgPerSec += 0.5 * VENT_AREA_M2 * Math.sqrt(0.5);
    }
    const freshO2Kg = airInflowKgPerSec * dt * (AMBIENT_O2 / 100);
    const o2ReplenishPercent = (freshO2Kg / ROOM_AIR_MASS) * 100;
    this.oxygenLevel = Math.max(0, Math.min(AMBIENT_O2, this.oxygenLevel + o2ReplenishPercent));

    // ── 5. Ceiling jet preheating (Alpert correlations) ─────
    // Fire centroid for Alpert distance calculations
    let fireCX = 0, fireCY = 0, fireWeight = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        if (cellState[idx] === CELL_BURNING && heat[idx] > 0) {
          fireCX += x * heat[idx]; fireCY += y * heat[idx]; fireWeight += heat[idx];
        }
      }
    }
    if (fireWeight > 0) { fireCX /= fireWeight; fireCY /= fireWeight; }

    // Corner fire 4× HRR boost for Alpert (spec §3.3: mirror-image reflections)
    // If fire centroid is within 2 cells of a corner, apply the virtual fire multiplier
    let alpertHRR = effectiveHRR;
    if (fireWeight > 0) {
      const nearLeft = fireCX < 2;
      const nearRight = fireCX > cols - 3;
      const nearTop = fireCY < 2;
      const nearBottom = fireCY > rows - 3;
      const wallCount = (nearLeft || nearRight ? 1 : 0) + (nearTop || nearBottom ? 1 : 0);
      if (wallCount >= 2) alpertHRR *= 4;       // corner: 4× virtual fire
      else if (wallCount === 1) alpertHRR *= 2;  // wall: 2× virtual fire
    }

    // Constants
    const EVAP_RATE = 0.012;  // base rate: full saturation dries in ~80s (spec §5.5.1: 60-90s)
    const GROWTH_DAMPEN = 0.85;
    const IGNITION_THRESHOLD_KJ = 20; // kJ (spec: 15-25 kJ)
    const gasTemp = this.gasLayerTemp;

    // ── 6. Per-cell update ───────────────────────────────────

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        let h = heat[i];
        let m = moisture[i];
        let exposure = heatExposure[i];
        let state = cellState[i];

        // ── Evaporate moisture (spec §5.5.1) ──
        if (m > 0) {
          let evapRate = 0;
          if (gasTemp > 100) {
            evapRate = EVAP_RATE * Math.min(1, (gasTemp - 100) / 300);
          }
          evapRate = Math.max(evapRate, EVAP_RATE * 0.05);
          m = Math.max(0, m - evapRate * dt);
          // Suppressed cell dries out → becomes unignited (can be preheated again)
          if (state === CELL_SUPPRESSED && m < 0.01) {
            state = CELL_UNIGNITED;
          }
        }

        // ── Ceiling vent dissipation ──
        if (h > 0 && this.isCeilingVent(x, y)) {
          h = Math.max(0, h - 0.8 * dt);
          if (h <= 0) state = CELL_UNIGNITED;
        }

        // ── BURNING cells: intensify ──
        if (state === CELL_BURNING) {
          if (this.ventLimited) {
            h = Math.max(0, h - 0.02 * dt);
            if (h <= 0) state = CELL_UNIGNITED; // smouldered out
          } else {
            h = Math.min(1.0, h + 0.15 * dt * (1.0 - h) * (1.0 - m * GROWTH_DAMPEN));
          }
          if (h < 0.02) {
            h = Math.max(0, h - 0.05 * dt);
            if (h <= 0) state = CELL_UNIGNITED;
          }

          // Neighbor diffusion: burning cell heats up toward hotter neighbors
          if (!this.ventLimited) {
            let neighborHeat = 0, nCount = 0;
            for (let ny = y - 1; ny <= y + 1; ny++) {
              for (let nx = x - 1; nx <= x + 1; nx++) {
                if (nx === x && ny === y) continue;
                if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                const nh = heat[ny * cols + nx];
                if (nh > 0) { neighborHeat += nh; nCount++; }
              }
            }
            if (nCount > 0) {
              const avg = neighborHeat / nCount;
              const d = avg - h;
              if (d > 0) h += d * 0.3 * dt * (1.0 - m * GROWTH_DAMPEN);
            }
          }
          exposure = 0; // burning cells don't accumulate exposure
        }

        // ── NON-BURNING cells: accumulate heat exposure ──
        if (state !== CELL_BURNING && !this.ventLimited) {
          let exposureRate = 0;

          // (a) Radiant heat from adjacent burning cells
          for (let ny = y - 1; ny <= y + 1; ny++) {
            for (let nx = x - 1; nx <= x + 1; nx++) {
              if (nx === x && ny === y) continue;
              if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
              if (cellState[ny * cols + nx] !== CELL_BURNING) continue;
              const nh = heat[ny * cols + nx];
              if (nh > 0) {
                const dist = (nx !== x && ny !== y) ? 1.414 : 1.0;
                exposureRate += nh * 1.5 / dist;
              }
            }
          }

          // (b) Ceiling jet preheating (Alpert) — dry cells only
          if (alpertHRR > 10 && fireWeight > 0 && m < 0.1) {
            const dx = x - fireCX;
            const dy = y - fireCY;
            const rFt = Math.sqrt(dx * dx + dy * dy);
            const rM = Math.max(0.5, rFt * FT_TO_M);
            const rOverH = rM / ROOM_H_M;
            let ceilingJetDT;
            if (rOverH <= 0.18) {
              ceilingJetDT = 16.9 * Math.pow(alpertHRR, 2/3) / Math.pow(ROOM_H_M, 5/3);
            } else {
              ceilingJetDT = 5.38 * Math.pow(alpertHRR / rM, 2/3) / ROOM_H_M;
            }
            if (ceilingJetDT > 150) {
              exposureRate += (ceilingJetDT - 150) * 0.01;
            }
          }

          // (c) Gas layer radiation (spec §5.5.2) — dry cells above 500°C
          if (gasTemp > REIGNITION_TEMP && m < 0.3) {
            exposureRate += (gasTemp - REIGNITION_TEMP) * 0.01;
          }

          // (d) Airflow directional bonus/penalty (spec §4.4)
          if (hasAirflow && exposureRate > 0) {
            const ai = (y * cols + x) * 2;
            const avx = airflow[ai];
            const avy = airflow[ai + 1];
            if (Math.abs(avx) + Math.abs(avy) > 0.01) {
              let concurrentBonus = 0, opposedPenalty = 0;
              let cCount = 0, oCount = 0;
              for (let ny2 = y - 1; ny2 <= y + 1; ny2++) {
                for (let nx2 = x - 1; nx2 <= x + 1; nx2++) {
                  if (nx2 === x && ny2 === y) continue;
                  if (nx2 < 0 || nx2 >= cols || ny2 < 0 || ny2 >= rows) continue;
                  if (cellState[ny2 * cols + nx2] !== CELL_BURNING) continue;
                  const ddx = x - nx2, ddy = y - ny2;
                  const dMag = Math.sqrt(ddx * ddx + ddy * ddy);
                  const dot = (ddx / dMag) * avx + (ddy / dMag) * avy;
                  if (dot > 0) { concurrentBonus += dot; cCount++; }
                  else if (dot < -0.3) { opposedPenalty += Math.abs(dot); oCount++; }
                }
              }
              if (cCount > 0) exposureRate *= (1.0 + (concurrentBonus / cCount) * 2.0);
              if (oCount > 0 && cCount === 0) exposureRate *= Math.max(0.2, 1.0 - (opposedPenalty / oCount) * 0.7);
            }
          }

          // Apply edge multiplier (spec §3.2)
          exposureRate *= edgeMul[i];

          // Moisture resists preheating (spec §5.5.1)
          exposureRate *= (1.0 - m * 0.95);

          // Accumulate exposure (kW × dt = kJ)
          if (exposureRate > 0) {
            exposure += exposureRate * dt;
            // Transition to PREHEATING when exposure starts accumulating
            if (state === CELL_UNIGNITED && exposure > 0.5) {
              state = CELL_PREHEATING;
            }
          }

          // Wet cells cool down (exposure decays)
          if (m > 0.5 && exposureRate <= 0) {
            exposure = Math.max(0, exposure - 2 * dt);
            if (exposure < 0.5 && state === CELL_PREHEATING) {
              state = CELL_UNIGNITED;
            }
          }

          // Deterministic ignition when threshold reached (spec §3.4)
          if (exposure >= IGNITION_THRESHOLD_KJ) {
            h = 0.05 + 0.05 * Math.min(1, (exposure - IGNITION_THRESHOLD_KJ) / 5);
            state = CELL_BURNING;
            exposure = 0;
          }
        }

        nextHeat[i] = Math.max(0, Math.min(1.0, h));
        moisture[i] = m;
        heatExposure[i] = exposure;
        cellState[i] = state;
      }
    }

    const tmp = this.heat;
    this.heat = this.nextHeat;
    this.nextHeat = tmp;

    // ── 7. Gas layer temperature update ─────────────────────
    this._updateGasLayer(dt, effectiveHRR);

    // ── 8. Win/lose conditions ───────────────────────────────
    this._checkWinLose(dt);
  }

  /** Update upper gas layer temperature based on fire output and ventilation. */
  _updateGasLayer(dt, totalHRR) {
    let temp = this.gasLayerTemp;

    // Heat input from fire (HRR heats the gas layer)
    temp += (totalHRR * dt) / (GAS_LAYER_MASS * GAS_CP);

    // Vent/door cooling: proportional to temp difference (hotter gas escapes faster)
    const nCeilingVents = this.vents.filter(v => v.type === 'ceiling').length;
    const nDoors = this.vents.filter(v => v.type === 'door').length;
    // Spec §4.3: door inflow ~1.36 kg/s of cool air into ~200kg gas layer
    // Cooling ≈ (m_air · Cp · ΔT) / (m_layer · Cp) = m_air/m_layer per second
    // 1.36/200 ≈ 0.007 per door. Ceiling vents smaller.
    const ventCoolCoeff = nCeilingVents * 0.004 + nDoors * 0.007;
    temp -= ventCoolCoeff * (temp - AMBIENT_TEMP) * dt;

    // Ambient radiation/convection loss (slow passive cooling toward ambient)
    temp -= 0.002 * (temp - AMBIENT_TEMP) * dt;

    // Clamp
    temp = Math.max(AMBIENT_TEMP, Math.min(1200, temp));
    this.gasLayerTemp = temp;

    // Flashover check: sustained gas layer temp > FLASHOVER_TEMP for 5 seconds
    if (temp > FLASHOVER_TEMP) {
      this.flashoverTimer += dt;
      if (this.flashoverTimer >= 5 && !this.flashedOver) {
        this.flashedOver = true;
        this._triggerFlashover();
      }
    } else {
      this.flashoverTimer = 0;
    }
  }

  /** Flashover: rapidly ignite all remaining cells. */
  _triggerFlashover() {
    const total = this.cols * this.rows;
    for (let i = 0; i < total; i++) {
      if (this.cellState[i] !== CELL_BURNING) {
        this.heat[i] = 0.5 + Math.random() * 0.3;
        this.cellState[i] = CELL_BURNING;
        this.heatExposure[i] = 0;
      }
    }
  }

  /** Check win/lose conditions each tick. */
  _checkWinLose(dt) {
    if (this.gameState !== 'running') return;

    // Lose: flashover
    if (this.flashedOver) {
      this.gameState = 'lose_flashover';
      return;
    }

    // Lose: oxygen depleted (IDLH atmosphere)
    if (this.oxygenLevel < O2_LETHAL_LIMIT) {
      this.gameState = 'lose_oxygen';
      return;
    }

    // Win: no burning cells for 3 sustained seconds
    let burning = 0;
    const total = this.cols * this.rows;
    for (let i = 0; i < total; i++) {
      if (this.cellState[i] === CELL_BURNING) { burning++; break; }
    }
    if (burning === 0 && this.simTime > 5) {
      // Need some time to have passed (don't win instantly)
      this.winTimer += dt;
      if (this.winTimer >= 3) {
        this.gameState = 'win';
      }
    } else {
      this.winTimer = 0;
    }
  }

  getStats() {
    let burning = 0;
    let totalHeat = 0;
    const total = this.cols * this.rows;

    for (let i = 0; i < total; i++) {
      if (this.heat[i] > 0) {
        burning++;
        totalHeat += this.heat[i];
      }
    }

    return {
      burning,
      coverage: burning / total,
      avgIntensity: burning > 0 ? totalHeat / burning : 0,
    };
  }

  // ── Scenario serialization ──────────────────────────────

  /** Export the room design (not live heat state) */
  toScenarioData() {
    return {
      vents: [...this.vents],
      obstacles: Array.from(this.obstacles),
      startLocations: Array.from(this.startLocations),
      params: {
        waterRadius: this.waterRadius,
        sprayPSI: this.sprayPSI,
        growthAlpha: this.growthAlpha,
      },
    };
  }

  /** Load a scenario design */
  loadScenarioData(data) {
    this.reset();
    this.vents = data.vents ? [...data.vents] : [];
    this.obstacles = data.obstacles
      ? new Uint8Array(data.obstacles)
      : new Uint8Array(this.cols * this.rows);
    this.startLocations = data.startLocations
      ? new Set(data.startLocations)
      : new Set();
    if (data.params) {
      Object.assign(this, data.params);
    }
    this.recalcAirflow();
  }

  // ── Snapshot / time-skip ──────────────────────────────────

  /** Take a snapshot of the live simulation state */
  takeSnapshot() {
    return {
      simTime: this.simTime,
      heat: new Float32Array(this.heat),
      cellState: new Uint8Array(this.cellState),
      heatExposure: new Float32Array(this.heatExposure),
      moisture: new Float32Array(this.moisture),
      gasLayerTemp: this.gasLayerTemp,
      totalHRR: this.totalHRR,
      oxygenLevel: this.oxygenLevel,
      flashedOver: this.flashedOver,
      flashoverTimer: this.flashoverTimer,
      ventLimited: this.ventLimited,
      gameState: this.gameState,
      winTimer: this.winTimer,
    };
  }

  /** Restore simulation state from a snapshot */
  restoreSnapshot(snap) {
    this.simTime = snap.simTime;
    this.heat.set(snap.heat);
    this.cellState.set(snap.cellState);
    this.heatExposure.set(snap.heatExposure);
    this.moisture.set(snap.moisture);
    this.gasLayerTemp = snap.gasLayerTemp;
    this.totalHRR = snap.totalHRR;
    this.oxygenLevel = snap.oxygenLevel;
    this.flashedOver = snap.flashedOver;
    this.flashoverTimer = snap.flashoverTimer;
    this.ventLimited = snap.ventLimited;
    this.gameState = snap.gameState;
    this.winTimer = snap.winTimer;
    this.nextHeat.fill(0);
  }

  /** Fast-forward: run simulation for the given number of seconds */
  fastForward(seconds) {
    const stepDt = 0.05; // 50ms per step (same as frame cap)
    const steps = Math.round(seconds / stepDt);
    for (let i = 0; i < steps; i++) {
      this.step(stepDt);
    }
  }
}
