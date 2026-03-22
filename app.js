/**
 * App controller – wires the simulation to the canvas, admin panel, and 3D view.
 */

(function () {
  // ── Fixed grid: 20 columns × 10 rows (1 ft² panels) ────
  const GRID_COLS = 20;
  const GRID_ROWS = 10;

  // ── Elements ──────────────────────────────────────────────
  const canvas = document.getElementById('simulation-canvas');
  const ctx = canvas.getContext('2d');

  const btnFireMode = document.getElementById('btn-fire-mode');
  const btnWaterMode = document.getElementById('btn-water-mode');
  const btnPause = document.getElementById('btn-pause');
  const btnReset = document.getElementById('btn-reset');

  const sliderSpread = document.getElementById('spread-speed');
  const sliderIgnition = document.getElementById('ignition-threshold');
  const sliderMaxIntensity = document.getElementById('max-intensity');
  const sliderWaterStrength = document.getElementById('water-strength');
  const sliderWaterRadius = document.getElementById('water-radius');
  const checkboxGrid = document.getElementById('show-grid');

  const valSpread = document.getElementById('spread-speed-val');
  const valIgnition = document.getElementById('ignition-threshold-val');
  const valMaxIntensity = document.getElementById('max-intensity-val');
  const valWaterStrength = document.getElementById('water-strength-val');
  const valWaterRadius = document.getElementById('water-radius-val');

  const statBurning = document.getElementById('stat-burning');
  const statCoverage = document.getElementById('stat-coverage');
  const statIntensity = document.getElementById('stat-intensity');

  // ── State ─────────────────────────────────────────────────
  let mode = 'fire';       // 'fire' | 'water'
  let paused = false;
  let showGrid = true;     // default on for panel grid
  let mouseDown = false;
  let mouseX = -1;
  let mouseY = -1;
  let activeView = '2d';

  // ── Simulation ────────────────────────────────────────────
  const sim = new FireSimulation(GRID_COLS, GRID_ROWS);

  // Expose simulation globally so room3d.js can read it
  window.fireSim = sim;

  // ── Network (remote viewing) ────────────────────────────
  let net = null;
  let lastNetSend = 0;
  try { net = new SimNetwork('controller'); } catch (e) { /* no server */ }

  // ── View tab switching ────────────────────────────────────
  const viewTabs = document.querySelectorAll('.view-tab');
  const viewPanels = document.querySelectorAll('.view-panel');

  viewTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const viewId = tab.dataset.view;
      activeView = viewId;

      viewTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      viewPanels.forEach(p => p.classList.remove('active'));
      document.getElementById('view-' + viewId).classList.add('active');

      if (viewId === '2d') {
        resizeCanvas();
      } else if (viewId === '3d' && window.room3d) {
        window.room3d.onResize();
      }
    });
  });

  // ── Canvas sizing ─────────────────────────────────────────
  function resizeCanvas() {
    const panel = document.getElementById('view-2d');
    canvas.width = panel.clientWidth;
    canvas.height = panel.clientHeight;
  }

  window.addEventListener('resize', () => {
    if (activeView === '2d') {
      resizeCanvas();
    } else if (window.room3d) {
      window.room3d.onResize();
    }
  });
  resizeCanvas();

  // ── Square cell layout helper ─────────────────────────────
  function getGridLayout() {
    const w = canvas.width;
    const h = canvas.height;
    const cellSize = Math.min(w / sim.cols, h / sim.rows);
    const gridW = cellSize * sim.cols;
    const gridH = cellSize * sim.rows;
    const offsetX = Math.floor((w - gridW) / 2);
    const offsetY = Math.floor((h - gridH) / 2);
    return { cellSize, offsetX, offsetY, gridW, gridH };
  }

  // ── Coordinate mapping ────────────────────────────────────
  function canvasToGrid(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const { cellSize, offsetX, offsetY } = getGridLayout();
    const px = clientX - rect.left - offsetX;
    const py = clientY - rect.top - offsetY;
    return {
      x: Math.floor(px / cellSize),
      y: Math.floor(py / cellSize),
    };
  }

  // ── 2D Rendering ──────────────────────────────────────────
  function render2D() {
    if (activeView !== '2d') return;

    const w = canvas.width;
    const h = canvas.height;
    const { cellSize, offsetX, offsetY, gridW, gridH } = getGridLayout();

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    // Draw each panel as a square
    for (let gy = 0; gy < sim.rows; gy++) {
      for (let gx = 0; gx < sim.cols; gx++) {
        const heat = sim.heat[sim.idx(gx, gy)];

        let r = 20, g = 20, b = 28;
        if (heat > 0) {
          const t = Math.min(heat, 1);
          if (t < 0.33) {
            const s = t / 0.33;
            r = Math.round(30 + s * 170);
            g = Math.round(s * 20);
            b = 0;
          } else if (t < 0.66) {
            const s = (t - 0.33) / 0.33;
            r = 200 + Math.round(s * 55);
            g = 20 + Math.round(s * 140);
            b = 0;
          } else {
            const s = (t - 0.66) / 0.34;
            r = 255;
            g = 160 + Math.round(s * 95);
            b = Math.round(s * 200);
          }
          // Flicker
          const flicker = 0.9 + Math.random() * 0.1;
          r = Math.min(255, Math.round(r * flicker));
          g = Math.min(255, Math.round(g * flicker));
          b = Math.min(255, Math.round(b * flicker));
        }

        const px0 = offsetX + Math.floor(gx * cellSize);
        const py0 = offsetY + Math.floor(gy * cellSize);
        const ps = Math.floor(cellSize);

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(px0, py0, ps, ps);
      }
    }

    // Grid lines (panel borders)
    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= sim.cols; x++) {
        const px = offsetX + Math.floor(x * cellSize);
        ctx.beginPath();
        ctx.moveTo(px + 0.5, offsetY);
        ctx.lineTo(px + 0.5, offsetY + gridH);
        ctx.stroke();
      }
      for (let y = 0; y <= sim.rows; y++) {
        const py = offsetY + Math.floor(y * cellSize);
        ctx.beginPath();
        ctx.moveTo(offsetX, py + 0.5);
        ctx.lineTo(offsetX + gridW, py + 0.5);
        ctx.stroke();
      }
    }

    // Panel labels (column/row)
    if (cellSize > 30) {
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let gy = 0; gy < sim.rows; gy++) {
        for (let gx = 0; gx < sim.cols; gx++) {
          const cx = offsetX + (gx + 0.5) * cellSize;
          const cy = offsetY + (gy + 0.5) * cellSize;
          ctx.fillText(`${gx},${gy}`, cx, cy);
        }
      }
    }

    // Water cursor
    if (mode === 'water' && mouseX >= 0 && mouseY >= 0) {
      const rect = canvas.getBoundingClientRect();
      const px = mouseX - rect.left;
      const py = mouseY - rect.top;
      const radiusPx = sim.waterRadius * cellSize;
      ctx.strokeStyle = 'rgba(100, 180, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
      ctx.stroke();

      if (mouseDown) {
        ctx.fillStyle = 'rgba(100, 180, 255, 0.3)';
        for (let i = 0; i < 8; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * radiusPx;
          ctx.beginPath();
          ctx.arc(px + Math.cos(angle) * dist, py + Math.sin(angle) * dist, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // ── Main loop ─────────────────────────────────────────────
  let lastTime = performance.now();
  const FIXED_DT = 1 / 30;

  function loop(now) {
    const elapsed = (now - lastTime) / 1000;
    lastTime = now;

    if (!paused) {
      // Apply water while mouse is held (2D view)
      if (mouseDown && mode === 'water' && activeView === '2d') {
        const grid = canvasToGrid(mouseX, mouseY);
        sim.applyWater(grid.x, grid.y, FIXED_DT);
      }

      sim.step(Math.min(elapsed, 0.05));
    }

    render2D();

    // Update 3D view (runs even when not visible to keep panels synced)
    if (window.room3d) {
      window.room3d.updatePanels();
      if (activeView === '3d') {
        window.room3d.render();
      }
    }

    updateStats();

    // Send heat data to remote viewers (throttled to 20fps)
    if (net && net.connected && now - lastNetSend > 50) {
      net.sendHeat(sim.heat);
      lastNetSend = now;
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  // ── Input handling (2D canvas) ────────────────────────────
  canvas.addEventListener('mousedown', (e) => {
    mouseDown = true;
    mouseX = e.clientX;
    mouseY = e.clientY;

    if (mode === 'fire') {
      const grid = canvasToGrid(e.clientX, e.clientY);
      sim.ignite(grid.x, grid.y, 2);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    if (mouseDown && mode === 'fire') {
      const grid = canvasToGrid(e.clientX, e.clientY);
      sim.ignite(grid.x, grid.y, 1);
    }
  });

  canvas.addEventListener('mouseup', () => { mouseDown = false; });
  canvas.addEventListener('mouseleave', () => {
    mouseDown = false;
    mouseX = -1;
    mouseY = -1;
  });

  // Touch support
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    mouseDown = true;
    mouseX = touch.clientX;
    mouseY = touch.clientY;
    if (mode === 'fire') {
      const grid = canvasToGrid(touch.clientX, touch.clientY);
      sim.ignite(grid.x, grid.y, 2);
    }
  });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    mouseX = touch.clientX;
    mouseY = touch.clientY;
    if (mode === 'fire') {
      const grid = canvasToGrid(touch.clientX, touch.clientY);
      sim.ignite(grid.x, grid.y, 1);
    }
  });

  canvas.addEventListener('touchend', () => { mouseDown = false; });

  // ── Mode buttons ──────────────────────────────────────────
  btnFireMode.addEventListener('click', () => {
    mode = 'fire';
    btnFireMode.classList.add('active');
    btnWaterMode.classList.remove('active');
    canvas.style.cursor = 'crosshair';
  });

  btnWaterMode.addEventListener('click', () => {
    mode = 'water';
    btnWaterMode.classList.add('active');
    btnFireMode.classList.remove('active');
    canvas.style.cursor = 'none';
  });

  btnPause.addEventListener('click', () => {
    paused = !paused;
    btnPause.textContent = paused ? 'Resume' : 'Pause';
  });

  btnReset.addEventListener('click', () => {
    sim.reset();
    if (net && net.connected) net.sendReset();
  });

  // ── Share Viewer modal ──────────────────────────────────
  const shareModal = document.getElementById('share-modal');
  const shareUrlInput = document.getElementById('share-url');
  const btnShareViewer = document.getElementById('btn-share-viewer');
  const btnCopyUrl = document.getElementById('btn-copy-url');
  const shareCopyStatus = document.getElementById('share-copy-status');

  function getViewerUrl() {
    return location.origin + '/viewer.html';
  }

  btnShareViewer.addEventListener('click', () => {
    const url = getViewerUrl();
    shareUrlInput.value = url;
    shareCopyStatus.textContent = '';
    shareModal.style.display = 'flex';

    // Generate QR code
    if (typeof QRious !== 'undefined') {
      new QRious({
        element: document.getElementById('share-qr'),
        value: url,
        size: 200,
        backgroundAlpha: 0,
        foreground: '#e0e0e0',
        level: 'M',
      });
    }
  });

  btnCopyUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrlInput.value).then(() => {
      shareCopyStatus.textContent = 'Copied!';
    }).catch(() => {
      shareUrlInput.select();
      shareCopyStatus.textContent = 'Press Ctrl+C to copy';
    });
  });

  document.getElementById('share-modal-close').addEventListener('click', () => {
    shareModal.style.display = 'none';
  });

  shareModal.addEventListener('click', (e) => {
    if (e.target === shareModal) shareModal.style.display = 'none';
  });

  // ── Sliders ───────────────────────────────────────────────
  function bindSlider(slider, display, prop, format) {
    const update = () => {
      const v = parseFloat(slider.value);
      sim[prop] = v;
      display.textContent = format ? format(v) : v;
      if (net && net.connected) net.sendParams({ [prop]: v });
    };
    slider.addEventListener('input', update);
    update();
  }

  bindSlider(sliderSpread, valSpread, 'spreadSpeed');
  bindSlider(sliderIgnition, valIgnition, 'ignitionThreshold');
  bindSlider(sliderMaxIntensity, valMaxIntensity, 'maxIntensity', v => v.toFixed(2));
  bindSlider(sliderWaterStrength, valWaterStrength, 'waterStrength', v => v.toFixed(1));
  bindSlider(sliderWaterRadius, valWaterRadius, 'waterRadius');

  checkboxGrid.addEventListener('change', () => {
    showGrid = checkboxGrid.checked;
  });

  // ── Mobile panel toggle ─────────────────────────────────
  const togglePanelBtn = document.getElementById('toggle-panel-btn');
  const adminPanel = document.getElementById('admin-panel');
  const mobileStats = document.getElementById('mobile-stats');
  const mStatBurning = document.getElementById('m-stat-burning');
  const mStatCoverage = document.getElementById('m-stat-coverage');
  const mStatIntensity = document.getElementById('m-stat-intensity');

  function checkMobile() {
    const isMobile = window.innerWidth <= 700;
    if (mobileStats) mobileStats.style.display = isMobile ? 'flex' : 'none';
    if (!isMobile) adminPanel.classList.remove('open');
  }
  checkMobile();
  window.addEventListener('resize', checkMobile);

  togglePanelBtn.addEventListener('click', () => {
    adminPanel.classList.toggle('open');
    togglePanelBtn.textContent = adminPanel.classList.contains('open') ? '\u2715' : '\u2699';
  });

  // ── Stats ─────────────────────────────────────────────────
  function updateStats() {
    const stats = sim.getStats();
    statBurning.textContent = stats.burning;
    statCoverage.textContent = (stats.coverage * 100).toFixed(1) + '%';
    statIntensity.textContent = stats.avgIntensity.toFixed(2);
    // Mobile stats bar
    if (mStatBurning) {
      mStatBurning.textContent = stats.burning;
      mStatCoverage.textContent = (stats.coverage * 100).toFixed(1) + '%';
      mStatIntensity.textContent = stats.avgIntensity.toFixed(2);
    }
  }
})();
