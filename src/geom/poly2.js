/**
 * Pure 2D polygon helpers: centroid-scale inset and tangent-arc fillet.
 * Port of prototype/icosidodecahedron.py fillet_polygon (+ inset scale).
 */

/**
 * Scale a 2D polygon about the origin by (1 - borderFraction).
 * Matches the Python construction: corners *= (1 - border/apothem).
 * @param {Float64Array|number[][]} poly  Nx2 points about face centroid
 * @param {number} borderFraction  border / apothem in [0, 1)
 * @returns {Float64Array} flat [x0,y0,x1,y1,…] of length 2N
 */
export function insetScale(poly, borderFraction) {
  const flat = flatten(poly);
  const s = 1.0 - borderFraction;
  const out = new Float64Array(flat.length);
  for (let i = 0; i < flat.length; i++) out[i] = flat[i] * s;
  return out;
}

/**
 * Round every corner of a convex 2D polygon with a tangent circular arc.
 * Straight edge midpoints are preserved (border exact at mid-edge).
 * Radius is clamped to the largest value whose tangent points still fit.
 *
 * @param {Float64Array|number[][]} poly  Nx2 convex polygon
 * @param {number} radius  requested fillet radius
 * @param {number} [segments=64]  samples per corner arc (load-bearing for parity)
 * @returns {{ polyline: Float64Array, radius: number }}
 *   polyline is flat [x,y,…]; radius is the value actually applied
 */
/**
 * Largest tangent fillet radius that still fits a convex polygon's corners.
 * Shared by filletPolygon and metrics.limits (slider ceilings).
 * @param {Float64Array|number[][]} poly
 * @returns {number}
 */
export function filletRmax(poly) {
  const pts = toPairs(poly);
  const n = pts.length;
  if (n < 3) return 0;
  let rmax = Infinity;
  for (let k = 0; k < n; k++) {
    const prev = pts[(k + n - 1) % n];
    const cur = pts[k];
    const nxt = pts[(k + 1) % n];
    const d1x = prev[0] - cur[0], d1y = prev[1] - cur[1];
    const d2x = nxt[0] - cur[0], d2y = nxt[1] - cur[1];
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-12 || l2 < 1e-12) continue;
    const half = Math.acos(clamp((d1x * d2x + d1y * d2y) / (l1 * l2), -1, 1)) / 2.0;
    rmax = Math.min(rmax, 0.5 * Math.min(l1, l2) * Math.tan(half));
  }
  return Number.isFinite(rmax) ? rmax : 0;
}

export function filletPolygon(poly, radius, segments = 64) {
  const pts = toPairs(poly);
  const n = pts.length;
  if (radius <= 1e-9) {
    return { polyline: flatten(pts), radius: 0.0 };
  }

  const rmax = filletRmax(pts);
  const r = Math.min(radius, rmax * 0.999);

  const out = [];
  for (let k = 0; k < n; k++) {
    const prev = pts[(k + n - 1) % n];
    const cur = pts[k];
    const nxt = pts[(k + 1) % n];
    const l1 = Math.hypot(prev[0] - cur[0], prev[1] - cur[1]);
    const l2 = Math.hypot(nxt[0] - cur[0], nxt[1] - cur[1]);
    const d1x = (prev[0] - cur[0]) / l1, d1y = (prev[1] - cur[1]) / l1;
    const d2x = (nxt[0] - cur[0]) / l2, d2y = (nxt[1] - cur[1]) / l2;
    const half = Math.acos(clamp(d1x * d2x + d1y * d2y, -1, 1)) / 2.0;
    const bisLen = Math.hypot(d1x + d2x, d1y + d2y);
    const cx = cur[0] + ((d1x + d2x) / bisLen) * (r / Math.sin(half));
    const cy = cur[1] + ((d1y + d2y) / bisLen) * (r / Math.sin(half));
    const p1x = cur[0] + d1x * (r / Math.tan(half));
    const p1y = cur[1] + d1y * (r / Math.tan(half));
    const p2x = cur[0] + d2x * (r / Math.tan(half));
    const p2y = cur[1] + d2y * (r / Math.tan(half));
    // Python: atan2(*(p - centre)[::-1]) ≡ atan2(dy, dx) = standard atan2(y, x)
    const a1 = Math.atan2(p1y - cy, p1x - cx);
    const a2 = Math.atan2(p2y - cy, p2x - cx);
    const sweep = mod(a2 - a1 + Math.PI, 2 * Math.PI) - Math.PI;
    for (let s = 0; s <= segments; s++) {
      const a = a1 + sweep * (s / segments);
      out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
  }
  return { polyline: new Float64Array(out), radius: r };
}

function mod(a, m) {
  return ((a % m) + m) % m;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/** @returns {number[][]} */
function toPairs(poly) {
  if (Array.isArray(poly) && Array.isArray(poly[0])) return poly.map((p) => [p[0], p[1]]);
  const flat = poly;
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

/** @returns {Float64Array} */
function flatten(poly) {
  if (Array.isArray(poly) && Array.isArray(poly[0])) {
    const out = new Float64Array(poly.length * 2);
    for (let i = 0; i < poly.length; i++) {
      out[i * 2] = poly[i][0];
      out[i * 2 + 1] = poly[i][1];
    }
    return out;
  }
  return poly instanceof Float64Array ? poly : new Float64Array(poly);
}
