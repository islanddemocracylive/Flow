/**
 * App controller – wires the simulation to the canvas and admin panel.
 */

(function () {
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
  const selectResolution = document.getElementById('grid-resolution');
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
  let showGrid = false;
  let mouseDown = false;
  let mouseX = -1;
  let mouseY = -1;

  // Determine grid dimensions from select (4:3 aspect)
  function getGridDims() {
    const cols = parseInt(selectResolution.value);
    const rows = Math.round(cols * 0.75);
    return { cols, rows };
  }

  const { cols, rows } = getGridDims();
  const sim = new FireSimulation(cols, rows);

  // ── Canvas sizing ─────────────────────────────────────────
  function resizeCanvas() {
    const container = canvas.parentElement;
    const rect = container.getBoundingClientRect();
    // Subtract the admin panel width
    const panelWidth = document.getElementById('admin-panel').offsetWidth;
    canvas.width = rect.width - panelWidth;
    canvas.height = rect.height;
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ── Coordinate mapping ────────────────────────────────────
  function canvasToGrid(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const cellW = canvas.width / sim.cols;
    const cellH = canvas.height / sim.rows;
    return {
      x: Math.floor(px / cellW),
      y: Math.floor(py / cellH),
    };
  }

  // ── Rendering ─────────────────────────────────────────────
  // Pre-build a colour LUT for heat values 0–255
  const fireLUT = new Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // black → red → orange → yellow → white
    let r, g, b;
    if (t < 0.33) {
      const s = t / 0.33;
      r = Math.round(s * 200);
      g = 0;
      b = 0;
    } else if (t < 0.66) {
      const s = (t - 0.33) / 0.33;
      r = 200 + Math.round(s * 55);
      g = Math.round(s * 160);
      b = 0;
    } else {
      const s = (t - 0.66) / 0.34;
      r = 255;
      g = 160 + Math.round(s * 95);
      b = Math.round(s * 200);
    }
    fireLUT[i] = `rgb(${r},${g},${b})`;
  }

  function render() {
    const w = canvas.width;
    const h = canvas.height;
    const cellW = w / sim.cols;
    const cellH = h / sim.rows;

    // Use ImageData for performance at high resolutions
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    for (let gy = 0; gy < sim.rows; gy++) {
      for (let gx = 0; gx < sim.cols; gx++) {
        const heat = sim.heat[sim.idx(gx, gy)];

        // Compute pixel colour
        let r = 10, g = 10, b = 15; // dark ceiling background
        if (heat > 0) {
          const t = Math.min(heat, 1);
          if (t < 0.33) {
            const s = t / 0.33;
            r = Math.round(s * 200);
            g = 0;
            b = 0;
          } else if (t < 0.66) {
            const s = (t - 0.33) / 0.33;
            r = 200 + Math.round(s * 55);
            g = Math.round(s * 160);
            b = 0;
          } else {
            const s = (t - 0.66) / 0.34;
            r = 255;
            g = 160 + Math.round(s * 95);
            b = Math.round(s * 200);
          }
          // Add flicker
          const flicker = 0.9 + Math.random() * 0.1;
          r = Math.min(255, Math.round(r * flicker));
          g = Math.min(255, Math.round(g * flicker));
          b = Math.min(255, Math.round(b * flicker));
        }

        // Fill cell pixels
        const px0 = Math.floor(gx * cellW);
        const py0 = Math.floor(gy * cellH);
        const px1 = Math.floor((gx + 1) * cellW);
        const py1 = Math.floor((gy + 1) * cellH);

        for (let py = py0; py < py1; py++) {
          for (let px = px0; px < px1; px++) {
            const off = (py * w + px) * 4;
            data[off] = r;
            data[off + 1] = g;
            data[off + 2] = b;
            data[off + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Optional grid overlay
    if (showGrid && cellW > 3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= sim.cols; x++) {
        const px = Math.floor(x * cellW);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
      }
      for (let y = 0; y <= sim.rows; y++) {
        const py = Math.floor(y * cellH);
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
      }
    }

    // Water cursor indicator
    if (mode === 'water' && mouseX >= 0 && mouseY >= 0) {
      const rect = canvas.getBoundingClientRect();
      const px = mouseX - rect.left;
      const py = mouseY - rect.top;
      const radiusPx = sim.waterRadius * cellW;
      ctx.strokeStyle = 'rgba(100, 180, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
      ctx.stroke();

      // Spray particles when spraying
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
  const FIXED_DT = 1 / 30; // simulation timestep

  function loop(now) {
    const elapsed = (now - lastTime) / 1000;
    lastTime = now;

    if (!paused) {
      // Apply water while mouse is held
      if (mouseDown && mode === 'water') {
        const grid = canvasToGrid(mouseX, mouseY);
        sim.applyWater(grid.x, grid.y, FIXED_DT);
      }

      sim.step(Math.min(elapsed, 0.05)); // cap dt to avoid spiral of death
    }

    render();
    updateStats();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  // ── Input handling ────────────────────────────────────────
  canvas.addEventListener('mousedown', (e) => {
    mouseDown = true;
    mouseX = e.clientX;
    mouseY = e.clientY;

    if (mode === 'fire') {
      const grid = canvasToGrid(e.clientX, e.clientY);
      sim.ignite(grid.x, grid.y, 3);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    // Allow continuous fire placement while dragging in fire mode
    if (mouseDown && mode === 'fire') {
      const grid = canvasToGrid(e.clientX, e.clientY);
      sim.ignite(grid.x, grid.y, 2);
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
      sim.ignite(grid.x, grid.y, 3);
    }
  });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    mouseX = touch.clientX;
    mouseY = touch.clientY;
    if (mode === 'fire') {
      const grid = canvasToGrid(touch.clientX, touch.clientY);
      sim.ignite(grid.x, grid.y, 2);
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
  });

  // ── Sliders ───────────────────────────────────────────────
  function bindSlider(slider, display, prop, format) {
    const update = () => {
      const v = parseFloat(slider.value);
      sim[prop] = v;
      display.textContent = format ? format(v) : v;
    };
    slider.addEventListener('input', update);
    update();
  }

  bindSlider(sliderSpread, valSpread, 'spreadSpeed');
  bindSlider(sliderIgnition, valIgnition, 'ignitionThreshold');
  bindSlider(sliderMaxIntensity, valMaxIntensity, 'maxIntensity', v => v.toFixed(2));
  bindSlider(sliderWaterStrength, valWaterStrength, 'waterStrength', v => v.toFixed(1));
  bindSlider(sliderWaterRadius, valWaterRadius, 'waterRadius');

  selectResolution.addEventListener('change', () => {
    const { cols, rows } = getGridDims();
    sim.resize(cols, rows);
  });

  checkboxGrid.addEventListener('change', () => {
    showGrid = checkboxGrid.checked;
  });

  // ── Stats ─────────────────────────────────────────────────
  function updateStats() {
    const stats = sim.getStats();
    statBurning.textContent = stats.burning;
    statCoverage.textContent = (stats.coverage * 100).toFixed(1) + '%';
    statIntensity.textContent = stats.avgIntensity.toFixed(2);
  }
})();
