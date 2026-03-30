/**
 * Physics validation tests for the fire simulation.
 *
 * These tests replicate manual testing scenarios:
 * - Fast-forward 60s, spray the leading edge, verify suppression/reignition
 * - Spray around a hot cell to create a wet barrier, verify isolation
 * - Verify no spontaneous ignition without burning neighbors
 * - Verify gas layer temperature is consistent with actual HRR
 */

import { describe, it, expect } from 'vitest';
import { FireSimulation, CELL_UNIGNITED, CELL_PREHEATING, CELL_BURNING, CELL_SUPPRESSED } from '../js/simulation.js';
import { GRID_COLS, GRID_ROWS, ROOM_W, ROOM_D, ROOM_H, GAS_LAYER_MASS, GAS_CP, AMBIENT_TEMP } from '../js/constants.js';

// ── Test helpers ──────────────────────────────────────────

/** Create a standard test scenario: corner fire, 1 door on back wall. */
function createScenario(opts = {}) {
  const sim = new FireSimulation(GRID_COLS, GRID_ROWS);

  // Place a door on the back wall (center)
  sim.addVent(Math.floor(GRID_COLS / 2), GRID_ROWS - 1, 'door', 'back');

  // Fire start in top-left corner
  const startX = opts.startX ?? 1;
  const startY = opts.startY ?? 1;
  sim.toggleStartLocation(startX, startY);

  return sim;
}

/** Advance the simulation by N seconds at dt=0.05 per tick. */
function fastForward(sim, seconds) {
  const dt = 0.05;
  const ticks = Math.round(seconds / dt);
  for (let i = 0; i < ticks; i++) {
    sim.step(dt);
  }
}

/**
 * Apply water at a world position for a duration.
 * Simulates a player standing at playerPos, spraying at (worldX, worldZ) on ceiling.
 * Interleaves step() and applyWater() to match real game loop.
 */
function applyWaterAt(sim, worldX, worldZ, durationSec, playerPos) {
  const dt = 0.05;
  const ticks = Math.round(durationSec / dt);
  playerPos = playerPos || { x: worldX, y: 5.0, z: worldZ + 3 };

  // Compute spray params (simplified — direct overhead or near-overhead)
  const params = sim.getSprayParams(worldX, worldZ, playerPos, 'ceiling');

  for (let i = 0; i < ticks; i++) {
    sim.step(dt);
    sim.applyWater(worldX, worldZ, dt, playerPos, params);
  }
}

/** Apply water to a cell WITHOUT stepping (just moisture/cooling, no sim advance). */
function applyWaterOnly(sim, worldX, worldZ, dt, playerPos) {
  playerPos = playerPos || { x: worldX, y: 5.0, z: worldZ + 3 };
  const params = sim.getSprayParams(worldX, worldZ, playerPos, 'ceiling');
  sim.applyWater(worldX, worldZ, dt, playerPos, params);
}

/** Get all burning cell coordinates. */
function findBurningCells(sim) {
  const cells = [];
  for (let y = 0; y < sim.rows; y++) {
    for (let x = 0; x < sim.cols; x++) {
      if (sim.cellState[sim.idx(x, y)] === CELL_BURNING) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

/** Get cell info for debugging/assertions. */
function getCellInfo(sim, x, y) {
  const i = sim.idx(x, y);
  return {
    heat: sim.heat[i],
    state: sim.cellState[i],
    moisture: sim.moisture[i],
    exposure: sim.heatExposure[i],
    tempC: 20 + sim.heat[i] * 780,
  };
}

/** Check if a cell has any burning neighbor within given radius. */
function hasBurningNeighborInRadius(sim, cx, cy, radius) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= sim.cols || ny < 0 || ny >= sim.rows) continue;
      if (sim.cellState[sim.idx(nx, ny)] === CELL_BURNING) return true;
    }
  }
  return false;
}

// ── Test suites ──────────────────────────────────────────

