/**
 * Fixed-order surface subdivision and polygonal subdivision fairing.
 *
 * When `soften === 0`, each level splits every face flat in its own plane:
 * - "radial" (default): triangles 4:1 via edge midpoints, larger polygons
 *   as centroid fans over the midpoint-split boundary — 2k triangles per
 *   k-gon (8 openings per cube side at level 1).
 * - "grid": triangles still 4:1; larger polygons split into k corner
 *   QUADS (corner, edge midpoint, centroid, previous midpoint) — k per
 *   k-gon (4 openings per cube side at level 1, 16 at level 2).
 *
 * When `soften > 0`, `subdivideSkeleton` runs deterministic blended
 * Catmull–Clark / 4:1 subdivision fairing followed by two 1-ring umbrella
 * relaxation passes and canonical symmetric quad triangulation:
 * - Convex polyhedra fair smoothly from filleted forms toward sphere-like
 *   surfaces while restoring unit circumradius.
 * - Spiked stars and non-convex origin-star-shaped meshes turn sharp spikes
 *   into soft rounded lobes and relax concave inner valleys into smooth
 *   saddle transitions, certified by `assertStarShaped`.
 */

import { assertSkeleton, assertStarShaped, edgeList } from "./skeleton.js";
import { applyFaceIdentity } from "./hull.js";

export const SUBDIV_MAX = 2;

/**
 * Automatic refinement level when `subdiv === 0` and `soften > 0`:
 * coarse bases (≤ 12 faces: tetrahedron, cube, octahedron, dodecahedron,
 * rhombic dodecahedron) refine twice for smooth curvature; medium/dense
 * bases and spiked stars (> 12 faces) refine once (4×).
 *
 * @param {number} [subdiv]
 * @param {number} [soften]  0..100 or 0..1 (any > 0 triggers auto-level)
 * @param {number} [faceCount]
 * @returns {number}
 */
export function effectiveSubdivLevel(subdiv = 0, soften = 0, faceCount = 0) {
  const n = Math.min(SUBDIV_MAX, Math.floor(subdiv ?? 0));
  if (n > 0) return n;
  if (soften > 0) return faceCount > 0 && faceCount <= 12 ? 2 : 1;
  return 0;
}

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 *   unit skeleton (all vertices on the circumsphere)
 * @param {number} level  0 returns the input untouched; clamped to SUBDIV_MAX
 * @param {number} [soften]  0–1 surface fairing: 0 keeps the exact flat
 *   subdivision; > 0 fairs corners, ridges, and concave valleys.
 * @param {"radial"|"grid"} [style]  polygon split pattern. Default "radial".
 * @returns {{
 *   positions: Float64Array,
 *   faces: number[][],
 *   edges: number[][],
 *   macroFaceId: number[],
 * }}
 */
