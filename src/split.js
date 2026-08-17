/**
 * Horizontal mesh split for support-free printing.
 *
 * Operates in *placed* coordinates (orientation already applied). Produces
 * two watertight halves capped at the cut plane. Half A = upper, half B =
 * lower. Export helpers flip both cut-face-down.
 */

import { transformPoint, orientationForDirection } from "./orient.js";
import { toFaceFrame } from "./faceframe.js";
import { toMesh, assertMeshInvariants } from "./mesh.js";
import { triangulateRegions, shoelace, segmentsCross } from "./geom/capfill.js";

/** Cap triangles use this faceId sentinel (face-pick disabled during split). */
export const CAP_FACE_ID = 0xffffffff;

/** Minimum z-gap a snapped plane keeps from any vertex (mm). */
const PLANE_GAP_MIN_MM = 0.02;

/** 45° self-support limit: outward nz below −cos(45°) needs support. */
const OVERHANG_NZ = -Math.SQRT1_2;

/** Geometry on the plate is supported, not an overhang. */
const BED_EPS_MM = 0.01;

/** Bound orientation search so a spiked globe cannot freeze the HUD. */
const MAX_ORIENT_CANDIDATES = 24;

/** Full seals tried on enable; reorient continues one-at-a-time. */
export const MAX_SPLIT_SEAL_TRIES = 8;

/** Geometric split failure (vs a programming error) — probe-skippable. */
function splitError(message) {
  const err = new Error(message);
  err.splitGeometry = true;
  return err;
}

/**
 * Apply a column-major 4×4 to every vertex; returns a new mesh in placed space.
 * @param {import('./mesh.js').Mesh} mesh
 * @param {Float64Array|number[]} matrix
 */
export function placeMesh(mesh, matrix) {
  const src = mesh.positions64 ?? mesh.positions;
  const n = src.length / 3;
  const positions64 = new Float64Array(src.length);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = transformPoint(
      matrix,
      src[i * 3],
      src[i * 3 + 1],
      src[i * 3 + 2],
    );
    positions64[i * 3] = x;
    positions64[i * 3 + 1] = y;
    positions64[i * 3 + 2] = z;
  }
  return {
    positions: new Float32Array(positions64),
    positions64,
    indices: mesh.indices,
    faceId: mesh.faceId,
  };
}

/**
 * Snap candidate z to the midpoint of a gap between distinct vertex z values.
 * @param {Float64Array|Float32Array} positions
 * @param {number} targetZ
 * @returns {number|null}
 */
export function snapPlaneZ(positions, targetZ) {
  const n = positions.length / 3;
  /** @type {number[]} */
  const zs = [];
  for (let i = 0; i < n; i++) zs.push(positions[i * 3 + 2]);
  zs.sort((a, b) => a - b);
  /** @type {number[]} */
  const uniq = [];
  for (const z of zs) {
    if (!uniq.length || Math.abs(z - uniq[uniq.length - 1]) > 1e-12) uniq.push(z);
  }
  if (uniq.length < 2) return null;

  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < uniq.length - 1; i++) {
    const lo = uniq[i], hi = uniq[i + 1];
    const gap = hi - lo;
    const mid = (lo + hi) / 2;
    const ulp = Math.max(Number.EPSILON * Math.abs(mid) * 4, 1e-15);
    const minGap = Math.max(PLANE_GAP_MIN_MM, ulp);
    if (gap < minGap) continue;
    const dist = Math.abs(mid - targetZ);
    if (dist < bestDist) {
      bestDist = dist;
      best = mid;
    }
  }
  return best;
}

/**
 * Ranked axis alignments for splitting, best first. Candidates are the
 * skeleton's construction axis (globe poles; the sphere's Fibonacci
 * lattice axis — its perceived pole), every face normal (face-down), and
 * every vertex ray (vertex-down), deduped per axis. When `mesh` is passed,
 * each kept candidate is scored by projected overhang of a mid-band split
 * (the ranking that actually changes printability). Without a mesh, the
 * score falls back to seam ring size then kind — construction axis first
 * so a sphere's first reorient still lands on its pole.
 *
 * Dense meshes can mint hundreds of unique axes; scoring is capped and
 * spread across the sphere so the HUD cannot freeze.
 *
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton mm-scaled
 * @param {{ band?: [number, number], mesh?: object, canonicalMatrix?: Float64Array|number[], maxCandidates?: number }} [opts]
 * @returns {{ down: number[], kind: 'axis'|'face'|'vertex',
 *             ringSize: number, ringDist: number, support?: number,
 *             matrix: Float64Array }[]}
 */
