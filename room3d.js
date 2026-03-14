/**
 * 3D Room View – Three.js cutaway room with ceiling fire panels.
 *
 * Room: 20ft wide (x) × 10ft deep (z) × 8ft tall (y)
 * Camera: positioned at front-right corner looking into the room,
 *         showing the ceiling, left wall, and far wall.
 * Ceiling: 20×10 grid of 1ft² panels whose colour tracks the fire simulation.
 */

(function () {
  const container = document.getElementById('room3d-container');
  if (!container || typeof THREE === 'undefined') return;

  // ── Room dimensions (in feet, mapped to Three.js units 1:1) ──
  const ROOM_W = 20;  // x-axis (columns)
  const ROOM_D = 10;  // z-axis (rows)
  const ROOM_H = 8;   // y-axis (height)

  // ── Scene setup ───────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a14);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  // Camera at front-right corner, elevated, looking into the room
  camera.position.set(ROOM_W + 6, ROOM_H * 0.7, ROOM_D + 8);
  camera.lookAt(ROOM_W * 0.4, ROOM_H * 0.6, ROOM_D * 0.35);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // ── Lighting ──────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0x333344, 0.6);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffeedd, 0.4);
  dirLight.position.set(ROOM_W, ROOM_H + 5, ROOM_D);
  scene.add(dirLight);

  // Dynamic fire glow light (updated per frame)
  const fireLight = new THREE.PointLight(0xff4400, 0, ROOM_W);
  fireLight.position.set(ROOM_W / 2, ROOM_H - 0.5, ROOM_D / 2);
  scene.add(fireLight);

  // ── Materials ─────────────────────────────────────────────
  const wallMat = new THREE.MeshLambertMaterial({
    color: 0x3a3a4a,
    side: THREE.DoubleSide,
  });

  const floorMat = new THREE.MeshLambertMaterial({
    color: 0x2a2a35,
    side: THREE.DoubleSide,
  });

  const edgeMat = new THREE.LineBasicMaterial({ color: 0x555566 });

  // ── Floor ─────────────────────────────────────────────────
  const floorGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_D);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(ROOM_W / 2, 0, ROOM_D / 2);
  scene.add(floor);

  // ── Walls ─────────────────────────────────────────────────
  // Far wall (z = 0, facing +z)
  const farWallGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_H);
  const farWall = new THREE.Mesh(farWallGeo, wallMat);
  farWall.position.set(ROOM_W / 2, ROOM_H / 2, 0);
  scene.add(farWall);

  // Left wall (x = 0, facing +x)
  const leftWallGeo = new THREE.PlaneGeometry(ROOM_D, ROOM_H);
  const leftWall = new THREE.Mesh(leftWallGeo, wallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(0, ROOM_H / 2, ROOM_D / 2);
  scene.add(leftWall);

  // ── Room wireframe edges (for depth perception) ───────────
  // Floor outline
  const floorEdges = new THREE.EdgesGeometry(floorGeo);
  const floorLine = new THREE.LineSegments(floorEdges, edgeMat);
  floorLine.rotation.x = -Math.PI / 2;
  floorLine.position.copy(floor.position);
  scene.add(floorLine);

  // Wall edges
  addWireframe(farWall, farWallGeo);
  addWireframe(leftWall, leftWallGeo);

  function addWireframe(mesh, geo) {
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, edgeMat);
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    scene.add(line);
  }

  // Vertical edge lines at room corners for structure
  const cornerMat = new THREE.LineBasicMaterial({ color: 0x666677 });
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

  // Ceiling outline edges
  const ceilingOutlineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, ROOM_H, 0),
    new THREE.Vector3(ROOM_W, ROOM_H, 0),
    new THREE.Vector3(ROOM_W, ROOM_H, ROOM_D),
    new THREE.Vector3(0, ROOM_H, ROOM_D),
    new THREE.Vector3(0, ROOM_H, 0),
  ]);
  scene.add(new THREE.Line(ceilingOutlineGeo, cornerMat));

  // ── Ceiling panels (20×10 grid) ───────────────────────────
  const PANEL_SIZE = 1; // 1ft
  const PANEL_GAP = 0.03;
  const panelMeshes = [];

  const panelGeo = new THREE.PlaneGeometry(
    PANEL_SIZE - PANEL_GAP,
    PANEL_SIZE - PANEL_GAP
  );

  for (let row = 0; row < ROOM_D; row++) {
    for (let col = 0; col < ROOM_W; col++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x1a1a24,
        side: THREE.DoubleSide,
      });
      const panel = new THREE.Mesh(panelGeo, mat);
      // Ceiling is at y = ROOM_H, panels face downward
      panel.rotation.x = Math.PI / 2;
      panel.position.set(
        col * PANEL_SIZE + PANEL_SIZE / 2,
        ROOM_H - 0.01, // just below ceiling line
        row * PANEL_SIZE + PANEL_SIZE / 2
      );
      scene.add(panel);
      panelMeshes.push({ mesh: panel, col, row });
    }
  }

  // ── Ceiling grid lines ────────────────────────────────────
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

  // ── Heat to colour mapping ────────────────────────────────
  const baseColor = new THREE.Color(0x1a1a24);

  function heatToColor(heat) {
    if (heat <= 0) return baseColor.clone();

    const t = Math.min(heat, 1);
    let r, g, b;
    if (t < 0.33) {
      const s = t / 0.33;
      r = s * 0.78;
      g = s * 0.08;
      b = 0;
    } else if (t < 0.66) {
      const s = (t - 0.33) / 0.33;
      r = 0.78 + s * 0.22;
      g = 0.08 + s * 0.55;
      b = 0;
    } else {
      const s = (t - 0.66) / 0.34;
      r = 1;
      g = 0.63 + s * 0.37;
      b = s * 0.78;
    }

    // Flicker
    const flicker = 0.92 + Math.random() * 0.08;
    r = Math.min(1, r * flicker);
    g = Math.min(1, g * flicker);
    b = Math.min(1, b * flicker);

    return new THREE.Color(r, g, b);
  }

  // ── Public API ────────────────────────────────────────────
  window.room3d = {
    /** Update ceiling panel colours from the fire simulation */
    updatePanels() {
      const sim = window.fireSim;
      if (!sim) return;

      let totalGlow = 0;

      for (let i = 0; i < panelMeshes.length; i++) {
        const { mesh, col, row } = panelMeshes[i];
        const heat = sim.heat[sim.idx(col, row)];
        const color = heatToColor(heat);
        mesh.material.color.copy(color);

        totalGlow += heat;
      }

      // Update the dynamic fire light based on overall fire intensity
      const avgHeat = totalGlow / panelMeshes.length;
      fireLight.intensity = avgHeat * 3;
      fireLight.color.setHSL(0.05, 1, 0.5 + avgHeat * 0.3);
    },

    /** Render the 3D scene */
    render() {
      renderer.render(scene, camera);
    },

    /** Handle container resize */
    onResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },
  };

  // Initial size
  setTimeout(() => window.room3d.onResize(), 0);
})();
