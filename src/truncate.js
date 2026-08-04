/**
 * Truncation — the second fixed-order skeleton operator (after jitter,
 * before subdivide). Each vertex is cut off by replacing every edge (u, v)
 * with the pair of points at fraction t and 1−t along it, then re-hulling
 * with coplanar merge. On regular solids the incident cut points are
 * coplanar and merge into the classic truncation faces:
 *
 *   cube  t→½ ....... cuboctahedron (rectification)
 *   icosa t=⅓ ....... truncated icosahedron (the soccer ball)
 *   dodeca t→½ ...... icosidodecahedron
 *
 * On irregular/jittered solids the cut points are generally NOT coplanar;
 * the hull then approximates the cut with several triangles — still convex,
 * still valid, degrading gradually per the SPEC.
 *
 * The remnants of each original face stay in that face's plane (edge points
 * are convex combinations of its ring), so coplanar merge recovers them as
 * single polygons. The result renormalizes to unit circumradius so Size
 * keeps meaning circumdiameter.
 *
 * t = 0 returns the input untouched (exact no-op); t is clamped to [0, ½] —
 * ½ is full rectification, where both edge points meet at the midpoint
 * (hull dedupe collapses the float twins).
 */

import { hullToSkeleton } from "./hull.js";

export const TRUNCATE_MAX = 0.5;

/**
 * @param {{ positions: Float64Array, edges: number[][] }} skeleton
 *   unit skeleton (max vertex radius 1)
 * @param {number} t  edge fraction cut from each end, 0–0.5
 * @returns {{ positions: Float64Array, faces: number[][], edges: number[][] }}
 */
export function truncateSkeleton(skeleton, t) {
  const f = Math.min(TRUNCATE_MAX, Math.max(0, t ?? 0));
  if (!(f > 0)) return skeleton;

  const pos = skeleton.positions;
  const pts = [];
  for (const [u, v] of skeleton.edges) {
    const ux = pos[u * 3], uy = pos[u * 3 + 1], uz = pos[u * 3 + 2];
    const vx = pos[v * 3], vy = pos[v * 3 + 1], vz = pos[v * 3 + 2];
    pts.push(
      ux + (vx - ux) * f, uy + (vy - uy) * f, uz + (vz - uz) * f,
      vx + (ux - vx) * f, vy + (uy - vy) * f, vz + (uz - vz) * f,
    );
  }

  // Coplanar merge recovers the original faces' remnants and (on regular
  // solids) the vertex-cut polygons as single faces.
  const sk = hullToSkeleton(Float64Array.from(pts), {});

  // Renormalize to unit circumradius — truncation strictly shrinks the
  // outermost vertices, and Size must keep meaning circumdiameter.
  let rMax = 0;
  const p = sk.positions;
  for (let i = 0; i < p.length; i += 3) {
    rMax = Math.max(rMax, Math.hypot(p[i], p[i + 1], p[i + 2]));
  }
  if (rMax > 1e-12 && Math.abs(rMax - 1) > 1e-12) {
    const k = 1 / rMax;
    for (let i = 0; i < p.length; i++) p[i] *= k;
  }
  return sk;
}
