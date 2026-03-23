/**
 * 2D canvas rendering – draws the fire grid, vents, doors, airflow arrows,
 * water cursor, grid lines, and placement mode overlay.
 */

import { heatToRGB } from './colorUtils.js';

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

  // Draw each panel
  for (let gy = 0; gy < sim.rows; gy++) {
    for (let gx = 0; gx < sim.cols; gx++) {
      const heat = sim.heat[sim.idx(gx, gy)];
      const isVent = sim.isCeilingVent(gx, gy);
      const isDoor = sim.vents.some(v => v.type === 'door' && v.x === gx && v.y === gy);

      let r, g, b;
      if (isVent) {
        r = 8; g = 12; b = 20;
      } else if (isDoor) {
        r = 60; g = 45; b = 25;
      } else {
        ({ r, g, b } = heatToRGB(heat));
      }

      const px0 = offsetX + Math.floor(gx * cellSize);
      const py0 = offsetY + Math.floor(gy * cellSize);
      const ps = Math.floor(cellSize);

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(px0, py0, ps, ps);

      if (isVent) {
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px0 + 2, py0 + 2, ps - 4, ps - 4);
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.4)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(px0 + 4, py0 + i * ps / 4);
          ctx.lineTo(px0 + ps - 4, py0 + i * ps / 4);
          ctx.stroke();
        }
      }

      if (isDoor) {
        ctx.strokeStyle = 'rgba(200, 160, 80, 0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px0 + 2, py0 + 2, ps - 4, ps - 4);
        ctx.fillStyle = 'rgba(200, 160, 80, 0.3)';
        ctx.fillRect(px0 + 3, py0 + 3, ps - 6, ps - 6);
      }
    }
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
        if (mag < 0.03) continue;

        const cx = offsetX + (gx + 1) * cellSize;
        const cy = offsetY + (gy + 1) * cellSize;
        const len = cellSize * 0.6 * Math.min(mag, 1);

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

  // Panel labels
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
  if (state.mouseDown && state.dragDistance > state.DRAG_THRESHOLD && state.mouseX >= 0 && state.mouseY >= 0) {
    const rect = canvas.getBoundingClientRect();
    const px = state.mouseX - rect.left;
    const py = state.mouseY - rect.top;
    const radiusPx = sim.waterRadius * cellSize;
    ctx.strokeStyle = 'rgba(100, 180, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(100, 180, 255, 0.3)';
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radiusPx;
      ctx.beginPath();
      ctx.arc(px + Math.cos(angle) * dist, py + Math.sin(angle) * dist, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Placement mode indicator
  if (state.placementMode) {
    ctx.fillStyle = 'rgba(100, 200, 255, 0.15)';
    ctx.fillRect(offsetX, offsetY, gridW, gridH);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = 'rgba(100, 200, 255, 0.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = state.placementMode === 'ceiling-vent' ? 'Click to toggle ceiling vent' :
      state.placementMode === 'door-far' ? 'Click top row to place door (far wall)' :
      'Click left column to place door (left wall)';
    ctx.fillText(label, offsetX + gridW / 2, offsetY + 6);
  }
}
