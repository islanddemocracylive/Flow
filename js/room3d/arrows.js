/**
 * Airflow arrow meshes – small triangles on the ceiling showing flow direction.
 */

import { ROOM_W, ROOM_D, ROOM_H } from '../constants.js';
import { scene } from './scene.js';

function createArrowMesh() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.3);
  shape.lineTo(-0.12, -0.1);
  shape.lineTo(0.12, -0.1);
  shape.lineTo(0, 0.3);
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x66bbff,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

export const arrowMeshes = [];

if (scene) {
  const arrowGroup = new THREE.Group();
  scene.add(arrowGroup);

  for (let row = 0; row < ROOM_D; row += 2) {
    for (let col = 0; col < ROOM_W; col += 2) {
      const arrow = createArrowMesh();
      arrow.position.set(col + 1, ROOM_H - 0.15, row + 1);
      arrow.rotation.x = -Math.PI / 2;
      arrowGroup.add(arrow);
      arrowMeshes.push({ mesh: arrow, col, row });
    }
  }
}
