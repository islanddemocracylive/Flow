/**
 * 2D canvas input handling: mouse and touch events.
 * Click = fire, Drag = water, Right-click = fire.
 * In placement mode, click toggles vents/doors.
 */

import { DRAG_THRESHOLD } from './constants.js';
import { canvasToGrid } from './render2d.js';

const canvas = document.getElementById('simulation-canvas');

export function setupInput2D(sim, state, handlePlacement) {
  if (!canvas) return;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('mousedown', (e) => {
    state.mouseDown = true;
    state.mouseX = e.clientX;
    state.mouseY = e.clientY;
    state.mouseDownX = e.clientX;
    state.mouseDownY = e.clientY;
    state.dragDistance = 0;

    if (e.button === 2) {
      const grid = canvasToGrid(e.clientX, e.clientY, sim);
      sim.ignite(grid.x, grid.y, 2);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    state.mouseX = e.clientX;
    state.mouseY = e.clientY;

    if (state.mouseDown) {
      const dx = e.clientX - state.mouseDownX;
      const dy = e.clientY - state.mouseDownY;
      state.dragDistance = Math.sqrt(dx * dx + dy * dy);
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0 && state.dragDistance <= DRAG_THRESHOLD) {
      const grid = canvasToGrid(e.clientX, e.clientY, sim);
      if (state.placementMode) {
        handlePlacement(grid.x, grid.y);
      } else {
        sim.ignite(grid.x, grid.y, 2);
      }
    }
    state.mouseDown = false;
    state.dragDistance = 0;
  });

  canvas.addEventListener('mouseleave', () => {
    state.mouseDown = false;
    state.mouseX = -1;
    state.mouseY = -1;
    state.dragDistance = 0;
  });

  // Touch support
  let touchStartX = 0;
  let touchStartY = 0;
  let touchDragDist = 0;

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    state.mouseDown = true;
    state.mouseX = touch.clientX;
    state.mouseY = touch.clientY;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchDragDist = 0;
  });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    state.mouseX = touch.clientX;
    state.mouseY = touch.clientY;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    touchDragDist = Math.sqrt(dx * dx + dy * dy);
    state.dragDistance = touchDragDist;
  });

  canvas.addEventListener('touchend', (e) => {
    if (touchDragDist <= DRAG_THRESHOLD) {
      const grid = canvasToGrid(state.mouseX, state.mouseY, sim);
      if (state.placementMode) {
        handlePlacement(grid.x, grid.y);
      } else {
        sim.ignite(grid.x, grid.y, 2);
      }
    }
    state.mouseDown = false;
    touchDragDist = 0;
    state.dragDistance = 0;
  });
}
