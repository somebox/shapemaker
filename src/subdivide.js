/**
 * Fixed-order surface subdivision — the first skeleton operator. Each level
 * splits every face flat, in its own plane. Two styles:
 *
 * - "radial" (default): triangles 4:1 via edge midpoints, larger polygons
 *   as centroid fans over the midpoint-split boundary — 2k triangles per
 *   k-gon (8 openings per cube side at level 1).
 * - "grid": triangles still 4:1; larger polygons split into k corner
 *   QUADS (corner, edge midpoint, centroid, previous midpoint) — k per
 *   k-gon (4 openings per cube side at level 1, 16 at level 2). Quads
 *   stay planar because splitting is flat, which is why Smooth is a
 *   radial-only companion: the sphere clip would bend them out of plane.
 *
 * Every edge splits at its midpoint in both styles, so mixed-face solids
 * (icosidodeca: pentagons meeting triangles) stay closed with no
 * T-junctions.
 *
 * Smooth is a true edge fillet: soften sets a rounding radius R = s × the
 * parent inradius, and every vertex projects onto the rounded parent solid
 * (parent inset by R, Minkowski-expanded by R). Edges and corners round
 * proportionally from the first percent while flat face interiors are
 * exact fixed points — overall dimensions hold, only sharpness melts.
 * Above soften 0.5 a melt phase additionally clips the deeper flats of
 * mixed-plane-distance solids spherically, so soften 1 reaches the
 * inscribed ball on every base.
 *
 * The result stays a convex triangulation, so all solidifier guarantees
 * hold. Runs AFTER jitter (plane perturbation on regulars, point jitter on
 * parametric bases): jitter distorts the simple form, subdivision adds
 * resolution to it, smooth fillets it. The reverse order would hand the
 * plane perturbation near-coplanar plane families whose members mostly
 * stop binding — silently discarding subdivision and smoothing.
 */

import { assertSkeleton, edgeList } from "./skeleton.js";
import { applyFaceIdentity } from "./hull.js";
import { faceFrames } from "./faceframe.js";

export const SUBDIV_MAX = 2;

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 *   unit skeleton (all vertices on the circumsphere)
 * @param {number} level  0 returns the input untouched; clamped to SUBDIV_MAX
 * @param {number} [soften]  0–1 edge fillet: 0 keeps the exact flat solid
 *   (grids of openings on planar faces), 1 rounds everything down to the
 *   inscribed ball. Default 0. Ignored (forced 0) for style "grid" — the
 *   clip would make the quads non-planar.
 * @param {"radial"|"grid"} [style]  polygon split pattern. Default "radial".
 * @returns {{ positions: Float64Array, faces: number[][], edges: number[][] }}
 */
export function subdivideSkeleton(skeleton, level, soften = 0, style = "radial") {
  const n = Math.min(SUBDIV_MAX, Math.floor(level ?? 0));
  if (!(n > 0)) return skeleton;
  const grid = style === "grid";
  const s = grid ? 0 : Math.min(1, Math.max(0, soften));

  let cur = { positions: skeleton.positions, faces: skeleton.faces };
  for (let i = 0; i < n; i++) cur = subdivideOnce(cur, grid);

  const positions = Float64Array.from(cur.positions);
  if (s > 0) {
    // Rounding clip: soften defines a fillet radius R = s × inradius and
    // every vertex projects onto the ROUNDED PARENT SOLID — the Minkowski
    // body {dist(p, parent inset by R) ≤ R}, the same construction the
    // shell-level rounding uses. Face interiors are exact fixed points
    // (their inset foot is R straight below), while every edge and corner
    // rounds from the first percent — including features the old sphere
    // clip could never reach (a cube's edges stayed 90° until soften ~0.69;
    // Catalan inner-ring corners were skipped, and clipping their outer
    // neighbours actually sharpened the crease). Cube corners follow the
    // identical trajectory as the old clip (radius 1 − s(1 − r_in)), so
    // historical anchors hold.
    //
    // The fillet radius caps at the min plane distance, so on
    // mixed-distance solids (icosidodeca, Catalans) the DEEPER faces
    // would survive soften 1 as large flats — the smoothing "stops
    // prematurely". A melt phase in the upper half of the slider clips
    // those remaining flats spherically toward the inscribed ball, so
    // soften 1 reaches the ball on every base. On uniform solids (cube)
    // every post-fillet radius already sits inside the melt clip, so the
    // melt is a no-op there and anchors still hold.
    let rEnd = Infinity;
    const planes = [];
    for (const f of faceFrames(skeleton)) {
      rEnd = Math.min(rEnd, f.inradius);
      planes.push({ n: f.normal, d: f.inradius });
    }
    const R = s * rEnd;
    for (let i = 0; i < positions.length; i += 3) {
      const p = [positions[i], positions[i + 1], positions[i + 2]];
      const q = projectOntoInset(p, planes, R);
      const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist > R + 1e-12 && dist > 1e-12) {
        const k = R / dist;
        positions[i] = q[0] + dx * k;
        positions[i + 1] = q[1] + dy * k;
        positions[i + 2] = q[2] + dz * k;
      }
    }
    const MELT_START = 0.5;
    if (s > MELT_START) {
      const clip = 1 - ((s - MELT_START) / (1 - MELT_START)) * (1 - rEnd);
      for (let i = 0; i < positions.length; i += 3) {
        const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
        if (r > clip) {
          const k = clip / r;
          positions[i] *= k;
          positions[i + 1] *= k;
          positions[i + 2] *= k;
        }
      }
    }
  }
  const faces = applyFaceIdentity(positions, cur.faces);
  const out = { positions, faces, edges: edgeList(faces) };
  assertSkeleton(out);
  return out;
}

