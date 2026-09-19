/**
 * Pure 2D: the largest inscribed ellipse that shares a convex polygon's
 * second-moment shape, centred on the polygon's area centroid (the origin
 * of a face frame).
 *
 * The construction is affine-invariant, so it lands on the classical
 * answers: the incircle of a regular polygon, the Steiner inellipse of a
 * triangle, and the midpoint-tangent ellipse of a parallelogram. In all
 * three the ellipse touches every edge at its midpoint, which is what lets
 * neighbouring faces' ovals meet across a shared edge.
 *
 * On other polygons the ellipse touches its binding edge(s) only; it always
 * lies inside the polygon, so a centroid scale of it lies inside the same
 * scale of the polygon.
 */

/**
 * @param {Float64Array|number[]} corners  flat [x0,y0,…] convex polygon
 *   about its area centroid, either winding
 * @returns {{ l11: number, l21: number, l22: number, k: number } | null}
 *   points of the ellipse are k·L·(cos t, sin t) with L = [[l11,0],[l21,l22]];
 *   null when the polygon is degenerate
 */
export function inscribedMomentEllipse(corners) {
  const n = corners.length / 2;
  if (n < 3) return null;
  let A2 = 0, Ixx = 0, Iyy = 0, Ixy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = corners[i * 2], y0 = corners[i * 2 + 1];
    const x1 = corners[j * 2], y1 = corners[j * 2 + 1];
    const cr = x0 * y1 - x1 * y0;
    A2 += cr;
    Ixx += (x0 * x0 + x0 * x1 + x1 * x1) * cr;
    Iyy += (y0 * y0 + y0 * y1 + y1 * y1) * cr;
    Ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * cr;
  }
  if (!(Math.abs(A2) > 0)) return null;
  const sign = A2 < 0 ? -1 : 1;
  const A = A2 / 2;
  // Covariance about the origin (= area centroid); signs cancel in the ratio.
  const Sxx = Ixx / 12 / A, Syy = Iyy / 12 / A, Sxy = Ixy / 24 / A;
  if (!(Sxx > 0)) return null;
  const l11 = Math.sqrt(Sxx);
  const l21 = Sxy / l11;
  const rem = Syy - l21 * l21;
  if (!(rem > 0)) return null;
  const l22 = Math.sqrt(rem);

  // Support of the unit-k ellipse along an edge normal n is √(nᵀ S n);
  // the largest k keeps that inside every edge line.
  let k = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = corners[i * 2], y0 = corners[i * 2 + 1];
    const ex = corners[j * 2] - x0, ey = corners[j * 2 + 1] - y0;
    const len = Math.hypot(ex, ey);
    if (!(len > 0)) continue;
    const nx = (sign * ey) / len, ny = (-sign * ex) / len; // outward
    const d = nx * x0 + ny * y0;
    const s = Math.sqrt(nx * nx * Sxx + 2 * nx * ny * Sxy + ny * ny * Syy);
    if (s > 0) k = Math.min(k, d / s);
  }
  if (!(k > 0 && Number.isFinite(k))) return null;
  return { l11, l21, l22, k };
}

/**
 * Closed-by-wraparound polyline of the ellipse at `scale` × its inscribed
 * size, counter-clockwise from parameter 0.
 * @param {{ l11: number, l21: number, l22: number, k: number }} e
 * @param {number} scale
 * @param {number} segments  ≥ 8
 * @returns {Float64Array} flat [x0,y0,…]
 */
export function ellipsePolyline(e, scale, segments) {
  const N = Math.max(8, Math.floor(segments));
  const s = e.k * scale;
  const out = new Float64Array(N * 2);
  for (let t = 0; t < N; t++) {
    const a = (2 * Math.PI * t) / N;
    const c = Math.cos(a), sn = Math.sin(a);
    out[t * 2] = s * e.l11 * c;
    out[t * 2 + 1] = s * (e.l21 * c + e.l22 * sn);
  }
  return out;
}
