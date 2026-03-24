/**
 * Admin panel: design modes, scenario management, sliders, play/stop, mobile layout.
 */

import { listScenarios, saveScenario, loadScenario, deleteScenario } from './scenario.js';

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

  function refreshScenarioList() {
    if (!scenarioSelect) return;
    const names = listScenarios();
    // Preserve current selection if possible
    const current = scenarioSelect.value;
    scenarioSelect.innerHTML = '<option value="">— New Scenario —</option>';
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      scenarioSelect.appendChild(opt);
    }
    if (names.includes(current)) {
      scenarioSelect.value = current;
    }
  }

  refreshScenarioList();

  if (scenarioSelect) {
    scenarioSelect.addEventListener('change', () => {
      const name = scenarioSelect.value;
      if (scenarioName) scenarioName.value = name;
      // Auto-load scenario on selection
      if (name) {
        const data = loadScenario(name);
        if (data) {
          sim.loadScenarioData(data);
          syncSliders(sim);
          state.playing = false;
          updatePlayStopButtons();
        }
      }
    });
  }

  if (btnSave) btnSave.addEventListener('click', () => {
    const name = scenarioName ? scenarioName.value.trim() : '';
    if (!name) { alert('Enter a scenario name'); return; }
    saveScenario(name, sim.toScenarioData());
    refreshScenarioList();
    if (scenarioSelect) scenarioSelect.value = name;
  });

  if (btnDelete) btnDelete.addEventListener('click', () => {
    const name = scenarioSelect ? scenarioSelect.value : '';
    if (!name) return;
    if (confirm(`Delete scenario "${name}"?`)) {
      deleteScenario(name);
      refreshScenarioList();
      if (scenarioName) scenarioName.value = '';
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
      btnPlay.textContent = 'Play Scenario';
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

  bindSlider('spread-speed', 'spread-speed-val', 'spreadSpeed');
  bindSlider('ignition-threshold', 'ignition-threshold-val', 'ignitionThreshold');
  bindSlider('water-radius', 'water-radius-val', 'waterRadius');
  bindSlider('spray-psi', 'spray-psi-val', 'sprayPSI');
  bindSlider('vent-strength', 'vent-strength-val', 'ventStrength', v => v.toFixed(1));

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
      ['spread-speed', 'spread-speed-val', 'spreadSpeed', null],
      ['ignition-threshold', 'ignition-threshold-val', 'ignitionThreshold', null],
      ['water-radius', 'water-radius-val', 'waterRadius', null],
      ['spray-psi', 'spray-psi-val', 'sprayPSI', null],
      ['vent-strength', 'vent-strength-val', 'ventStrength', v => v.toFixed(1)],
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