export function rankSplitOrientations(skeleton, opts = {}) {
  const { band = [0.35, 0.65], mesh = null, canonicalMatrix = null } = opts;
  const maxCandidates = opts.maxCandidates ?? MAX_ORIENT_CANDIDATES;
  const { positions, faces } = skeleton;
  const nV = positions.length / 3;

  /** @type {{ down: number[], kind: 'axis'|'face'|'vertex' }[]} */
  const raw = [{ down: [0, 0, -1], kind: "axis" }];
  for (let f = 0; f < faces.length; f++) {
    raw.push({ down: toFaceFrame(skeleton, f).normal.slice(), kind: "face" });
  }
  for (let i = 0; i < nV; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    raw.push({ down: [x / l, y / l, z / l], kind: "vertex" });
  }

  // Dedup per axis (antipodal counts as the same axis); earlier entries win,
  // and the push order encodes kind priority: axis, faces, vertices.
  /** @type {typeof raw} */
  const uniq = [];
  for (const c of raw) {
    const dup = uniq.some((u) =>
      Math.abs(u.down[0] * c.down[0] + u.down[1] * c.down[1] + u.down[2] * c.down[2]) > 1 - 1e-6,
    );
    if (!dup) uniq.push(c);
  }

  const extras = [];
  if (canonicalMatrix) extras.push(downFromMatrix(canonicalMatrix));
  const picked = spreadPickAxes(uniq, maxCandidates, extras);

  const TOL = 1e-3; // mm — same ring tolerance as skeletonSeamLevels
  const KIND_RANK = { axis: 0, face: 1, vertex: 2 };
  const scored = picked.map((c) => {
    // Project every vertex onto the down axis (z after rotation = −down·p).
    const zs = [];
    for (let i = 0; i < nV; i++) {
      zs.push(-(
        c.down[0] * positions[i * 3] +
        c.down[1] * positions[i * 3 + 1] +
        c.down[2] * positions[i * 3 + 2]
      ));
    }
    zs.sort((a, b) => a - b);
    const zMin = zs[0], H = zs[zs.length - 1] - zMin;
    const lo = zMin + H * band[0], hi = zMin + H * band[1];
    const mid = zMin + H * 0.5;
    let ringSize = 0, ringDist = Infinity;
    let start = 0;
    for (let i = 1; i <= zs.length; i++) {
      if (i === zs.length || zs[i] - zs[i - 1] > TOL) {
        const level = (zs[start] + zs[i - 1]) / 2;
        const size = i - start;
        if (size >= 3 && level >= lo && level <= hi) {
          const dist = Math.abs(level - mid);
          if (size > ringSize || (size === ringSize && dist < ringDist)) {
            ringSize = size;
            ringDist = dist;
          }
        }
        start = i;
      }
    }
    const matrix = orientationForDirection(skeleton, c.down);
    let support = null;
    if (mesh) {
      const placed = placeMesh(mesh, matrix);
      let zLo = Infinity, zHi = -Infinity;
      const p = placed.positions64;
      for (let i = 2; i < p.length; i += 3) {
        if (p[i] < zLo) zLo = p[i];
        if (p[i] > zHi) zHi = p[i];
      }
      const planeZ = snapPlaneZInBand(p, (zLo + zHi) * 0.5, zLo + (zHi - zLo) * band[0], zLo + (zHi - zLo) * band[1]);
      support = planeZ == null
        ? Infinity
        : estimateSplitOverhang(placed, planeZ).support;
    }
    return { ...c, ringSize, ringDist, matrix, support };
  });

  scored.sort((a, b) => {
    if (mesh) {
      const da = a.support, db = b.support;
      if (da !== db && Number.isFinite(da) && Number.isFinite(db)) {
        const slack = Math.max(1, 0.05 * Math.min(da, db));
        if (Math.abs(da - db) > slack) return da - db;
      } else if (da !== db) {
        return (da ?? Infinity) - (db ?? Infinity);
      }
    }
    if (a.ringSize !== b.ringSize) return b.ringSize - a.ringSize;
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (a.ringDist !== b.ringDist) return a.ringDist - b.ringDist;
    return 0;
  });

  return scored;
}