export function subdivideSkeleton(skeleton, level, soften = 0, style = "radial") {
  const n = Math.min(SUBDIV_MAX, Math.floor(level ?? 0));
  if (!(n > 0)) return skeleton;
  const grid = style === "grid";
  const s = Math.min(1, Math.max(0, soften));

  // Fast path: exact flat split for both radial and grid when soften === 0.
  if (!(s > 0)) {
    let cur = {
      positions: skeleton.positions,
      faces: skeleton.faces,
      parentId: skeleton.faces.map((_, i) => i),
    };
    for (let i = 0; i < n; i++) cur = subdivideOnce(cur, grid);
    const positions = Float64Array.from(cur.positions);
    const identified = applyFaceIdentity(positions, cur.faces, cur.parentId);
    const out = {
      positions,
      faces: identified.faces,
      edges: edgeList(identified.faces),
      macroFaceId: identified.tags,
    };
    assertSkeleton(out);
    return out;
  }

  // Deterministic blended subdivision fairing for s > 0:
  // Step weight α = s^(1/n) gives fine-ring stencil product α^n = s (instead
  // of attenuating as s^n) and coarse-vertex weight 1 − (1 − s^(1/n))^n.
  const alpha = Math.pow(s, 1 / n);
  let cur = {
    positions: Array.from(skeleton.positions),
    faces: skeleton.faces.map((f) => f.slice()),
    parentId: skeleton.faces.map((_, i) => i),
  };

  for (let lv = 0; lv < n; lv++) {
    cur = subdivideFairStep(cur, alpha);
  }

  // Two 1-ring umbrella relaxation passes smooth residual creases at
  // extraordinary vertices (valence-3 spike tips and valence-8 inner saddles).
  const nV = cur.positions.length / 3;
  const nbrs = Array.from({ length: nV }, () => new Set());
  for (const ring of cur.faces) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      nbrs[a].add(b);
      nbrs[b].add(a);
    }
  }
  const lambda = 0.35 * s;
  for (let pass = 0; pass < 2; pass++) {
    const prev = cur.positions;
    const next = prev.slice();
    for (let v = 0; v < nV; v++) {
      const list = [...nbrs[v]];
      if (!list.length) continue;
      let nx = 0, ny = 0, nz = 0;
      for (const u of list) {
        nx += prev[u * 3];
        ny += prev[u * 3 + 1];
        nz += prev[u * 3 + 2];
      }
      nx /= list.length;
      ny /= list.length;
      nz /= list.length;
      next[v * 3] += lambda * (nx - prev[v * 3]);
      next[v * 3 + 1] += lambda * (ny - prev[v * 3 + 1]);
      next[v * 3 + 2] += lambda * (nz - prev[v * 3 + 2]);
    }
    cur.positions = next;
  }

  // Split every Catmull–Clark quad [mPrev, a, mNext, center] along its
  // canonical parent-corner-to-face-center diagonal (center, a) so all faces
  // are strictly planar triangles while preserving full polyhedral symmetry.
  const triFaces = [];
  const triId = [];
  for (let fi = 0; fi < cur.faces.length; fi++) {
    const ring = cur.faces[fi];
    const id = cur.parentId[fi];
    if (ring.length === 4) {
      const [mPrev, a, mNext, center] = ring;
      triFaces.push([center, mPrev, a], [center, a, mNext]);
      triId.push(id, id);
    } else {
      triFaces.push(ring);
      triId.push(id);
    }
  }

  const positions = Float64Array.from(cur.positions);
  let maxR = 0;
  for (let i = 0; i < positions.length; i += 3) {
    maxR = Math.max(
      maxR,
      Math.hypot(positions[i], positions[i + 1], positions[i + 2]),
    );
  }
  if (maxR > 0) {
    for (let i = 0; i < positions.length; i++) positions[i] /= maxR;
  }

  const identified = applyFaceIdentity(positions, triFaces, triId);
  const out = {
    positions,
    faces: identified.faces,
    edges: edgeList(identified.faces),
    macroFaceId: identified.tags,
  };
  assertSkeleton(out);
  assertStarShaped(out);
  return out;
}

/**
 * One level of blended Catmull–Clark / 4:1 subdivision with step blend α.
 * Triangles split 4:1; k-gons (k ≥ 4) split into k corner quads so intermediate
 * vertices maintain regular valence 4 across levels.
 *
 * @param {{ positions: number[], faces: number[][], parentId: number[] }} skel
 * @param {number} alpha  per-level fairing weight in (0, 1]
 */
