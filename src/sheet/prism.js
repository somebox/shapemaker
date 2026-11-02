/**
 * Chamfered prism over a flat outline: a printed clip's solid, shared by the
 * print plates and the 3D assembly.
 */

import { area, offsetPolygon } from "./geom2.js";
import { triangulate as earcut } from "../../vendor/earcut/earcut.js";

/** Chamfer on a printed clip's faces, mm. */
export const chamferOf = (t) => Math.min(0.6, 0.2 * t);

/**
 * Triangles of a chamfered prism over a CCW outline, in local coordinates
 * [x, y, z] with z from 0 to t. Rings share vertices exactly, so the
 * result is closed.
 * @param {number[][]} outline
 * @returns {number[][][]}
 */
export function chamferedPrism(outline, t, e) {
  let P = outline;
  if (area(P) < 0) P = P.slice().reverse();
  // An edge shorter than the inset would turn inside out once inset: fold
  // it into its neighbour (a fraction of a millimetre off the outline).
  P = dropShortEdges(P, 2.5 * e);
  const inner = offsetPolygon(P, -e);
  const rings = [
    inner.map(([x, y]) => [x, y, 0]),
    P.map(([x, y]) => [x, y, e]),
    P.map(([x, y]) => [x, y, t - e]),
    inner.map(([x, y]) => [x, y, t]),
  ];
  const tris = [];
  const idx = earcut(inner.flat());
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    tris.push([rings[0][a], rings[0][c], rings[0][b]]);
    tris.push([rings[3][a], rings[3][b], rings[3][c]]);
  }
  const n = P.length;
  for (let r = 0; r < 3; r++) {
    const lo = rings[r], hi = rings[r + 1];
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      tris.push([lo[k], lo[k1], hi[k1]], [lo[k], hi[k1], hi[k]]);
    }
  }
  return tris;
}

/** Drop vertices until no edge of the polygon is shorter than `min`. */
function dropShortEdges(P, min) {
  const out = P.slice();
  for (let i = 0; i < out.length && out.length > 3; ) {
    const a = out[i], b = out[(i + 1) % out.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < min) out.splice((i + 1) % out.length, 1);
    else i++;
  }
  return out;
}