/** Model-space unit vector that the placement matrix sends to world −Z. */
function downFromMatrix(M) {
  const x = -M[8], y = -M[9], z = -M[10];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Keep at most `k` axes, always the must-include downs (canonical rest,
 * construction axis) then greedy farthest-point on the projective sphere.
 * @param {{ down: number[] }[]} uniq
 * @param {number} k
 * @param {number[][]} extraDowns
 */
function spreadPickAxes(uniq, k, extraDowns) {
  if (uniq.length <= k) return uniq;
  /** @type {typeof uniq} */
  const selected = [];
  const take = (c) => {
    if (!c || selected.includes(c) || selected.length >= k) return;
    selected.push(c);
  };
  const findDown = (d) => uniq.find((u) =>
    Math.abs(u.down[0] * d[0] + u.down[1] * d[1] + u.down[2] * d[2]) > 1 - 1e-6,
  );
  for (const d of extraDowns) take(findDown(d));
  take(uniq[0]);
  while (selected.length < k) {
    let best = null, bestSep = -1;
    for (const c of uniq) {
      if (selected.includes(c)) continue;
      let sep = Infinity;
      for (const s of selected) {
        const ad = Math.abs(
          s.down[0] * c.down[0] + s.down[1] * c.down[1] + s.down[2] * c.down[2],
        );
        sep = Math.min(sep, 1 - ad);
      }
      if (sep > bestSep) {
        bestSep = sep;
        best = c;
      }
    }
    if (!best) break;
    take(best);
  }
  return selected;
}

/**
 * Natural seam levels of a placed skeleton: z values where a ring of
 * skeleton vertices lies (3+ within tolerance) — an edge loop the split
 * plane should hug when possible (e.g. the cuboctahedron's hexagonal
 * girdle when resting on a triangle face).
 * @param {{ positions: Float64Array }} skeleton
 * @param {Float64Array|number[]} matrix placement (orientation) matrix
 * @returns {number[]}
 */
export function skeletonSeamLevels(skeleton, matrix) {
  const pos = skeleton.positions;
  const zs = [];
  for (let i = 0; i < pos.length; i += 3) {
    zs.push(transformPoint(matrix, pos[i], pos[i + 1], pos[i + 2])[2]);
  }
  zs.sort((a, b) => a - b);
  const TOL = 1e-3; // mm — symmetric rings are exact; jitter breaks them
  const seams = [];
  let start = 0;
  for (let i = 1; i <= zs.length; i++) {
    if (i === zs.length || zs[i] - zs[i - 1] > TOL) {
      if (i - start >= 3) seams.push((zs[start] + zs[i - 1]) / 2);
      start = i;
    }
  }
  return seams;
}

/**
 * Valid planes hugging a natural seam level from below and above: the
 * nearest z on each side that keeps PLANE_GAP_MIN_MM clearance from every
 * vertex z. Seam levels ARE vertex levels (an edge ring lies exactly
 * there), so a hugging plane is typically 0.02mm away — visually on it.
 * Both sides are returned because a near-tangential cut can be splittable
 * on one side of the ring and degenerate on the other.
 *
 * @param {Float64Array|Float32Array} positions
 * @param {number} seamZ
 * @returns {number[]} 0–2 candidate z values, nearest first
 */
export function seamPlaneCandidates(positions, seamZ, minGap = PLANE_GAP_MIN_MM) {
  const n = positions.length / 3;
  /** @type {number[]} */
  const zs = [];
  for (let i = 0; i < n; i++) zs.push(positions[i * 3 + 2]);
  zs.sort((a, b) => a - b);
  const uniq = [];
  for (const z of zs) {
    if (!uniq.length || Math.abs(z - uniq[uniq.length - 1]) > 1e-12) uniq.push(z);
  }
  let below = null, above = null;
  for (let i = 0; i < uniq.length - 1; i++) {
    const lo = uniq[i], hi = uniq[i + 1];
    const midG = (lo + hi) / 2;
    const ulp = Math.max(Number.EPSILON * Math.abs(midG) * 4, 1e-15);
    const clr = Math.max(minGap, ulp);
    if (hi - lo < clr * 2) continue;
    const z = Math.min(Math.max(seamZ, lo + clr), hi - clr);
    if (z <= seamZ && (below == null || seamZ - z < seamZ - below)) below = z;
    if (z >= seamZ && (above == null || z - seamZ < above - seamZ)) above = z;
  }
  const out = [];
  if (below != null) out.push(below);
  if (above != null && above !== below) out.push(above);
  out.sort((a, b) => Math.abs(a - seamZ) - Math.abs(b - seamZ));
  return out;
}

/**
 * Nearest valid plane to `target` whose gap-clearance interval intersects
 * the band [lo, hi] — unlike snapPlaneZ, this never escapes the band: on
 * dense meshes (subdivided globes) every mid-band gap can be tighter than
 * the clearance, and the nearest-gap rule would then return a plane near
 * the top of the model.
 *
 * @param {Float64Array|Float32Array} positions
 * @param {number} target
 * @param {number} lo band floor (mm)
 * @param {number} hi band ceiling (mm)
 * @param {number} [minGap] vertex clearance (mm)
 * @returns {number|null}
 */
export function snapPlaneZInBand(positions, target, lo, hi, minGap = PLANE_GAP_MIN_MM) {
  const n = positions.length / 3;
  const zs = [];
  for (let i = 0; i < n; i++) zs.push(positions[i * 3 + 2]);
  zs.sort((a, b) => a - b);
  const uniq = [];
  for (const z of zs) {
    if (!uniq.length || Math.abs(z - uniq[uniq.length - 1]) > 1e-12) uniq.push(z);
  }
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < uniq.length - 1; i++) {
    const gLo = uniq[i], gHi = uniq[i + 1];
    const midG = (gLo + gHi) / 2;
    const ulp = Math.max(Number.EPSILON * Math.abs(midG) * 4, 1e-15);
    const clr = Math.max(minGap, ulp);
    const usableLo = Math.max(gLo + clr, lo);
    const usableHi = Math.min(gHi - clr, hi);
    if (usableLo > usableHi) continue;
    const z = Math.min(Math.max(target, usableLo), usableHi);
    const dist = Math.abs(z - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = z;
    }
  }
  return best;
}

