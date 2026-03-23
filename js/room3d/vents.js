/**
 * Vent meshes – white squares (holes) in the ceiling.
 * These represent openings that firefighters create for ventilation.
 */

import { ROOM_H } from '../constants.js';
import { scene } from './scene.js';

const PANEL_SIZE = 1;

const ventGroup = typeof THREE !== 'undefined' ? new THREE.Group() : null;
if (scene && ventGroup) scene.add(ventGroup);

// White opening material (represents a hole — bright white square)
const ventHoleMat = typeof THREE !== 'undefined' ? new THREE.MeshBasicMaterial({
  color: 0xeeeeff,
  side: THREE.DoubleSide,
}) : null;

const ventEdgeMat = typeof THREE !== 'undefined' ? new THREE.LineBasicMaterial({
  color: 0xffffff,
}) : null;

export function buildVentMeshes(sim) {
  if (!ventGroup) return;

  while (ventGroup.children.length > 0) {
    const c = ventGroup.children[0];
    ventGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
  }

  if (!sim) return;

  for (const vent of sim.vents) {
    if (vent.type === 'ceiling') {
      // White square opening
      const openGeo = new THREE.PlaneGeometry(PANEL_SIZE - 0.05, PANEL_SIZE - 0.05);
      const openMesh = new THREE.Mesh(openGeo, ventHoleMat);
      openMesh.rotation.x = Math.PI / 2;
      openMesh.position.set(vent.x + 0.5, ROOM_H + 0.005, vent.y + 0.5);
      ventGroup.add(openMesh);

      // Edge outline
      const edgeGeo = new THREE.EdgesGeometry(openGeo);
      const edgeLine = new THREE.LineSegments(edgeGeo, ventEdgeMat);
      edgeLine.rotation.x = Math.PI / 2;
      edgeLine.position.set(vent.x + 0.5, ROOM_H + 0.006, vent.y + 0.5);
      ventGroup.add(edgeLine);
    }
  }
}
