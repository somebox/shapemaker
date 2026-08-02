/**
 * Convex hull → merged polygonal skeleton with deterministic face identity.
 *
 * Only this module imports the vendored QuickHull library. Callers see
 * project-owned Float64Array positions and number[][] face rings.
 *
 * Contract: input points are origin-centered (required by assertSkeleton's
 * outward-winding test). Generators emit normalized unit-circumradius clouds.
 */

import quickhull from "../vendor/quickhull3d/quickhull3d.js";
import { assertSkeleton, edgeList, circumradius, newell } from "./skeleton.js";

/** Cache / fixture tag for the merge policy implemented below. */
export const MERGE_POLICY_ID = "adj-v1";

/** Cache tag for the merge-skip path (random bases, nonzero jitter). */
export const MERGE_SKIP_ID = "none";

/**
 * Named merge tolerances. Defaults suit exact regular solids (unit sphere).
 * Size-relative values are multiplied by the cloud's circumradius.
 */
export const DEFAULT_MERGE = Object.freeze({
  planeDistanceRel: 1e-7,
  normalAngleRad: 1e-6,
  collinearRel: 1e-7,
  dedupeRel: 1e-9,
});

/**
 * @param {Float64Array | number[][]} points  flat xyz or list of [x,y,z]
 * @param {Partial<typeof DEFAULT_MERGE> & { merge?: boolean }} [mergeOpts]
 *   merge: false skips coplanar merging (hull triangles become the faces).
 * @returns {{ positions: Float64Array, faces: number[][], edges: number[][] }}
 */
export function hullToSkeleton(points, mergeOpts = {}) {
  const opts = { ...DEFAULT_MERGE, ...mergeOpts };
  const { positions, pointList } = copyAndDedupe(points, opts.dedupeRel);
  if (pointList.length < 4) {
    throw new Error(`hull needs ≥ 4 distinct points, got ${pointList.length}`);
  }

  // Library API stays inside this function. Copy again so a mutating lib
  // cannot touch our stored arrays (current bundle does not mutate).
  const libInput = pointList.map((p) => [p[0], p[1], p[2]]);
  const tris = quickhull(libInput);
  if (!Array.isArray(tris) || tris.length < 4) {
    throw new Error(`QuickHull returned ${tris?.length} triangles`);
  }

  const triangles = tris.map((t) => {
    if (!Array.isArray(t) || t.length !== 3) {
      throw new Error("QuickHull must return triangle index triples");
    }
    return [t[0] | 0, t[1] | 0, t[2] | 0];
  });

  const R = circumradius(positions);

  // Merge runs only for exact regular generators. Random bases and any
  // nonzero jitter skip it (locked decision, Phase 4): jittered points are
  // almost never coplanar, so merging would be a no-op with over-merge risk.
  // Triangles become the faces, oriented outward here because that job
  // otherwise belongs to boundaryRing.
  const faces =
    opts.merge === false
      ? triangles.map((t) => {
          const ring = t.slice();
          orientOutward(positions, ring); // mutates in place
          return ring;
        })
      : mergeCoplanar(positions, triangles, {
          planeDistance: opts.planeDistanceRel * R,
          normalAngleRad: opts.normalAngleRad,
          collinear: opts.collinearRel * R,
        });

  const identified = applyFaceIdentity(positions, faces);
  const skeleton = {
    positions,
    faces: identified,
    edges: edgeList(identified),
  };
  assertSkeleton(skeleton);
  return skeleton;
}

/**
 * Copy points into owned storage and merge near-duplicates.
 * @param {Float64Array | number[][]} points
 * @param {number} dedupeRel  relative to circumradius of the raw cloud
 */
function copyAndDedupe(points, dedupeRel) {
  /** @type {number[][]} */
  let raw;
  if (points instanceof Float64Array) {
    if (points.length % 3 !== 0) throw new Error("flat points length must be ×3");
    raw = [];
    for (let i = 0; i < points.length; i += 3) {
      raw.push([points[i], points[i + 1], points[i + 2]]);
    }
  } else if (Array.isArray(points)) {
    raw = points.map((p) => {
      if (p.length < 3 || !Number.isFinite(p[0] + p[1] + p[2])) {
        throw new Error("each point needs finite xyz");
      }
      return [+p[0], +p[1], +p[2]];
    });
  } else {
    throw new Error("points must be Float64Array or number[][]");
  }

  let r2 = 0;
  for (const p of raw) {
    const d = p[0] ** 2 + p[1] ** 2 + p[2] ** 2;
    if (d > r2) r2 = d;
  }
  const tol = Math.max(Math.sqrt(r2) * dedupeRel, 1e-15);
  const tol2 = tol * tol;

  /** @type {number[][]} */
  const unique = [];
  for (const p of raw) {
    let found = false;
    for (const q of unique) {
      const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
      if (dx * dx + dy * dy + dz * dz <= tol2) {
        found = true;
        break;
      }
    }
    if (!found) unique.push(p);
  }

  const positions = new Float64Array(unique.length * 3);
  for (let i = 0; i < unique.length; i++) {
    positions[i * 3] = unique[i][0];
    positions[i * 3 + 1] = unique[i][1];
    positions[i * 3 + 2] = unique[i][2];
  }
  return { positions, pointList: unique };
}

