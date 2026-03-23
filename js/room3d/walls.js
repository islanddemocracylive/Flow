/**
 * Wall geometry building with door cutouts and frames.
 */

import { ROOM_W, ROOM_D, ROOM_H, DOOR_W, DOOR_H } from '../constants.js';
import { wallMat, edgeMat, cornerMat, doorFrameMat } from './materials.js';
import { scene } from './scene.js';

// Wall group – rebuilt when doors change
const wallGroup = new THREE.Group();
if (scene) scene.add(wallGroup);

export function buildWalls(sim) {
  // Clear previous
  while (wallGroup.children.length > 0) {
    const c = wallGroup.children[0];
    wallGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
  }

  const doors = sim ? sim.vents.filter(v => v.type === 'door') : [];

  buildWallWithDoors('far', ROOM_W, ROOM_H, { px: ROOM_W / 2, py: ROOM_H / 2, pz: 0, ry: 0 }, doors);
  buildWallWithDoors('left', ROOM_D, ROOM_H, { px: 0, py: ROOM_H / 2, pz: ROOM_D / 2, ry: Math.PI / 2 }, doors);
  buildWallWithDoors('right', ROOM_D, ROOM_H, { px: ROOM_W, py: ROOM_H / 2, pz: ROOM_D / 2, ry: -Math.PI / 2 }, doors);
  buildWallWithDoors('back', ROOM_W, ROOM_H, { px: ROOM_W / 2, py: ROOM_H / 2, pz: ROOM_D, ry: Math.PI }, doors);
}

function buildWallWithDoors(wallName, wallWidth, wallHeight, transform, allDoors) {
  const doors = allDoors.filter(d => d.wall === wallName);

  if (doors.length === 0) {
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

  // Wall with door openings – use shape with holes
  const shape = new THREE.Shape();
  shape.moveTo(-wallWidth / 2, -wallHeight / 2);
  shape.lineTo(wallWidth / 2, -wallHeight / 2);
  shape.lineTo(wallWidth / 2, wallHeight / 2);
  shape.lineTo(-wallWidth / 2, wallHeight / 2);
  shape.lineTo(-wallWidth / 2, -wallHeight / 2);

  for (const door of doors) {
    let localX;
    if (wallName === 'far' || wallName === 'back') {
      localX = door.x - wallWidth / 2 + 0.5;
    } else {
      localX = door.y - wallWidth / 2 + 0.5;
    }

    const holeLeft = localX - DOOR_W / 2;
    const holeRight = localX + DOOR_W / 2;
    const holeBottom = -wallHeight / 2;
    const holeTop = holeBottom + DOOR_H;

    const hole = new THREE.Path();
    hole.moveTo(holeLeft, holeBottom);
    hole.lineTo(holeRight, holeBottom);
    hole.lineTo(holeRight, holeTop);
    hole.lineTo(holeLeft, holeTop);
    hole.lineTo(holeLeft, holeBottom);
    shape.holes.push(hole);

    // Door frame
    const frameThickness = 0.15;
    const frameParts = [
      { w: frameThickness, h: DOOR_H, lx: holeLeft - frameThickness / 2, ly: holeBottom + DOOR_H / 2 },
      { w: frameThickness, h: DOOR_H, lx: holeRight + frameThickness / 2, ly: holeBottom + DOOR_H / 2 },
      { w: DOOR_W + frameThickness * 2, h: frameThickness, lx: localX, ly: holeTop + frameThickness / 2 },
    ];
    for (const fp of frameParts) {
      const fg = new THREE.PlaneGeometry(fp.w, fp.h);
      const fm = new THREE.Mesh(fg, doorFrameMat);
      if (wallName === 'far') {
        fm.position.set(transform.px + fp.lx, transform.py + fp.ly, transform.pz + 0.01);
      } else if (wallName === 'left') {
        fm.position.set(transform.px + 0.01, transform.py + fp.ly, transform.pz + fp.lx);
        fm.rotation.y = Math.PI / 2;
      } else if (wallName === 'right') {
        fm.position.set(transform.px - 0.01, transform.py + fp.ly, transform.pz + fp.lx);
        fm.rotation.y = Math.PI / 2;
      } else if (wallName === 'back') {
        fm.position.set(transform.px + fp.lx, transform.py + fp.ly, transform.pz - 0.01);
      }
      wallGroup.add(fm);
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
