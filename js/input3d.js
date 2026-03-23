/**
 * 3D view input handling: water spray only.
 *
 * The 3D view is the firefighter training view — the only interaction
 * is spraying water. Fire ignition, object/vent placement, and all
 * admin functions are done from the 2D control view.
 *
 * Right-click+drag = water spray via raycasting
 * Mobile 2-finger drag = water spray
 *
 * Left-click and 1-finger touch are handled by fpCamera for looking around.
 */

import { DRAG_THRESHOLD } from './constants.js';

const room3dContainer = document.getElementById('room3d-container');

export function setupInput3D(sim, state, room3d) {
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
  let touch2fMidX = 0;
  let touch2fMidY = 0;

  room3dContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      touch2fActive = true;
      touch2fMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      touch2fMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      // Start spraying immediately on 2-finger touch
      state.mouse3dDown = true;
      state.mouseX3d = touch2fMidX;
      state.mouseY3d = touch2fMidY;
      state.dragDistance3d = DRAG_THRESHOLD + 1; // exceed threshold immediately
    }
  }, { passive: false });

  room3dContainer.addEventListener('touchmove', (e) => {
    if (touch2fActive && e.touches.length >= 2) {
      e.preventDefault();
      touch2fMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      touch2fMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      state.mouseX3d = touch2fMidX;
      state.mouseY3d = touch2fMidY;
      state.dragDistance3d = DRAG_THRESHOLD + 1;
    }
  }, { passive: false });

  room3dContainer.addEventListener('touchend', (e) => {
    if (touch2fActive && e.touches.length < 2) {
      touch2fActive = false;
      state.mouse3dDown = false;
      state.dragDistance3d = 0;
      room3d.hideWaterSpray();
    }
  }, { passive: true });
}
