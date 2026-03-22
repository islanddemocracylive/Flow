/**
 * Viewer application – receives simulation state over WebSocket
 * and renders the fullscreen 3D room view.
 */
(function () {
  const GRID_COLS = 20;
  const GRID_ROWS = 10;

  // Create simulation as a data container (no stepping)
  const sim = new FireSimulation(GRID_COLS, GRID_ROWS);
  window.fireSim = sim;

  const statusEl = document.getElementById('status');

  // Connect to server as viewer
  const net = new SimNetwork('viewer');

  net.onHeatData = (heatArray) => {
    sim.heat.set(heatArray);
  };

  net.onParams = (params) => {
    if (params.spreadSpeed !== undefined) sim.spreadSpeed = params.spreadSpeed;
    if (params.ignitionThreshold !== undefined) sim.ignitionThreshold = params.ignitionThreshold;
    if (params.maxIntensity !== undefined) sim.maxIntensity = params.maxIntensity;
    if (params.waterStrength !== undefined) sim.waterStrength = params.waterStrength;
    if (params.waterRadius !== undefined) sim.waterRadius = params.waterRadius;
  };

  net.onReset = () => {
    sim.reset();
  };

  // Render loop – only renders 3D, no simulation stepping
  function loop() {
    if (window.room3d) {
      window.room3d.updatePanels();
      window.room3d.render();
    }

    if (net.connected) {
      statusEl.textContent = 'Connected';
      statusEl.className = 'connected';
    } else {
      statusEl.textContent = 'Reconnecting...';
      statusEl.className = '';
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  window.addEventListener('resize', () => {
    if (window.room3d) window.room3d.onResize();
  });
})();
