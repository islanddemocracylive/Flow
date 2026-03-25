/**
 * Shared heat-to-color conversion used by both the 2D canvas renderer
 * and the 3D ceiling panel updater.
 */

/**
 * Convert heat value [0,1] to RGB integer components for 2D canvas.
 * Returns { r, g, b } in range [0, 255].
 */
export function heatToRGB(heat) {
  if (!(heat > 0)) return { r: 20, g: 20, b: 28 }; // covers 0, negative, NaN, undefined

  const t = Math.min(heat, 1);
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

  // Flicker
  const flicker = 0.9 + Math.random() * 0.1;
  r = Math.min(255, Math.round(r * flicker));
  g = Math.min(255, Math.round(g * flicker));
  b = Math.min(255, Math.round(b * flicker));

  return { r, g, b };
}

/**
 * Convert gas layer temperature (°C) to an RGBA color for the smoke overlay.
 * Returns { r, g, b, a } with r,g,b in [0,255] and a in [0,1].
 */
export function gasLayerColor(temp) {
  if (temp < 100) return { r: 128, g: 128, b: 128, a: 0 };

  let r, g, b, a;
  if (temp < 300) {
    // Light gray smoke
    const t = (temp - 100) / 200;
    r = 128; g = 128; b = 128;
    a = t * 0.3;
  } else if (temp < 500) {
    // Brownish gray — thickening smoke
    const t = (temp - 300) / 200;
    r = Math.round(128 + t * 12);
    g = Math.round(128 - t * 8);
    b = Math.round(128 - t * 38);
    a = 0.3 + t * 0.2;
  } else if (temp < 600) {
    // Orange tint — danger zone
    const t = (temp - 500) / 100;
    r = Math.round(140 + t * 40);
    g = Math.round(120 - t * 20);
    b = Math.round(90 - t * 50);
    a = 0.5 + t * 0.1;
  } else {
    // Bright orange-red — flashover
    const t = Math.min(1, (temp - 600) / 200);
    r = Math.round(180 + t * 40);
    g = Math.round(100 - t * 20);
    b = Math.round(40 - t * 20);
    a = 0.6 + t * 0.1;
  }

  return { r, g, b, a };
}

/**
 * Convert heat value [0,1] to a THREE.Color for 3D ceiling panels.
 * Returns a THREE.Color instance.
 */
const BASE_COLOR = null; // lazily initialized

export function heatToColor(heat) {
  if (!(heat > 0)) return new THREE.Color(0x1a1a24); // covers 0, negative, NaN, undefined

  const t = Math.min(heat, 1);
  let r, g, b;
  if (t < 0.33) {
    const s = t / 0.33;
    r = s * 0.78;
    g = s * 0.08;
    b = 0;
  } else if (t < 0.66) {
    const s = (t - 0.33) / 0.33;
    r = 0.78 + s * 0.22;
    g = 0.08 + s * 0.55;
    b = 0;
  } else {
    const s = (t - 0.66) / 0.34;
    r = 1;
    g = 0.63 + s * 0.37;
    b = s * 0.78;
  }

  // Flicker
  const flicker = 0.92 + Math.random() * 0.08;
  r = Math.min(1, r * flicker);
  g = Math.min(1, g * flicker);
  b = Math.min(1, b * flicker);

  return new THREE.Color(r, g, b);
}
