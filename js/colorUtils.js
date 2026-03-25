/**
 * State-aware color conversion for the fire simulation.
 *
 * Cell states (from simulation.js):
 *   0 = UNIGNITED  → dark ceiling (ambient)
 *   1 = PREHEATING → warm amber tint, intensity = exposure / threshold
 *   2 = BURNING    → fire colors (red → orange → yellow → white)
 *   3 = SUPPRESSED → blue-gray tint, fading as moisture evaporates
 */

import {
  CELL_UNIGNITED, CELL_PREHEATING, CELL_BURNING, CELL_SUPPRESSED,
} from './simulation.js';

// ── 2D canvas (RGB 0-255) ────────────────────────────────

const DARK = { r: 20, g: 20, b: 28 };

/**
 * State-aware cell color for 2D canvas.
 * @param {number} state - CELL_* constant
 * @param {number} heat - [0-1] fire intensity (burning cells)
 * @param {number} exposureNorm - [0-1] exposure / threshold (preheating cells)
 * @param {number} moisture - [0-1] water saturation (suppressed cells)
 * @returns {{ r, g, b }}
 */
export function cellToRGB(state, heat, exposureNorm, moisture) {
  if (state === CELL_BURNING && heat > 0) {
    return _fireRGB(heat);
  }
  if (state === CELL_PREHEATING && exposureNorm > 0) {
    return _preheatRGB(exposureNorm);
  }
  if (state === CELL_SUPPRESSED) {
    return _suppressedRGB(moisture);
  }
  return DARK;
}

/** Fire colors: dark red → bright orange → yellow → white. With flicker. */
function _fireRGB(t) {
  t = Math.min(t, 1);
  let r, g, b;
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
  const flicker = 0.9 + Math.random() * 0.1;
  r = Math.min(255, Math.round(r * flicker));
  g = Math.min(255, Math.round(g * flicker));
  b = Math.min(255, Math.round(b * flicker));
  return { r, g, b };
}

/** Preheating: dark → subtle amber/brown glow as exposure increases. */
function _preheatRGB(t) {
  t = Math.min(t, 1);
  // Subtle warm tint: dark → amber. Alpha-like blend with dark background.
  const r = Math.round(20 + t * 80);   // 20 → 100
  const g = Math.round(20 + t * 40);   // 20 → 60
  const b = Math.round(28 - t * 18);   // 28 → 10
  return { r, g, b };
}

/** Suppressed: blue-gray tint, brighter when wetter. */
function _suppressedRGB(moisture) {
  const m = Math.min(moisture, 1);
  const r = Math.round(25 + m * 15);   // 25 → 40
  const g = Math.round(30 + m * 30);   // 30 → 60
  const b = Math.round(40 + m * 40);   // 40 → 80
  return { r, g, b };
}

// Legacy alias for any code still using the old function
export function heatToRGB(heat) {
  if (!(heat > 0)) return DARK;
  return _fireRGB(heat);
}

// ── Gas layer color (unchanged) ──────────────────────────

export function gasLayerColor(temp) {
  if (temp < 100) return { r: 128, g: 128, b: 128, a: 0 };

  let r, g, b, a;
  if (temp < 300) {
    const t = (temp - 100) / 200;
    r = 128; g = 128; b = 128;
    a = t * 0.3;
  } else if (temp < 500) {
    const t = (temp - 300) / 200;
    r = Math.round(128 + t * 12);
    g = Math.round(128 - t * 8);
    b = Math.round(128 - t * 38);
    a = 0.3 + t * 0.2;
  } else if (temp < 600) {
    const t = (temp - 500) / 100;
    r = Math.round(140 + t * 40);
    g = Math.round(120 - t * 20);
    b = Math.round(90 - t * 50);
    a = 0.5 + t * 0.1;
  } else {
    const t = Math.min(1, (temp - 600) / 200);
    r = Math.round(180 + t * 40);
    g = Math.round(100 - t * 20);
    b = Math.round(40 - t * 20);
    a = 0.6 + t * 0.1;
  }
  return { r, g, b, a };
}

// ── 3D ceiling panels (THREE.Color) ─────────────────────

const _tempColor = typeof THREE !== 'undefined' ? new THREE.Color() : null;

/**
 * State-aware cell color for 3D ceiling panels.
 * Returns a reused THREE.Color — callers must .copy() or use immediately.
 */
export function cellToColor(state, heat, exposureNorm, moisture) {
  if (!_tempColor) return null;

  if (state === CELL_BURNING && heat > 0) {
    return _fireColor3D(heat);
  }
  if (state === CELL_PREHEATING && exposureNorm > 0) {
    const t = Math.min(exposureNorm, 1);
    _tempColor.setRGB(
      0.08 + t * 0.31,  // 0.08 → 0.39
      0.08 + t * 0.16,  // 0.08 → 0.24
      0.11 - t * 0.07   // 0.11 → 0.04
    );
    return _tempColor;
  }
  if (state === CELL_SUPPRESSED) {
    const m = Math.min(moisture, 1);
    _tempColor.setRGB(
      0.10 + m * 0.06,  // dark blue-gray
      0.12 + m * 0.12,
      0.16 + m * 0.16
    );
    return _tempColor;
  }
  _tempColor.setHex(0x1a1a24);
  return _tempColor;
}

/** Fire colors for 3D — same gradient as 2D but in [0-1] range. With flicker. */
function _fireColor3D(heat) {
  const t = Math.min(heat, 1);
  let r, g, b;
  if (t < 0.33) {
    const s = t / 0.33;
    r = s * 0.78; g = s * 0.08; b = 0;
  } else if (t < 0.66) {
    const s = (t - 0.33) / 0.33;
    r = 0.78 + s * 0.22; g = 0.08 + s * 0.55; b = 0;
  } else {
    const s = (t - 0.66) / 0.34;
    r = 1; g = 0.63 + s * 0.37; b = s * 0.78;
  }
  const flicker = 0.92 + Math.random() * 0.08;
  _tempColor.setRGB(
    Math.min(1, r * flicker),
    Math.min(1, g * flicker),
    Math.min(1, b * flicker)
  );
  return _tempColor;
}

// Legacy alias
export function heatToColor(heat) {
  if (!_tempColor) return null;
  if (!(heat > 0)) { _tempColor.setHex(0x1a1a24); return _tempColor; }
  return _fireColor3D(heat);
}
