/**
 * 3D Room View – Three.js cutaway room with ceiling fire panels,
 * vent/door openings, and airflow arrow visualization.
 *
 * Room: 20ft wide (x) × 10ft deep (z) × 8ft tall (y)
 * Camera: OrbitControls for drag-to-rotate interaction.
 * Ceiling: 20×10 grid of 1ft² panels whose colour tracks the fire simulation.
 * Vents: dark openings in the ceiling with metallic frames.
 * Doors: openings in walls with frames.
 * Airflow arrows: small arrow meshes on the ceiling showing flow direction.
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
  camera.position.set(ROOM_W + 6, ROOM_H * 0.7, ROOM_D + 8);
  camera.lookAt(ROOM_W * 0.4, ROOM_H * 0.6, ROOM_D * 0.35);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // ── OrbitControls ───────────────────────────────────────────
  let controls = null;
  if (typeof THREE.OrbitControls !== 'undefined') {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(ROOM_W / 2, ROOM_H * 0.5, ROOM_D / 2);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI * 0.85; // don't go fully below floor
    controls.update();
  }

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

  const ventFrameMat = new THREE.MeshLambertMaterial({ color: 0x777788 });
  const ventOpeningMat = new THREE.MeshBasicMaterial({
    color: 0x050510,
    side: THREE.DoubleSide,
  });
  const doorFrameMat = new THREE.MeshLambertMaterial({ color: 0x8b7355 });
  const doorOpeningMat = new THREE.MeshBasicMaterial({
    color: 0x020208,
    side: THREE.DoubleSide,
  });

  // ── Floor ─────────────────────────────────────────────────
  const floorGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_D);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(ROOM_W / 2, 0, ROOM_D / 2);
  scene.add(floor);

  // ── Walls (rebuilt when doors change) ─────────────────────
  const wallGroup = new THREE.Group();
  scene.add(wallGroup);

  function buildWalls() {
    // Clear previous wall meshes
    while (wallGroup.children.length > 0) {
      const c = wallGroup.children[0];
      wallGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
    }

    const sim = window.fireSim;
    const doors = sim ? sim.vents.filter(v => v.type === 'door') : [];

    // Far wall (z = 0, facing +z)
    buildWallWithDoors('far', ROOM_W, ROOM_H, { px: ROOM_W / 2, py: ROOM_H / 2, pz: 0, ry: 0 }, doors);
    // Left wall (x = 0, facing +x)
    buildWallWithDoors('left', ROOM_D, ROOM_H, { px: 0, py: ROOM_H / 2, pz: ROOM_D / 2, ry: Math.PI / 2 }, doors);
  }

  function buildWallWithDoors(wallName, wallWidth, wallHeight, transform, allDoors) {
    const doors = allDoors.filter(d => d.wall === wallName);

    if (doors.length === 0) {
      // Simple full wall
      const geo = new THREE.PlaneGeometry(wallWidth, wallHeight);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(transform.px, transform.py, transform.pz);
      if (transform.ry) mesh.rotation.y = transform.ry;
      wallGroup.add(mesh);
      // Wireframe
      const edges = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(edges, edgeMat);
      line.position.copy(mesh.position);
      line.rotation.copy(mesh.rotation);
      wallGroup.add(line);
      return;
    }

    // Wall with door openings - use shape with holes
    const shape = new THREE.Shape();
    shape.moveTo(-wallWidth / 2, -wallHeight / 2);
    shape.lineTo(wallWidth / 2, -wallHeight / 2);
    shape.lineTo(wallWidth / 2, wallHeight / 2);
    shape.lineTo(-wallWidth / 2, wallHeight / 2);
    shape.lineTo(-wallWidth / 2, -wallHeight / 2);

    const DOOR_W = 3;
    const DOOR_H = 6.5;

    for (const door of doors) {
      // Convert grid position to local wall coordinate
      let localX;
      if (wallName === 'far') {
        localX = door.x - wallWidth / 2 + 0.5;
      } else if (wallName === 'left') {
        localX = door.y - wallWidth / 2 + 0.5;
      } else {
        localX = door.x - wallWidth / 2 + 0.5;
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
        // Left jamb
        { w: frameThickness, h: DOOR_H, lx: holeLeft - frameThickness / 2, ly: holeBottom + DOOR_H / 2 },
        // Right jamb
        { w: frameThickness, h: DOOR_H, lx: holeRight + frameThickness / 2, ly: holeBottom + DOOR_H / 2 },
        // Header
        { w: DOOR_W + frameThickness * 2, h: frameThickness, lx: localX, ly: holeTop + frameThickness / 2 },
      ];
      for (const fp of frameParts) {
        const fg = new THREE.PlaneGeometry(fp.w, fp.h);
        const fm = new THREE.Mesh(fg, doorFrameMat);
        // Position relative to wall center, then offset by a tiny amount
        if (wallName === 'far') {
          fm.position.set(transform.px + fp.lx, transform.py + fp.ly - wallHeight / 2 + wallHeight / 2, transform.pz + 0.01);
        } else if (wallName === 'left') {
          fm.position.set(transform.px + 0.01, transform.py + fp.ly - wallHeight / 2 + wallHeight / 2, transform.pz + fp.lx);
          fm.rotation.y = Math.PI / 2;
        }
        wallGroup.add(fm);
      }
    }

    const geo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.position.set(transform.px, transform.py, transform.pz);
    if (transform.ry) mesh.rotation.y = transform.ry;
    wallGroup.add(mesh);

    // Wireframe for wall
    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, edgeMat);
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    wallGroup.add(line);
  }

  // Initial wall build
  buildWalls();

  // ── Room wireframe edges (for depth perception) ───────────
  // Floor outline
  const floorEdges = new THREE.EdgesGeometry(floorGeo);
  const floorLine = new THREE.LineSegments(floorEdges, edgeMat);
  floorLine.rotation.x = -Math.PI / 2;
  floorLine.position.copy(floor.position);
  scene.add(floorLine);

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

  // ── Vent meshes (ceiling vents) ─────────────────────────────
  const ventGroup = new THREE.Group();
  scene.add(ventGroup);

  // Track last vent config to know when to rebuild
  let lastVentKey = '';

  function buildVentMeshes() {
    while (ventGroup.children.length > 0) {
      const c = ventGroup.children[0];
      ventGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
    }

    const sim = window.fireSim;
    if (!sim) return;

    for (const vent of sim.vents) {
      if (vent.type === 'ceiling') {
        // Dark opening slightly above panel
        const openGeo = new THREE.PlaneGeometry(PANEL_SIZE - 0.05, PANEL_SIZE - 0.05);
        const openMesh = new THREE.Mesh(openGeo, ventOpeningMat);
        openMesh.rotation.x = Math.PI / 2;
        openMesh.position.set(
          vent.x + 0.5,
          ROOM_H + 0.005,
          vent.y + 0.5
        );
        ventGroup.add(openMesh);

        // Vent frame (4 edges)
        const frameSize = PANEL_SIZE;
        const ft = 0.06; // frame thickness
        const fh = 0.12; // frame height
        const frameGeo = new THREE.BoxGeometry(frameSize, fh, ft);

        const sides = [
          { x: vent.x + 0.5, z: vent.y, ry: 0 },          // front edge
          { x: vent.x + 0.5, z: vent.y + 1, ry: 0 },      // back edge
          { x: vent.x, z: vent.y + 0.5, ry: Math.PI / 2 }, // left edge
          { x: vent.x + 1, z: vent.y + 0.5, ry: Math.PI / 2 }, // right edge
        ];
        for (const s of sides) {
          const fm = new THREE.Mesh(frameGeo, ventFrameMat);
          fm.position.set(s.x, ROOM_H + fh / 2, s.z);
          fm.rotation.y = s.ry;
          ventGroup.add(fm);
        }

        // Vent grate lines (horizontal slats)
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

  // ── Airflow arrow meshes ──────────────────────────────────
  const arrowGroup = new THREE.Group();
  scene.add(arrowGroup);

  // Create a reusable arrow shape (small triangle)
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

  // Pre-create arrows for every other cell (10x5 grid = 50 arrows)
  const arrowMeshes = [];
  for (let row = 0; row < ROOM_D; row += 2) {
    for (let col = 0; col < ROOM_W; col += 2) {
      const arrow = createArrowMesh();
      arrow.position.set(col + 1, ROOM_H - 0.15, row + 1);
      arrow.rotation.x = -Math.PI / 2; // lay flat on ceiling, facing down
      arrowGroup.add(arrow);
      arrowMeshes.push({ mesh: arrow, col, row });
    }
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

      // Check if vents changed – rebuild meshes if needed
      const ventKey = JSON.stringify(sim.vents);
      if (ventKey !== lastVentKey) {
        lastVentKey = ventKey;
        buildVentMeshes();
        buildWalls();
      }

      let totalGlow = 0;

      for (let i = 0; i < panelMeshes.length; i++) {
        const { mesh, col, row } = panelMeshes[i];
        const heat = sim.heat[sim.idx(col, row)];

        // Ceiling vent panels appear as dark openings
        if (sim.isCeilingVent(col, row)) {
          mesh.material.color.set(0x050510);
          mesh.material.opacity = 0.3;
          mesh.material.transparent = true;
        } else {
          const color = heatToColor(heat);
          mesh.material.color.copy(color);
          mesh.material.opacity = 1;
          mesh.material.transparent = false;
        }

        totalGlow += heat;
      }

      // Update airflow arrows
      if (sim.vents.length > 0) {
        for (const arrow of arrowMeshes) {
          const af = sim.getAirflow(arrow.col, arrow.row);
          const mag = Math.sqrt(af.vx * af.vx + af.vy * af.vy);

          if (mag > 0.02) {
            // Rotate arrow to point in airflow direction
            // Airflow vx = grid x direction, vy = grid y direction
            // In 3D: grid x = Three.js x, grid y = Three.js z
            const angle = Math.atan2(-af.vx, -af.vy); // rotation around Y axis (on XZ plane)
            arrow.mesh.rotation.x = -Math.PI / 2;
            arrow.mesh.rotation.y = 0;
            arrow.mesh.rotation.z = angle;
            arrow.mesh.material.opacity = Math.min(0.6, mag * 0.8);
          } else {
            arrow.mesh.material.opacity = 0;
          }
        }
      } else {
        // No vents – hide all arrows
        for (const arrow of arrowMeshes) {
          arrow.mesh.material.opacity = 0;
        }
      }

      // Update the dynamic fire light based on overall fire intensity
      const avgHeat = totalGlow / panelMeshes.length;
      fireLight.intensity = avgHeat * 3;
      fireLight.color.setHSL(0.05, 1, 0.5 + avgHeat * 0.3);
    },

    /** Render the 3D scene */
    render() {
      if (controls) controls.update();
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
