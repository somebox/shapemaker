/**
 * Mesh booleans via manifold-3d (vendored WASM). The library is about half a
 * megabyte and only Cut sides use it, so it loads on demand: await
 * loadCsg() before a build that cuts (needsCsg), and every boolean after
 * that stays synchronous.
 */

/** @type {any} the initialised module once loaded */
let wasm = null;
/** @type {Promise<void>|null} */
let pending = null;
/** @type {unknown} the last load failure, cleared by a later success */
let failure = null;

/**
 * Load the library once; concurrent callers share the load. A failed load
 * is forgotten, so the next call tries again.
 * @returns {Promise<void>}
 */
export function loadCsg() {
  pending ??= import("../../vendor/manifold/manifold.js")
    .then(({ default: Module }) => Module())
    .then((m) => {
      m.setup();
      wasm = m;
      failure = null;
    })
    .catch((err) => {
      pending = null;
      failure = err;
      throw err;
    });
  return pending;
}

/** Whether subtractAll can run now. */
export const csgReady = () => wasm !== null;

/** The last load failure, or null. */
export const csgLoadError = () => failure;

/**
 * Whether a build of `state` subtracts cutters (Cut sides).
 * @param {{ openings?: boolean, depth?: string, openingAxis?: string }} state
 */
export function needsCsg(state) {
  return Boolean(state.openings) && state.depth === "hollow" && state.openingAxis === "through";
}

/**
 * @typedef {{ positions: Float64Array|number[], indices: Uint32Array|number[], faceIds: Uint32Array|number[] }} CsgInput
 */

/** @param {CsgInput} m */
function toManifold(m) {
  const { Manifold, Mesh } = wasm;
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(m.positions),
    triVerts: Uint32Array.from(m.indices),
    faceID: Uint32Array.from(m.faceIds),
  });
  return new Manifold(mesh);
}

/**
 * `base` minus the union of `tools`. Face ids pass through per triangle, so
 * each cut wall keeps the id its tool carried.
 *
 * With `keepLargest`, only the largest connected piece is returned and the
 * rest are counted in `dropped` / `droppedVolume`.
 *
 * @param {CsgInput} base
 * @param {CsgInput[]} tools
 * @param {{ keepLargest?: boolean }} [opts]
 * @returns {{ positions: Float64Array, indices: Uint32Array, faceIds: Uint32Array, genus: number, dropped: number, droppedVolume: number }}
 */
export function subtractAll(base, tools, { keepLargest = false } = {}) {
  if (!wasm) throw new Error("mesh boolean library not loaded — await loadCsg() first");
  const { Manifold } = wasm;
  const owned = [];
  try {
    const a = toManifold(base);
    owned.push(a);
    const cutters = tools.map((t) => {
      const c = toManifold(t);
      owned.push(c);
      return c;
    });
    let out = Manifold.difference([a, ...cutters]);
    owned.push(out);
    if (out.status() !== "NoError") throw new Error(`boolean failed: ${out.status()}`);
    let dropped = 0, droppedVolume = 0;
    if (keepLargest) {
      const parts = out.decompose();
      owned.push(...parts);
      if (parts.length > 1) {
        const vols = parts.map((p) => p.volume());
        const best = vols.indexOf(Math.max(...vols));
        out = parts[best];
        dropped = parts.length - 1;
        droppedVolume = vols.reduce((s, v) => s + v, 0) - vols[best];
      }
    }
    const mesh = out.getMesh();
    // getMesh() rounds to float32, which can land two intersection points
    // on one position; an identity warp hands over the double positions
    // in the same vertex order.
    let pos64 = null;
    const warped = out.warpBatch((verts, count) => {
      pos64 = Float64Array.from(verts.subarray(0, count * 3));
    });
    owned.push(warped);
    if (!pos64 || pos64.length !== mesh.vertProperties.length) {
      throw new Error("boolean output vertex count mismatch");
    }
    return {
      ...collapseCoincident(pos64, mesh.triVerts, mesh.faceID),
      genus: out.genus(),
      dropped,
      droppedVolume,
    };
  } finally {
    for (const m of owned) m.delete();
  }
}