/**
 * Adjacency-based coplanar merge of hull triangles into polygon rings.
 * @param {Float64Array} positions
 * @param {number[][]} triangles
 * @param {{ planeDistance: number, normalAngleRad: number, collinear: number }} tols
 * @returns {number[][]}
 */
export function mergeCoplanar(positions, triangles, tols) {
  const n = triangles.length;
  const planes = triangles.map((t) => planeOf(positions, t[0], t[1], t[2]));

  // Undirected edge → triangle indices that use it.
  /** @type {Map<string, number[]>} */
  const edgeTris = new Map();
  for (let ti = 0; ti < n; ti++) {
    const t = triangles[ti];
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let list = edgeTris.get(key);
      if (!list) {
        list = [];
        edgeTris.set(key, list);
      }
      list.push(ti);
    }
  }

  const parent = Uint32Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };

  const cosTol = Math.cos(tols.normalAngleRad);
  for (const [, list] of edgeTris) {
    if (list.length !== 2) continue;
    const [i, j] = list;
    if (!isCoplanarEnough(planes[i], planes[j], cosTol, tols.planeDistance)) continue;
    unite(i, j);
  }

  /** @type {Map<number, number[]>} */
  const groups = new Map();
  for (let ti = 0; ti < n; ti++) {
    const root = find(ti);
    let g = groups.get(root);
    if (!g) {
      g = [];
      groups.set(root, g);
    }
    g.push(ti);
  }

  /** @type {number[][]} */
  const faces = [];
  for (const members of groups.values()) {
    faces.push(boundaryRing(positions, triangles, members, tols.collinear));
  }
  return faces;
}

function planeOf(positions, ia, ib, ic) {
  const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
  const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
  const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
  let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const L = Math.hypot(nx, ny, nz);
  if (!(L > 0)) throw new Error("degenerate hull triangle");
  nx /= L;
  ny /= L;
  nz /= L;
  // Flip to outward (origin-inside contract).
  if (nx * ax + ny * ay + nz * az < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const offset = nx * ax + ny * ay + nz * az;
  return { nx, ny, nz, offset };
}

function isCoplanarEnough(a, b, cosTol, planeDistance) {
  const dot = a.nx * b.nx + a.ny * b.ny + a.nz * b.nz;
  if (dot < cosTol) return false;
  return Math.abs(a.offset - b.offset) <= planeDistance;
}

/**
 * Recover the outer boundary of a set of coplanar triangles.
 * @param {Float64Array} positions
 * @param {number[][]} triangles
 * @param {number[]} members  triangle indices
 * @param {number} collinear
 * @returns {number[]}
 */
function boundaryRing(positions, triangles, members, collinear) {
  /** @type {Map<string, number>} directed edge a→b count inside the group */
  const directed = new Map();
  const add = (a, b) => {
    const key = `${a},${b}`;
    directed.set(key, (directed.get(key) || 0) + 1);
  };
  for (const ti of members) {
    const t = triangles[ti];
    add(t[0], t[1]);
    add(t[1], t[2]);
    add(t[2], t[0]);
  }

  // Boundary = directed edges with no reverse inside the group.
  /** @type {Map<number, number[]>} */
  const nexts = new Map();
  for (const [key, count] of directed) {
    if (count !== 1) continue;
    const [as, bs] = key.split(",");
    const a = +as, b = +bs;
    if (directed.has(`${b},${a}`)) continue; // internal (cancelled)
    let list = nexts.get(a);
    if (!list) {
      list = [];
      nexts.set(a, list);
    }
    list.push(b);
  }

  if (nexts.size < 3) {
    throw new Error("coplanar merge produced a degenerate boundary");
  }

  // Start at the lexicographically smallest vertex for stability.
  let start = Infinity;
  for (const v of nexts.keys()) if (v < start) start = v;

  const ring = [start];
  let cur = start;
  const guard = nexts.size + 2;
  for (let step = 0; step < guard; step++) {
    const outs = nexts.get(cur);
    if (!outs || outs.length !== 1) {
      throw new Error(
        outs?.length
          ? "coplanar merge boundary is not a single simple loop"
          : "coplanar merge boundary walk broke",
      );
    }
    const nxt = outs[0];
    if (nxt === start) break;
    ring.push(nxt);
    cur = nxt;
  }
  if (ring.length < 3) throw new Error("boundary ring too short");

  // Reject a second disjoint loop: every boundary vertex must appear in ring.
  if (ring.length !== nexts.size) {
    throw new Error("coplanar merge produced multiple boundary loops");
  }

  const cleaned = dropCollinear(positions, ring, collinear);
  orientOutward(positions, cleaned);
  if (!isConvexRing(positions, cleaned)) {
    throw new Error("coplanar merge produced a non-convex face");
  }
  return cleaned;
}

function dropCollinear(positions, ring, tol) {
  if (ring.length <= 3) return ring.slice();
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    if (pointLineDistance(positions, cur, prev, next) > tol) out.push(cur);
  }
  return out.length >= 3 ? out : ring.slice();
}

