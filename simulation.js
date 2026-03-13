/**
 * Fire & Water Ceiling Simulation Engine
 *
 * Grid-based cellular automaton where each cell holds a heat value [0, 1].
 * Fire spreads to neighbors based on heat diffusion; water suppresses heat.
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

  /** Advance the simulation by dt seconds */
  step(dt) {
    const { cols, rows, heat, nextHeat, spreadSpeed, ignitionThreshold, maxIntensity } = this;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = this.idx(x, y);
        let h = heat[i];

        if (h > 0) {
          // Burning cells grow toward max intensity
          h = Math.min(maxIntensity, h + 0.3 * dt * (maxIntensity - h));

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
            // Probability increases with neighbor heat and count
            const ignitionChance = spreadSpeed * dt * (avgNeighbor - ignitionThreshold) * (count / 8);
            // Add slight randomness for natural-looking spread
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
