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

  // Build plate: 10 mm squares, bolder every 50 mm
  scene.add(makePlateGrid(200));

  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  let meshObj = null;
  let focusMesh = null;
  let edgePick = null;
  let edgeHighlight = null;
  let faceIdAttr = null;
  let edgeLengths = null;
  let selectedEdge = null;
  let hoverEdge = null;
  let hasFramed = false;
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 1.8;
  const pointer = new THREE.Vector2();

  /**
   * Replace geometry and placement.
   * @param {object} mesh
   * @param {object} orientation
   * @param {{ frame?: boolean, skeleton?: { positions: Float64Array, edges: number[][] } }} [opts]
   */
  function setMesh(mesh, orientation, { frame = false, skeleton = null } = {}) {
    while (modelGroup.children.length) {
      const c = modelGroup.children[0];
      modelGroup.remove(c);
      c.geometry?.dispose?.();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material.dispose();
      }
    }
    meshObj = null;
    focusMesh = null;
    edgePick = null;
    edgeHighlight = null;
    faceIdAttr = mesh.faceId;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

    // Flat shading so the preview shows the same facets the STL exports —
    // smooth vertex normals made fillet arcs look softer than the mesh is.
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc4a882,
      metalness: 0.05,
      roughness: 0.55,
      side: THREE.DoubleSide,
      flatShading: true,
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

  function setFocusFaces(ids) {
    if (focusMesh) {
      modelGroup.remove(focusMesh);
      focusMesh.geometry.dispose();
      focusMesh.material.dispose();
      focusMesh = null;
    }
    if (!meshObj || !ids?.length || !faceIdAttr) return;

    const src = meshObj.geometry;
    const pos = src.getAttribute("position");
    const idx = src.getIndex();
    const verts = [];
    const set = new Set(ids);
    for (let t = 0; t < faceIdAttr.length; t++) {
      if (!set.has(faceIdAttr[t])) continue;
      for (let k = 0; k < 3; k++) {
        const vi = idx.getX(t * 3 + k);
        verts.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      }
    }
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
      }),
    );
    modelGroup.add(focusMesh);
    const mine = focusMesh;
    setTimeout(() => {
      if (focusMesh !== mine) return;
      modelGroup.remove(mine);
      mine.geometry.dispose();
      mine.material.dispose();
      focusMesh = null;
    }, 400);
  }

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
