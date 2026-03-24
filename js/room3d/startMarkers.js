/**
 * 3D markers for fire start locations on the ceiling.
 *
 * Renders small red squares on the ceiling near the panels to
 * indicate where fire will ignite when Play is pressed.
 */

import { ROOM_H } from '../constants.js';
import { scene } from './scene.js';

const markerGroup = typeof THREE !== 'undefined' ? new THREE.Group() : null;
if (scene && markerGroup) scene.add(markerGroup);

const markerMat = typeof THREE !== 'undefined' ? new THREE.MeshBasicMaterial({
  color: 0xff2222,
  transparent: true,
  opacity: 0.7,
  side: THREE.DoubleSide,
  depthWrite: false,
}) : null;

let lastStartKey = '';

export function buildStartMarkers(sim) {
  if (!markerGroup || !scene || !sim) return;

  // Change detection
  const key = Array.from(sim.startLocations).sort().join(',');
  if (key === lastStartKey) return;
  lastStartKey = key;

  // Clear previous
  while (markerGroup.children.length > 0) {
    const c = markerGroup.children[0];
    markerGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
  }

  const geo = new THREE.PlaneGeometry(0.7, 0.7);

  for (const idx of sim.startLocations) {
    const x = idx % sim.cols;
    const y = Math.floor(idx / sim.cols);

    const mesh = new THREE.Mesh(geo, markerMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x + 0.5, ROOM_H - 0.005, y + 0.5);
    markerGroup.add(mesh);

    // Cross pattern for visibility
    const crossMat = new THREE.LineBasicMaterial({ color: 0xff4444 });
    const pts1 = [
      new THREE.Vector3(x + 0.2, ROOM_H - 0.003, y + 0.2),
      new THREE.Vector3(x + 0.8, ROOM_H - 0.003, y + 0.8),
    ];
    const pts2 = [
      new THREE.Vector3(x + 0.8, ROOM_H - 0.003, y + 0.2),
      new THREE.Vector3(x + 0.2, ROOM_H - 0.003, y + 0.8),
    ];
    const g1 = new THREE.BufferGeometry().setFromPoints(pts1);
    const g2 = new THREE.BufferGeometry().setFromPoints(pts2);
    markerGroup.add(new THREE.Line(g1, crossMat));
    markerGroup.add(new THREE.Line(g2, crossMat));
  }
}
