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

export class FireSimulation {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.heat = new Float32Array(cols * rows);
    this.nextHeat = new Float32Array(cols * rows);

    // Tunable parameters (set from admin panel)
    this.spreadSpeed = 1.5;
    this.ignitionThreshold = 0.15;
    this.waterRadius = 2;
    this.sprayPSI = 100;          // nozzle pressure – controls reach & flow rate

    // Vent mechanics
    // Each vent: { x, y, type: 'ceiling'|'door', wall?: 'far'|'left'|'right'|'back' }
    this.vents = [];
    this.ventStrength = 1.0;

    // Airflow vector field: (vx, vy) per cell
    this.airflow = new Float32Array(cols * rows * 2);

    // Obstacles: height per cell (0 = no obstacle, 1+ = stacked blocks in feet)
    this.obstacles = new Uint8Array(cols * rows);

    // Fire start locations: set of grid indices
    this.startLocations = new Set();
  }

  idx(x, y) {
    return y * this.cols + x;
  }

  reset() {
    this.heat.fill(0);
    this.nextHeat.fill(0);
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.heat = new Float32Array(cols * rows);
    this.nextHeat = new Float32Array(cols * rows);
    this.airflow = new Float32Array(cols * rows * 2);
    this.obstacles = new Uint8Array(cols * rows);
    this.startLocations = new Set();
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
   * Compute spray parameters based on cone geometry from nozzle to ceiling.
   *
   * The nozzle produces a cone of water. The spray radius on the ceiling is
   * determined by the cone's half-angle and the distance to the ceiling hit,
   * not a flat base radius. Spraying straight up gives a tight ~0.7ft circle;
   * spraying at an angle elongates into an ellipse as the cone intersects
   * the ceiling obliquely.
   *
   * Cone half-angle scales inversely with PSI (higher pressure = tighter
   * stream). The Spray Width slider acts as a multiplier on the cone angle.
   *
   * Strength is constant until 70% of max reach, then fades linearly.
   * The cone geometry itself handles the natural per-cell reduction at
   * distance (same water volume spread over larger area).
   *
   * playerPos: {x, y, z} in room coords.
   * hitGridX, hitGridY: grid cell the spray is aimed at.
   * Returns null if out of range, or { majorR, minorR, sprayAngle, strengthFactor }.
   */
  getSprayParams(hitGridX, hitGridY, playerPos) {
    const HOSE_HEIGHT = 4;              // hose held at chest level (ft)
    const CEILING_H = 9;               // room ceiling height (ft)
    const verticalDist = CEILING_H - HOSE_HEIGHT; // 5ft

    // 3D distance from hose to ceiling hit point
    const hitWorldX = hitGridX + 0.5;
    const hitWorldZ = hitGridY + 0.5;
    const dx = hitWorldX - playerPos.x;
    const dz = hitWorldZ - playerPos.z;
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    const totalDist = Math.sqrt(horizDist * horizDist + verticalDist * verticalDist);

    // Max reach scales with PSI: ~30 ft at 100 PSI
    const maxReach = this.sprayPSI * 0.3;
    if (totalDist > maxReach) return null;

    // Cone half-angle (radians): ~8° at 100 PSI with waterRadius=2 (narrow fog).
    // Higher PSI = tighter cone. waterRadius slider scales the angle.
    // Base: 8° at 100 PSI, radius=2. Inversely proportional to sqrt(PSI).
    const baseDeg = 8;   // degrees at 100 PSI, waterRadius=2
    const halfAngleDeg = baseDeg * (this.waterRadius / 2) * Math.sqrt(100 / this.sprayPSI);
    const halfAngleRad = halfAngleDeg * Math.PI / 180;

    // Spray radius = distance along the beam × tan(half-angle)
    // Directly overhead (5ft): ~0.7ft. At 15ft away: ~2.1ft.
    const coneRadius = totalDist * Math.tan(halfAngleRad);

    // Incidence angle: 0 = directly overhead, π/2 = horizontal
    const incidenceAngle = Math.atan2(horizDist, verticalDist);

    // On the ceiling, the cone intersects as an ellipse when spraying at an angle.
    // Minor axis (perpendicular to spray direction): cone radius.
    // Major axis (along spray direction): stretches by 1/cos(incidence).
    const cosAngle = Math.max(0.15, Math.cos(incidenceAngle));
    const majorR = Math.max(0.5, coneRadius / cosAngle);
    const minorR = Math.max(0.5, coneRadius);

    // Spray direction angle on the ceiling
    const sprayAngle = Math.atan2(dz, dx);

    // Strength: the same volume of water spreads over a larger ellipse area
    // at distance, so per-cell suppression naturally decreases. We don't
    // apply an additional distance penalty — the cone geometry handles it.
    // Only apply a mild dropoff near max reach where the stream breaks apart.
    const reachRatio = totalDist / maxReach;
    const strengthFactor = reachRatio > 0.7
      ? 1.0 - (reachRatio - 0.7) / 0.3   // linear fade from 70% to 100% of max reach
      : 1.0;

    return {
      majorR,
      minorR,
      sprayAngle,
      strengthFactor,
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

  applyWater(cx, cy, dt, playerPos) {
    const params = playerPos ? this.getSprayParams(cx, cy, playerPos) : null;

    if (playerPos && !params) return; // out of range

    const majorR = params ? params.majorR : this.waterRadius;
    const minorR = params ? params.minorR : this.waterRadius;
    const angle = params ? params.sprayAngle : 0;
    const strengthMul = params ? params.strengthFactor : 1.0;

    // Derive suppression rate from physics:
    // GPM → gallons/sec, distributed over spray ellipse area.
    // COOLING_FACTOR converts gallons/sec/sqft to heat reduction rate.
    // Tuned so 150 GPM overhead (~1.5 sqft area) suppresses a cell in ~0.5s.
    const COOLING_FACTOR = 0.8;
    const gps = this.getGPM() / 60;                      // gallons per second
    const sprayArea = Math.PI * majorR * minorR;          // sq ft
    const suppressionRate = (gps / sprayArea) * COOLING_FACTOR * strengthMul;

    const cosA = Math.cos(-angle);
    const sinA = Math.sin(-angle);
    const rMax = Math.ceil(Math.max(majorR, minorR));

    for (let dy = -rMax; dy <= rMax; dy++) {
      for (let dx = -rMax; dx <= rMax; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) continue;

        // Rotate offset into ellipse-local coords (aligned with spray direction)
        const lx = dx * cosA - dy * sinA;
        const ly = dx * sinA + dy * cosA;

        // Elliptical distance: (lx/majorR)^2 + (ly/minorR)^2 <= 1
        const ellipseDist = (lx * lx) / (majorR * majorR) + (ly * ly) / (minorR * minorR);
        if (ellipseDist > 1.0) continue;

        const falloff = 1.0 - Math.sqrt(ellipseDist);
        const i = this.idx(x, y);
        this.heat[i] = Math.max(0, this.heat[i] - suppressionRate * falloff * dt);
      }
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
    const { cols, rows, heat, nextHeat, spreadSpeed, ignitionThreshold, airflow, ventStrength } = this;
    const hasAirflow = this.vents.length > 0;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = this.idx(x, y);
        let h = heat[i];

        if (h > 0 && this.isCeilingVent(x, y)) {
          h = Math.max(0, h - 0.8 * ventStrength * dt);
        }

        if (h > 0) {
          h = Math.min(1.0, h + 0.3 * dt * (1.0 - h));

          if (hasAirflow) {
            const ai = (y * cols + x) * 2;
            const mag = Math.sqrt(airflow[ai] * airflow[ai] + airflow[ai + 1] * airflow[ai + 1]);
            if (mag > 0.05) {
              h = Math.min(1.0, h + mag * ventStrength * 0.15 * dt);
            }
          }

          if (h < 0.02) {
            h = Math.max(0, h - 0.05 * dt);
          }
        }

        let neighborHeat = 0;
        let count = 0;
        for (let ny = y - 1; ny <= y + 1; ny++) {
          for (let nx = x - 1; nx <= x + 1; nx++) {
            if (nx === x && ny === y) continue;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            const nh = heat[this.idx(nx, ny)];
            if (nh > 0) {
              neighborHeat += nh;
              count++;
            }
          }
        }

        if (count > 0) {
          const avgNeighbor = neighborHeat / count;

          if (h <= 0 && avgNeighbor > ignitionThreshold) {
            let ignitionChance = spreadSpeed * dt * (avgNeighbor - ignitionThreshold) * (count / 8);

            if (hasAirflow) {
              const ai = (y * cols + x) * 2;
              const avx = airflow[ai];
              const avy = airflow[ai + 1];

              if (Math.abs(avx) + Math.abs(avy) > 0.01) {
                let windBonus = 0;
                let windCount = 0;
                for (let ny2 = y - 1; ny2 <= y + 1; ny2++) {
                  for (let nx2 = x - 1; nx2 <= x + 1; nx2++) {
                    if (nx2 === x && ny2 === y) continue;
                    if (nx2 < 0 || nx2 >= cols || ny2 < 0 || ny2 >= rows) continue;
                    if (heat[this.idx(nx2, ny2)] <= 0) continue;

                    const dx = x - nx2;
                    const dy = y - ny2;
                    const dMag = Math.sqrt(dx * dx + dy * dy);
                    const dot = (dx / dMag) * avx + (dy / dMag) * avy;
                    if (dot > 0) {
                      windBonus += dot;
                      windCount++;
                    }
                  }
                }
                if (windCount > 0) {
                  ignitionChance *= (1.0 + ventStrength * (windBonus / windCount) * 2.0);
                }
              }
            }

            if (Math.random() < ignitionChance) {
              h = 0.05 + Math.random() * 0.1;
            }
          } else if (h > 0) {
            const diff = avgNeighbor - h;
            if (diff > 0) {
              h += diff * spreadSpeed * 0.2 * dt;
            }
          }
        }

        nextHeat[i] = Math.max(0, Math.min(1.0, h));
      }
    }

    const tmp = this.heat;
    this.heat = this.nextHeat;
    this.nextHeat = tmp;
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
        spreadSpeed: this.spreadSpeed,
        ignitionThreshold: this.ignitionThreshold,
        waterRadius: this.waterRadius,
        sprayPSI: this.sprayPSI,
        ventStrength: this.ventStrength,
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
}
