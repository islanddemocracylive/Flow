/**
 * Wall geometry building with door cutouts and frames.
 *
 * Door cells are 1ft wide (matching the grid). Adjacent door cells on
 * the same wall merge into a single opening with frames only on the
 * outer edges.
 */

import { ROOM_W, ROOM_D, ROOM_H, DOOR_H } from '../constants.js';
import { wallMat, edgeMat, cornerMat, doorFrameMat } from './materials.js';
import { scene } from './scene.js';

// Wall group – rebuilt when doors change (hidden in orbit mode)
export const wallGroup = new THREE.Group();
if (scene) scene.add(wallGroup);

// Door frame group – always visible (separate from walls for orbit mode)
export const doorFrameGroup = new THREE.Group();
if (scene) scene.add(doorFrameGroup);

/**
 * Merge adjacent door cells on a wall into contiguous runs.
 * Returns array of { start, end } where the opening spans [start, end] in world units.
 */
function mergeDoorRuns(doors, wallName) {
  // Get the positions along the wall for each door cell
  const positions = doors
    .filter(d => d.wall === wallName)
    .map(d => (wallName === 'far' || wallName === 'back') ? d.x : d.y)
    .sort((a, b) => a - b);

  if (positions.length === 0) return [];

  // Merge consecutive integers into runs
  const runs = [];
  let runStart = positions[0];
  let runEnd = positions[0];

  for (let i = 1; i < positions.length; i++) {
    if (positions[i] === runEnd + 1) {
      runEnd = positions[i];
    } else {
      runs.push({ start: runStart, end: runEnd + 1 }); // end is exclusive (world units)
      runStart = positions[i];
      runEnd = positions[i];
    }
  }
  runs.push({ start: runStart, end: runEnd + 1 });

  return runs;
}

export function buildWalls(sim) {
  // Clear previous walls
  while (wallGroup.children.length > 0) {
    const c = wallGroup.children[0];
    wallGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
  }
  // Clear previous door frames
  while (doorFrameGroup.children.length > 0) {
    const c = doorFrameGroup.children[0];
    doorFrameGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
  }

  const doors = sim ? sim.vents.filter(v => v.type === 'door') : [];

  buildWallWithDoors('far', ROOM_W, ROOM_H, { px: ROOM_W / 2, py: ROOM_H / 2, pz: 0, ry: 0 }, doors);
  buildWallWithDoors('left', ROOM_D, ROOM_H, { px: 0, py: ROOM_H / 2, pz: ROOM_D / 2, ry: Math.PI / 2 }, doors);
  buildWallWithDoors('right', ROOM_D, ROOM_H, { px: ROOM_W, py: ROOM_H / 2, pz: ROOM_D / 2, ry: -Math.PI / 2 }, doors);
  buildWallWithDoors('back', ROOM_W, ROOM_H, { px: ROOM_W / 2, py: ROOM_H / 2, pz: ROOM_D, ry: Math.PI }, doors);
}

/**
 * Convert a world-space position to the Shape's local X coordinate.
 */
function worldToShapeLocalX(worldPos, wallCenter, wallName) {
  const offset = worldPos - wallCenter;
  if (wallName === 'back' || wallName === 'left') {
    return -offset;
  }
  return offset;
}

