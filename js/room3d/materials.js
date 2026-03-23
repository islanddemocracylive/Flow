/**
 * Shared Three.js materials for the 3D room.
 */

export const wallMat = typeof THREE !== 'undefined' ? new THREE.MeshLambertMaterial({
  color: 0x3a3a4a,
  side: THREE.DoubleSide,
}) : null;

export const floorMat = typeof THREE !== 'undefined' ? new THREE.MeshLambertMaterial({
  color: 0x2a2a35,
  side: THREE.DoubleSide,
}) : null;

export const edgeMat = typeof THREE !== 'undefined'
  ? new THREE.LineBasicMaterial({ color: 0x555566 })
  : null;

export const cornerMat = typeof THREE !== 'undefined'
  ? new THREE.LineBasicMaterial({ color: 0x666677 })
  : null;

export const ventFrameMat = typeof THREE !== 'undefined'
  ? new THREE.MeshLambertMaterial({ color: 0x777788 })
  : null;

export const ventOpeningMat = typeof THREE !== 'undefined' ? new THREE.MeshBasicMaterial({
  color: 0x050510,
  side: THREE.DoubleSide,
}) : null;

export const doorFrameMat = typeof THREE !== 'undefined'
  ? new THREE.MeshLambertMaterial({ color: 0x8b7355 })
  : null;

export const doorOpeningMat = typeof THREE !== 'undefined' ? new THREE.MeshBasicMaterial({
  color: 0x020208,
  side: THREE.DoubleSide,
}) : null;
