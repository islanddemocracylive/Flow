/**
 * Three.js scene setup: scene, camera, renderer, lighting.
 */

import { ROOM_W, ROOM_D, ROOM_H } from '../constants.js';

const EYE_HEIGHT = 6;

const container = document.getElementById('room3d-container');

let scene, camera, renderer;

if (container && typeof THREE !== 'undefined') {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a14);

  camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  camera.position.set(ROOM_W / 2, EYE_HEIGHT, ROOM_D + 5);
  camera.lookAt(ROOM_W / 2, EYE_HEIGHT, ROOM_D / 2);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Lighting
  const ambient = new THREE.AmbientLight(0x333344, 0.6);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffeedd, 0.4);
  dirLight.position.set(ROOM_W, ROOM_H + 5, ROOM_D);
  scene.add(dirLight);
}

// Dynamic fire glow light (updated per frame in index.js)
let fireLight = null;
if (scene) {
  fireLight = new THREE.PointLight(0xff4400, 0, ROOM_W);
  fireLight.position.set(ROOM_W / 2, ROOM_H - 0.5, ROOM_D / 2);
  scene.add(fireLight);
}

// Gas layer plane — translucent horizontal sheet representing hot gas / smoke layer
let gasLayerPlane = null;
if (scene) {
  const gasGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_D);
  const gasMat = new THREE.MeshBasicMaterial({
    color: 0x808080,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  gasLayerPlane = new THREE.Mesh(gasGeo, gasMat);
  gasLayerPlane.rotation.x = -Math.PI / 2;
  gasLayerPlane.position.set(ROOM_W / 2, ROOM_H, ROOM_D / 2);
  gasLayerPlane.renderOrder = 999;
  scene.add(gasLayerPlane);
}

export { container, scene, camera, renderer, fireLight, gasLayerPlane };