function buildWallWithDoors(wallName, wallWidth, wallHeight, transform, allDoors) {
  const runs = mergeDoorRuns(allDoors, wallName);

  if (runs.length === 0) {
    const geo = new THREE.PlaneGeometry(wallWidth, wallHeight);
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.position.set(transform.px, transform.py, transform.pz);
    if (transform.ry) mesh.rotation.y = transform.ry;
    wallGroup.add(mesh);

    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, edgeMat);
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    wallGroup.add(line);
    return;
  }

  // Wall center along its length axis
  const wallCenter = (wallName === 'far' || wallName === 'back')
    ? transform.px
    : transform.pz;

  // Wall with door openings – use shape with holes
  const shape = new THREE.Shape();
  shape.moveTo(-wallWidth / 2, -wallHeight / 2);
  shape.lineTo(wallWidth / 2, -wallHeight / 2);
  shape.lineTo(wallWidth / 2, wallHeight / 2);
  shape.lineTo(-wallWidth / 2, wallHeight / 2);
  shape.lineTo(-wallWidth / 2, -wallHeight / 2);

  for (const run of runs) {
    // run.start / run.end are in world units along the wall
    const worldLeft = run.start;
    const worldRight = run.end;
    const worldCenter = (worldLeft + worldRight) / 2;
    const openingWidth = worldRight - worldLeft;

    const localLeft = worldToShapeLocalX(worldLeft, wallCenter, wallName);
    const localRight = worldToShapeLocalX(worldRight, wallCenter, wallName);
    const holeLeft = Math.min(localLeft, localRight);
    const holeRight = Math.max(localLeft, localRight);
    const holeBottom = -wallHeight / 2;
    const holeTop = holeBottom + DOOR_H;

    const hole = new THREE.Path();
    hole.moveTo(holeLeft, holeBottom);
    hole.lineTo(holeRight, holeBottom);
    hole.lineTo(holeRight, holeTop);
    hole.lineTo(holeLeft, holeTop);
    hole.lineTo(holeLeft, holeBottom);
    shape.holes.push(hole);

    // Door frame around the merged opening
    const frameThickness = 0.15;

    const frameParts = [
      // Left jamb
      { w: frameThickness, h: DOOR_H, wp: worldLeft - frameThickness / 2, ly: holeBottom + DOOR_H / 2 },
      // Right jamb
      { w: frameThickness, h: DOOR_H, wp: worldRight + frameThickness / 2, ly: holeBottom + DOOR_H / 2 },
      // Header
      { w: openingWidth + frameThickness * 2, h: frameThickness, wp: worldCenter, ly: holeTop + frameThickness / 2 },
    ];
    for (const fp of frameParts) {
      const fg = new THREE.PlaneGeometry(fp.w, fp.h);
      const fm = new THREE.Mesh(fg, doorFrameMat);
      if (wallName === 'far') {
        fm.position.set(fp.wp, transform.py + fp.ly, transform.pz + 0.01);
      } else if (wallName === 'left') {
        fm.position.set(transform.px + 0.01, transform.py + fp.ly, fp.wp);
        fm.rotation.y = Math.PI / 2;
      } else if (wallName === 'right') {
        fm.position.set(transform.px - 0.01, transform.py + fp.ly, fp.wp);
        fm.rotation.y = Math.PI / 2;
      } else if (wallName === 'back') {
        fm.position.set(fp.wp, transform.py + fp.ly, transform.pz - 0.01);
      }
      doorFrameGroup.add(fm);
    }
  }

  const geo = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geo, wallMat);
  mesh.position.set(transform.px, transform.py, transform.pz);
  if (transform.ry) mesh.rotation.y = transform.ry;
  wallGroup.add(mesh);

  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(edges, edgeMat);
  line.position.copy(mesh.position);
  line.rotation.copy(mesh.rotation);
  wallGroup.add(line);
}

// ── Floor + Room wireframe edges (built on import) ────────
if (scene) {
  const floorGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_D);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ color: 0x2a2a35, side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(ROOM_W / 2, 0, ROOM_D / 2);
  scene.add(floor);

  // Floor outline
  const floorEdges = new THREE.EdgesGeometry(floorGeo);
  const floorLine = new THREE.LineSegments(floorEdges, edgeMat);
  floorLine.rotation.x = -Math.PI / 2;
  floorLine.position.copy(floor.position);
  scene.add(floorLine);

  // Corner edges
  function addCornerEdge(x, z) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0, z),
      new THREE.Vector3(x, ROOM_H, z),
    ]);
    scene.add(new THREE.LineSegments(geo, cornerMat));
  }
  addCornerEdge(0, 0);
  addCornerEdge(ROOM_W, 0);
  addCornerEdge(0, ROOM_D);
  addCornerEdge(ROOM_W, ROOM_D);

  // Ceiling outline
  const ceilingOutlineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, ROOM_H, 0),
    new THREE.Vector3(ROOM_W, ROOM_H, 0),
    new THREE.Vector3(ROOM_W, ROOM_H, ROOM_D),
    new THREE.Vector3(0, ROOM_H, ROOM_D),
    new THREE.Vector3(0, ROOM_H, 0),
  ]);
  scene.add(new THREE.Line(ceilingOutlineGeo, cornerMat));
}
