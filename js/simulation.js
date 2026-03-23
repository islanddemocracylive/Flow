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
    this.maxIntensity = 1.0;
    this.waterStrength = 3.0;
    this.waterRadius = 3;

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
          this.heat[i] = Math.min(this.maxIntensity, Math.max(this.heat[i], strength));
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

  applyWater(cx, cy, dt) {
    const r = this.waterRadius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= r) {
          const falloff = 1.0 - (dist / r);
          const i = this.idx(x, y);
          this.heat[i] = Math.max(0, this.heat[i] - this.waterStrength * falloff * dt);
        }
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

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let vx = 0;
        let vy = 0;
        const ai = (y * cols + x) * 2;

        for (const cv of ceilingVents) {
          const dx = cv.x - x;
          const dy = cv.y - y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.5) continue;

          const maxDist = Math.sqrt(cols * cols + rows * rows);
          const influence = Math.max(0, 1.0 - dist / maxDist);
          const strength = influence * influence;

          vx += (dx / dist) * strength;
          vy += (dy / dist) * strength;
        }

        for (const door of doors) {
          let pushX = 0, pushY = 0;
          if (door.wall === 'far')   pushY = 1;
          if (door.wall === 'back')  pushY = -1;
          if (door.wall === 'left')  pushX = 1;
          if (door.wall === 'right') pushX = -1;

          const dx = x - door.x;
          const dy = y - door.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = Math.sqrt(cols * cols + rows * rows);
          const influence = Math.max(0, 1.0 - dist / maxDist);
          const strength = influence * 0.7;

          vx += pushX * strength;
          vy += pushY * strength;
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
    const { cols, rows, heat, nextHeat, spreadSpeed, ignitionThreshold, maxIntensity, airflow, ventStrength } = this;
    const hasAirflow = this.vents.length > 0;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = this.idx(x, y);
        let h = heat[i];

        if (h > 0 && this.isCeilingVent(x, y)) {
          h = Math.max(0, h - 0.8 * dt);
        }

        if (h > 0) {
          h = Math.min(maxIntensity, h + 0.3 * dt * (maxIntensity - h));

          if (hasAirflow) {
            const ai = (y * cols + x) * 2;
            const mag = Math.sqrt(airflow[ai] * airflow[ai] + airflow[ai + 1] * airflow[ai + 1]);
            if (mag > 0.05) {
              h = Math.min(maxIntensity, h + mag * ventStrength * 0.15 * dt);
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

        nextHeat[i] = Math.max(0, Math.min(maxIntensity, h));
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
        maxIntensity: this.maxIntensity,
        waterStrength: this.waterStrength,
        waterRadius: this.waterRadius,
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