/**
 * Nearest point of the parent solid inset by R — Dykstra's alternating
 * projection onto {q : n_f·q ≤ d_f − R}. Only planes a point could
 * interact with (violated within a 2R margin) enter the cycle; interior
 * face points converge in one pass, edge/corner points in a few dozen.
 *
 * @param {number[]} p
 * @param {{ n: number[], d: number }[]} planes  parent face planes (unit n)
 * @param {number} R  inset depth
 * @returns {number[]} nearest point in the inset body
 */
function projectOntoInset(p, planes, R) {
  const active = planes.filter(
    ({ n, d }) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] > d - 2 * R - 1e-9,
  );
  const q = [p[0], p[1], p[2]];
  /** Dykstra correction per constraint. */
  const corr = active.map(() => [0, 0, 0]);
  for (let iter = 0; iter < 120; iter++) {
    let moved = 0;
    for (let c = 0; c < active.length; c++) {
      const { n, d } = active[c];
      const y = [q[0] + corr[c][0], q[1] + corr[c][1], q[2] + corr[c][2]];
      const excess = n[0] * y[0] + n[1] * y[1] + n[2] * y[2] - (d - R);
      const nx = excess > 0 ? [y[0] - n[0] * excess, y[1] - n[1] * excess, y[2] - n[2] * excess] : y;
      corr[c] = [y[0] - nx[0], y[1] - nx[1], y[2] - nx[2]];
      moved = Math.max(moved, Math.abs(nx[0] - q[0]), Math.abs(nx[1] - q[1]), Math.abs(nx[2] - q[2]));
      q[0] = nx[0]; q[1] = nx[1]; q[2] = nx[2];
    }
    if (moved < 1e-12) break;
  }
  return q;
}

/**
 * @param {{ positions: ArrayLike<number>, faces: number[][] }} skel
 * @param {boolean} [grid]  corner quads instead of centroid fans on n-gons
 * @returns {{ positions: number[], faces: number[][] }}
 */
function subdivideOnce({ positions, faces }, grid = false) {
  /** @type {number[]} */
  const pos = Array.from(positions);
  /** @type {Map<number, number>} undirected edge → midpoint vertex */
  const mids = new Map();

  // New vertices stay on the parent geometry — splitting is flat; rounding
  // is the caller's sphere clip.
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
  for (const ring of faces) {
    const k = ring.length;
    if (k === 3) {
      const [a, b, c] = ring;
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      continue;
    }
    // n-gon: flat split about the centroid — corner quads (grid) or a
    // centroid fan of triangles (radial). Both stay in the face plane.
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
        out.push([mPrev, a, mNext, center]);
      }
    } else {
      for (let i = 0; i < k; i++) {
        const a = ring[i], b = ring[(i + 1) % k];
        const m = midpoint(a, b);
        out.push([center, a, m], [center, m, b]);
      }
    }
  }
  return { positions: pos, faces: out };
}
