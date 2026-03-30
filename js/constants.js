/**
 * Shared constants used across simulation, 2D rendering, and 3D visualization.
 */

// Room dimensions in feet (mapped 1:1 to Three.js units and grid cells)
// Grid is 1 ft² per cell, so GRID_COLS = ROOM_W, GRID_ROWS = ROOM_D.
export const ROOM_W = 20;  // x-axis (columns / width in feet)
export const ROOM_D = 10;  // z-axis (rows / depth in feet)
export const ROOM_H = 8;   // y-axis (ceiling height in feet) — spec: 8 ft

// Derived: grid dimensions match room footprint at 1 ft² per cell
export const GRID_COLS = ROOM_W;
export const GRID_ROWS = ROOM_D;

// Metric conversions for physics (Alpert correlations, etc.)
export const FT_TO_M = 0.3048;
export const ROOM_H_M = ROOM_H * FT_TO_M;  // ceiling height in metres

// Input
export const DRAG_THRESHOLD = 5; // pixels – movement beyond this = drag (water)

// Door geometry
export const DOOR_W = 3;   // door width in feet
export const DOOR_H = 6.67; // door height in feet (standard 6'8")

// Fire physics (gas layer / HRR model)
export const GAS_LAYER_MASS = 200;     // kg — approximate mass of upper gas layer
export const GAS_CP = 1.0;             // kJ/(kg·K) — specific heat of gas mixture
export const UNTENABLE_TEMP = 260;     // °C (~500°F) — gas layer temp untenable for firefighter
                                       // Turnout gear rated to ~260°C; above this, burns through
                                       // in seconds. NFPA 1971 thermal protective performance.
export const AMBIENT_TEMP = 20;        // °C
export const CELL_HRR_MAX = 25;        // kW per cell at heat=1.0 (200 cells × 25 = 5 MW max)

// Oxygen model
export const ROOM_AIR_MASS = 57.8;     // kg of air in the room (45.3 m³)
export const AMBIENT_O2 = 20.9;        // % O₂ in ambient air
export const O2_FLAMING_LIMIT = 15;    // % O₂ below which flaming ceases
export const O2_LETHAL_LIMIT = 12;     // % O₂ below which atmosphere is IDLH
export const O2_PER_MJ = 1.1 / 13.1;  // kg O₂ consumed per MJ of energy released

// Ventilation
export const DOOR_AREA_M2 = 0.9 * 2.1;  // standard interior door opening (m²)
export const DOOR_HEIGHT_M = 2.1;        // door height (m)
export const VENT_AREA_M2 = 0.25;        // ceiling vent opening (m²) — approx 0.5m × 0.5m
