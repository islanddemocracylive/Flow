/**
 * 3D obstacle meshes – stackable 1ft blocks on the floor grid.
 *
 * Rebuilt when obstacle data changes. Each occupied cell gets a box
 * from floor level up to its height.
 */

import { ROOM_W, ROOM_D } from '../constants.js';
import { scene } from './scene.js';

const obstacleGroup = typeof THREE !== 'undefined' ? new THREE.Group() : null;
if (scene && obstacleGroup) scene.add(obstacleGroup);

const obstacleMat = typeof THREE !== 'undefined' ? new THREE.MeshLambertMaterial({
  color: 0x6a6a5e,
}) : null;

const obstacleEdgeMat = typeof THREE !== 'undefined' ? new THREE.LineBasicMaterial({
  color: 0x888878,
}) : null;

// Cache to detect changes
let lastObstacleKey = '';

export function buildObstacleMeshes(sim) {
  if (!obstacleGroup || !scene) return;

  // Build a key from obstacle data to detect changes
  const key = Array.from(sim.obstacles).join(',');
  if (key === lastObstacleKey) return;
  lastObstacleKey = key;

  // Clear previous
  while (obstacleGroup.children.length > 0) {
    const c = obstacleGroup.children[0];
    obstacleGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
  }

  for (let y = 0; y < sim.rows; y++) {
    for (let x = 0; x < sim.cols; x++) {
      const h = sim.getObstacleHeight(x, y);
      if (h <= 0) continue;

      // Box from floor (y=0) up to height h
      const geo = new THREE.BoxGeometry(1, h, 1);
      const mesh = new THREE.Mesh(geo, obstacleMat);
      mesh.position.set(x + 0.5, h / 2, y + 0.5);
      obstacleGroup.add(mesh);

      // Wireframe edges for visibility
      const edges = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(edges, obstacleEdgeMat);
      line.position.copy(mesh.position);
      obstacleGroup.add(line);
    }
  }
}
