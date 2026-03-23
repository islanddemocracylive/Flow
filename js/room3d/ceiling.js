/**
 * Ceiling panels (20×10 grid) and ceiling grid lines.
 */

import { ROOM_W, ROOM_D, ROOM_H } from '../constants.js';
import { scene } from './scene.js';

const PANEL_SIZE = 1;
const PANEL_GAP = 0.03;

export const panelMeshes = [];

if (scene) {
  const panelGeo = new THREE.PlaneGeometry(PANEL_SIZE - PANEL_GAP, PANEL_SIZE - PANEL_GAP);

  for (let row = 0; row < ROOM_D; row++) {
    for (let col = 0; col < ROOM_W; col++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x1a1a24,
        side: THREE.DoubleSide,
      });
      const panel = new THREE.Mesh(panelGeo, mat);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(
        col * PANEL_SIZE + PANEL_SIZE / 2,
        ROOM_H - 0.01,
        row * PANEL_SIZE + PANEL_SIZE / 2
      );
      scene.add(panel);
      panelMeshes.push({ mesh: panel, col, row });
    }
  }

  // Ceiling grid lines
  const gridLineMat = new THREE.LineBasicMaterial({
    color: 0x444455,
    transparent: true,
    opacity: 0.3,
  });

  for (let x = 0; x <= ROOM_W; x++) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, ROOM_H - 0.005, 0),
      new THREE.Vector3(x, ROOM_H - 0.005, ROOM_D),
    ]);
    scene.add(new THREE.Line(geo, gridLineMat));
  }

  for (let z = 0; z <= ROOM_D; z++) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, ROOM_H - 0.005, z),
      new THREE.Vector3(ROOM_W, ROOM_H - 0.005, z),
    ]);
    scene.add(new THREE.Line(geo, gridLineMat));
  }
}