/** A "seam" plane that had to move this far off its ring is no longer one. */
const SEAM_MAX_OFFSET_MM = 1.0;

/**
 * Rank candidate split planes, best first.
 *
 * Larger cut face first (bed contact). Areas within 5% tie on a natural
 * seam, then nearer mid-height. Seams are an aesthetic tiebreak, not a
 * trump over a much larger (or much smaller-overhang) cut. Callers try
 * candidates in order — a plane that probed clean can still fail the
 * full split on sliver caps.
 *
 * @param {import('./mesh.js').Mesh} placedMesh
 * @param {{ heightMm: number, samples?: number, band?: [number, number], seamZs?: number[] }} opts
 * @returns {{ planeZ: number, cutArea: number, seam: boolean }[]}
 */
export function rankSplitPlanes(placedMesh, opts) {
  const { heightMm, samples = 21, band = [0.35, 0.65], seamZs = [] } = opts;
  const mid = heightMm * 0.5;
  const lo = heightMm * band[0];
  const hi = heightMm * band[1];
  const positions = placedMesh.positions64 ?? placedMesh.positions;

  /** @type {{ z: number, area: number, dist: number, seam: boolean, seamOff: number }[]} */
  const candidates = [];
  const seen = new Set();
  const consider = (z, seam, seamOff = 0) => {
    if (z == null || seen.has(z)) return;
    seen.add(z);
    const area = cutAreaAtPlane(placedMesh, z);
    if (area == null) return; // self-intersecting cut — skip
    candidates.push({ z, area, dist: Math.abs(z - mid), seam, seamOff });
  };

  // Dense meshes (subdivided globes) can leave no gap in the band at the
  // default clearance — retry with tighter ones (the last tier is 0.5µm,
  // still ~130 float32 ULP at 50mm, so exact-sign classification holds)
  // before giving up.
  for (const minGap of [PLANE_GAP_MIN_MM, PLANE_GAP_MIN_MM / 4, PLANE_GAP_MIN_MM / 40]) {
    for (const seamZ of seamZs) {
      if (seamZ < lo || seamZ > hi) continue;
      for (const z of seamPlaneCandidates(positions, seamZ, minGap)) {
        if (Math.abs(z - seamZ) <= SEAM_MAX_OFFSET_MM) consider(z, true, Math.abs(z - seamZ));
      }
    }
    for (let s = 0; s < samples; s++) {
      const t = samples === 1 ? 0.5 : s / (samples - 1);
      consider(snapPlaneZInBand(positions, lo + t * (hi - lo), lo, hi, minGap), false);
    }
    if (candidates.length) break;
  }
  if (!candidates.length) throw splitError("split: no valid plane in band");

  candidates.sort((a, b) => {
    const slack = 0.05 * Math.max(a.area, b.area);
    if (Math.abs(a.area - b.area) > slack) return b.area - a.area;
    if (a.seam !== b.seam) return a.seam ? -1 : 1;
    if (a.seam && a.seamOff !== b.seamOff) return a.seamOff - b.seamOff;
    return a.dist - b.dist;
  });
  return candidates.map(({ z, area, seam }) => ({
    planeZ: z, cutArea: area, seam,
  }));
}

/**
 * Best split plane (first of rankSplitPlanes).
 * @param {import('./mesh.js').Mesh} placedMesh
 * @param {{ heightMm: number, samples?: number, band?: [number, number], seamZs?: number[] }} opts
 * @returns {{ planeZ: number, cutArea: number }}
 */
export function findSplitPlane(placedMesh, opts) {
  const [best] = rankSplitPlanes(placedMesh, opts);
  return { planeZ: best.planeZ, cutArea: best.cutArea };
}

/**
 * Split a placed mesh at z = zMm into upper (A) and lower (B) watertight halves.
 * @param {import('./mesh.js').Mesh} placedMesh
 * @param {number} zMm
 * @returns {{ a: import('./mesh.js').Mesh, b: import('./mesh.js').Mesh, planeZ: number, cutArea: number, volumeMm3A: number, volumeMm3B: number }}
 */
export function splitMeshAtPlane(placedMesh, zMm) {
  const cut = cutMesh(placedMesh, zMm);
  const a = finalizeHalf(cut, "a");
  const b = finalizeHalf(cut, "b");
  return {
    a: a.mesh,
    b: b.mesh,
    planeZ: zMm,
    cutArea: cut.cutArea,
    volumeMm3A: a.volumeMm3,
    volumeMm3B: b.volumeMm3,
  };
}

/**
 * Rigid export matrices so both halves rest cut-face-down on z=0.
 * A: translate by −planeZMm. B: (x,y,z) → (x, −y, planeZMm−z).
 * @param {number} planeZMm split-plane height in placed millimetres
 * @returns {{ matrixA: Float64Array, matrixB: Float64Array }}
 */
