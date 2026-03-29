/**
 * Admin panel: design modes, scenario management, sliders, play/stop, mobile layout.
 */

import { listScenarios, createScenario, saveScenario, loadScenario, deleteScenario } from './scenario.js';

const canvas = document.getElementById('simulation-canvas');

export function setupAdminPanel(sim, state, net) {
  // ── Design mode buttons ────────────────────────────────

  const btnModeStart = document.getElementById('btn-mode-start');
  const btnModeVent = document.getElementById('btn-mode-vent');
  const btnModeDoor = document.getElementById('btn-mode-door');
  const btnModeObstacle = document.getElementById('btn-mode-obstacle');
  const btnClearAll = document.getElementById('btn-clear-all');

  const modeButtons = {
    'start-location': btnModeStart,
    'ceiling-vent': btnModeVent,
    'door': btnModeDoor,
    'obstacle': btnModeObstacle,
  };

  function setDesignMode(mode) {
    if (state.designMode === mode) {
      state.designMode = null;
    } else {
      state.designMode = mode;
    }
    // Update button active states
    for (const [m, btn] of Object.entries(modeButtons)) {
      if (btn) btn.classList.toggle('active', state.designMode === m);
    }
    if (canvas) canvas.style.cursor = state.designMode ? 'cell' : 'default';
  }

  if (btnModeStart) btnModeStart.addEventListener('click', () => setDesignMode('start-location'));
  if (btnModeVent) btnModeVent.addEventListener('click', () => setDesignMode('ceiling-vent'));
  if (btnModeDoor) btnModeDoor.addEventListener('click', () => setDesignMode('door'));
  if (btnModeObstacle) btnModeObstacle.addEventListener('click', () => setDesignMode('obstacle'));

  if (btnClearAll) btnClearAll.addEventListener('click', () => {
    sim.clearVents();
    sim.obstacles.fill(0);
    sim.startLocations.clear();
    sim.reset();
    state.designMode = null;
    for (const btn of Object.values(modeButtons)) {
      if (btn) btn.classList.remove('active');
    }
    if (canvas) canvas.style.cursor = 'default';
  });

  // ── Scenario management ─────────────────────────────────

  const scenarioSelect = document.getElementById('scenario-select');
  const scenarioName = document.getElementById('scenario-name');
  const btnSave = document.getElementById('btn-save-scenario');
  const btnDelete = document.getElementById('btn-delete-scenario');

  // Track the currently selected scenario UUID
  let currentScenarioId = null;

  async function refreshScenarioList() {
    if (!scenarioSelect) return [];
    const scenarios = await listScenarios();
    const currentId = currentScenarioId;
    scenarioSelect.innerHTML = '<option value="">— New Scenario —</option>';
    for (const s of scenarios) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      scenarioSelect.appendChild(opt);
    }
    if (currentId && scenarios.some(s => s.id === currentId)) {
      scenarioSelect.value = currentId;
    }
    return scenarios;
  }

  // Initial load + auto-select first scenario
  refreshScenarioList().then(scenarios => {
    if (scenarioSelect && scenarios.length > 0) {
      scenarioSelect.value = scenarios[0].id;
      scenarioSelect.dispatchEvent(new Event('change'));
    }
  });

  if (scenarioSelect) {
    scenarioSelect.addEventListener('change', async () => {
      const id = scenarioSelect.value;
      currentScenarioId = id || null;
      // Show the scenario name in the text input
      if (scenarioName) {
        const opt = scenarioSelect.selectedOptions[0];
        scenarioName.value = id ? opt.textContent : '';
      }
      // Auto-load scenario on selection
      if (id) {
        const data = await loadScenario(id);
        if (data) {
          sim.loadScenarioData(data);
          syncSliders(sim);
          state.playing = false;
          updatePlayButton();
        }
      }
    });
  }

  if (btnSave) btnSave.addEventListener('click', async () => {
    const name = scenarioName ? scenarioName.value.trim() : '';
    if (!name) { alert('Enter a scenario name'); return; }
    btnSave.disabled = true;
    btnSave.textContent = 'Saving...';
    try {
      if (currentScenarioId) {
        // Update existing scenario
        await saveScenario(currentScenarioId, { name, data: sim.toScenarioData() });
      } else {
        // Create new scenario with UUID
        const result = await createScenario(name, sim.toScenarioData());
        currentScenarioId = result.id;
      }
      await refreshScenarioList();
      if (scenarioSelect && currentScenarioId) scenarioSelect.value = currentScenarioId;
    } catch (err) {
      alert('Failed to save scenario: ' + err.message);
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = 'Save';
    }
  });

  if (btnDelete) btnDelete.addEventListener('click', async () => {
    const id = currentScenarioId;
    if (!id) return;
    const name = scenarioName ? scenarioName.value : id;
    if (confirm(`Delete scenario "${name}"?`)) {
      btnDelete.disabled = true;
      try {
        await deleteScenario(id);
        currentScenarioId = null;
        await refreshScenarioList();
        if (scenarioName) scenarioName.value = '';
      } catch (err) {
        alert('Failed to delete scenario: ' + err.message);
      } finally {
        btnDelete.disabled = false;
      }
    }
  });

  // ── Play / Stop (single toggle button in tab bar) ──────

  const btnPlay = document.getElementById('btn-play');
  const btnReset = document.getElementById('btn-reset');

  function updatePlayButton() {
    if (!btnPlay) return;
    if (state.playing) {
      btnPlay.textContent = 'Stop Scenario';
      btnPlay.classList.add('playing');
    } else {
      btnPlay.textContent = 'Run Scenario';
      btnPlay.classList.remove('playing');
    }
  }

  if (btnPlay) btnPlay.addEventListener('click', () => {
    if (state.playing) {
      // Stop
      state.playing = false;
      state.paused = true;
    } else {
      // Play: validate, reset, ignite
      if (sim.startLocations.size === 0) {
        alert('Place at least one fire start location before playing.');
        return;
      }
      sim.reset();
      sim.igniteStartLocations();
      state.playing = true;
      state.paused = false;
    }
    updatePlayButton();
  });

  if (btnReset) btnReset.addEventListener('click', () => {
    sim.reset();
    state.playing = false;
    state.paused = false;
    updatePlayButton();
    if (net && net.connected) net.sendReset();
  });

  updatePlayButton();

  // ── Rewind / Fast-forward ─────────────────────────────────

  const btnRewind = document.getElementById('btn-rewind');
  const btnFfwd = document.getElementById('btn-ffwd');
  const SKIP_SECONDS = 30;
  const SNAPSHOT_INTERVAL = 5;  // save snapshot every 5 sim-seconds
  const MAX_SNAPSHOTS = 120;    // keep up to 10 minutes of history
  const snapshots = [];
  let lastSnapshotTime = -Infinity;

  function updateTimeButtons() {
    if (btnRewind) btnRewind.disabled = !state.playing || snapshots.length === 0;
    if (btnFfwd) btnFfwd.disabled = !state.playing;
  }

  /** Called from the main loop to periodically save snapshots */
  function maybeTakeSnapshot() {
    if (!state.playing || state.paused) return;
    if (sim.simTime - lastSnapshotTime >= SNAPSHOT_INTERVAL) {
      snapshots.push(sim.takeSnapshot());
      if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
      lastSnapshotTime = sim.simTime;
      updateTimeButtons();
    }
  }

  if (btnRewind) btnRewind.addEventListener('click', () => {
    if (!state.playing || snapshots.length === 0) return;
    // Find the snapshot closest to 30s ago
    const targetTime = sim.simTime - SKIP_SECONDS;
    let best = snapshots[0];
    for (const snap of snapshots) {
      if (snap.simTime <= targetTime) best = snap;
    }
    sim.restoreSnapshot(best);
    // Remove snapshots newer than the restored time
    while (snapshots.length > 0 && snapshots[snapshots.length - 1].simTime > best.simTime) {
      snapshots.pop();
    }
    lastSnapshotTime = sim.simTime;
    updateTimeButtons();
    if (net && net.connected) net.sendState(sim);
  });

  if (btnFfwd) btnFfwd.addEventListener('click', () => {
    if (!state.playing) return;
    // Take a snapshot before fast-forwarding so we can rewind back
    snapshots.push(sim.takeSnapshot());
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
    sim.fastForward(SKIP_SECONDS);
    lastSnapshotTime = sim.simTime;
    updateTimeButtons();
    if (net && net.connected) net.sendState(sim);
  });

  // Expose snapshot-taking for the main loop
  if (typeof window !== 'undefined') {
    window._flowStateSnapshot = maybeTakeSnapshot;
  }

  // Reset snapshots when play starts or resets
  const origPlayClick = btnPlay ? btnPlay.onclick : null;
  function resetSnapshots() {
    snapshots.length = 0;
    lastSnapshotTime = -Infinity;
    updateTimeButtons();
  }

  // Patch play button to also reset snapshots
  if (btnPlay) {
    const playHandler = btnPlay.onclick;
    // The addEventListener above already handles click — add snapshot reset
    btnPlay.addEventListener('click', () => {
      if (!state.playing) resetSnapshots(); // just started
      updateTimeButtons();
    });
  }
  if (btnReset) {
    btnReset.addEventListener('click', resetSnapshots);
  }

  updateTimeButtons();

  // ── Sliders ─────────────────────────────────────────────

  function bindSlider(id, displayId, prop, format) {
    const slider = document.getElementById(id);
    const display = document.getElementById(displayId);
    if (!slider || !display) return;
    const update = () => {
      const v = parseFloat(slider.value);
      sim[prop] = v;
      display.textContent = format ? format(v) : v;
      if (net && net.connected) net.sendParams({ [prop]: v });
    };
    slider.addEventListener('input', update);
    update();
  }

  // Growth rate slider — display as category label
  function growthLabel(v) {
    if (v <= 0.006) return 'Slow';
    if (v <= 0.025) return 'Medium';
    if (v <= 0.1) return 'Fast';
    return 'Ultra-fast';
  }
  bindSlider('growth-alpha', 'growth-alpha-val', 'growthAlpha', growthLabel);
  bindSlider('water-radius', 'water-radius-val', 'waterRadius');
  bindSlider('spray-psi', 'spray-psi-val', 'sprayPSI');

  // GPM readout: updates whenever PSI slider changes
  function updateGPMDisplay() {
    const gpmEl = document.getElementById('spray-gpm-val');
    if (gpmEl) gpmEl.textContent = Math.round(sim.getGPM()) + ' GPM';
  }
  const psiSlider = document.getElementById('spray-psi');
  if (psiSlider) psiSlider.addEventListener('input', updateGPMDisplay);
  updateGPMDisplay();

  function syncSliders(sim) {
    const pairs = [
      ['growth-alpha', 'growth-alpha-val', 'growthAlpha', growthLabel],
      ['water-radius', 'water-radius-val', 'waterRadius', null],
      ['spray-psi', 'spray-psi-val', 'sprayPSI', null],
    ];
    for (const [sliderId, displayId, prop, format] of pairs) {
      const slider = document.getElementById(sliderId);
      const display = document.getElementById(displayId);
      if (slider) slider.value = sim[prop];
      if (display) display.textContent = format ? format(sim[prop]) : sim[prop];
    }
    updateGPMDisplay();
  }

  // Grid checkbox
  const checkboxGrid = document.getElementById('show-grid');
  if (checkboxGrid) {
    checkboxGrid.addEventListener('change', () => {
      state.showGrid = checkboxGrid.checked;
    });
  }

  // ── Logout button ──────────────────────────────────────
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });
  }

  // ── Mobile panel toggle ─────────────────────────────────

  const togglePanelBtn = document.getElementById('toggle-panel-btn');
  const adminPanel = document.getElementById('admin-panel');

  function checkMobile() {
    const isMobile = window.innerWidth <= 700;
    if (!isMobile && adminPanel) adminPanel.classList.remove('open');
  }
  checkMobile();
  window.addEventListener('resize', checkMobile);

  if (togglePanelBtn) {
    togglePanelBtn.addEventListener('click', () => {
      adminPanel.classList.toggle('open');
      togglePanelBtn.textContent = adminPanel.classList.contains('open') ? '\u2715' : '\u2699';
    });
  }
}

export function updateStats(_sim) {
  // Stats display removed from UI — kept as no-op for callers
}
