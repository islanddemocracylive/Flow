/**
 * Shared constants used across simulation, 2D rendering, and 3D visualization.
 */

// Grid dimensions (1 ft² panels)
export const GRID_COLS = 20;
export const GRID_ROWS = 10;

// Room dimensions in feet (mapped 1:1 to Three.js units)
export const ROOM_W = 20;  // x-axis (columns)
export const ROOM_D = 10;  // z-axis (rows)
export const ROOM_H = 9;   // y-axis (height)

// Input
export const DRAG_THRESHOLD = 5; // pixels – movement beyond this = drag (water)

// Door geometry
export const DOOR_W = 3;   // door width in feet
export const DOOR_H = 6.67; // door height in feet (standard 6'8")

// Fire physics (gas layer / HRR model)
export const GAS_LAYER_MASS = 200;     // kg — approximate mass of upper gas layer
export const GAS_CP = 1.0;             // kJ/(kg·K) — specific heat of gas mixture
export const FLASHOVER_TEMP = 600;     // °C — gas layer temp triggering full room involvement
export const REIGNITION_TEMP = 500;    // °C — gas layer temp that reignites unsaturated cells
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
