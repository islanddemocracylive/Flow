/**
 * 2D canvas input handling for room design.
 *
 * Click = apply current design mode action (add/remove element)
 * Right-click = remove (for obstacles)
 * No water spray in 2D — that's only in the 3D firefighter view.
 */

import { canvasToGrid } from './render2d.js';

const canvas = document.getElementById('simulation-canvas');

export function setupInput2D(sim, state, handleDesignClick) {
  if (!canvas) return;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Mouse
  canvas.addEventListener('mousedown', (e) => {
    if (!state.designMode) return;
    const grid = canvasToGrid(e.clientX, e.clientY, sim);
    if (grid.x < 0 || grid.x >= sim.cols || grid.y < 0 || grid.y >= sim.rows) return;

    if (e.button === 2) {
      // Right-click: remove obstacle block
      if (state.designMode === 'obstacle') {
        sim.removeObstacleBlock(grid.x, grid.y);
      }
    } else if (e.button === 0) {
      handleDesignClick(grid.x, grid.y);
    }
  });

  // Touch
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!state.designMode) return;
    const touch = e.touches[0];
    const grid = canvasToGrid(touch.clientX, touch.clientY, sim);
    if (grid.x < 0 || grid.x >= sim.cols || grid.y < 0 || grid.y >= sim.rows) return;
    handleDesignClick(grid.x, grid.y);
  });
}
