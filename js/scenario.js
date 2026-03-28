/**
 * Scenario manager – save/load/list room configurations via server API (S3-backed).
 *
 * A scenario stores the complete room design:
 *   - Vents (ceiling holes + doors on any wall)
 *   - Obstacles (stackable blocks on floor)
 *   - Fire start locations
 *   - Simulation parameters (spread speed, water strength, etc.)
 *
 * All functions are async and communicate with /api/scenarios/* endpoints.
 */

async function handleResponse(res) {
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }
  return res;
}

/** Get list of scenario names (sorted alphabetically) */
export async function listScenarios() {
  const res = await handleResponse(await fetch('/api/scenarios'));
  if (!res.ok) return [];
  return await res.json();
}

/** Save a scenario by name using data from sim.toScenarioData() */
export async function saveScenario(name, scenarioData) {
  const res = await handleResponse(await fetch(`/api/scenarios/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scenarioData),
  }));
  if (!res.ok) throw new Error('Failed to save scenario');
}

/** Load a scenario by name. Returns null if not found. */
export async function loadScenario(name) {
  const res = await handleResponse(await fetch(`/api/scenarios/${encodeURIComponent(name)}`));
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return await res.json();
}

/** Delete a scenario by name */
export async function deleteScenario(name) {
  const res = await handleResponse(await fetch(`/api/scenarios/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  }));
  if (!res.ok) throw new Error('Failed to delete scenario');
}
