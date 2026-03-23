/**
 * Scenario manager – save/load/list room configurations from localStorage.
 *
 * A scenario stores the complete room design:
 *   - Vents (ceiling holes + doors on any wall)
 *   - Obstacles (stackable blocks on floor)
 *   - Fire start locations
 *   - Simulation parameters (spread speed, water strength, etc.)
 */

const STORAGE_KEY = 'flow_scenarios';

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(scenarios) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
}

/** Get list of scenario names (sorted alphabetically) */
export function listScenarios() {
  return Object.keys(loadAll()).sort();
}

/** Save a scenario by name using data from sim.toScenarioData() */
export function saveScenario(name, scenarioData) {
  const all = loadAll();
  all[name] = {
    ...scenarioData,
    savedAt: Date.now(),
  };
  saveAll(all);
}

/** Load a scenario by name. Returns null if not found. */
export function loadScenario(name) {
  const all = loadAll();
  return all[name] || null;
}

/** Delete a scenario by name */
export function deleteScenario(name) {
  const all = loadAll();
  delete all[name];
  saveAll(all);
}

/** Rename a scenario */
export function renameScenario(oldName, newName) {
  const all = loadAll();
  if (all[oldName]) {
    all[newName] = all[oldName];
    delete all[oldName];
    saveAll(all);
  }
}
