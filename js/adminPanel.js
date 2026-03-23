/**
 * Admin panel: placement mode buttons, sliders, pause/reset, mobile layout.
 */

const canvas = document.getElementById('simulation-canvas');

export function setupAdminPanel(sim, state, net) {
  // Vent placement buttons
  const btnPlaceVent = document.getElementById('btn-place-vent');
  const btnPlaceDoorFar = document.getElementById('btn-place-door-far');
  const btnPlaceDoorLeft = document.getElementById('btn-place-door-left');
  const btnClearVents = document.getElementById('btn-clear-vents');

  function setPlacementMode(mode) {
    if (state.placementMode === mode) {
      state.placementMode = null;
    } else {
      state.placementMode = mode;
    }
    if (btnPlaceVent) btnPlaceVent.classList.toggle('active', state.placementMode === 'ceiling-vent');
    if (btnPlaceDoorFar) btnPlaceDoorFar.classList.toggle('active', state.placementMode === 'door-far');
    if (btnPlaceDoorLeft) btnPlaceDoorLeft.classList.toggle('active', state.placementMode === 'door-left');
    if (canvas) canvas.style.cursor = state.placementMode ? 'cell' : 'crosshair';
  }

  if (btnPlaceVent) btnPlaceVent.addEventListener('click', () => setPlacementMode('ceiling-vent'));
  if (btnPlaceDoorFar) btnPlaceDoorFar.addEventListener('click', () => setPlacementMode('door-far'));
  if (btnPlaceDoorLeft) btnPlaceDoorLeft.addEventListener('click', () => setPlacementMode('door-left'));
  if (btnClearVents) btnClearVents.addEventListener('click', () => {
    sim.clearVents();
    state.placementMode = null;
    if (btnPlaceVent) btnPlaceVent.classList.remove('active');
    if (btnPlaceDoorFar) btnPlaceDoorFar.classList.remove('active');
    if (btnPlaceDoorLeft) btnPlaceDoorLeft.classList.remove('active');
    if (canvas) canvas.style.cursor = 'crosshair';
  });

  // Pause / Reset
  const btnPause = document.getElementById('btn-pause');
  const btnReset = document.getElementById('btn-reset');

  btnPause.addEventListener('click', () => {
    state.paused = !state.paused;
    btnPause.textContent = state.paused ? 'Resume' : 'Pause';
  });

  btnReset.addEventListener('click', () => {
    sim.reset();
    if (net && net.connected) net.sendReset();
  });

  // Sliders
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
  bindSlider('max-intensity', 'max-intensity-val', 'maxIntensity', v => v.toFixed(2));
  bindSlider('water-strength', 'water-strength-val', 'waterStrength', v => v.toFixed(1));
  bindSlider('water-radius', 'water-radius-val', 'waterRadius');
  bindSlider('vent-strength', 'vent-strength-val', 'ventStrength', v => v.toFixed(1));

  // Grid checkbox
  const checkboxGrid = document.getElementById('show-grid');
  if (checkboxGrid) {
    checkboxGrid.addEventListener('change', () => {
      state.showGrid = checkboxGrid.checked;
    });
  }

  // Mobile panel toggle
  const togglePanelBtn = document.getElementById('toggle-panel-btn');
  const adminPanel = document.getElementById('admin-panel');
  const mobileStats = document.getElementById('mobile-stats');

  function checkMobile() {
    const isMobile = window.innerWidth <= 700;
    if (mobileStats) mobileStats.style.display = isMobile ? 'flex' : 'none';
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

export function updateStats(sim) {
  const stats = sim.getStats();

  const statBurning = document.getElementById('stat-burning');
  const statCoverage = document.getElementById('stat-coverage');
  const statIntensity = document.getElementById('stat-intensity');

  if (statBurning) statBurning.textContent = stats.burning;
  if (statCoverage) statCoverage.textContent = (stats.coverage * 100).toFixed(1) + '%';
  if (statIntensity) statIntensity.textContent = stats.avgIntensity.toFixed(2);

  // Mobile stats bar
  const mStatBurning = document.getElementById('m-stat-burning');
  if (mStatBurning) {
    mStatBurning.textContent = stats.burning;
    document.getElementById('m-stat-coverage').textContent = (stats.coverage * 100).toFixed(1) + '%';
    document.getElementById('m-stat-intensity').textContent = stats.avgIntensity.toFixed(2);
  }
}
