/**
 * Fire & Water Ceiling Simulation Engine
 *
 * Grid-based cellular automaton where each cell holds a heat value [0, 1].
 * Fire spreads to neighbors based on heat diffusion; water suppresses heat.
 *
 * Vent mechanics model real fire dynamics:
 *   - Ceiling vents allow hot gas to escape (stack/chimney effect)
 *   - Doors allow fresh air intake at floor level
 *   - Airflow creates a directional bias: air enters doors → feeds fire →
 *     hot gas rises → flows along ceiling toward vents → exits
 *   - Fire spreads faster in the direction of airflow (oxygen supply path)
 */

class FireSimulation {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.heat = new Float32Array(cols * rows);      // current heat 0–1
    this.nextHeat = new Float32Array(cols * rows);   // double-buffer

    // Tunable parameters (set from admin panel)
    this.spreadSpeed = 1.5;       // how fast fire spreads to neighbors
    this.ignitionThreshold = 0.15; // minimum neighbor heat to catch fire
    this.maxIntensity = 1.0;       // cap on heat value
    this.waterStrength = 3.0;      // suppression multiplier
    this.waterRadius = 3;          // radius in cells

    // ── Vent mechanics ──────────────────────────────────────
    // Each vent: { x, y, type: 'ceiling'|'door', wall?: 'far'|'left'|'right'|'back' }
    this.vents = [];
    this.ventStrength = 1.0;       // airflow influence multiplier

