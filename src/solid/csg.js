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
    return { ...meshOf(out, owned), genus: out.genus(), dropped, droppedVolume };
  } finally {
    for (const m of owned) m.delete();
  }
}

/**
 * A manifold's mesh at double precision. getMesh() rounds to float32, which
 * can land two intersection points on one position; an identity warp hands
 * over the double positions in the same vertex order.
 */
function meshOf(out, owned) {
  const mesh = out.getMesh();
  let pos64 = null;
  const warped = out.warpBatch((verts, count) => {
    pos64 = Float64Array.from(verts.subarray(0, count * 3));
  });
  owned.push(warped);
  if (!pos64 || pos64.length !== mesh.vertProperties.length) {
    throw new Error("boolean output vertex count mismatch");
  }
  return collapseCoincident(pos64, mesh.triVerts, mesh.faceID);
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
  let tris = [];
  let faces = [];
  for (let t = 0; t < nT; t++) {
    if (!alive[t]) continue;
    tris.push(T[t * 3], T[t * 3 + 1], T[t * 3 + 2]);
    faces.push(F[t]);
  }
  let flipped;
  ({ tris, faces, fixed: flipped } = fixFlat(P, nV, tris, faces, Math.sqrt(tol2)));
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
 * Measures on positions `P` for the flat-triangle passes. A triangle is flat
 * when a corner lies within `tol` of the opposite (longest) edge. Such a
 * corner can sit a fraction of a micrometre on the right side of the edge in
 * double precision and cross it once positions are rounded to float32 for
 * the STL, folding the triangle through its neighbour. Needles (two corners
 * within `tol` of each other) are the edge collapse's business, not these
 * passes'.
 */
function flatGeometry(P, tol) {
  const len2 = (a, b) =>
    (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  const normal = (a, b, c) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
    const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
    return [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x];
  };
  const area2 = (a, b, c) => Math.hypot(...normal(a, b, c));
  const flat = (a, b, c) => {
    const ar = area2(a, b, c);
    if (ar < 1e-12) return true;
    const l = [len2(a, b), len2(b, c), len2(c, a)];
    if (Math.min(...l) < tol * tol) return false;
    return ar < tol * Math.sqrt(Math.max(...l));
  };
  /** Corners as [a, b, c] with a → b the longest edge. */
  const byLongEdge = (v) => {
    let e = 0, best = -1;
    for (let k = 0; k < 3; k++) {
      const l = len2(v[k], v[(k + 1) % 3]);
      if (l > best) { best = l; e = k; }
    }
    return [v[e], v[(e + 1) % 3], v[(e + 2) % 3]];
  };
  return { len2, normal, area2, flat, byLongEdge };
}

/**
 * Removes flat triangles. Each is flipped away where it can be: the flat
 * triangle and its neighbour across the long edge become two triangles
 * meeting at the middle corner, which is the neighbour split at that corner,
 * and the shape does not change. A flip is only taken when neither new
 * triangle is flat; with the neighbour's far corner near the line too the
 * split is as flat as before and flips would cycle. Where no flip works — a
 * fan over several corners on one line, every triangle flat — the middle
 * corner slides along the line onto the nearer end of the long edge (an edge
 * collapse). That is only taken when the two corners share exactly the two
 * neighbours of their edge, and every triangle left around the moved corner
 * stays within `tol` of its own plane and keeps its orientation (a flat one
 * stays flat), so the surface neither moves nor folds.
 * @returns {{ tris: number[], faces: number[], fixed: number }}
 */
function fixFlat(P, nV, tris, faces, tol) {
  const { len2, normal, flat, byLongEdge } = flatGeometry(P, tol);
  const nT = tris.length / 3;
  const isFlat = (t) => flat(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
  const queue = [];
  for (let t = 0; t < nT; t++) if (isFlat(t)) queue.push(t);
  if (!queue.length) return { tris, faces, fixed: 0 };

  // Vertex → triangles: flat arrays built once, plus what a vertex gains
  // later. Entries a triangle has since lost are filtered on read.
  const start = new Uint32Array(nV + 1);
  for (let i = 0; i < tris.length; i++) start[tris[i] + 1]++;
  for (let v = 0; v < nV; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nV);
  const inc = new Uint32Array(tris.length);
  for (let t = 0; t < nT; t++) for (let j = 0; j < 3; j++) inc[fill[tris[t * 3 + j]]++] = t;
  const gained = new Map();
  const gain = (v, t) => {
    const g = gained.get(v);
    if (g) g.push(t);
    else gained.set(v, [t]);
  };
  const alive = new Uint8Array(nT).fill(1);
  const has = (t, v) => tris[t * 3] === v || tris[t * 3 + 1] === v || tris[t * 3 + 2] === v;
  const star = (v) => {
    const out = [];
    for (let k = start[v]; k < start[v + 1]; k++) {
      const t = inc[k];
      if (alive[t] && has(t, v)) out.push(t);
    }
    for (const t of gained.get(v) ?? []) if (alive[t] && has(t, v) && !out.includes(t)) out.push(t);
    return out;
  };
  /** Triangle holding the directed edge u → v, or -1. */
  const owner = (u, v) => {
    for (const t of star(u)) {
      for (let j = 0; j < 3; j++) {
        if (tris[t * 3 + j] === u && tris[t * 3 + (j + 1) % 3] === v) return t;
      }
    }
    return -1;
  };
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

  const tryFlip = (t, a, b, c) => {
    const n = owner(b, a);
    if (n < 0 || n === t) return false;
    const d = [tris[n * 3], tris[n * 3 + 1], tris[n * 3 + 2]].find((x) => x !== a && x !== b);
    if (d == null || d === c) return false;
    if (owner(c, d) >= 0 || owner(d, c) >= 0) return false;
    if (flat(b, c, d) || flat(c, a, d)) return false;
    tris[t * 3] = b; tris[t * 3 + 1] = c; tris[t * 3 + 2] = d;
    tris[n * 3] = c; tris[n * 3 + 1] = a; tris[n * 3 + 2] = d;
    gain(d, t);
    gain(c, n);
    queue.push(t, n);
    return true;
  };
  const tryCollapse = (drop, keep) => {
    const around = star(drop);
    if (around.filter((t) => has(t, keep)).length !== 2) return false;
    const ringOf = (v) => {
      const out = new Set();
      for (const t of star(v)) for (let j = 0; j < 3; j++) if (tris[t * 3 + j] !== v) out.add(tris[t * 3 + j]);
      return out;
    };
    const rk = ringOf(keep);
    let common = 0;
    for (const v of ringOf(drop)) if (rk.has(v)) common++;
    if (common !== 2) return false;
    const move = [0, 1, 2].map((k) => P[keep * 3 + k] - P[drop * 3 + k]);
    for (const t of around) {
      if (has(t, keep)) continue;
      const v = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
      const w = v.map((x) => (x === drop ? keep : x));
      // A flat triangle has no plane to keep; it must stay flat, or it
      // would open up facing any way.
      if (isFlat(t)) {
        if (!flat(w[0], w[1], w[2])) return false;
        continue;
      }
      const n0 = normal(v[0], v[1], v[2]);
      if (Math.abs(dot(n0, move)) > tol * Math.hypot(...n0)) return false;
      if (!(dot(normal(w[0], w[1], w[2]), n0) > 0)) return false;
    }
    for (const t of around) {
      if (has(t, keep)) { alive[t] = 0; continue; }
      for (let j = 0; j < 3; j++) if (tris[t * 3 + j] === drop) tris[t * 3 + j] = keep;
      gain(keep, t);
      queue.push(t);
    }
    return true;
  };

  let fixed = 0;
  let removed = false;
  while (queue.length && fixed < 4 * nT) {
    const t = queue.pop();
    if (!alive[t] || !isFlat(t)) continue;
    const [a, b, c] = byLongEdge([tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]]);
    if (tryFlip(t, a, b, c)) { fixed++; continue; }
    const ends = len2(c, a) <= len2(c, b) ? [a, b] : [b, a];
    if (ends.some((keep) => tryCollapse(c, keep))) { fixed++; removed = true; }
  }
  if (!removed) return { tris, faces, fixed };
  const outT = [], outF = [];
  for (let t = 0; t < nT; t++) {
    if (!alive[t]) continue;
    outT.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
    outF.push(faces[t]);
  }
  return { tris: outT, faces: outF, fixed };
}

/**
 * Weld solids that touch: pairs that overlap join one group, and each group
 * of two or more is unioned into one closed mesh. Solids are triangle soups
 * ([[x, y, z] × 3] per triangle) that are closed once equal corners merge.
 *
 * @param {number[][][][]} solids
 * @returns {{ members: number[], positions: Float64Array, indices: Uint32Array }[]}
 */
export function weldTouching(solids) {
  if (!wasm) throw new Error("mesh boolean library not loaded — await loadCsg() first");
  const { Manifold } = wasm;
  const owned = [];
  try {
    const ms = solids.map((tris) => {
      const m = toManifold(indexSoup(tris));
      owned.push(m);
      return m;
    });
    const parent = ms.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const x = ms[i].intersect(ms[j]);
        owned.push(x);
        if (x.volume() > 1e-3) parent[find(i)] = find(j);
      }
    }
    const groups = new Map();
    ms.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
    const out = [];
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const u = Manifold.union(members.map((i) => ms[i]));
      owned.push(u);
      if (u.status() !== "NoError") throw new Error(`weld failed: ${u.status()}`);
      const { positions, indices } = meshOf(u, owned);
      out.push({ members, positions, indices });
    }
    return out;
  } finally {
    for (const m of owned) m.delete();
  }
}

/** Index a triangle soup, merging corners at equal positions. */
function indexSoup(tris) {
  const index = new Map(), positions = [], indices = [];
  for (const tri of tris) {
    for (const p of tri) {
      const key = `${p[0]},${p[1]},${p[2]}`;
      let k = index.get(key);
      if (k === undefined) {
        k = positions.length / 3;
        index.set(key, k);
        positions.push(p[0], p[1], p[2]);
      }
      indices.push(k);
    }
  }
  return { positions, indices, faceIds: new Uint32Array(indices.length / 3) };
}
