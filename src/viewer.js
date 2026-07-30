/**
 * Three.js viewer: mm grid plate, orbit camera (model stays fixed),
 * face pick via faceId → skeleton face, orientation matrix at draw time.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * @param {HTMLElement} container
 * @param {{ onFacePick?: (faceIndex: number) => void }} [opts]
 */
export function createViewer(container, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1e);

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
  let faceIdAttr = null;
  let hasFramed = false;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  /**
   * Replace geometry and placement.
   *
   * The camera is only reframed when asked (`frame: true`) or the first time,
   * because M2 regenerates on every slider move: reframing each time would
   * yank the view away while the user is inspecting a detail.
   */
  function setMesh(mesh, orientation, { frame = false } = {}) {
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
    faceIdAttr = mesh.faceId;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xc4a882,
      metalness: 0.05,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    meshObj = new THREE.Mesh(geo, mat);
    modelGroup.add(meshObj);

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

  /** Point the camera at the model from a ¾ view. */
  function frameObject() {
    if (!meshObj) return;
    const box = new THREE.Box3().setFromObject(modelGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 1.8;
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
    // Same local space as meshObj (orientation is on the group)
    modelGroup.add(focusMesh);
    // Auto-clear, but only this flash: rapid clicks queue several timers and
    // an older one must not clear a newer highlight.
    const mine = focusMesh;
    setTimeout(() => {
      if (focusMesh !== mine) return;
      modelGroup.remove(mine);
      mine.geometry.dispose();
      mine.material.dispose();
      focusMesh = null;
    }, 400);
  }

  function onPointerDown(ev) {
    if (!meshObj || !opts.onFacePick) return;
    // Ignore if this was a drag (OrbitControls)
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(meshObj, false);
    if (!hits.length) return;
    const tri = hits[0].faceIndex;
    if (tri == null || !faceIdAttr) return;
    // Emit only. The caller re-compiles and then asks for the flash, because
    // setMesh() rebuilds modelGroup and would destroy a flash started here.
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
    if (dx * dx + dy * dy < 16) onPointerDown(ev);
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

  return { setMesh, setFocusFaces, frameObject, camera, controls };
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