    // Airflow vector field: (vx, vy) per cell – direction air flows along ceiling
    this.airflow = new Float32Array(cols * rows * 2);
  }

  /** Index helper */
  idx(x, y) {
    return y * this.cols + x;
  }

  /** Reset the entire grid */
  reset() {
    this.heat.fill(0);
    this.nextHeat.fill(0);
  }

  /** Resize the grid (preserves nothing) */
  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.heat = new Float32Array(cols * rows);
    this.nextHeat = new Float32Array(cols * rows);
    this.airflow = new Float32Array(cols * rows * 2);
  }

  /** Ignite a point with a small radius */
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

  /** Apply water suppression at a point */
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

  // ── Vent management ─────────────────────────────────────

  /** Add a vent or door. Returns the vent object. */
  addVent(x, y, type, wall) {
    // Prevent duplicates at same position
    const existing = this.vents.find(v => v.x === x && v.y === y && v.type === type);
    if (existing) return existing;
    const vent = { x, y, type, wall: wall || null };
    this.vents.push(vent);
    this.recalcAirflow();
    return vent;
  }

  /** Remove a vent at position */
  removeVent(x, y, type) {
    this.vents = this.vents.filter(v => !(v.x === x && v.y === y && v.type === type));
    this.recalcAirflow();
  }

  /** Toggle a vent at position – add if absent, remove if present */
  toggleVent(x, y, type, wall) {
    const idx = this.vents.findIndex(v => v.x === x && v.y === y && v.type === type);
    if (idx >= 0) {
      this.vents.splice(idx, 1);
      this.recalcAirflow();
      return false; // removed
    } else {
      this.addVent(x, y, type, wall);
      return true; // added
    }
  }

  /** Clear all vents */
  clearVents() {
    this.vents = [];
    this.airflow.fill(0);
  }

  /**
   * Recalculate the airflow vector field based on vent positions.
   *
   * Physics model (simplified compartment fire dynamics):
   *
   * 1. Ceiling vents create an "exhaust" pull – hot gas layer at the ceiling
   *    flows laterally toward ceiling vents (stack effect). Each ceiling vent
   *    generates a radial inward flow field that falls off with distance.
   *
   * 2. Doors create an "intake" push – fresh air enters at floor level and
   *    flows inward along the floor, then rises. At the ceiling level, this
   *    manifests as a general flow from the door direction inward. Doors on
   *    the far wall (z=0, grid row 0) push airflow in +y direction on the grid.
   *    Doors on the left wall (x=0, grid col 0) push in +x direction.
   *
   * 3. The combined field: air enters through doors → flows toward fire →
   *    hot gas rises to ceiling → flows toward ceiling vents → exits.
   *    This creates a feedback loop where fire spreads along the airflow path.
   */
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

        // Ceiling vent pull: flow toward each ceiling vent (hot gas layer movement)
        for (const cv of ceilingVents) {
          const dx = cv.x - x;
          const dy = cv.y - y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.5) continue; // at the vent itself

          // Inverse-distance influence (capped), simulating pressure gradient
          const maxDist = Math.sqrt(cols * cols + rows * rows);
          const influence = Math.max(0, 1.0 - dist / maxDist);
          const strength = influence * influence; // quadratic falloff

          // Normalize direction and apply
          vx += (dx / dist) * strength;
          vy += (dy / dist) * strength;
        }

        // Door intake push: fresh air flowing inward from door openings
        for (const door of doors) {
          // Doors push air inward from their wall
          let pushX = 0, pushY = 0;
          if (door.wall === 'far')   pushY = 1;   // far wall (row 0) pushes toward +y
          if (door.wall === 'back')  pushY = -1;   // back wall (row max) pushes toward -y
          if (door.wall === 'left')  pushX = 1;   // left wall (col 0) pushes toward +x
          if (door.wall === 'right') pushX = -1;   // right wall (col max) pushes toward -x

          // Distance from door determines strength of intake airflow
          const dx = x - door.x;
          const dy = y - door.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = Math.sqrt(cols * cols + rows * rows);
          const influence = Math.max(0, 1.0 - dist / maxDist);
          const strength = influence * 0.7; // slightly weaker than vent pull

          vx += pushX * strength;
          vy += pushY * strength;
        }

        // Normalize if non-zero, but preserve magnitude info
        const mag = Math.sqrt(vx * vx + vy * vy);
        if (mag > 0) {
          // Clamp magnitude to [0, 1] range
          const clampedMag = Math.min(mag, 1.0);
          this.airflow[ai] = (vx / mag) * clampedMag;
          this.airflow[ai + 1] = (vy / mag) * clampedMag;
        }
      }
    }
  }

  /** Get airflow vector at cell (x, y) → { vx, vy } */
  getAirflow(x, y) {
    const ai = (y * this.cols + x) * 2;
    return { vx: this.airflow[ai], vy: this.airflow[ai + 1] };
  }

  /** Check if a cell is a ceiling vent */
  isCeilingVent(x, y) {
    return this.vents.some(v => v.type === 'ceiling' && v.x === x && v.y === y);
  }

  /** Advance the simulation by dt seconds */
  step(dt) {
    const { cols, rows, heat, nextHeat, spreadSpeed, ignitionThreshold, maxIntensity, airflow, ventStrength } = this;
    const hasAirflow = this.vents.length > 0;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = this.idx(x, y);
        let h = heat[i];

        // Ceiling vent cells: heat escapes faster (hot gas exits)
        if (h > 0 && this.isCeilingVent(x, y)) {
          h = Math.max(0, h - 0.8 * dt); // rapid heat loss at vents
        }

        if (h > 0) {
          // Burning cells grow toward max intensity
          h = Math.min(maxIntensity, h + 0.3 * dt * (maxIntensity - h));

          // Oxygen boost from airflow: stronger airflow = more O₂ = hotter fire
          if (hasAirflow) {
            const ai = (y * cols + x) * 2;
            const mag = Math.sqrt(airflow[ai] * airflow[ai] + airflow[ai + 1] * airflow[ai + 1]);
            if (mag > 0.05) {
              h = Math.min(maxIntensity, h + mag * ventStrength * 0.15 * dt);
            }
          }

          // Natural decay at very low heat (smoldering dies out)
          if (h < 0.02) {
            h = Math.max(0, h - 0.05 * dt);
          }
        }

        // Heat diffusion from neighbors
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
            // Ignition: unburning cell catches fire from neighbors
            let ignitionChance = spreadSpeed * dt * (avgNeighbor - ignitionThreshold) * (count / 8);

            // Airflow directional bias: fire spreads faster in downwind direction
            if (hasAirflow) {
              // For each burning neighbor, check if airflow pushes toward this cell
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

                    // Direction from burning neighbor to this cell
                    const dx = x - nx2;
                    const dy = y - ny2;
                    const dMag = Math.sqrt(dx * dx + dy * dy);
                    // Dot product: how aligned is airflow with spread direction?
                    const dot = (dx / dMag) * avx + (dy / dMag) * avy;
                    if (dot > 0) {
                      windBonus += dot;
                      windCount++;
                    }
                  }
                }
                if (windCount > 0) {
                  // Boost ignition probability when airflow pushes fire this way
                  ignitionChance *= (1.0 + ventStrength * (windBonus / windCount) * 2.0);
                }
              }
            }

            if (Math.random() < ignitionChance) {
              h = 0.05 + Math.random() * 0.1;
            }
          } else if (h > 0) {
            // Burning cell gains heat from hotter neighbors
            const diff = avgNeighbor - h;
            if (diff > 0) {
              h += diff * spreadSpeed * 0.2 * dt;
            }
          }
        }

        nextHeat[i] = Math.max(0, Math.min(maxIntensity, h));
      }
    }

    // Swap buffers
    const tmp = this.heat;
    this.heat = this.nextHeat;
    this.nextHeat = tmp;
  }

  /** Get stats */
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
}
