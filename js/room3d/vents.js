/**
 * Vent meshes – dark openings in the ceiling with metallic frames and grate lines.
 */

import { ROOM_H } from '../constants.js';
import { scene } from './scene.js';
import { ventFrameMat, ventOpeningMat } from './materials.js';

const PANEL_SIZE = 1;

const ventGroup = new THREE.Group();
if (scene) scene.add(ventGroup);

export function buildVentMeshes(sim) {
  while (ventGroup.children.length > 0) {
    const c = ventGroup.children[0];
    ventGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
  }

  if (!sim) return;

  for (const vent of sim.vents) {
    if (vent.type === 'ceiling') {
      // Dark opening
      const openGeo = new THREE.PlaneGeometry(PANEL_SIZE - 0.05, PANEL_SIZE - 0.05);
      const openMesh = new THREE.Mesh(openGeo, ventOpeningMat);
      openMesh.rotation.x = Math.PI / 2;
      openMesh.position.set(vent.x + 0.5, ROOM_H + 0.005, vent.y + 0.5);
      ventGroup.add(openMesh);

      // Vent frame (4 edges)
      const ft = 0.06;
      const fh = 0.12;
      const frameGeo = new THREE.BoxGeometry(PANEL_SIZE, fh, ft);

      const sides = [
        { x: vent.x + 0.5, z: vent.y, ry: 0 },
        { x: vent.x + 0.5, z: vent.y + 1, ry: 0 },
        { x: vent.x, z: vent.y + 0.5, ry: Math.PI / 2 },
        { x: vent.x + 1, z: vent.y + 0.5, ry: Math.PI / 2 },
      ];
      for (const s of sides) {
        const fm = new THREE.Mesh(frameGeo, ventFrameMat);
        fm.position.set(s.x, ROOM_H + fh / 2, s.z);
        fm.rotation.y = s.ry;
        ventGroup.add(fm);
      }

      // Grate lines
      const grateMat = new THREE.LineBasicMaterial({ color: 0x999aaa });
      for (let i = 1; i <= 3; i++) {
        const gPos = vent.y + i * 0.25;
        const grateGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(vent.x + 0.1, ROOM_H + 0.01, gPos),
          new THREE.Vector3(vent.x + 0.9, ROOM_H + 0.01, gPos),
        ]);
        ventGroup.add(new THREE.Line(grateGeo, grateMat));
      }
    }
  }
}
