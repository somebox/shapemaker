/**
 * Dual — a fixed-order skeleton operator (after jitter, before truncate).
 *
 * Polar reciprocation about the origin: a face lying in the plane n·x = d
 * becomes the vertex n/d, and every vertex becomes a face. All the planes
 * through one vertex map to points of a single plane, so the dual's faces
 * are exactly planar whatever the parent looks like; re-hulling with
 * coplanar merge recovers them as polygons — one k-gon per k-valent parent
 * vertex. Truncate's re-hull is the template.
 *
 *   cube ↔ octahedron, dodecahedron ↔ icosahedron, tetrahedron ↔ itself
 *   cuboctahedron → rhombic dodecahedron, icosidodecahedron → rhombic 30
 *   sphere / twisted globe (triangulated) → pentagon + hexagon cells
 *
 * The dual of a triangulation has only three-valent vertices, so a later
 * Truncate cuts every corner exactly (three points are always coplanar).
 *
 * The parent must contain the origin strictly (every face inradius > 0),
 * which the hull stage guarantees. The result renormalizes to unit
 * circumradius so Size keeps meaning circumdiameter.
 */

import { hullToSkeleton } from "./hull.js";
import { faceFrames } from "./faceframe.js";

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 *   unit skeleton, convex, origin strictly inside
 * @returns {{ positions: Float64Array, faces: number[][], edges: number[][] }}
 */
export function dualSkeleton(skeleton) {
  const frames = faceFrames(skeleton);
  const pts = new Float64Array(frames.length * 3);
  for (let i = 0; i < frames.length; i++) {
    const { normal, inradius } = frames[i];
    if (!(inradius > 1e-12)) {
      throw new Error(`dual: face ${i} does not clear the origin`);
    }
    pts[i * 3] = normal[0] / inradius;
    pts[i * 3 + 1] = normal[1] / inradius;
    pts[i * 3 + 2] = normal[2] / inradius;
  }

  // Merge is always on: the dual's faces are polygons even when the parent
  // was an unmerged triangulation.
  const sk = hullToSkeleton(pts, {});

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
