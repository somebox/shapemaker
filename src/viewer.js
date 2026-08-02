/**
 * Three.js viewer: mm grid plate, orbit camera (model stays fixed),
 * face pick via faceId → skeleton face, orientation matrix at draw time,
 * edge hover/select via invisible LineSegments over skeleton edges.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * @param {HTMLElement} container
 * @param {{
 *   onFacePick?: (faceIndex: number) => void,
 *   onEdgeHover?: (info: { edgeIndex: number, lengthMm: number }|null) => void,
 *   onEdgeSelect?: (info: { edgeIndex: number, lengthMm: number }|null) => void,
 * }} [opts]
 */
export function createViewer(container, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x121214);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  camera.position.set(120, 90, 140);
  camera.up.set(0, 0, 1); // Z-up — print plate is XY, Z is height

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 40);
  controls.enableDamping = true;
  controls.update();

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(80, 60, 120);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xaaccff, 0.35);
  fill.position.set(-60, -40, 80);
  scene.add(fill);

  // Build plate: 10 mm squares, bolder every 50 mm, with mm labels
  scene.add(makePlateGrid(200));

  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  // Section plane — opt-in preview clip. Off until the user engages it.
  const sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
  renderer.localClippingEnabled = false;
  let sectionEngaged = false;
  let sectionZ = 1e6;
  /** @type {'solid'|'hollow'} */
  let meshDepth = "hollow";
  /** @type {THREE.Mesh | null} */
  let sectionFill = null;

  // Viewport tools: section plane + print-risk (not in the side panel).
  const sectionHud = document.createElement("div");
  sectionHud.className = "section-hud";
  sectionHud.innerHTML = `
    <label class="section-hud-toggle">
      <input type="checkbox" data-section-on />
      <span>Section</span>
    </label>
    <input type="range" data-section-z min="0" max="100" step="0.5" value="100" disabled aria-label="Section plane height" />
    <label class="section-hud-toggle" data-risk-toggle>
      <input type="checkbox" data-print-risk />
      <span>Print risk</span>
    </label>
  `;
  container.appendChild(sectionHud);
  const sectionOnEl = sectionHud.querySelector("[data-section-on]");
  const sectionZEl = sectionHud.querySelector("[data-section-z]");
  const printRiskEl = sectionHud.querySelector("[data-print-risk]");
  const riskToggle = sectionHud.querySelector("[data-risk-toggle]");

  // In-view dimension callout (HTML overlay in container).
  const dimCallout = document.createElement("div");
  dimCallout.className = "dim-callout";
  dimCallout.hidden = true;
  container.appendChild(dimCallout);

  let meshObj = null;
  let focusMesh = null;
  let edgePick = null;
  let edgeHighlight = null;
  let riskGroup = null;
  let lastRisk = null;
  let printOverlayOn = false;
  let faceIdAttr = null;
  let edgeLengths = null;
  let selectedEdge = null;
  let hoverEdge = null;
  let hasFramed = false;
  let lastHeightMm = 100;
  let lastExtents = null;
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 1.8;
  const pointer = new THREE.Vector2();

  /**
   * Replace geometry and placement.
   * @param {object} mesh
   * @param {object} orientation
   * @param {{ frame?: boolean, skeleton?: { positions: Float64Array, edges: number[][] }, depth?: string, heightMm?: number }} [opts]
   */
  /** Dispose every geometry/material at or below `obj` (Groups included). */
  function disposeObject3D(obj) {
    obj.traverse((c) => {
      c.geometry?.dispose?.();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material.dispose();
      }
    });
  }

  /** Triangle-soup positions for mesh triangles whose faceId is in `ids`. */
  function trianglesForFaceIds(ids) {
    if (!meshObj || !faceIdAttr) return [];
    const pos = meshObj.geometry.getAttribute("position");
    const idx = meshObj.geometry.getIndex();
    const verts = [];
    const set = new Set(ids);
    for (let t = 0; t < faceIdAttr.length; t++) {
      if (!set.has(faceIdAttr[t])) continue;
      for (let k = 0; k < 3; k++) {
        const vi = idx.getX(t * 3 + k);
        verts.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      }
    }
    return verts;
  }

  function setMesh(mesh, orientation, { frame = false, skeleton = null, depth = "hollow", heightMm = null } = {}) {
    while (modelGroup.children.length) {
      const c = modelGroup.children[0];
      modelGroup.remove(c);
      disposeObject3D(c);
    }
    meshObj = null;
    focusMesh = null;
    edgePick = null;
    edgeHighlight = null;
    riskGroup = null;
    faceIdAttr = mesh.faceId;
    meshDepth = depth === "solid" ? "solid" : "hollow";
    if (heightMm != null && Number.isFinite(heightMm) && heightMm > 0) {
      syncSectionHudMax(heightMm);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

    // Flat shading so the preview shows the same facets the STL exports.
    // DoubleSide so section cuts stay lit on both walls; a fill cap (below)
    // keeps solids from reading as an empty shell when clipped.
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc4a882,
      metalness: 0.05,
      roughness: 0.55,
      side: THREE.DoubleSide,
      flatShading: true,
      clippingPlanes: sectionEngaged ? [sectionPlane] : [],
      clipShadows: true,
    });
    meshObj = new THREE.Mesh(geo, mat);
    modelGroup.add(meshObj);

    if (skeleton?.edges?.length) {
      edgeLengths = new Float64Array(skeleton.edges.length);
      const pts = [];
      const pos = skeleton.positions;
      for (let e = 0; e < skeleton.edges.length; e++) {
        const [i, j] = skeleton.edges[e];
        const ax = pos[i * 3], ay = pos[i * 3 + 1], az = pos[i * 3 + 2];
        const bx = pos[j * 3], by = pos[j * 3 + 1], bz = pos[j * 3 + 2];
        pts.push(ax, ay, az, bx, by, bz);
        edgeLengths[e] = Math.hypot(bx - ax, by - ay, bz - az);
      }
      const eg = new THREE.BufferGeometry();
      eg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      edgePick = new THREE.LineSegments(
        eg,
        new THREE.LineBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      // Keep pickable; invisible
      edgePick.visible = true;
      modelGroup.add(edgePick);
    } else {
      edgeLengths = null;
    }

    // Re-apply selection highlight after rebuild
    if (selectedEdge != null && edgeLengths && selectedEdge < edgeLengths.length) {
      showEdgeHighlight(selectedEdge, 0xc4a882);
    } else {
      selectedEdge = null;
    }

    // Apply orientation matrix to the group (not the buffers)
    const M = orientation.matrix;
    const mat4 = new THREE.Matrix4().fromArray(M);
    modelGroup.matrixAutoUpdate = false;
    modelGroup.matrix.copy(mat4);
    modelGroup.updateMatrixWorld(true);

    if (frame || !hasFramed) {
      frameObject();
      hasFramed = true;
    }
    // Mesh rebuild disposed the risk group; redraw if overlay is on.
    redrawPrintRisk();
    updateSectionFill();
  }

  function showEdgeHighlight(edgeIndex, color) {
    if (edgeHighlight) {
      modelGroup.remove(edgeHighlight);
      edgeHighlight.geometry.dispose();
      edgeHighlight.material.dispose();
      edgeHighlight = null;
    }
    if (!edgePick || edgeIndex == null) return;
    const src = edgePick.geometry.getAttribute("position");
    const a = edgeIndex * 2;
    const pts = [
      src.getX(a), src.getY(a), src.getZ(a),
      src.getX(a + 1), src.getY(a + 1), src.getZ(a + 1),
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    edgeHighlight = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color, linewidth: 2 }),
    );
    modelGroup.add(edgeHighlight);
  }

  /** Point the camera at the model from a ¾ view. */
  function frameObject() {
    if (!meshObj) return;
    const box = new THREE.Box3().setFromObject(modelGroup);
    const center = box.getCenter(new THREE.Vector3());
    // Frame by the bounding sphere, not the box max-dimension: a cube's box
    // edge is 58% of its corner diagonal, so box framing zoomed cubes (and
    // tetrahedra) in far past round solids of the same circumdiameter.
    meshObj.geometry.computeBoundingSphere();
    const radius = meshObj.geometry.boundingSphere?.radius || 50;
    const dist = radius * 3.6;
    controls.target.copy(center);
    camera.position.set(center.x + dist * 0.7, center.y - dist * 0.8, center.z + dist * 0.55);
    controls.update();
  }

  /**
   * Draw approximate print-risk overlays (flat edges + overhang faces).
   * @param {{
   *   skeleton: { positions: Float64Array, edges: number[][] },
   *   flatEdgeIndices?: number[],
   *   overhangFaceIndices?: number[],
   * } | null} risk
   */
  function setPrintRisk(risk) {
    lastRisk = risk;
    redrawPrintRisk();
  }

  function setPrintOverlay(on) {
    printOverlayOn = !!on;
    if (printRiskEl) printRiskEl.checked = printOverlayOn;
    if (riskToggle) riskToggle.dataset.on = printOverlayOn ? "1" : "0";
    redrawPrintRisk();
  }

  printRiskEl?.addEventListener("change", () => {
    setPrintOverlay(printRiskEl.checked);
  });

  function redrawPrintRisk() {
    if (riskGroup) {
      modelGroup.remove(riskGroup);
      disposeObject3D(riskGroup);
      riskGroup = null;
    }
    const risk = printOverlayOn ? lastRisk : null;
    if (!risk || !meshObj) return;
    const group = new THREE.Group();
    const { skeleton, flatEdgeIndices = [], overhangFaceIndices = [] } = risk;

    if (flatEdgeIndices.length && skeleton?.edges && skeleton?.positions) {
      const pts = [];
      for (const ei of flatEdgeIndices) {
        const e = skeleton.edges[ei];
        if (!e) continue;
        const [a, b] = e;
        pts.push(
          skeleton.positions[a * 3],
          skeleton.positions[a * 3 + 1],
          skeleton.positions[a * 3 + 2],
          skeleton.positions[b * 3],
          skeleton.positions[b * 3 + 1],
          skeleton.positions[b * 3 + 2],
        );
      }
      if (pts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        group.add(
          new THREE.LineSegments(
            g,
            new THREE.LineBasicMaterial({
              // Hot amber — flat bridges need to pop against the model.
              color: 0xffb020,
              linewidth: 2,
              clippingPlanes: sectionEngaged ? [sectionPlane] : [],
            }),
          ),
        );
      }
    }

    if (overhangFaceIndices.length) {
      const verts = trianglesForFaceIds(overhangFaceIndices);
      if (verts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        group.add(
          new THREE.Mesh(
            g,
            new THREE.MeshBasicMaterial({
              // Hot coral/red — overhang faces more obvious than the soft wash.
              color: 0xff4a3a,
              transparent: true,
              opacity: 0.55,
              side: THREE.DoubleSide,
              depthTest: true,
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -2,
              clippingPlanes: sectionEngaged ? [sectionPlane] : [],
            }),
          ),
        );
      }
    }

    if (!group.children.length) return;
    riskGroup = group;
    modelGroup.add(riskGroup);
  }

  /**
   * Preview-only section plane. Pass null/undefined or engage=false to disable.
   * @param {number | null | undefined} zMm
   * @param {{ engage?: boolean }} [opts]
   */
  function setSectionPlane(zMm, { engage } = {}) {
    if (engage === false || zMm == null || !Number.isFinite(zMm)) {
      sectionEngaged = false;
      sectionZ = 1e6;
      sectionPlane.constant = 1e6;
      renderer.localClippingEnabled = false;
      applyClippingToMaterials();
      updateSectionFill();
      syncSectionHudUi();
      return;
    }
    sectionEngaged = true;
    sectionZ = zMm;
    sectionPlane.constant = zMm;
    renderer.localClippingEnabled = true;
    applyClippingToMaterials();
    updateSectionFill();
    syncSectionHudUi();
  }

  function applyClippingToMaterials() {
    const planes = sectionEngaged ? [sectionPlane] : [];
    modelGroup.traverse((c) => {
      if (c.material && "clippingPlanes" in c.material) {
        c.material.clippingPlanes = planes;
        c.material.needsUpdate = true;
      }
    });
  }

  /**
   * Opaque horizontal fill at the clip height so a solid cut reads as a
   * cross-section rather than an empty shell. Hidden when section is off.
   */
  function updateSectionFill() {
    if (sectionFill) {
      scene.remove(sectionFill);
      sectionFill.geometry.dispose();
      sectionFill.material.dispose();
      sectionFill = null;
    }
    if (!sectionEngaged || !meshObj) return;
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Slightly oversized so the rim doesn't show a gap.
    const geo = new THREE.PlaneGeometry(
      Math.max(size.x, 1) * 1.02,
      Math.max(size.y, 1) * 1.02,
    );
    const mat = new THREE.MeshBasicMaterial({
      color: meshDepth === "solid" ? 0x5a5044 : 0x3a3a42,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    sectionFill = new THREE.Mesh(geo, mat);
    // PlaneGeometry lies in XY — correct for a Z = const bed-plane cap.
    sectionFill.position.set(center.x, center.y, sectionZ);
    sectionFill.renderOrder = 2;
    scene.add(sectionFill);
  }

  function syncSectionHudMax(heightMm) {
    lastHeightMm = Math.max(1, heightMm);
    const max = Math.round(lastHeightMm * 10) / 10;
    sectionZEl.max = String(max);
    if (!sectionEngaged) {
      sectionZEl.value = String(max);
    } else if (Number(sectionZEl.value) > max) {
      sectionZEl.value = String(max);
      sectionZ = max;
      sectionPlane.constant = max;
      updateSectionFill();
    }
  }

  function syncSectionHudUi() {
    sectionOnEl.checked = sectionEngaged;
    sectionZEl.disabled = !sectionEngaged;
    sectionHud.dataset.on = sectionEngaged ? "1" : "0";
  }

  sectionOnEl.addEventListener("change", () => {
    if (sectionOnEl.checked) {
      const z = Number(sectionZEl.value);
      setSectionPlane(Number.isFinite(z) ? z : lastHeightMm, { engage: true });
    } else {
      setSectionPlane(null, { engage: false });
    }
  });
  sectionZEl.addEventListener("input", () => {
    if (!sectionEngaged) return;
    setSectionPlane(Number(sectionZEl.value), { engage: true });
  });
  syncSectionHudUi();

  /**
   * Show/hide an in-view dimension callout near the model.
   * @param {{ width: number, depth: number, height: number } | null} extentsMm
   * @param {boolean} [visible]
   */
  function setDimensionCallout(extentsMm, visible = true) {
    lastExtents = extentsMm;
    if (extentsMm?.height != null) syncSectionHudMax(extentsMm.height);
    if (!visible || !extentsMm) {
      dimCallout.hidden = true;
      return;
    }
    const { width, depth, height } = extentsMm;
    dimCallout.textContent = `${fmtMm(width)} × ${fmtMm(depth)} × ${fmtMm(height)} mm`;
    dimCallout.hidden = false;
  }

  function fmtMm(n) {
    return Number.isFinite(n)
      ? (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "")
      : "—";
  }

  function setFocusFaces(ids) {
    if (focusMesh) {
      modelGroup.remove(focusMesh);
      focusMesh.geometry.dispose();
      focusMesh.material.dispose();
      focusMesh = null;
    }
    if (!meshObj || !ids?.length || !faceIdAttr) return;

    const verts = trianglesForFaceIds(ids);
    if (!verts.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    focusMesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: 0xffcc44,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    modelGroup.add(focusMesh);
    const mine = focusMesh;
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      if (focusMesh !== mine) return;
      modelGroup.remove(mine);
      mine.geometry.dispose();
      mine.material.dispose();
      focusMesh = null;
    }, 400);
  }
  let focusTimer = null;

  function updateEdgeThreshold() {
    // ~6 px in screen space → world units at the orbit target distance.
    const dist = camera.position.distanceTo(controls.target);
    const fov = (camera.fov * Math.PI) / 180;
    const height = Math.max(renderer.domElement.clientHeight, 1);
    const worldPerPixel = (2 * dist * Math.tan(fov / 2)) / height;
    raycaster.params.Line.threshold = Math.min(
      Math.max(worldPerPixel * 6, 0.2),
      dist * 0.05,
    );
  }

  function pickEdge(ev) {
    if (!edgePick || !edgeLengths) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    updateEdgeThreshold();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(edgePick, false);
    if (!hits.length) return null;
    const seg = hits[0].index;
    if (seg == null) return null;
    const edgeIndex = Math.floor(seg / 2);
    if (edgeIndex < 0 || edgeIndex >= edgeLengths.length) return null;
    return { edgeIndex, lengthMm: edgeLengths[edgeIndex] };
  }

  function onPointerMove(ev) {
    const info = pickEdge(ev);
    const next = info?.edgeIndex ?? null;
    if (next === hoverEdge) return;
    hoverEdge = next;
    if (selectedEdge == null) {
      showEdgeHighlight(next, 0xd8c9ae);
    }
    opts.onEdgeHover?.(info);
  }

  function onClickPick(ev) {
    // Prefer edge when close; otherwise face
    const edge = pickEdge(ev);
    if (edge) {
      selectedEdge = edge.edgeIndex;
      showEdgeHighlight(selectedEdge, 0xc4a882);
      opts.onEdgeSelect?.(edge);
      return;
    }
    if (!meshObj || !opts.onFacePick) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(meshObj, false);
    if (!hits.length) return;
    const tri = hits[0].faceIndex;
    if (tri == null || !faceIdAttr) return;
    opts.onFacePick(faceIdAttr[tri]);
  }

  // Distinguish click from drag
  let downPos = null;
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    downPos = { x: ev.clientX, y: ev.clientY };
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (!downPos) return;
    const dx = ev.clientX - downPos.x, dy = ev.clientY - downPos.y;
    downPos = null;
    if (dx * dx + dy * dy < 16) onClickPick(ev);
  });
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", () => {
    if (hoverEdge == null) return;
    hoverEdge = null;
    if (selectedEdge == null) showEdgeHighlight(null);
    opts.onEdgeHover?.(null);
  });

  renderer.domElement.addEventListener("dblclick", frameObject);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function frame() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  frame();

  return {
    setMesh,
    setFocusFaces,
    setPrintRisk,
    setPrintOverlay,
    setSectionPlane,
    setDimensionCallout,
    frameObject,
    camera,
    controls,
    clearEdgeSelection() {
      selectedEdge = null;
      showEdgeHighlight(null);
      opts.onEdgeSelect?.(null);
    },
  };
}

/** XY plate with 10 mm minor / 50 mm major lines, Z = 0. */
function makePlateGrid(halfExtent = 200) {
  const group = new THREE.Group();
  const minor = [];
  const major = [];
  for (let x = -halfExtent; x <= halfExtent; x += 10) {
    const arr = x % 50 === 0 ? major : minor;
    arr.push(x, -halfExtent, 0, x, halfExtent, 0);
  }
  for (let y = -halfExtent; y <= halfExtent; y += 10) {
    const arr = y % 50 === 0 ? major : minor;
    arr.push(-halfExtent, y, 0, halfExtent, y, 0);
  }
  const mk = (pts, color, opacity) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
    );
  };
  group.add(mk(minor, 0x3a3a42, 0.45));
  group.add(mk(major, 0x5a5a66, 0.85));
  return group;
}
