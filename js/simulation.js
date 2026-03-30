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
  GAS_LAYER_MASS, GAS_CP, UNTENABLE_TEMP,
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

    // Max reach scales with sqrt(PSI) — velocity ∝ sqrt(PSI), range ∝ velocity.
    // 20 ft at 100 PSI, ~14 ft at 50 PSI, ~17 ft at 75 PSI (spec §5.1: 15-25 ft).
    const maxReach = 2.0 * Math.sqrt(this.sprayPSI);
    if (totalDist > maxReach) return null;

    // Stream and splash radii:
    // streamRadius: true cone geometry from nozzle (5° half-angle expansion)
    // splashRadius: effective wetted area on surface (stream + radial splash)
    // The splash minimum ensures even close-range perpendicular hits show a
    // meaningful wetted area from the high-velocity impact.
    const NOZZLE_R = 0.042;  // ft — 1" diameter / 2 (standard combo nozzle)
    // Splash minimum scales with pattern width — fog patterns splash wider
    const MIN_SPLASH_R = 0.5 * (this.waterRadius / 2); // 0.5 ft at default, 1.0 ft at max fog
    const BASE_HALF_ANGLE_DEG = 5.0; // degrees, straight stream
    const halfAngleDeg = BASE_HALF_ANGLE_DEG * (this.waterRadius / 2) * Math.sqrt(100 / this.sprayPSI);
    const tanAlpha = Math.tan(halfAngleDeg * Math.PI / 180);
    const streamRadius = NOZZLE_R + tanAlpha * totalDist;
    const splashRadius = Math.max(MIN_SPLASH_R, streamRadius);
    // Use splashRadius for the surface footprint (suppression + visual disc)
    const coneRadius = splashRadius;

    // Equivalent half-angle for the cone-surface intersection math
    const halfAngleRad = Math.atan2(coneRadius, totalDist);

    // Incidence angle: 0 = perpendicular to surface, π/2 = parallel
    const incidenceAngle = Math.atan2(surfaceDist, perpDist);

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
      minorR,         // splash radius (for disc visual + suppression)
      streamRadius,   // true cone radius (for cone wireframe visual)
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

  applyWater(worldX, worldZ, dt, playerPos, precomputedParams) {
    // Use pre-computed params from viewer if available (avoids wrong surface/nozzleY recalculation)
    const params = precomputedParams
      || (playerPos ? this.getSprayParams(worldX, worldZ, playerPos) : null);

    if (playerPos && !params) return; // out of range

    const majorR = params ? params.majorR : this.waterRadius;
    const minorR = params ? params.minorR : this.waterRadius;
    const angle = params ? params.sprayAngle : 0;
    const strengthMul = params ? params.strengthFactor : 1.0;
    const mode = (params && params.mode) || 'direct';

    const gps = this.getGPM() / 60;                      // gallons per second
    let totalWaterApplied = 0; // track water for gas layer cooling

    // Fog mode: primarily gas layer cooling, with reduced surface suppression.
    // ~75% of water evaporates in the gas layer (Barnett data, 0.35mm droplets).
    // ~25% settles onto ceiling surfaces as distributed mist — provides reduced
    // but real cell suppression at lower density than a direct stream.
    // FOG_SURFACE_FRACTION accounts for the droplets that don't evaporate.
    const FOG_SURFACE_FRACTION = 0.25;

    if (mode === 'fog') {
      // Gas layer gets the bulk of the water
      totalWaterApplied = gps * dt * strengthMul;
    }

    {
      // Cell suppression: full strength for direct, reduced for fog
      // Fog distributes water over a wider area at lower density (settled mist).
      const suppressionMul = mode === 'fog' ? FOG_SURFACE_FRACTION : 1.0;
      const COOLING_FACTOR = 1;
      const sprayArea = Math.PI * majorR * minorR;          // sq ft
      const peakDensity = 3 * gps / sprayArea;              // gal/s/sqft at center
      const suppressionRate = peakDensity * COOLING_FACTOR * strengthMul * suppressionMul;

      // Shift from hit point to true ellipse center along the spray direction
      const off = params ? (params.centerOffset || 0) : 0;
      const sprayX = worldX + Math.cos(angle) * off;
      const sprayZ = worldZ + Math.sin(angle) * off;

      const cosA = Math.cos(-angle);
      const sinA = Math.sin(-angle);
      const rMax = Math.ceil(Math.max(majorR, minorR));

      // Grid cell containing the spray center (clamped to valid bounds)
      const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(sprayX)));
      const cz = Math.max(0, Math.min(this.rows - 1, Math.floor(sprayZ)));

      // Sub-sample grid: 3×3 points per cell to estimate ellipse coverage.
      const SUB = 3;
      const SUB_STEP = 1 / SUB;
      const SUB_OFFSET = SUB_STEP / 2;
      const invMajSq = 1 / (majorR * majorR);
      const invMinSq = 1 / (minorR * minorR);

      for (let dy = -rMax; dy <= rMax; dy++) {
        for (let dx = -rMax; dx <= rMax; dx++) {
          const gx = cx + dx;
          const gy = cz + dy;
          if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) continue;

          let falloffSum = 0;
          for (let sy = 0; sy < SUB; sy++) {
            for (let sx = 0; sx < SUB; sx++) {
              const px = gx + SUB_OFFSET + sx * SUB_STEP;
              const pz = gy + SUB_OFFSET + sy * SUB_STEP;
              const offX = px - sprayX;
              const offZ = pz - sprayZ;

              const lx = offX * cosA - offZ * sinA;
              const ly = offX * sinA + offZ * cosA;

              const ellipseDist = lx * lx * invMajSq + ly * ly * invMinSq;
              if (ellipseDist <= 1.0) {
                falloffSum += 1.0 - Math.sqrt(ellipseDist);
              }
            }
          }
          if (falloffSum === 0) continue;

          const falloff = falloffSum / (SUB * SUB);
          const i = this.idx(gx, gy);
          const cooled = this.heat[i] - suppressionRate * falloff * dt;
          this.heat[i] = cooled > 0 ? cooled : 0;

          if (this.heat[i] <= 0 && this.cellState[i] === CELL_BURNING) {
            this.cellState[i] = CELL_SUPPRESSED;
            this.heatExposure[i] = 0;
          }

          if (this.cellState[i] === CELL_PREHEATING) {
            this.heatExposure[i] = Math.max(0, this.heatExposure[i] - suppressionRate * falloff * dt * 10);
            if (this.heatExposure[i] < 0.5) {
              this.cellState[i] = CELL_SUPPRESSED;
              this.heatExposure[i] = 0;
            }
          }

          const MOISTURE_RATE = 0.16;
          const waterDensity = peakDensity * falloff * strengthMul;
          const m = this.moisture[i] + waterDensity * dt * MOISTURE_RATE;
          this.moisture[i] = m < 1 ? m : 1;

          // In direct mode, track water for incidental gas layer cooling.
          // In fog mode, gas layer water is already accounted for above.
          if (mode !== 'fog') {
            totalWaterApplied += waterDensity * dt;
          }
        }
      }
    }

    // Cool the gas layer.
    // Each gallon of water: 1 gal = 3.785 kg. Absorbs 2.6 MJ/kg = 9.84 MJ/gal.
    // Fog mode: 15% efficiency — Barnett data shows 75% of 0.35mm fog droplets
    // evaporate in the gas layer; ~25-40% of nozzle output enters the layer
    // (Srdqvist 20-60% operational range). Combined: 15-30%.
    // 15% = mid-range for good technique. At 150 GPM, 1s burst:
    // 2.5 gal × 9840 × 0.15 / (200 × 1.0) = 18.5°C drop.
    // Direct mode: 2% efficiency — most water hits surfaces as liquid stream,
    // only incidental evaporation en route through the gas layer.
    if (totalWaterApplied > 0 && this.gasLayerTemp > AMBIENT_TEMP) {
      const efficiency = mode === 'fog' ? 0.15 : 0.02;
      const coolingKJ = totalWaterApplied * 9840 * efficiency;
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

    // ── 1. Growth rate ────────────────────────────────────────
    // The NFPA t² growth coefficient (α) controls how fast individual cells
    // intensify. Scale the per-cell growth rate relative to the "fast" baseline.
    // Slow (0.003): 0.064×, Medium (0.012): 0.255×, Fast (0.047): 1.0×, Ultra (0.188): 4.0×
    const cellGrowthRate = 0.15 * (this.growthAlpha / 0.047);
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

    // Actual HRR: what the fire is actually producing. Heats the gas layer,
    // consumes O₂, and drives ceiling jet spread. Only capped by ventilation.
    let actualHRR = totalHRR;
    if (this.ventLimited) {
      actualHRR = 0;
    } else if (ventMaxHRR > 0) {
      actualHRR = Math.min(totalHRR, ventMaxHRR);
    }
    this.totalHRR = actualHRR;

    const gasTemp = this.gasLayerTemp;

    // ── 4. O₂ update (two-zone model) ──────────────────────
    // Fire consumes O₂ from the lower cool layer only. The upper hot layer
    // is O₂-depleted exhaust. The neutral plane divides the room: below it
    // is the cool lower layer (where firefighters breathe and fire draws air),
    // above it is the hot upper layer.
    //
    // Neutral plane height fraction depends on gas layer temperature:
    // at ambient, the whole room is "lower layer" (fraction ≈ 1.0);
    // as the gas heats up, the hot layer descends, compressing the lower layer.
    // At flashover temps the neutral plane is at ~40% of room height.
    //
    // Physics: neutral plane height ≈ H × (1 − ΔT/(ΔT + 300))
    // where ΔT = gasTemp − ambient. At ΔT=0→1.0, ΔT=300→0.5, ΔT=600→0.33.
    const deltaT = Math.max(0, gasTemp - AMBIENT_TEMP);
    const neutralFraction = 1 - deltaT / (deltaT + 300);
    // Lower layer air mass = fraction × total room air mass
    const lowerLayerMass = ROOM_AIR_MASS * Math.max(0.2, neutralFraction);

    // O₂ consumption: Huggett's constant (13.1 MJ per kg O₂ consumed)
    const o2ConsumedKg = (actualHRR * dt / 1000) * O2_PER_MJ;
    // Track O₂ in the lower layer where fire burns
    const o2ChangePercent = (o2ConsumedKg / lowerLayerMass) * 100;
    this.oxygenLevel -= o2ChangePercent;

    // Fresh air inflow through openings replenishes O₂
    let airInflowKgPerSec = 0;
    for (const d of doors) {
      airInflowKgPerSec += 0.5 * DOOR_AREA_M2 * Math.sqrt(DOOR_HEIGHT_M);
    }
    for (const v of ceilingVents) {
      airInflowKgPerSec += 0.5 * VENT_AREA_M2 * Math.sqrt(0.5);
    }
    const freshO2Kg = airInflowKgPerSec * dt * (AMBIENT_O2 / 100);
    const o2ReplenishPercent = (freshO2Kg / lowerLayerMass) * 100;
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
    // Ceiling jet uses actual HRR — it's a physical consequence of what's
    // burning, not limited by the t² growth curve. The t² curve governs
    // how fast individual cells ramp up, not how hot the ceiling jet is.
    let alpertHRR = actualHRR;
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
    const EVAP_RATE = 0.012;  // base ambient evap rate (passive drying)
    const EVAP_ENERGY = 200;  // kJ to evaporate one unit of moisture (m: 0→1)
                              // Physics: 0.1 kg water/ft² × 2,260 kJ/kg ≈ 226 kJ
                              // At 3.6 kW from 3 neighbors: ~56s to fully dry
    const IGNITION_THRESHOLD_KJ = 20; // kJ (spec: 15-25 kJ)

    // Radiative view factors for coplanar 1ft² squares on ceiling grid.
    // From published tables (Howell, "A Catalog of Radiation Heat Transfer
    // Configuration Factors", 3rd ed.) for parallel coplanar squares.
    // Key: dx²+dy² → view factor F₁₂
    const VIEW_FACTOR = { 1: 0.20, 2: 0.12, 4: 0.07, 5: 0.04, 8: 0.02 };

    // Stefan-Boltzmann radiation: Q = ε·σ·F·A·(T⁴_hot − T⁴_cold)
    // ε=0.9 (typical ceiling material), σ=5.67e-8 W/(m²·K⁴), A=0.093 m² (1 ft²)
    // Combined constant: ε·σ·A = 4.75e-9 kW/K⁴
    const RAD_COEFF = 0.9 * 5.67e-8 * 0.093 * 1e-3; // 4.75e-12 kW/K⁴ (σ is W, sim uses kW)
    const T_AMB = 293; // K (20°C)
    const T_AMB_4 = T_AMB * T_AMB * T_AMB * T_AMB;

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
          // Reset exposure: the cell was cooled and wetted, accumulated heat is gone
          if (state === CELL_SUPPRESSED && m < 0.01) {
            state = CELL_UNIGNITED;
            exposure = 0;
          }
        }

        // ── Ceiling vent dissipation ──
        if (h > 0 && this.isCeilingVent(x, y)) {
          h = Math.max(0, h - 0.8 * dt);
          if (h <= 0) state = CELL_UNIGNITED;
        }

        // ── BURNING cells: intensify or cool from moisture ──
        // Same evaporation-first physics as non-burning cells:
        // the cell's own combustion heat must evaporate moisture before
        // it can sustain fire growth. A wet cell's energy goes into
        // boiling water, not feeding flames.
        if (state === CELL_BURNING) {
          if (this.ventLimited) {
            h = Math.max(0, h - 0.02 * dt);
            if (h <= 0) state = CELL_UNIGNITED; // smouldered out
          } else {
            // Cell's combustion output (kW)
            const cellHRR = h * CELL_HRR_MAX;

            // Evaporation-first: only applies when moisture is substantial
            // (≥5%). Trace moisture (<5%) evaporates instantly on a burning
            // surface and doesn't meaningfully impede combustion. Below this
            // threshold, applyWater's direct heat reduction is the primary
            // cooling mechanism; moisture accumulates for post-suppression
            // reignition protection.
            let netFraction = 1;
            if (m >= 0.05) {
              let netHRR = cellHRR;
              const evapFromBurn = Math.min(m, cellHRR * dt / EVAP_ENERGY);
              m -= evapFromBurn;
              netHRR -= evapFromBurn * EVAP_ENERGY / dt;
              if (netHRR < 0) netHRR = 0;
              netFraction = cellHRR > 0 ? netHRR / cellHRR : 1;
            }

            if (netFraction > 0) {
              // Fire can sustain — grow proportional to remaining energy
              h = Math.min(1.0, h + cellGrowthRate * dt * (1.0 - h) * netFraction);
            } else {
              // All energy went to evaporation — fire decays
              h = Math.max(0, h - 0.1 * dt);
            }
          }
          if (h <= 0) {
            state = CELL_SUPPRESSED;
            exposure = 0;
          } else if (h < 0.02) {
            h = Math.max(0, h - 0.05 * dt);
            if (h <= 0) {
              state = CELL_SUPPRESSED;
              exposure = 0;
            }
          }

          // Neighbor radiant heating: hotter neighbors boost this cell's heat.
          // Uses same Stefan-Boltzmann + view factor model.
          // Net radiant input from neighbors that are hotter than this cell.
          if (!this.ventLimited && state === CELL_BURNING) {
            const T_self = T_AMB + h * 780;
            const T_self_4 = T_self * T_self * T_self * T_self;
            let radiantInput = 0;
            for (let ny = y - 2; ny <= y + 2; ny++) {
              for (let nx = x - 2; nx <= x + 2; nx++) {
                if (nx === x && ny === y) continue;
                if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                const nh = heat[ny * cols + nx];
                if (nh <= h) continue; // only hotter neighbors contribute
                const d2 = (nx - x) * (nx - x) + (ny - y) * (ny - y);
                const vf = VIEW_FACTOR[d2];
                if (!vf) continue;
                const T_n = T_AMB + nh * 780;
                const T_n_4 = T_n * T_n * T_n * T_n;
                radiantInput += RAD_COEFF * vf * (T_n_4 - T_self_4);
              }
            }
            // Convert radiant kW to heat increase (normalized by cell HRR capacity)
            if (radiantInput > 0) {
              // Radiant input goes through evaporation first
              if (m > 0) {
                const evapFromRad = Math.min(m, radiantInput * dt / EVAP_ENERGY);
                m -= evapFromRad;
                radiantInput -= evapFromRad * EVAP_ENERGY / dt;
                if (radiantInput < 0) radiantInput = 0;
              }
              h += (radiantInput / CELL_HRR_MAX) * dt;
              h = Math.min(1.0, h);
            }
          }
          exposure = 0; // burning cells don't accumulate exposure
        }

        // ── NON-BURNING cells: accumulate heat exposure ──
        // Physics: incoming heat must first evaporate moisture (latent heat
        // of vaporization). Only after the surface is dry can temperature
        // rise toward ignition. Water at 100°C absorbs ~2,260 kJ/kg;
        // no ignition is possible while liquid water remains.
        if (state !== CELL_BURNING && !this.ventLimited) {
          let incomingHeat = 0;

          // (a) Radiant heat from nearby burning cells (radius 2)
          // Uses Stefan-Boltzmann law with geometric view factors for
          // coplanar 1ft² squares.
          // T_cell = 293 + h × 780 K (linear: h=0→20°C, h=1→800°C)
          let hasBurningNeighbor = false;
          for (let ny = y - 2; ny <= y + 2; ny++) {
            for (let nx = x - 2; nx <= x + 2; nx++) {
              if (nx === x && ny === y) continue;
              if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
              if (cellState[ny * cols + nx] !== CELL_BURNING) continue;
              const nh = heat[ny * cols + nx];
              if (nh <= 0) continue;
              hasBurningNeighbor = true;
              const d2 = (nx - x) * (nx - x) + (ny - y) * (ny - y);
              const vf = VIEW_FACTOR[d2];
              if (!vf) continue;
              const T = T_AMB + nh * 780;
              const T4 = T * T * T * T;
              incomingHeat += RAD_COEFF * vf * (T4 - T_AMB_4);
            }
          }

          // (b) Ceiling jet preheating (Alpert) — only if fire is nearby.
          // The ceiling jet accelerates spread near the fire front but cannot
          // ignite remote cells with no burning neighbors.
          //
          // Directional bias: room airflow deflects the ceiling jet toward
          // the outlet (vents/doors). The jet is hotter and faster downwind
          // (concurrent with airflow) and cooler upwind (opposed).
          // Spec §4.4: concurrent spread 2-5× faster than still-air rate.
          if (hasBurningNeighbor && alpertHRR > 10 && fireWeight > 0) {
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

            // Airflow deflection: scale ceiling jet based on whether this cell
            // is downwind (concurrent) or upwind (opposed) from the fire.
            if (hasAirflow && rFt > 0.5) {
              const ai2 = (y * cols + x) * 2;
              const avx2 = airflow[ai2];
              const avy2 = airflow[ai2 + 1];
              const aMag = Math.sqrt(avx2 * avx2 + avy2 * avy2);
              if (aMag > 0.01) {
                // dot > 0 = cell is downwind of fire (airflow pushes jet toward cell)
                // dot < 0 = cell is upwind (airflow pushes jet away from cell)
                const dirX = dx / rFt, dirY = dy / rFt;
                const dot = dirX * (avx2 / aMag) + dirY * (avy2 / aMag);
                // Concurrent: up to 1.8× jet temperature (airflow boosts velocity
                // more than temperature; ~80% increase is realistic for strong flow).
                // Opposed: down to 0.4× (jet fights against incoming air).
                const jetBias = 1.0 + dot * 0.8; // range: 0.2..1.8
                ceilingJetDT *= Math.max(0.4, Math.min(1.8, jetBias));
              }
            }

            if (ceilingJetDT > 150) {
              incomingHeat += (ceilingJetDT - 150) * 0.01;
            }
          }

          // (c) Gas layer convective heating — ceiling is immersed in hot gas.
          // Natural convection: h_c ≈ 15 W/(m²·K), cell area = 0.093 m².
          // q = h_c × A × (T_gas − T_surface) [kW]
          // T_surface for a non-burning cell ≈ ambient (or higher if preheating).
          if (gasTemp > AMBIENT_TEMP + 10) {
            const surfaceTemp = 20 + (exposure / IGNITION_THRESHOLD_KJ) * 330;
            const gasConvection = 0.015 * 0.093 * Math.max(0, gasTemp - surfaceTemp) * 1e-3;
            incomingHeat += gasConvection;
          }

          // Airflow directional bonus/penalty (spec §4.4)
          if (hasAirflow && incomingHeat > 0) {
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
              // Spec §4.4: concurrent 2-5× faster, opposed 0.3-0.5× of still-air
              // These multiply the radiant exposure rate → directly scale ignition time.
              if (cCount > 0) incomingHeat *= (1.0 + (concurrentBonus / cCount) * 2.5);
              if (oCount > 0 && cCount === 0) incomingHeat *= Math.max(0.3, 1.0 - (opposedPenalty / oCount) * 0.6);
            }
          }

          // Apply edge multiplier (spec §3.2)
          incomingHeat *= edgeMul[i];

          // ── Evaporation-first: heat must dry moisture before raising temperature ──
          if (m > 0 && incomingHeat > 0) {
            // Energy absorbed by evaporation this tick
            const evapFromHeat = Math.min(m, incomingHeat * dt / EVAP_ENERGY);
            m -= evapFromHeat;
            // Subtract evaporated energy from incoming heat
            incomingHeat -= evapFromHeat * EVAP_ENERGY / dt;
            if (incomingHeat < 0) incomingHeat = 0;
          }

          // Only heat remaining AFTER evaporation raises temperature toward ignition
          if (incomingHeat > 0) {
            exposure += incomingHeat * dt;
            if (state === CELL_UNIGNITED && exposure > 0.5) {
              state = CELL_PREHEATING;
            }
          }

          // Surface cooling: exposure decays when heat source is removed.
          // A preheated surface radiates and convects heat back to the
          // environment. Wet surfaces cool faster (evaporative cooling).
          if (exposure > 0) {
            // Passive cooling: ~1 kJ/s radiation/convection to ambient
            // Wet bonus: moisture adds up to 4 kJ/s evaporative cooling
            const passiveCooling = 1.0 + m * 4.0;
            exposure = Math.max(0, exposure - passiveCooling * dt);
            if (exposure < 0.5 && state === CELL_PREHEATING) {
              state = CELL_UNIGNITED;
            }
          }

          // Deterministic ignition when threshold reached (spec §3.4)
          // Requires at least one burning cell within radius 2 — fire
          // spreads from cell to cell, never spontaneously across the room.
          if (exposure >= IGNITION_THRESHOLD_KJ && hasBurningNeighbor) {
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
    this._updateGasLayer(dt, actualHRR);

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

  }

  /** Check win/lose conditions each tick. */
  _checkWinLose(dt) {
    if (this.gameState !== 'running') return;

    // Lose: gas layer too hot (untenable for firefighter)
    if (this.gasLayerTemp > UNTENABLE_TEMP) {
      this.flashoverTimer += dt;
      if (this.flashoverTimer >= 5) {
        this.gameState = 'lose_flashover';
        return;
      }
    } else {
      this.flashoverTimer = 0;
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
