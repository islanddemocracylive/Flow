/**
 * 2D canvas rendering – draws the room design grid:
 *   - Fire start locations (red squares)
 *   - Ceiling vents (white squares – holes in ceiling)
 *   - Doors (brown squares on wall edges)
 *   - Obstacles (gray blocks with height number)
 *   - Heat overlay when simulation is running
 *   - Airflow arrows
 *   - Grid lines
 *   - Design mode indicator
 */

import { heatToRGB, gasLayerColor } from './colorUtils.js';

const canvas = document.getElementById('simulation-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;

export function getGridLayout(sim) {
  const w = canvas.width;
  const h = canvas.height;
  const cellSize = Math.min(w / sim.cols, h / sim.rows);
  const gridW = cellSize * sim.cols;
  const gridH = cellSize * sim.rows;
  const offsetX = Math.floor((w - gridW) / 2);
  const offsetY = Math.floor((h - gridH) / 2);
  return { cellSize, offsetX, offsetY, gridW, gridH };
}

export function canvasToGrid(clientX, clientY, sim) {
  const rect = canvas.getBoundingClientRect();
  const { cellSize, offsetX, offsetY } = getGridLayout(sim);
  const px = clientX - rect.left - offsetX;
  const py = clientY - rect.top - offsetY;
  return {
    x: Math.floor(px / cellSize),
    y: Math.floor(py / cellSize),
  };
}

export function resizeCanvas() {
  if (!canvas) return;
  const panel = document.getElementById('view-2d');
  canvas.width = panel.clientWidth;
  canvas.height = panel.clientHeight;
}

export function render2D(sim, state) {
  if (!ctx || state.activeView !== '2d') return;

  const w = canvas.width;
  const h = canvas.height;
  const { cellSize, offsetX, offsetY, gridW, gridH } = getGridLayout(sim);

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);

  // Draw each cell
  for (let gy = 0; gy < sim.rows; gy++) {
    for (let gx = 0; gx < sim.cols; gx++) {
      const heat = sim.heat[sim.idx(gx, gy)];
      const isVent = sim.isCeilingVent(gx, gy);
      const isDoor = sim.vents.some(v => v.type === 'door' && v.x === gx && v.y === gy);
      const isStart = sim.isStartLocation(gx, gy);
      const obstacleH = sim.getObstacleHeight(gx, gy);

      const px0 = offsetX + Math.floor(gx * cellSize);
      const py0 = offsetY + Math.floor(gy * cellSize);
      const ps = Math.floor(cellSize);

      // Base cell color
      let r, g, b;
      if (heat > 0) {
        ({ r, g, b } = heatToRGB(heat));
      } else {
        r = 18; g = 18; b = 26;
      }

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(px0, py0, ps, ps);

      // Obstacle overlay (gray blocks)
      if (obstacleH > 0) {
        const intensity = Math.min(180, 60 + obstacleH * 18);
        ctx.fillStyle = `rgba(${intensity}, ${intensity}, ${Math.floor(intensity * 0.85)}, 0.8)`;
        ctx.fillRect(px0 + 1, py0 + 1, ps - 2, ps - 2);
        ctx.strokeStyle = 'rgba(200, 200, 180, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px0 + 1, py0 + 1, ps - 2, ps - 2);
        // Show height number
        if (cellSize > 16) {
          ctx.font = `bold ${Math.max(10, cellSize * 0.4)}px monospace`;
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(obstacleH.toString(), px0 + ps / 2, py0 + ps / 2);
        }
      }

      // Fire start location (bright red)
      if (isStart) {
        ctx.fillStyle = 'rgba(255, 40, 20, 0.7)';
        ctx.fillRect(px0 + 2, py0 + 2, ps - 4, ps - 4);
        ctx.strokeStyle = 'rgba(255, 80, 40, 0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px0 + 2, py0 + 2, ps - 4, ps - 4);
        // Fire icon
        if (cellSize > 20) {
          ctx.font = `${Math.max(12, cellSize * 0.5)}px sans-serif`;
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('\u2737', px0 + ps / 2, py0 + ps / 2);
        }
      }

      // Ceiling vent (white square – represents a hole)
      if (isVent) {
        ctx.fillStyle = 'rgba(240, 240, 255, 0.85)';
        ctx.fillRect(px0 + 2, py0 + 2, ps - 4, ps - 4);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px0 + 2, py0 + 2, ps - 4, ps - 4);
      }

      // Door (brown with frame)
      if (isDoor) {
        ctx.fillStyle = 'rgba(160, 120, 60, 0.8)';
        ctx.fillRect(px0 + 2, py0 + 2, ps - 4, ps - 4);
        ctx.strokeStyle = 'rgba(200, 160, 80, 0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px0 + 2, py0 + 2, ps - 4, ps - 4);
      }
    }
  }

  // Gas layer overlay (smoke / flashover visual)
  if (sim.gasLayerTemp > 100) {
    const gl = gasLayerColor(sim.gasLayerTemp);
    if (gl.a > 0) {
      ctx.fillStyle = `rgba(${gl.r},${gl.g},${gl.b},${gl.a})`;
      ctx.fillRect(offsetX, offsetY, gridW, gridH);
    }
  }

  // Gas layer HUD (top-right of grid)
  if (state.playing) {
    const hudX = offsetX + gridW - 8;
    const hudY = offsetY + 16;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';

    // Gas layer temp
    const temp = Math.round(sim.gasLayerTemp);
    const gl = gasLayerColor(sim.gasLayerTemp);
    const tempColor = temp > 500 ? `rgb(${gl.r},${gl.g},${gl.b})`
      : temp > 300 ? 'rgba(255,200,100,0.9)'
      : 'rgba(200,200,200,0.7)';
    ctx.fillStyle = tempColor;
    ctx.fillText(`Gas: ${temp}°C`, hudX, hudY);

    // HRR
    const hrr = sim.totalHRR / 1000;
    ctx.fillStyle = 'rgba(255,180,80,0.7)';
    ctx.fillText(`HRR: ${hrr.toFixed(1)} MW`, hudX, hudY + 16);
  }

  // Airflow arrows
  if (sim.vents.length > 0) {
    ctx.fillStyle = 'rgba(100, 180, 255, 0.4)';
    ctx.strokeStyle = 'rgba(100, 180, 255, 0.5)';
    ctx.lineWidth = 1.5;
    for (let gy = 0; gy < sim.rows; gy += 2) {
      for (let gx = 0; gx < sim.cols; gx += 2) {
        const af = sim.getAirflow(gx, gy);
        const mag = Math.sqrt(af.vx * af.vx + af.vy * af.vy);
        const effectiveMag = mag * sim.ventStrength;
        if (effectiveMag < 0.03) continue;

        const cx = offsetX + (gx + 1) * cellSize;
        const cy = offsetY + (gy + 1) * cellSize;
        const len = cellSize * 0.6 * Math.min(effectiveMag, 1);

        const angle = Math.atan2(af.vy, af.vx);
        const ex = cx + Math.cos(angle) * len;
        const ey = cy + Math.sin(angle) * len;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        const headLen = 4;
        const headAngle = 0.5;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - headLen * Math.cos(angle - headAngle), ey - headLen * Math.sin(angle - headAngle));
        ctx.lineTo(ex - headLen * Math.cos(angle + headAngle), ey - headLen * Math.sin(angle + headAngle));
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Grid lines
  if (state.showGrid) {
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

  // Wall edge indicators (highlight which cells are wall-adjacent for door placement)
  if (state.designMode === 'door') {
    ctx.strokeStyle = 'rgba(200, 160, 80, 0.3)';
    ctx.lineWidth = 2;
    // Top row (far wall)
    for (let gx = 0; gx < sim.cols; gx++) {
      const px0 = offsetX + Math.floor(gx * cellSize);
      const py0 = offsetY;
      ctx.strokeRect(px0 + 1, py0 + 1, Math.floor(cellSize) - 2, Math.floor(cellSize) - 2);
    }
    // Bottom row (back wall)
    for (let gx = 0; gx < sim.cols; gx++) {
      const px0 = offsetX + Math.floor(gx * cellSize);
      const py0 = offsetY + Math.floor((sim.rows - 1) * cellSize);
      ctx.strokeRect(px0 + 1, py0 + 1, Math.floor(cellSize) - 2, Math.floor(cellSize) - 2);
    }
    // Left column (left wall)
    for (let gy = 0; gy < sim.rows; gy++) {
      const px0 = offsetX;
      const py0 = offsetY + Math.floor(gy * cellSize);
      ctx.strokeRect(px0 + 1, py0 + 1, Math.floor(cellSize) - 2, Math.floor(cellSize) - 2);
    }
    // Right column (right wall)
    for (let gx = sim.cols - 1; gx === sim.cols - 1; gx++) {
      for (let gy = 0; gy < sim.rows; gy++) {
        const px0 = offsetX + Math.floor(gx * cellSize);
        const py0 = offsetY + Math.floor(gy * cellSize);
        ctx.strokeRect(px0 + 1, py0 + 1, Math.floor(cellSize) - 2, Math.floor(cellSize) - 2);
      }
    }
  }

  // Design mode indicator
  if (state.designMode) {
    const labels = {
      'start-location': 'Click to toggle fire start locations',
      'ceiling-vent': 'Click to toggle ceiling vents (holes)',
      'door': 'Click wall-edge cells to toggle doors',
      'obstacle': 'Click to add obstacle blocks (right-click to remove)',
    };
    const colors = {
      'start-location': 'rgba(255, 60, 40, 0.15)',
      'ceiling-vent': 'rgba(240, 240, 255, 0.1)',
      'door': 'rgba(200, 160, 80, 0.1)',
      'obstacle': 'rgba(150, 150, 140, 0.1)',
    };
    ctx.fillStyle = colors[state.designMode] || 'rgba(100, 200, 255, 0.15)';
    ctx.fillRect(offsetX, offsetY, gridW, gridH);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(labels[state.designMode] || '', offsetX + gridW / 2, offsetY + 6);
  }
}