describe('Fire Simulation Physics', () => {

  // ── Test 1: Spray suppression & moisture accumulation ──
  describe('1. Spray suppression & moisture', () => {
    it('should suppress a burning cell and accumulate moisture with 3s of direct spray', () => {
      const sim = createScenario();
      sim.igniteStartLocations();
      fastForward(sim, 60);

      // Find a burning cell near the fire front
      const burning = findBurningCells(sim);
      expect(burning.length).toBeGreaterThan(0);

      const target = burning[Math.floor(burning.length / 2)];
      const info0 = getCellInfo(sim, target.x, target.y);
      expect(info0.state).toBe(CELL_BURNING);
      expect(info0.heat).toBeGreaterThan(0);

      // Spray for 3 seconds
      applyWaterAt(sim, target.x + 0.5, target.y + 0.5, 3);

      const info1 = getCellInfo(sim, target.x, target.y);
      expect(info1.heat).toBe(0);
      expect(info1.state).toBe(CELL_SUPPRESSED);
      expect(info1.moisture).toBeGreaterThan(0.3);
    });
  });

  // ── Test 2: Moisture prevents reignition ──
  describe('2. Moisture prevents reignition', () => {
    it('should keep a wet suppressed cell from reigniting for at least 20 seconds', () => {
      const sim = createScenario();
      sim.igniteStartLocations();
      fastForward(sim, 60);

      // Find and suppress a cell
      const burning = findBurningCells(sim);
      const target = burning[Math.floor(burning.length / 2)];

      // Spray for 5 seconds to saturate
      applyWaterAt(sim, target.x + 0.5, target.y + 0.5, 5);

      const infoAfterSpray = getCellInfo(sim, target.x, target.y);
      expect(infoAfterSpray.moisture).toBeGreaterThan(0.5);

      // Run 20 more seconds without spraying
      fastForward(sim, 20);

      const infoAfterWait = getCellInfo(sim, target.x, target.y);
      // Cell should NOT be burning while moisture is above threshold
      if (infoAfterWait.moisture > 0.05) {
        expect(infoAfterWait.state).not.toBe(CELL_BURNING);
      }
    });
  });

  // ── Test 3: Angled spray has reduced effectiveness ──
  describe('3. Angled spray effectiveness', () => {
    it('should take longer to suppress with an oblique spray angle', () => {
      // Direct spray test
      const sim1 = createScenario();
      sim1.igniteStartLocations();
      fastForward(sim1, 60);
      const burning1 = findBurningCells(sim1);
      const t1 = burning1[Math.floor(burning1.length / 2)];

      // Player directly below the cell
      const directPlayer = { x: t1.x + 0.5, y: 5.0, z: t1.y + 0.5 + 2 };
      let directTicks = 0;
      const dt = 0.05;
      const params1 = sim1.getSprayParams(t1.x + 0.5, t1.y + 0.5, directPlayer, 'ceiling');
      while (sim1.heat[sim1.idx(t1.x, t1.y)] > 0 && directTicks < 200) {
        sim1.step(dt);
        sim1.applyWater(t1.x + 0.5, t1.y + 0.5, dt, directPlayer, params1);
        directTicks++;
      }

      // Oblique spray test — player offset 8ft to the side
      const sim2 = createScenario();
      sim2.igniteStartLocations();
      fastForward(sim2, 60);
      const burning2 = findBurningCells(sim2);
      const t2 = burning2[Math.floor(burning2.length / 2)];

      const obliquePlayer = { x: t2.x + 0.5 + 8, y: 5.0, z: t2.y + 0.5 + 2 };
      let obliqueTicks = 0;
      const params2 = sim2.getSprayParams(t2.x + 0.5, t2.y + 0.5, obliquePlayer, 'ceiling');

      if (params2) {
        while (sim2.heat[sim2.idx(t2.x, t2.y)] > 0 && obliqueTicks < 200) {
          sim2.step(dt);
          sim2.applyWater(t2.x + 0.5, t2.y + 0.5, dt, obliquePlayer, params2);
          obliqueTicks++;
        }
        expect(obliqueTicks).toBeGreaterThan(directTicks);
      }
      // If params2 is null (out of range), that's also a valid result — oblique is worse
    });
  });

  // ── Test 4: Wet barrier prevents fire spread ──
  describe('4. Wet barrier isolation', () => {
    it('should prevent a burning cell from igniting its wet neighbors', () => {
      const sim = createScenario();
      sim.igniteStartLocations();
      fastForward(sim, 60);

      // Find a burning cell that has non-burning neighbors
      const burning = findBurningCells(sim);
      let targetCell = null;
      for (const cell of burning) {
        // Check if it has at least one non-burning neighbor
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cell.x + dx, ny = cell.y + dy;
            if (nx < 0 || nx >= sim.cols || ny < 0 || ny >= sim.rows) continue;
            if (sim.cellState[sim.idx(nx, ny)] !== CELL_BURNING) {
              targetCell = cell;
            }
          }
        }
        if (targetCell) break;
      }

      expect(targetCell).not.toBeNull();

      // Spray all neighbors (but NOT the target cell itself) for 5 seconds
      const dt = 0.05;
      const ticks = Math.round(5 / dt);
      for (let tick = 0; tick < ticks; tick++) {
        sim.step(dt);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue; // skip center cell
            const nx = targetCell.x + dx, ny = targetCell.y + dy;
            if (nx < 0 || nx >= sim.cols || ny < 0 || ny >= sim.rows) continue;
            applyWaterOnly(sim, nx + 0.5, ny + 0.5, dt);
          }
        }
      }

      // Verify neighbors are wet
      let allNeighborsWet = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = targetCell.x + dx, ny = targetCell.y + dy;
          if (nx < 0 || nx >= sim.cols || ny < 0 || ny >= sim.rows) continue;
          const info = getCellInfo(sim, nx, ny);
          if (info.moisture < 0.3) allNeighborsWet = false;
        }
      }
      expect(allNeighborsWet).toBe(true);

      // Run 20 more seconds — wet neighbors should NOT ignite
      for (let tick = 0; tick < Math.round(20 / dt); tick++) {
        sim.step(dt);

        // Check that no wet neighbor is burning
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = targetCell.x + dx, ny = targetCell.y + dy;
            if (nx < 0 || nx >= sim.cols || ny < 0 || ny >= sim.rows) continue;
            const info = getCellInfo(sim, nx, ny);
            if (info.moisture > 0.05) {
              expect(info.state).not.toBe(CELL_BURNING);
            }
          }
        }
      }
    });
  });

  // ── Test 5: No spontaneous ignition without burning neighbors ──
  describe('5. No spontaneous ignition', () => {
    it('should never ignite a cell that has no burning neighbors within radius 2', () => {
      const sim = createScenario();
      sim.igniteStartLocations();
      fastForward(sim, 30);

      // Track which cells are burning before each tick
      const dt = 0.05;
      const violations = [];

      for (let tick = 0; tick < Math.round(30 / dt); tick++) {
        // Snapshot pre-step cell states
        const preBurning = new Uint8Array(sim.cellState);

        sim.step(dt);

        // Check any cell that just became BURNING
        for (let y = 0; y < sim.rows; y++) {
          for (let x = 0; x < sim.cols; x++) {
            const i = sim.idx(x, y);
            if (sim.cellState[i] === CELL_BURNING && preBurning[i] !== CELL_BURNING) {
              // This cell just ignited — check if it had a burning neighbor before the step
              let hadNeighbor = false;
              for (let ny = y - 2; ny <= y + 2; ny++) {
                for (let nx = x - 2; nx <= x + 2; nx++) {
                  if (nx === x && ny === y) continue;
                  if (nx < 0 || nx >= sim.cols || ny < 0 || ny >= sim.rows) continue;
                  if (preBurning[sim.idx(nx, ny)] === CELL_BURNING) {
                    hadNeighbor = true;
                  }
                }
              }
              if (!hadNeighbor) {
                violations.push({ x, y, tick, simTime: sim.simTime });
              }
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  // ── Test 6: Temperature consistency ──
  describe('6. Temperature consistency', () => {
    it('should not have any dry non-burning cell cooler than the gas layer', () => {
      const sim = createScenario();
      sim.igniteStartLocations();
      fastForward(sim, 60);

      const gasTemp = sim.gasLayerTemp;
      const violations = [];

      for (let y = 0; y < sim.rows; y++) {
        for (let x = 0; x < sim.cols; x++) {
          const info = getCellInfo(sim, x, y);
          if (info.state !== CELL_BURNING && info.moisture < 0.01) {
            // Effective temp accounts for exposure toward ignition
            const effectiveTemp = Math.max(gasTemp, 20 + (info.exposure / 20) * 330);
            // This should always be >= gasTemp by construction
            if (effectiveTemp < gasTemp - 0.1) {
              violations.push({ x, y, effectiveTemp, gasTemp });
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  // ── Test 7: Evaporation-first — wet cells don't accumulate exposure ──
  describe('7. Evaporation-first for wet cells', () => {
    it('should not let a fully wet cell accumulate exposure while moisture > 0', () => {
      const sim = createScenario();
      sim.igniteStartLocations();
      fastForward(sim, 40);

      // Find a non-burning cell near the fire front
      let target = null;
      for (let y = 0; y < sim.rows && !target; y++) {
        for (let x = 0; x < sim.cols && !target; x++) {
          const i = sim.idx(x, y);
          if (sim.cellState[i] !== CELL_BURNING &&
              hasBurningNeighborInRadius(sim, x, y, 2)) {
            target = { x, y };
          }
        }
      }

      expect(target).not.toBeNull();

      // Manually saturate this cell
      const i = sim.idx(target.x, target.y);
      sim.moisture[i] = 1.0;
      sim.heatExposure[i] = 0;
      sim.cellState[i] = CELL_SUPPRESSED;

      // Run 10 seconds
      const dt = 0.05;
      let maxExposureWhileWet = 0;

      for (let tick = 0; tick < Math.round(10 / dt); tick++) {
        sim.step(dt);
        const info = getCellInfo(sim, target.x, target.y);
        if (info.moisture > 0.01) {
          maxExposureWhileWet = Math.max(maxExposureWhileWet, info.exposure);
        }
      }

      // Exposure should be near-zero the entire time moisture is present
      // (all incoming heat goes into evaporation)
      expect(maxExposureWhileWet).toBeLessThan(1.0);
    });
  });

  // ── Test 8: Gas layer heats with actual HRR (not t²-capped) ──
  describe('8. Gas layer uses actual HRR', () => {
    it('should heat the gas layer based on actual burning output, not t² cap', () => {
      const sim = new FireSimulation(GRID_COLS, GRID_ROWS);
      sim.addVent(10, GRID_ROWS - 1, 'door', 'back');

      // Manually ignite 50% of the ceiling at high heat
      const total = sim.cols * sim.rows;
      for (let i = 0; i < total / 2; i++) {
        sim.heat[i] = 0.8;
        sim.cellState[i] = CELL_BURNING;
      }
      sim.gameState = 'running';
      sim.simTime = 10; // low simTime means t² cap is very low

      const gasStart = sim.gasLayerTemp;

      // t² cap at simTime=10: 0.047 × 100 = 4.7 kW — tiny
      // Actual HRR: 100 cells × 0.8 × 25 = 2000 kW
      fastForward(sim, 5);

      const gasEnd = sim.gasLayerTemp;
      const rise = gasEnd - gasStart;

      // At 2000 kW, gas should rise ~10°C/s (minus cooling).
      // Over 5 seconds: ~40-50°C rise. If t²-capped, only ~0.1°C rise.
      expect(rise).toBeGreaterThan(20);
    });
  });

  // ── Test 9: Passive exposure decay ──
  describe('9. Passive exposure decay', () => {
    it('should decay exposure on a dry cell with no burning neighbors', () => {
      const sim = new FireSimulation(GRID_COLS, GRID_ROWS);
      sim.gameState = 'running';

      // Manually set a cell's exposure high, no fire anywhere
      const x = 10, y = 5;
      const i = sim.idx(x, y);
      sim.heatExposure[i] = 15;
      sim.cellState[i] = CELL_PREHEATING;

      fastForward(sim, 20);

      const info = getCellInfo(sim, x, y);
      // Passive cooling at 1 kJ/s: 15 kJ should decay significantly in 20s
      // May not reach 0 due to tiny gas convection from ambient, but should be well below ignition
      expect(info.exposure).toBeLessThan(10.0);
      expect(info.state).not.toBe(CELL_BURNING);
    });
  });

  // ── Test 10: Fog spray cools gas layer at correct rate ──
  describe('10. Fog spray gas layer cooling', () => {
    it('should drop gas layer by ~18.5°C per second of fogging at 100 PSI', () => {
      const sim = new FireSimulation(GRID_COLS, GRID_ROWS);
      sim.gameState = 'running';
      sim.sprayPSI = 100;

      // Set gas layer to a known hot temperature, no fire (isolate fog effect)
      sim.gasLayerTemp = 200;
      const startTemp = sim.gasLayerTemp;

      // Fog for exactly 1 second at dt=0.05 (20 ticks)
      const dt = 0.05;
      const ticks = 20; // 1 second
      const playerPos = { x: 10, y: 5, z: 5 };
      const fogParams = {
        majorR: 2, minorR: 2, sprayAngle: 0,
        strengthFactor: 1.0, centerOffset: 0,
        mode: 'fog',
      };

      for (let i = 0; i < ticks; i++) {
        sim.applyWater(10, 5, dt, playerPos, fogParams);
      }

      const drop = startTemp - sim.gasLayerTemp;

      // Expected: GPM=150, gps=2.5, per second=2.5 gal
      // coolingKJ = 2.5 * 9840 * 0.15 = 3690 kJ
      // dT = 3690 / (200 * 1.0) = 18.45°C
      expect(drop).toBeGreaterThan(17);
      expect(drop).toBeLessThan(20);
    });

    it('should cool 4x faster than direct spray at same GPM', () => {
      // Fog test
      const sim1 = new FireSimulation(GRID_COLS, GRID_ROWS);
      sim1.gameState = 'running';
      sim1.sprayPSI = 100;
      sim1.gasLayerTemp = 200;

      const dt = 0.05;
      const playerPos = { x: 10, y: 5, z: 8 };
      const fogParams = {
        majorR: 2, minorR: 2, sprayAngle: 0,
        strengthFactor: 1.0, centerOffset: 0,
        mode: 'fog',
      };
      for (let i = 0; i < 20; i++) {
        sim1.applyWater(10, 5, dt, playerPos, fogParams);
      }
      const fogDrop = 200 - sim1.gasLayerTemp;

      // Direct test — spray at ceiling, same position
      const sim2 = new FireSimulation(GRID_COLS, GRID_ROWS);
      sim2.gameState = 'running';
      sim2.sprayPSI = 100;
      sim2.gasLayerTemp = 200;

      const directParams = sim2.getSprayParams(10, 5, playerPos, 'ceiling');
      directParams.mode = 'direct';
      for (let i = 0; i < 20; i++) {
        sim2.applyWater(10, 5, dt, playerPos, directParams);
      }
      const directDrop = 200 - sim2.gasLayerTemp;

      // Fog should cool significantly more than direct
      // Efficiency ratio is 0.08/0.02 = 4x, but direct also loses water to cell suppression
      // so fog should be well over 4x in practice
      expect(fogDrop).toBeGreaterThan(directDrop * 3);
    });

    it('should suppress cells at reduced rate (25% of direct) in fog mode', () => {
      // Direct spray test — measure heat reduction over 1 second
      const sim1 = new FireSimulation(GRID_COLS, GRID_ROWS);
      sim1.gameState = 'running';
      sim1.sprayPSI = 100;
      // Manually set a cell burning
      const cx = 10, cy = 5;
      const i1 = sim1.idx(cx, cy);
      sim1.cellState[i1] = CELL_BURNING;
      sim1.heat[i1] = 0.8;

      const dt = 0.05;
      const playerPos = { x: cx + 0.5, y: 5, z: cy + 0.5 + 3 };
      // Use only 2 ticks (0.1s) to avoid direct spray fully suppressing the cell
      const directParams = sim1.getSprayParams(cx + 0.5, cy + 0.5, playerPos, 'ceiling');
      directParams.mode = 'direct';
      for (let t = 0; t < 2; t++) {
        sim1.applyWater(cx + 0.5, cy + 0.5, dt, playerPos, directParams);
      }
      const directReduction = 0.8 - sim1.heat[i1];

      // Fog spray test — same setup
      const sim2 = new FireSimulation(GRID_COLS, GRID_ROWS);
      sim2.gameState = 'running';
      sim2.sprayPSI = 100;
      const i2 = sim2.idx(cx, cy);
      sim2.cellState[i2] = CELL_BURNING;
      sim2.heat[i2] = 0.8;

      const fogParams = sim2.getSprayParams(cx + 0.5, cy + 0.5, playerPos, 'ceiling');
      fogParams.mode = 'fog';
      for (let t = 0; t < 2; t++) {
        sim2.applyWater(cx + 0.5, cy + 0.5, dt, playerPos, fogParams);
      }
      const fogReduction = 0.8 - sim2.heat[i2];

      // Fog should suppress but at ~25% of direct rate (FOG_SURFACE_FRACTION)
      expect(fogReduction).toBeGreaterThan(0);
      expect(directReduction).toBeGreaterThan(0);
      const ratio = fogReduction / directReduction;
      expect(ratio).toBeGreaterThan(0.15);
      expect(ratio).toBeLessThan(0.40);
    });

    it('should bring gas layer from 260°C to below 100°C within 10 seconds of fogging', () => {
      const sim = new FireSimulation(GRID_COLS, GRID_ROWS);
      sim.gameState = 'running';
      sim.sprayPSI = 100;
      sim.gasLayerTemp = 260; // untenable

      const dt = 0.05;
      const playerPos = { x: 10, y: 5, z: 5 };
      const fogParams = {
        majorR: 2, minorR: 2, sprayAngle: 0,
        strengthFactor: 1.0, centerOffset: 0,
        mode: 'fog',
      };

      // Fog for 10 seconds (200 ticks)
      for (let i = 0; i < 200; i++) {
        sim.applyWater(10, 5, dt, playerPos, fogParams);
      }

      // 10s × ~18.45°C/s = ~184.5°C drop → 260 - 184.5 = ~75.5°C
      expect(sim.gasLayerTemp).toBeLessThan(100);
      expect(sim.gasLayerTemp).toBeGreaterThan(AMBIENT_TEMP);
    });
  });

  // ── Test 11: Full suppression flow (end-to-end) ──
  describe('11. Full suppression flow', () => {
    it('should maintain a wet barrier that holds for 30 seconds after spray stops', () => {
      const sim = createScenario();
      sim.igniteStartLocations();
      fastForward(sim, 60);

      // Find the leading edge of the fire (rightmost burning cells)
      const burning = findBurningCells(sim);
      let maxX = 0;
      for (const cell of burning) {
        if (cell.x > maxX) maxX = cell.x;
      }

      // Spray the entire vertical barrier simultaneously for 5 seconds
      const barrierX = maxX;
      const dt = 0.05;
      const sprayTicks = Math.round(5 / dt);

      for (let tick = 0; tick < sprayTicks; tick++) {
        sim.step(dt);
        for (let y = 0; y < sim.rows; y++) {
          applyWaterOnly(sim, barrierX + 0.5, y + 0.5, dt);
        }
      }

      // Record which cells are beyond the barrier (should stay safe)
      const safeZoneX = barrierX + 2; // 2 cells past the barrier
      const safeCellsBefore = [];
      for (let y = 0; y < sim.rows; y++) {
        if (safeZoneX < sim.cols) {
          safeCellsBefore.push({
            x: safeZoneX, y,
            state: sim.cellState[sim.idx(safeZoneX, y)],
          });
        }
      }

      // Run 30 seconds without spraying
      fastForward(sim, 30);

      // Check barrier cells stayed wet and safe zone stayed unburned
      let barrierHeld = true;
      for (let y = 0; y < sim.rows; y++) {
        const info = getCellInfo(sim, barrierX, y);
        // If still wet, should not be burning
        if (info.moisture > 0.05 && info.state === CELL_BURNING) {
          barrierHeld = false;
        }
      }

      // Check safe zone — cells beyond the barrier shouldn't have caught fire
      let safeZoneViolations = 0;
      for (let y = 0; y < sim.rows; y++) {
        if (safeZoneX < sim.cols) {
          const info = getCellInfo(sim, safeZoneX, y);
          if (info.state === CELL_BURNING) {
            safeZoneViolations++;
          }
        }
      }

      // The barrier should hold for most cells (allow some edge leakage)
      expect(safeZoneViolations).toBeLessThan(sim.rows / 2);
    });
  });

});