function subdivideFairStep({ positions: pos, faces, parentId }, alpha) {
  const nV = pos.length / 3;
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];

  const F = faces.map((ring) => {
    let x = 0, y = 0, z = 0;
    for (const v of ring) {
      x += pos[v * 3];
      y += pos[v * 3 + 1];
      z += pos[v * 3 + 2];
    }
    const k = ring.length;
    return [x / k, y / k, z / k];
  });

  const edgeAdj = new Map();
  const vertFaces = Array.from({ length: nV }, () => []);
  const vertNbrs = Array.from({ length: nV }, () => new Set());
  for (let fi = 0; fi < faces.length; fi++) {
    const ring = faces[fi];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      vertFaces[a].push(fi);
      vertNbrs[a].add(b);
      vertNbrs[b].add(a);
      const key = a < b ? a * 0x100000 + b : b * 0x100000 + a;
      let rec = edgeAdj.get(key);
      if (!rec) {
        rec = { a: Math.min(a, b), b: Math.max(a, b), faces: [] };
        edgeAdj.set(key, rec);
      }
      rec.faces.push(fi);
    }
  }

  const nextPos = [];
  const push = (x, y, z) => {
    nextPos.push(x, y, z);
    return nextPos.length / 3 - 1;
  };

  for (let v = 0; v < nV; v++) {
    const pv = P(v);
    const nbrs = [...vertNbrs[v]];
    const fList = vertFaces[v];
    const deg = nbrs.length;
    let fx = 0, fy = 0, fz = 0;
    for (const fi of fList) {
      fx += F[fi][0];
      fy += F[fi][1];
      fz += F[fi][2];
    }
    fx /= fList.length;
    fy /= fList.length;
    fz /= fList.length;

    let mx = 0, my = 0, mz = 0;
    for (const u of nbrs) {
      mx += (pv[0] + pos[u * 3]) / 2;
      my += (pv[1] + pos[u * 3 + 1]) / 2;
      mz += (pv[2] + pos[u * 3 + 2]) / 2;
    }
    mx /= deg;
    my /= deg;
    mz /= deg;

    const wSelf = Math.min((deg - 3) / deg, 0.45);
    const wRest = 1 - wSelf;
    const cx = wSelf * pv[0] + (wRest * (fx + 2 * mx)) / 3;
    const cy = wSelf * pv[1] + (wRest * (fy + 2 * my)) / 3;
    const cz = wSelf * pv[2] + (wRest * (fz + 2 * mz)) / 3;
    push(
      (1 - alpha) * pv[0] + alpha * cx,
      (1 - alpha) * pv[1] + alpha * cy,
      (1 - alpha) * pv[2] + alpha * cz,
    );
  }

  const mids = new Map();
  for (const [key, rec] of edgeAdj) {
    const pa = P(rec.a), pb = P(rec.b);
    const mx = (pa[0] + pb[0]) / 2;
    const my = (pa[1] + pb[1]) / 2;
    const mz = (pa[2] + pb[2]) / 2;
    if (rec.faces.length < 2) {
      mids.set(key, push(mx, my, mz));
      continue;
    }
    const c0 = F[rec.faces[0]], c1 = F[rec.faces[1]];
    const tx = (pa[0] + pb[0] + c0[0] + c1[0]) / 4;
    const ty = (pa[1] + pb[1] + c0[1] + c1[1]) / 4;
    const tz = (pa[2] + pb[2] + c0[2] + c1[2]) / 4;
    mids.set(
      key,
      push(
        (1 - alpha) * mx + alpha * tx,
        (1 - alpha) * my + alpha * ty,
        (1 - alpha) * mz + alpha * tz,
      ),
    );
  }

  const edgeVert = (a, b) =>
    mids.get(a < b ? a * 0x100000 + b : b * 0x100000 + a);

  const outFaces = [];
  const outId = [];
  const emit = (ring, id) => {
    outFaces.push(ring);
    outId.push(id);
  };

  for (let fi = 0; fi < faces.length; fi++) {
    const ring = faces[fi];
    const id = parentId[fi];
    const k = ring.length;
    if (k === 3) {
      const [a, b, c] = ring;
      const ab = edgeVert(a, b), bc = edgeVert(b, c), ca = edgeVert(c, a);
      emit([a, ab, ca], id);
      emit([ab, b, bc], id);
      emit([ca, bc, c], id);
      emit([ab, bc, ca], id);
      continue;
    }
    const center = push(F[fi][0], F[fi][1], F[fi][2]);
    for (let i = 0; i < k; i++) {
      const a = ring[i];
      const mPrev = edgeVert(ring[(i - 1 + k) % k], a);
      const mNext = edgeVert(a, ring[(i + 1) % k]);
      emit([mPrev, a, mNext, center], id);
    }
  }

  return { positions: nextPos, faces: outFaces, parentId: outId };
}

/**
 * @param {{ positions: ArrayLike<number>, faces: number[][], parentId?: number[] }} skel
 * @param {boolean} [grid]  corner quads instead of centroid fans on n-gons
 * @returns {{ positions: number[], faces: number[][], parentId: number[] }}
 */
function subdivideOnce({ positions, faces, parentId }, grid = false) {
  /** @type {number[]} */
  const pos = Array.from(positions);
  /** @type {Map<number, number>} undirected edge → midpoint vertex */
  const mids = new Map();

  const push = (x, y, z) => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };
  const midpoint = (a, b) => {
    const key = a < b ? a * 0x100000 + b : b * 0x100000 + a;
    let v = mids.get(key);
    if (v == null) {
      v = push(
        (pos[a * 3] + pos[b * 3]) / 2,
        (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2,
        (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2,
      );
      mids.set(key, v);
    }
    return v;
  };

  /** @type {number[][]} */
  const out = [];
  /** @type {number[]} */
  const outId = [];
  const emit = (ring, id) => {
    out.push(ring);
    outId.push(id);
  };
  for (let fi = 0; fi < faces.length; fi++) {
    const ring = faces[fi];
    const id = parentId ? parentId[fi] : fi;
    const k = ring.length;
    if (k === 3) {
      const [a, b, c] = ring;
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      emit([a, ab, ca], id);
      emit([ab, b, bc], id);
      emit([ca, bc, c], id);
      emit([ab, bc, ca], id);
      continue;
    }
    let cx = 0, cy = 0, cz = 0;
    for (const vi of ring) {
      cx += pos[vi * 3];
      cy += pos[vi * 3 + 1];
      cz += pos[vi * 3 + 2];
    }
    const center = push(cx / k, cy / k, cz / k);
    if (grid) {
      for (let i = 0; i < k; i++) {
        const a = ring[i];
        const mPrev = midpoint(ring[(i - 1 + k) % k], a);
        const mNext = midpoint(a, ring[(i + 1) % k]);
        emit([mPrev, a, mNext, center], id);
      }
    } else {
      for (let i = 0; i < k; i++) {
        const a = ring[i], b = ring[(i + 1) % k];
        const m = midpoint(a, b);
        emit([center, a, m], id);
        emit([center, m, b], id);
      }
    }
  }
  return { positions: pos, faces: out, parentId: outId };
}