export function halfExportMatrices(planeZMm) {
  const matrixA = new Float64Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, -planeZMm, 1,
  ]);
  // Column-major: R_x(π) then T_z(planeZMm) → (x, −y, planeZMm−z).
  const matrixB = new Float64Array([
    1, 0, 0, 0,
    0, -1, 0, 0,
    0, 0, -1, 0,
    0, 0, planeZMm, 1,
  ]);
  return { matrixA, matrixB };
}

/**
 * Projected overhang of a mesh already in print pose (cut-face-down).
 * Downward-facing area (nz < −cos 45°) above the bed, area-weighted by −nz.
 * Relative ranking only — not grams of support.
 *
 * @param {import('./mesh.js').Mesh} mesh
 * @param {Float64Array|number[]|null} [matrix]
 * @returns {{ support: number, bed: number }}
 */
export function overhangProjection(mesh, matrix = null) {
  const placed = matrix ? placeMesh(mesh, matrix) : mesh;
  return accumulateOverhang(placed.positions64 ?? placed.positions, placed.indices);
}

/**
 * Estimate both halves' overhang without capping: classify unsplit
 * triangles against the plane and apply halfExportMatrices to normals.
 * Straddling triangles become the bed cap and are skipped.
 *
 * @param {import('./mesh.js').Mesh} placedMesh
 * @param {number} planeZ
 * @returns {{ support: number, a: number, b: number }}
 */
export function estimateSplitOverhang(placedMesh, planeZ) {
  const pos = placedMesh.positions64 ?? placedMesh.positions;
  const idx = placedMesh.indices;
  let a = 0, b = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t] * 3, ib = idx[t + 1] * 3, ic = idx[t + 2] * 3;
    const az = pos[ia + 2], bz = pos[ib + 2], cz = pos[ic + 2];
    const zMin = Math.min(az, bz, cz), zMax = Math.max(az, bz, cz);
    if (zMin < planeZ && zMax > planeZ) continue;
    const ax = pos[ia], ay = pos[ia + 1];
    const bx = pos[ib], by = pos[ib + 1];
    const cx = pos[ic], cy = pos[ic + 1];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const mag = Math.hypot(nx, ny, nz);
    if (!(mag > 0)) continue;
    const area = mag / 2;
    const above = (az + bz + cz) / 3 >= planeZ;
    // A: translate only. B: (x, −y, planeZ−z) → n' = (nx, −ny, −nz).
    const nzP = above ? nz / mag : -nz / mag;
    const z0 = above ? zMin - planeZ : planeZ - zMax;
    if (z0 <= BED_EPS_MM) continue;
    if (nzP < OVERHANG_NZ) {
      const add = area * (-nzP);
      if (above) a += add;
      else b += add;
    }
  }
  return { support: a + b, a, b };
}

function accumulateOverhang(pos, idx) {
  let support = 0, bed = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t] * 3, ib = idx[t + 1] * 3, ic = idx[t + 2] * 3;
    const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2];
    const bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2];
    const cx = pos[ic], cy = pos[ic + 1], cz = pos[ic + 2];
    const zMin = Math.min(az, bz, cz);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const mag = Math.hypot(nx, ny, nz);
    if (!(mag > 0)) continue;
    const area = mag / 2;
    if (zMin <= BED_EPS_MM) {
      bed += area;
      continue;
    }
    const unz = nz / mag;
    if (unz < OVERHANG_NZ) support += area * (-unz);
  }
  return { support, bed };
}

/**
 * Seal a split for one placement, or null. Tries ranked planes until one
 * seals. Does not search other orientations.
 *
 * @param {import('./mesh.js').Mesh} mesh
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {Float64Array|number[]} matrix
 * @returns {{ a: object, b: object, planeZ: number, gapMm: number, cutArea: number,
 *             overhang: { a: { support: number, bed: number }, b: { support: number, bed: number } },
 *             heightMm: number, planes: object[], planeIndex: number, matrix: Float64Array } | null}
 */
export function splitAtOrientation(mesh, skeleton, matrix) {
  try {
    const placed = placeMesh(mesh, matrix);
    let zLo = Infinity, zHi = -Infinity;
    const p = placed.positions64;
    for (let i = 2; i < p.length; i += 3) {
      if (p[i] < zLo) zLo = p[i];
      if (p[i] > zHi) zHi = p[i];
    }
    const heightMm = zHi - zLo;
    const ranked = rankSplitPlanes(placed, {
      heightMm,
      seamZs: skeletonSeamLevels(skeleton, matrix),
    });
    for (let i = 0; i < ranked.length; i++) {
      try {
        const { a, b, planeZ, cutArea, volumeMm3A, volumeMm3B } = splitMeshAtPlane(placed, ranked[i].planeZ);
        const { matrixA, matrixB } = halfExportMatrices(planeZ);
        return {
          a,
          b,
          planeZ,
          cutArea,
          volumeMm3A,
          volumeMm3B,
          gapMm: Math.max(6, 0.08 * heightMm),
          overhang: {
            a: overhangProjection(a, matrixA),
            b: overhangProjection(b, matrixB),
          },
          heightMm,
          planes: ranked,
          planeIndex: i,
          matrix,
        };
      } catch {
        /* next candidate */
      }
    }
  } catch {
    /* no valid plane for this placement */
  }
  return null;
}

