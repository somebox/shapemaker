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

/** An edge is "micro" when shorter than this fraction of the longest edge. */
const MICRO_EDGE_RATIO = 0.5;

/**
 * Collapse short edges — well under the face's longest edge — to their
 * midpoint, repeatedly, worst first. Plane-perturbation jitter splits
 * high-valence vertices into micro edges (valence 5 splits into *chains* of
 * them); left in, a single micro edge clamps the face's whole fillet to
 * roughly 1.5× its own length, so the fillet visibly vanishes at the first
 * jitter step. Rounding across the collapsed corner restores the intended
 * arc. Only the 2D opening path uses this — the 3D skeleton keeps its exact
 * planar faces and outer boundary.
 *
 * The ratio rule is scale-free and a no-op on clean polygons (all edges
 * comparable; triangles are never touched). By the time a split edge
 * outgrows the ratio, its own corner clamp already allows radii beyond
 * typical requests, so the handoff between swallowed and kept is not
 * visible in practice.
 *
 * @param {Float64Array|number[][]} poly  Nx2 convex polygon
 * @returns {number[][]} pair list (new arrays; input untouched)
 */
export function collapseMicroEdges(poly) {
  let pts = toPairs(poly).map((p) => [p[0], p[1]]);
  while (pts.length > 3) {
    const n = pts.length;
    const len = new Array(n);
    let longest = 0;
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      len[k] = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len[k] > longest) longest = len[k];
    }
    if (!(longest > 0)) break;
    let worst = -1;
    let worstRatio = MICRO_EDGE_RATIO;
    for (let k = 0; k < n; k++) {
      const ratio = len[k] / longest;
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worst = k;
      }
    }
    if (worst < 0) break;
    const a = pts[worst], b = pts[(worst + 1) % n];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (worst + 1 === n) {
      pts = pts.slice(1, worst);
      pts.push(mid);
    } else {
      pts.splice(worst, 2, mid);
    }
  }
  return pts;
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
  if (radius <= 1e-9) {
    return { polyline: flatten(toPairs(poly)), radius: 0.0 };
  }
  // Micro edges (vertex-split jitter) must not clamp the whole face's
  // radius; the arc rounds across the virtual corner instead.
  const pts = collapseMicroEdges(poly);
  const n = pts.length;

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