/**
 * Intersection points closer than float32 resolution come back as distinct
 * vertices at (nearly) one position, joined by near-zero-length edges.
 * Collapse those edges, drop the triangles that collapse with them, then
 * flip away triangles that are flat with distinct corners. Vertices that
 * share a position without an edge are a real contact and stay apart.
 */
function collapseCoincident(P, I, F) {
  const nV = P.length / 3;
  const parent = new Uint32Array(nV);
  for (let i = 0; i < nV; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  // "Same" is closer than 1e-5 of the part size (0.5 µm on a 100 mm part):
  // far below print resolution, and wide enough that folds around a
  // micro-edge cannot cross under float32 rounding once the part is rotated.
  let ext = 0;
  for (let i = 0; i < P.length; i++) ext = Math.max(ext, Math.abs(P[i]));
  const tol2 = (1e-5 * ext) ** 2;
  const same = (a, b) =>
    (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 +
    (P[a * 3 + 2] - P[b * 3 + 2]) ** 2 <= tol2;
  const nT = I.length / 3;
  const T = Int32Array.from(I);
  const alive = new Uint8Array(nT).fill(1);
  /** @type {number[][] | null} vertex → incident triangles, built on first need */
  let vt = null;
  const has = (t, v) => T[t * 3] === v || T[t * 3 + 1] === v || T[t * 3 + 2] === v;
  const ring = (v) => {
    const s = new Set();
    for (const t of vt[v]) {
      if (!alive[t] || !has(t, v)) continue;
      for (let e = 0; e < 3; e++) if (T[t * 3 + e] !== v) s.add(T[t * 3 + e]);
    }
    return s;
  };
  let merged = 0;
  for (let t = 0; t < nT; t++) {
    for (let e = 0; e < 3; e++) {
      const a = I[t * 3 + e], b = I[t * 3 + ((e + 1) % 3)];
      if (!same(a, b)) continue;
      const ra = find(a), rb = find(b);
      if (ra === rb) continue;
      if (!vt) {
        vt = Array.from({ length: nV }, () => []);
        for (let k = 0; k < nT; k++) for (let j = 0; j < 3; j++) vt[T[k * 3 + j]].push(k);
      }
      // Link condition: a and b may share only the corners opposite their
      // common edge, or merging them would fuse two distinct edges.
      const shared = [];
      for (const k of vt[ra]) if (alive[k] && has(k, ra) && has(k, rb)) shared.push(k);
      if (shared.length !== 2) continue;
      const nb = ring(rb);
      let common = 0;
      for (const v of ring(ra)) if (nb.has(v)) common++;
      if (common !== 2) continue;
      // Keep whichever end moves no triangle by more than 60°: a collapse
      // that folds a neighbour trades a micro-edge for a crossing.
      let keep = ra, drop = rb;
      if (!collapseKeepsNormals(P, T, alive, vt, drop, keep)) {
        [keep, drop] = [rb, ra];
        if (!collapseKeepsNormals(P, T, alive, vt, drop, keep)) continue;
      }
      parent[drop] = keep;
      merged++;
      for (const k of vt[drop]) {
        if (!alive[k] || !has(k, drop)) continue;
        if (has(k, keep)) { alive[k] = 0; continue; }
        for (let j = 0; j < 3; j++) if (T[k * 3 + j] === drop) T[k * 3 + j] = keep;
        vt[keep].push(k);
      }
    }
  }
  const tris = [];
  const faces = [];
  for (let t = 0; t < nT; t++) {
    if (!alive[t]) continue;
    tris.push(T[t * 3], T[t * 3 + 1], T[t * 3 + 2]);
    faces.push(F[t]);
  }
  const flipped = flipFlat(P, nV, tris);
  if (!merged && !flipped) {
    return {
      positions: Float64Array.from(P),
      indices: Uint32Array.from(I),
      faceIds: Uint32Array.from(F),
    };
  }
  // Compact so dropped vertices are not carried.
  const remap = new Int32Array(nV).fill(-1);
  const pos = [];
  const outTris = [];
  const outFaces = [];
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const v = tris[t + e];
      if (remap[v] < 0) {
        remap[v] = pos.length / 3;
        pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      }
      outTris.push(remap[v]);
    }
    outFaces.push(faces[t / 3]);
  }
  return {
    positions: Float64Array.from(pos),
    indices: Uint32Array.from(outTris),
    faceIds: Uint32Array.from(outFaces),
  };
}