/**
 * Pick a sealed split: score orientations by overhang, always — canonical
 * rest is a candidate, not the default. Caps seal attempts so a dense
 * mesh cannot stall the session.
 *
 * @param {import('./mesh.js').Mesh} mesh
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {Float64Array|number[]} canonicalMatrix
 * @param {{ startIndex?: number, maxTries?: number }} [opts]
 * @returns {{ a: object, b: object, planeZ: number, gapMm: number, cutArea: number,
 *             overhang: object, heightMm: number, planes: object[], planeIndex: number,
 *             matrix: Float64Array, orients: object[], orientIndex: number } | null}
 */
export function chooseSplit(mesh, skeleton, canonicalMatrix, opts = {}) {
  const maxTries = opts.maxTries ?? MAX_SPLIT_SEAL_TRIES;
  const startIndex = opts.startIndex ?? 0;
  const orients = rankSplitOrientations(skeleton, { mesh, canonicalMatrix });
  const n = orients.length;
  if (!n) return null;
  for (let t = 0; t < Math.min(maxTries, n); t++) {
    const i = (startIndex + t) % n;
    const split = splitAtOrientation(mesh, skeleton, orients[i].matrix);
    if (split) {
      return { ...split, orients, orientIndex: i };
    }
  }
  return null;
}

// ── internals ────────────────────────────────────────────────────────

function cutAreaAtPlane(mesh, c) {
  try {
    const cut = cutMesh(mesh, c);
    // Reject self-intersecting cut loops — earcut can't seal them and
    // rounded open frames can produce them at some heights.
    for (const loop of cut.loops) {
      if (loopSelfIntersects(cut.points2d, loop)) return null;
    }
    return cut.cutArea;
  } catch (err) {
    if (err?.splitGeometry) return null; // geometric failure: skip candidate
    throw err; // programming error: surface it
  }
}

function loopSelfIntersects(points2d, loop) {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    const ax = points2d[a * 2], ay = points2d[a * 2 + 1];
    const bx = points2d[b * 2], by = points2d[b * 2 + 1];
    for (let j = i + 1; j < n; j++) {
      const c = loop[j], d = loop[(j + 1) % n];
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsCross(
        ax, ay, bx, by,
        points2d[c * 2], points2d[c * 2 + 1],
        points2d[d * 2], points2d[d * 2 + 1],
      )) return true;
    }
  }
  return false;
}

/**
 * @param {import('./mesh.js').Mesh} mesh
 * @param {number} c
 */
