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

/** Fire colors: orange → bright orange → yellow → white. No red — fire starts orange. */
function _fireRGB(t) {
  t = Math.min(t, 1);
  let r, g, b;
  if (t < 0.4) {
    // Low intensity: orange (200,80,0) → bright orange (240,140,0)
    const s = t / 0.4;
    r = Math.round(200 + s * 40);
    g = Math.round(80 + s * 60);
    b = 0;
  } else if (t < 0.75) {
    // Mid intensity: bright orange → yellow (255,220,30)
    const s = (t - 0.4) / 0.35;
    r = 240 + Math.round(s * 15);
    g = 140 + Math.round(s * 80);
    b = Math.round(s * 30);
  } else {
    // High intensity: yellow → white (255,255,200)
    const s = (t - 0.75) / 0.25;
    r = 255;
    g = 220 + Math.round(s * 35);
    b = 30 + Math.round(s * 170);
  }
  const flicker = 0.9 + Math.random() * 0.1;
  r = Math.min(255, Math.round(r * flicker));
  g = Math.min(255, Math.round(g * flicker));
  b = Math.min(255, Math.round(b * flicker));
  return { r, g, b };
}

/** Preheating: dark → brown → dark red as exposure approaches ignition. */
function _preheatRGB(t) {
  t = Math.min(t, 1);
  if (t < 0.5) {
    // Low exposure: dark → warm brown
    const s = t / 0.5;
    return {
      r: Math.round(20 + s * 60),    // 20 → 80
      g: Math.round(20 + s * 25),    // 20 → 45
      b: Math.round(28 - s * 18),    // 28 → 10
    };
  }
  // High exposure: warm brown → dark red (approaching ignition)
  const s = (t - 0.5) / 0.5;
  return {
    r: Math.round(80 + s * 80),     // 80 → 160
    g: Math.round(45 - s * 20),     // 45 → 25
    b: Math.round(10 - s * 5),      // 10 → 5
  };
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
    if (t < 0.5) {
      // Dark → warm brown
      const s = t / 0.5;
      _tempColor.setRGB(0.08 + s * 0.24, 0.08 + s * 0.10, 0.11 - s * 0.07);
    } else {
      // Warm brown → dark red
      const s = (t - 0.5) / 0.5;
      _tempColor.setRGB(0.32 + s * 0.31, 0.18 - s * 0.08, 0.04 - s * 0.02);
    }
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

/** Fire colors for 3D — orange → yellow → white. Matches 2D gradient. */
function _fireColor3D(heat) {
  const t = Math.min(heat, 1);
  let r, g, b;
  if (t < 0.4) {
    // Orange → bright orange
    const s = t / 0.4;
    r = 0.78 + s * 0.16; g = 0.31 + s * 0.24; b = 0;
  } else if (t < 0.75) {
    // Bright orange → yellow
    const s = (t - 0.4) / 0.35;
    r = 0.94 + s * 0.06; g = 0.55 + s * 0.31; b = s * 0.12;
  } else {
    // Yellow → white
    const s = (t - 0.75) / 0.25;
    r = 1; g = 0.86 + s * 0.14; b = 0.12 + s * 0.66;
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
