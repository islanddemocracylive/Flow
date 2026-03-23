/**
 * Shared constants used across simulation, 2D rendering, and 3D visualization.
 */

// Grid dimensions (1 ft² panels)
export const GRID_COLS = 20;
export const GRID_ROWS = 10;

// Room dimensions in feet (mapped 1:1 to Three.js units)
export const ROOM_W = 20;  // x-axis (columns)
export const ROOM_D = 10;  // z-axis (rows)
export const ROOM_H = 8;   // y-axis (height)

// Input
export const DRAG_THRESHOLD = 5; // pixels – movement beyond this = drag (water)

// Door geometry
export const DOOR_W = 3;   // door width in feet
export const DOOR_H = 6.67; // door height in feet (standard 6'8")
