/**
 * Annulus construction: radial sample of a star-shaped opening, then quads → tris.
 * No Three.js, no schema — pure geometry.
 */

/**
 * Radius of a closed star-shaped polyline (about the origin) at each angle.
 * Exact ray/segment intersection — port of Python radial_sample.
 *
 * @param {Float64Array|number[][]} polyline  Nx2 polyline about origin,
 *   treated as closed via wraparound — may be explicitly closed
 *   (last point == first; the zero-length closing edge is skipped) or open
 *   (e.g. filletPolygon's radius-0 degenerate output)
 * @param {Float64Array|number[]} angles  ray angles in radians
 * @returns {Float64Array} radius along each ray
 */
export function radialSample(polyline, angles) {
  const P = toPairs(polyline);
  const n = P.length;
  const E = new Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    E[i] = [P[j][0] - P[i][0], P[j][1] - P[i][1]];
  }

  const out = new Float64Array(angles.length);
  for (let k = 0; k < angles.length; k++) {
    const th = angles[k];
    const dx = Math.cos(th), dy = Math.sin(th);
    let best = Infinity;
    let any = false;
    for (let i = 0; i < n; i++) {
      const Ex = E[i][0], Ey = E[i][1];
      const denom = dx * Ey - dy * Ex;
      if (Math.abs(denom) <= 1e-12) continue;
      const num = dy * P[i][0] - dx * P[i][1];
      const v = num / denom;
      if (v < -1e-9 || v > 1 + 1e-9) continue;
      const hx = P[i][0] + v * Ex;
      const hy = P[i][1] + v * Ey;
      const u = hx * dx + hy * dy;
      if (u > 1e-9 && u < best) {
        best = u;
        any = true;
      }
    }
    if (!any) {
      throw new Error("opening is not star-shaped about the face centroid");
    }
    out[k] = best;
  }
  return out;
}

/**
 * Emit two triangles for a planar quad (p0,p1,p2,p3) in CCW order when viewed
 * from outside. Returns 6 index values into a shared vertex buffer.
 *
 * @param {number} p0
 * @param {number} p1
 * @param {number} p2
 * @param {number} p3
 * @returns {number[]}
 */
export function quadToTris(p0, p1, p2, p3) {
  return [p0, p1, p2, p0, p2, p3];
}


/** Always copies — same contract as geom/poly2.toPairs (never alias input). */
function toPairs(poly) {
  if (Array.isArray(poly) && Array.isArray(poly[0])) {
    return poly.map((p) => [p[0], p[1]]);
  }
  const flat = poly;
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}
