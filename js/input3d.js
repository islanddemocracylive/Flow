/**
 * 3D view input handling: mouse and touch events for water spray.
 *
 * Right-click+drag = water spray via raycasting
 * Right-click (short) = ignite fire / place object
 * Mobile 2-finger drag = water spray
 * Mobile 2-finger tap = ignite fire / place object
 *
 * Left-click and 1-finger touch are handled by fpCamera for looking around.
 */

import { DRAG_THRESHOLD } from './constants.js';

const room3dContainer = document.getElementById('room3d-container');

export function setupInput3D(sim, state, room3d, handlePlacement) {
  if (!room3dContainer) return;

  // ── Right-click water spray (mouse) ──────────────────────

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
    if (e.button !== 2) return; // only right-click
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
    if (e.button !== 2) return;
    if (dragDistance3d <= DRAG_THRESHOLD && room3d.available) {
      // Short right-click = fire ignition or placement
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

  // ── 2-finger water spray (touch) ────────────────────────

  let touch2fActive = false;
  let touch2fStartMidX = 0;
  let touch2fStartMidY = 0;
  let touch2fDragDist = 0;
  let touch2fMidX = 0;
  let touch2fMidY = 0;

  room3dContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      touch2fActive = true;
      touch2fMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      touch2fMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      touch2fStartMidX = touch2fMidX;
      touch2fStartMidY = touch2fMidY;
      touch2fDragDist = 0;
      state.mouse3dDown = true;
      state.mouseX3d = touch2fMidX;
      state.mouseY3d = touch2fMidY;
      state.dragDistance3d = 0;
    }
  }, { passive: false });

  room3dContainer.addEventListener('touchmove', (e) => {
    if (touch2fActive && e.touches.length >= 2) {
      e.preventDefault();
      touch2fMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      touch2fMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const dx = touch2fMidX - touch2fStartMidX;
      const dy = touch2fMidY - touch2fStartMidY;
      touch2fDragDist = Math.sqrt(dx * dx + dy * dy);
      state.mouseX3d = touch2fMidX;
      state.mouseY3d = touch2fMidY;
      state.dragDistance3d = touch2fDragDist;
    }
  }, { passive: false });

  room3dContainer.addEventListener('touchend', (e) => {
    if (touch2fActive && e.touches.length < 2) {
      // Gesture ended
      if (touch2fDragDist <= DRAG_THRESHOLD && room3d.available) {
        // Short 2-finger tap = fire ignition or placement
        const hit = room3d.raycastCeiling(touch2fMidX, touch2fMidY);
        if (hit) {
          if (state.placementMode) {
            handlePlacement(hit.gridX, hit.gridY);
          } else {
            sim.ignite(hit.gridX, hit.gridY, 2);
          }
        }
      }
      touch2fActive = false;
      touch2fDragDist = 0;
      state.mouse3dDown = false;
      state.dragDistance3d = 0;
      room3d.hideWaterSpray();
    }
  }, { passive: true });
}