function cutMesh(mesh, c) {
  const pos = mesh.positions64 ?? mesh.positions;
  const idx = mesh.indices;
  const faceId = mesh.faceId;
  const nVerts = pos.length / 3;
  const nTris = idx.length / 3;

  const sign = new Int8Array(nVerts);
  for (let i = 0; i < nVerts; i++) {
    const z = pos[i * 3 + 2];
    sign[i] = z >= c ? 1 : -1;
  }

  /** @type {number[]} */
  const verts = [];
  const remap = new Int32Array(nVerts).fill(-1);
  const ensureOrig = (vi) => {
    if (remap[vi] >= 0) return remap[vi];
    const ni = verts.length / 3;
    verts.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
    remap[vi] = ni;
    return ni;
  };

  /** @type {Map<number, number>} */
  const edgeCut = new Map();
  const cutVertex = (u, v) => {
    const a = Math.min(u, v), b = Math.max(u, v);
    const key = a * nVerts + b;
    if (edgeCut.has(key)) return /** @type {number} */ (edgeCut.get(key));
    const za = pos[a * 3 + 2], zb = pos[b * 3 + 2];
    const t = (c - za) / (zb - za);
    const x = pos[a * 3] + t * (pos[b * 3] - pos[a * 3]);
    const y = pos[a * 3 + 1] + t * (pos[b * 3 + 1] - pos[a * 3 + 1]);
    const ni = verts.length / 3;
    verts.push(x, y, c);
    edgeCut.set(key, ni);
    return ni;
  };

  /** @type {number[]} */
  const trisA = [];
  /** @type {number[]} */
  const faceA = [];
  /** @type {number[]} */
  const trisB = [];
  /** @type {number[]} */
  const faceB = [];

  for (let t = 0; t < nTris; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    const s0 = sign[i0], s1 = sign[i1], s2 = sign[i2];
    const fid = faceId ? faceId[t] : 0;
    const sum = s0 + s1 + s2;

    if (sum === 3) {
      trisA.push(ensureOrig(i0), ensureOrig(i1), ensureOrig(i2));
      faceA.push(fid);
      continue;
    }
    if (sum === -3) {
      trisB.push(ensureOrig(i0), ensureOrig(i1), ensureOrig(i2));
      faceB.push(fid);
      continue;
    }

    // Lone = the unique-sign vertex (one above+two below ⇒ sum −1, lone +1;
    // one below+two above ⇒ sum +1, lone −1). NOT s===sum.
    let lone, a, b;
    if (s0 !== s1 && s0 !== s2) { lone = i0; a = i1; b = i2; }
    else if (s1 !== s0 && s1 !== s2) { lone = i1; a = i2; b = i0; }
    else { lone = i2; a = i0; b = i1; }

    const loneSide = sign[lone];
    const cLoneA = cutVertex(lone, a);
    const cLoneB = cutVertex(lone, b);
    const L = ensureOrig(lone);
    const A = ensureOrig(a);
    const B = ensureOrig(b);

    // Sub-tri on lone side preserves winding lone→a→b → lone→cLoneA→cLoneB.
    // Far side: two tris for quad a→b→cLoneB→cLoneA.
    if (loneSide > 0) {
      trisA.push(L, cLoneA, cLoneB);
      faceA.push(fid);
      trisB.push(A, B, cLoneB);
      faceB.push(fid);
      trisB.push(A, cLoneB, cLoneA);
      faceB.push(fid);
    } else {
      trisB.push(L, cLoneA, cLoneB);
      faceB.push(fid);
      trisA.push(A, B, cLoneB);
      faceA.push(fid);
      trisA.push(A, cLoneB, cLoneA);
      faceA.push(fid);
    }
  }

  // A-side cut boundary = directed edges of A tris that lie on the plane
  // (both endpoints at z=c). Manifold ⇒ each such edge appears once.
  /** @type {number[]} */
  const cutSegs = [];
  for (let t = 0; t < trisA.length; t += 3) {
    const u = trisA[t], v = trisA[t + 1], w = trisA[t + 2];
    const zu = verts[u * 3 + 2], zv = verts[v * 3 + 2], zw = verts[w * 3 + 2];
    if (Math.abs(zu - c) < 1e-12 && Math.abs(zv - c) < 1e-12) cutSegs.push(u, v);
    if (Math.abs(zv - c) < 1e-12 && Math.abs(zw - c) < 1e-12) cutSegs.push(v, w);
    if (Math.abs(zw - c) < 1e-12 && Math.abs(zu - c) < 1e-12) cutSegs.push(w, u);
  }

  const loops = assembleLoops(cutSegs);
  const points2d = new Float64Array((verts.length / 3) * 2);
  for (let i = 0; i < verts.length / 3; i++) {
    points2d[i * 2] = verts[i * 3];
    points2d[i * 2 + 1] = verts[i * 3 + 1];
  }

  // Planar faces put many samples on one line; earcut then emits zero-area
  // ears that meshcheck rejects (and that false-positive as self-intersects
  // against side edges). Nudge those middle verts slightly into the region so
  // every ear has area while the cut stays manifold (same vertex indices).
  nudgeColinearCutVerts(verts, points2d, loops, c);

  // Signed sum: A-side directed loops wind material outlines one way and
  // holes (cavity outlines, opening interiors) the other, so holes subtract
  // and the total is the MATERIAL cross-section. Per-loop |abs| would count
  // a hollow shell's cavity as material — a thin ring near a natural seam
  // then scores as a huge cut and loses to any solid-strut plane.
  let cutArea = 0;
  for (const loop of loops) cutArea += shoelace(points2d, loop);
  cutArea = Math.abs(cutArea);

  return {
    verts,
    trisA,
    faceA,
    trisB,
    faceB,
    loops,
    points2d,
    cutArea,
    planeZ: c,
  };
}

/**
 * Push colinear cut-loop middles a tiny step into the material so
 * triangulation ears gain area. Updates verts + points2d in place.
 * Direction is left of the loop's directed edges (CCW outer / CW hole both
 * leave material on the left when nestLoops orientations are correct).
 * @param {number[]} verts
 * @param {Float64Array} points2d
 * @param {number[][]} loops
 * @param {number} c
 */
function nudgeColinearCutVerts(verts, points2d, loops, c) {
  const epsCross = 1e-9;
  const nudgeMm = 1e-4; // survives float32 STL; still << FDM
  for (const loop of loops) {
    const n = loop.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const ia = loop[(i - 1 + n) % n];
      const ib = loop[i];
      const ic = loop[(i + 1) % n];
      const ax = points2d[ia * 2], ay = points2d[ia * 2 + 1];
      const bx = points2d[ib * 2], by = points2d[ib * 2 + 1];
      const dx = points2d[ic * 2], dy = points2d[ic * 2 + 1];
      const cross = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      const lac = Math.hypot(dx - ax, dy - ay);
      if (lac < 1e-15) continue;
      if (Math.abs(cross) > epsCross * lac * lac) continue;
      const lab = Math.hypot(bx - ax, by - ay);
      const lbc = Math.hypot(dx - bx, dy - by);
      if (lab + lbc > lac + 1e-8) continue;
      // Left normal of A→C (material side for correctly wound loops).
      let nx = -(dy - ay);
      let ny = dx - ax;
      const plen = Math.hypot(nx, ny);
      if (plen < 1e-15) continue;
      nx = (nx / plen) * nudgeMm;
      ny = (ny / plen) * nudgeMm;
      const x = bx + nx;
      const y = by + ny;
      points2d[ib * 2] = x;
      points2d[ib * 2 + 1] = y;
      verts[ib * 3] = x;
      verts[ib * 3 + 1] = y;
      verts[ib * 3 + 2] = c;
    }
  }
}