/**
 * Would moving `drop` onto `keep` turn any surviving triangle around `drop`
 * by more than 60° (or flatten it)?
 * @returns {boolean} true when the collapse is safe
 */
function collapseKeepsNormals(P, T, alive, vt, drop, keep) {
  const normal = (a, b, c) => {
    const e1x = P[b * 3] - P[a * 3], e1y = P[b * 3 + 1] - P[a * 3 + 1], e1z = P[b * 3 + 2] - P[a * 3 + 2];
    const e2x = P[c * 3] - P[a * 3], e2y = P[c * 3 + 1] - P[a * 3 + 1], e2z = P[c * 3 + 2] - P[a * 3 + 2];
    return [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x];
  };
  for (const k of vt[drop]) {
    const v = [T[k * 3], T[k * 3 + 1], T[k * 3 + 2]];
    if (!alive[k] || !v.includes(drop) || v.includes(keep)) continue;
    const n0 = normal(v[0], v[1], v[2]);
    const w = v.map((x) => (x === drop ? keep : x));
    const n1 = normal(w[0], w[1], w[2]);
    const l0 = Math.hypot(...n0), l1 = Math.hypot(...n1);
    if (!(l1 > 0)) return false;
    if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < 0.5 * l0 * l1) return false;
  }
  return true;
}

/**
 * Flat triangles (a vertex lying on the opposite edge) are flipped away:
 * the flat triangle and its neighbour across the long edge become two
 * triangles meeting at the middle vertex. Edits `tris` in place; the
 * triangle count stays the same.
 * @returns {number} flips made
 */
function flipFlat(P, nV, tris) {
  const key = (u, v) => u * nV + v;
  const nT = tris.length / 3;
  const area2 = (a, b, c) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
    const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
    return Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
  };
  const len2 = (a, b) =>
    (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  const set = (t, a, b, c) => {
    tris[t * 3] = a; tris[t * 3 + 1] = b; tris[t * 3 + 2] = c;
    owner.set(key(a, b), t); owner.set(key(b, c), t); owner.set(key(c, a), t);
  };
  const queue = [];
  for (let t = 0; t < nT; t++) {
    if (area2(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]) < 1e-12) queue.push(t);
  }
  if (!queue.length) return 0;
  /** directed edge → triangle slot */
  const owner = new Map();
  for (let t = 0; t < nT; t++) {
    for (let e = 0; e < 3; e++) owner.set(key(tris[t * 3 + e], tris[t * 3 + (e + 1) % 3]), t);
  }
  let flips = 0;
  while (queue.length && flips < 4 * nT) {
    const t = queue.pop();
    const v = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
    if (!(area2(v[0], v[1], v[2]) < 1e-12)) continue;
    // Long edge (a → b) with the middle vertex c opposite it.
    let e = 0, best = -1;
    for (let k = 0; k < 3; k++) {
      const l = len2(v[k], v[(k + 1) % 3]);
      if (l > best) { best = l; e = k; }
    }
    const a = v[e], b = v[(e + 1) % 3], c = v[(e + 2) % 3];
    const n = owner.get(key(b, a));
    if (n == null || n === t) continue;
    const w = [tris[n * 3], tris[n * 3 + 1], tris[n * 3 + 2]];
    const d = w.find((x) => x !== a && x !== b);
    if (d == null || d === c) continue;
    if (owner.has(key(c, d)) || owner.has(key(d, c))) continue;
    owner.delete(key(a, b)); owner.delete(key(b, a));
    set(t, b, c, d);
    set(n, c, a, d);
    flips++;
    queue.push(t, n);
  }
  return flips;
}