function pointLineDistance(positions, p, a, b) {
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
  const px = positions[p * 3], py = positions[p * 3 + 1], pz = positions[p * 3 + 2];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const cx = aby * apz - abz * apy;
  const cy = abz * apx - abx * apz;
  const cz = abx * apy - aby * apx;
  const ab = Math.hypot(abx, aby, abz);
  if (!(ab > 0)) return 0;
  return Math.hypot(cx, cy, cz) / ab;
}

function orientOutward(positions, ring) {
  const { normal, centroid } = newell(positions, ring);
  if (normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2] < 0) {
    ring.reverse();
  }
}

/** Convex in the face plane (origin-centered convex polyhedra ⇒ true). */
function isConvexRing(positions, ring) {
  const { normal } = newell(positions, ring);
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], c = ring[(i + 2) % n];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const bcx = cx - bx, bcy = cy - by, bcz = cz - bz;
    const crossX = aby * bcz - abz * bcy;
    const crossY = abz * bcx - abx * bcz;
    const crossZ = abx * bcy - aby * bcx;
    // Outward normal × edge turns should stay consistent (left turns).
    if (crossX * normal[0] + crossY * normal[1] + crossZ * normal[2] < -1e-12) {
      return false;
    }
  }
  return true;
}

/**
 * Deterministic face identity: ring start + winding, then face sort.
 * Does not renumber vertices.
 * @param {Float64Array} positions
 * @param {number[][]} faces
 * @returns {number[][]}
 */
export function applyFaceIdentity(positions, faces) {
  const rings = faces.map((ring) => canonicalizeRing(positions, ring.slice()));
  rings.sort((a, b) => compareFaceKeys(faceSortKey(positions, a), faceSortKey(positions, b)));
  return rings;
}

function canonicalizeRing(positions, ring) {
  orientOutward(positions, ring);
  // Rotate so the lexicographically smallest vertex position is first.
  let best = 0;
  for (let i = 1; i < ring.length; i++) {
    if (vertLess(positions, ring[i], ring[best])) best = i;
  }
  if (best !== 0) {
    const rotated = ring.slice(best).concat(ring.slice(0, best));
    for (let i = 0; i < ring.length; i++) ring[i] = rotated[i];
  }
  // Re-check winding after rotation (rotation preserves winding).
  orientOutward(positions, ring);
  return ring;
}

function vertLess(positions, ia, ib) {
  const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
  const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
  if (ax !== bx) return ax < bx;
  if (ay !== by) return ay < by;
  return az < bz;
}

/** @returns {number[]} comparable key */
function faceSortKey(positions, ring) {
  const { normal, centroid } = newell(positions, ring);
  const offset = normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2];
  // Quantize normals so exact-regular noise does not reorder faces.
  const q = (v) => Math.round(v * 1e9);
  const minVi = ring.reduce((a, b) => (vertLess(positions, b, a) ? b : a), ring[0]);
  return [
    ring.length,
    q(normal[0]),
    q(normal[1]),
    q(normal[2]),
    q(offset),
    q(centroid[0]),
    q(centroid[1]),
    q(centroid[2]),
    q(positions[minVi * 3]),
    q(positions[minVi * 3 + 1]),
    q(positions[minVi * 3 + 2]),
  ];
}

function compareFaceKeys(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
