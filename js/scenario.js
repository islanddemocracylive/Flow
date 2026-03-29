/**
 * Scenario manager – save/load/list room configurations via server API (S3-backed).
 *
 * Scenarios are stored by UUID. The server maintains an index mapping
 * UUID → display name, so renames don't move S3 objects.
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

/** Get list of scenarios [{id, name, updatedAt}] sorted by name */
export async function listScenarios() {
  const res = await handleResponse(await fetch('/api/scenarios'));
  if (!res.ok) return [];
  return await res.json();
}

/** Create a new scenario. Returns {id, name}. */
export async function createScenario(name, scenarioData) {
  const res = await handleResponse(await fetch('/api/scenarios', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data: scenarioData }),
  }));
  if (!res.ok) throw new Error('Failed to create scenario');
  return await res.json();
}

/** Save scenario data and/or rename. */
export async function saveScenario(id, { name, data }) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (data !== undefined) body.data = data;
  const res = await handleResponse(await fetch(`/api/scenarios/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  if (!res.ok) throw new Error('Failed to save scenario');
}

/** Load a scenario by id. Returns null if not found. */
export async function loadScenario(id) {
  const res = await handleResponse(await fetch(`/api/scenarios/${encodeURIComponent(id)}`));
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return await res.json();
}

/** Delete a scenario by id */
export async function deleteScenario(id) {
  const res = await handleResponse(await fetch(`/api/scenarios/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }));
  if (!res.ok) throw new Error('Failed to delete scenario');
}