/**
 * Chain directed segments into closed loops.
 * @param {number[]} segs
 * @returns {number[][]}
 */
export function assembleLoops(segs) {
  /** @type {Map<number, number>} */
  const next = new Map();
  for (let i = 0; i < segs.length; i += 2) {
    const u = segs[i], v = segs[i + 1];
    if (next.has(u)) throw splitError(`split: cut vertex ${u} has out-degree >1`);
    next.set(u, v);
  }
  /** @type {number[][]} */
  const loops = [];
  const visited = new Set();
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    /** @type {number[]} */
    const loop = [];
    let cur = start;
    do {
      if (visited.has(cur)) throw splitError("split: cut loop re-entered vertex");
      visited.add(cur);
      loop.push(cur);
      const n = next.get(cur);
      if (n == null) throw splitError("split: cut chain broke");
      cur = n;
    } while (cur !== start);
    if (loop.length < 3) throw splitError("split: degenerate cut loop");
    loops.push(loop);
  }
  return loops;
}

/**
 * @param {ReturnType<typeof cutMesh>} cut
 * @param {'a'|'b'} which
 */
function finalizeHalf(cut, which) {
  const { trisA, faceA, trisB, faceB, loops, points2d } = cut;
  // Copy verts — cap cleanup may nudge plane samples without affecting the
  // sibling half's in-progress build.
  const verts = cut.verts.slice();

  const baseTris = which === "a" ? trisA.slice() : trisB.slice();
  const baseFace = which === "a" ? faceA.slice() : faceB.slice();

  // Cap must cover every cut edge (colinear middles were nudged for area).
  let capTris;
  try {
    capTris = triangulateRegions(points2d, loops);
  } catch (err) {
    throw new Error(`split: cap fill failed on half ${which}: ${err.message}`);
  }

  for (let i = 0; i < capTris.length; i += 3) {
    let a = capTris[i], b = capTris[i + 1], c = capTris[i + 2];
    // If earcut emitted a flat/sliver tri (colinear samples on a planar face
    // cut), push one vertex off the line. Check 3D area — matches mesh.js /
    // float32 STL — not just the xy shoelace.
    {
      const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
      const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
      const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      const nx0 = e1y * e2z - e1z * e2y;
      const ny0 = e1z * e2x - e1x * e2z;
      const nz0 = e1x * e2y - e1y * e2x;
      // 1e-12 catches slivers that die under float32; mesh.js rejects <1e-18.
      if (Math.hypot(nx0, ny0, nz0) < 1e-12) {
        const lab = Math.hypot(e1x, e1y);
        const lbc = Math.hypot(cx - bx, cy - by);
        const lac = Math.hypot(cx - ax, cy - ay);
        let ux, uy, mid;
        if (lac >= lab && lac >= lbc) {
          ux = cx - ax; uy = cy - ay; mid = b;
        } else if (lab >= lbc) {
          ux = bx - ax; uy = by - ay; mid = c;
        } else {
          ux = cx - bx; uy = cy - by; mid = a;
        }
        let nx = -uy, ny = ux;
        const plen = Math.hypot(nx, ny);
        if (plen < 1e-15) continue;
        // 1e-3 mm survives float32 rounding at ~50 mm coordinates. Same
        // direction for BOTH halves so the two cut faces stay exact mirrors
        // (a per-half sign would open a 2e-3 mm seam mismatch).
        verts[mid * 3] += (nx / plen) * 1e-3;
        verts[mid * 3 + 1] += (ny / plen) * 1e-3;
      }
    }
    if (which === "a") { const tmp = b; b = c; c = tmp; }
    baseTris.push(a, b, c);
    baseFace.push(CAP_FACE_ID);
  }

  const used = new Map();
  /** @type {number[]} */
  const newPos = [];
  const mapV = (vi) => {
    if (used.has(vi)) return used.get(vi);
    const ni = newPos.length / 3;
    newPos.push(verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]);
    used.set(vi, ni);
    return ni;
  };
  const newIdx = new Uint32Array(baseTris.length);
  for (let i = 0; i < baseTris.length; i++) newIdx[i] = mapV(baseTris[i]);
  const mesh = toMesh(
    new Float64Array(newPos),
    newIdx,
    Uint32Array.from(baseFace),
  );
  const check = assertMeshInvariants(mesh);
  return { mesh, volumeMm3: check.volume };
}
