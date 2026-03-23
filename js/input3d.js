/**
 * 3D view input handling: mouse and touch events for water spray.
 * Left-click+drag = water spray via raycasting.
 * Tap / short click = ignite fire.
 * 2-finger touch is handled by fpCamera for looking around.
 */

import { DRAG_THRESHOLD } from './constants.js';

const room3dContainer = document.getElementById('room3d-container');

export function setupInput3D(sim, state, room3d, handlePlacement) {
  if (!room3dContainer) return;

  let mouse3dDown = false;
  let mouseX3d = 0;
  let mouseY3d = 0;
  let mouseDownX3d = 0;
  let mouseDownY3d = 0;
  let dragDistance3d = 0;

  // Expose 3D drag state on state object so main loop can access it
  state.mouse3dDown = false;
  state.mouseX3d = 0;
  state.mouseY3d = 0;
  state.dragDistance3d = 0;

  room3dContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    mouse3dDown = true;
    mouseX3d = e.clientX;
    mouseY3d = e.clientY;
    mouseDownX3d = e.clientX;
    mouseDownY3d = e.clientY;
    dragDistance3d = 0;
    state.mouse3dDown = true;
    state.mouseX3d = e.clientX;
    state.mouseY3d = e.clientY;
    state.dragDistance3d = 0;
  });

  room3dContainer.addEventListener('mousemove', (e) => {
    if (!mouse3dDown) return;
    mouseX3d = e.clientX;
    mouseY3d = e.clientY;
    const dx = e.clientX - mouseDownX3d;
    const dy = e.clientY - mouseDownY3d;
    dragDistance3d = Math.sqrt(dx * dx + dy * dy);
    state.mouseX3d = mouseX3d;
    state.mouseY3d = mouseY3d;
    state.dragDistance3d = dragDistance3d;
  });

  room3dContainer.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (dragDistance3d <= DRAG_THRESHOLD && room3d.available) {
      const hit = room3d.raycastCeiling(e.clientX, e.clientY);
      if (hit) {
        if (state.placementMode) {
          handlePlacement(hit.gridX, hit.gridY);
        } else {
          sim.ignite(hit.gridX, hit.gridY, 2);
        }
      }
    }
    mouse3dDown = false;
    dragDistance3d = 0;
    state.mouse3dDown = false;
    state.dragDistance3d = 0;
    room3d.hideWaterSpray();
  });

  room3dContainer.addEventListener('mouseleave', () => {
    mouse3dDown = false;
    dragDistance3d = 0;
    state.mouse3dDown = false;
    state.dragDistance3d = 0;
    room3d.hideWaterSpray();
  });

  // Touch: 1-finger = spray/tap, 2-finger handled by fpCamera
  let touch3dStartX = 0;
  let touch3dStartY = 0;
  let touch3dDragDist = 0;

  room3dContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const touch = e.touches[0];
    mouse3dDown = true;
    mouseX3d = touch.clientX;
    mouseY3d = touch.clientY;
    touch3dStartX = touch.clientX;
    touch3dStartY = touch.clientY;
    touch3dDragDist = 0;
    dragDistance3d = 0;
    state.mouse3dDown = true;
    state.mouseX3d = touch.clientX;
    state.mouseY3d = touch.clientY;
    state.dragDistance3d = 0;
  });

  room3dContainer.addEventListener('touchmove', (e) => {
    // Cancel spray if finger count changed to 2
    if (e.touches.length !== 1) {
      if (mouse3dDown) {
        mouse3dDown = false;
        dragDistance3d = 0;
        state.mouse3dDown = false;
        state.dragDistance3d = 0;
        room3d.hideWaterSpray();
      }
      return;
    }
    if (!mouse3dDown) return;
    e.preventDefault();
    const touch = e.touches[0];
    mouseX3d = touch.clientX;
    mouseY3d = touch.clientY;
    const dx = touch.clientX - touch3dStartX;
    const dy = touch.clientY - touch3dStartY;
    touch3dDragDist = Math.sqrt(dx * dx + dy * dy);
    dragDistance3d = touch3dDragDist;
    state.mouseX3d = mouseX3d;
    state.mouseY3d = mouseY3d;
    state.dragDistance3d = dragDistance3d;
  });

  room3dContainer.addEventListener('touchend', (e) => {
    if (touch3dDragDist <= DRAG_THRESHOLD && room3d.available) {
      const hit = room3d.raycastCeiling(mouseX3d, mouseY3d);
      if (hit) {
        if (state.placementMode) {
          handlePlacement(hit.gridX, hit.gridY);
        } else {
          sim.ignite(hit.gridX, hit.gridY, 2);
        }
      }
    }
    mouse3dDown = false;
    touch3dDragDist = 0;
    dragDistance3d = 0;
    state.mouse3dDown = false;
    state.dragDistance3d = 0;
    room3d.hideWaterSpray();
  });
}
