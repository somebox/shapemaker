/**
 * Plain 2D helpers for sheet parts. Points are [x, y] pairs in millimetres;
 * polygons are arrays of points, counter-clockwise for outlines.
 */

export const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
export const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
export const mul = (p, s) => [p[0] * s, p[1] * s];
export const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
export const cross = (p, q) => p[0] * q[1] - p[1] * q[0];
export const len = (p) => Math.hypot(p[0], p[1]);
export const unit = (p) => mul(p, 1 / len(p));
/** Left normal; for a CCW outline it points into the polygon. */
export const leftNormal = (d) => [-d[1], d[0]];
export const lerp = (p, q, s) => [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s];

/** Signed area (positive for CCW). */
export function area(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += cross(poly[i], poly[(i + 1) % poly.length]);
  return a / 2;
}

export function centroid(poly) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], c = cross(p, q);
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
    a += c;
  }
  if (Math.abs(a) < 1e-12) return mul(poly.reduce(add, [0, 0]), 1 / poly.length);
  return [cx / (3 * a), cy / (3 * a)];
}

/** Intersection of lines p + s·d and q + u·e; null when parallel. */
export function lineX(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  return add(p, mul(d, cross(sub(q, p), e) / den));
}

/**
 * Move each edge of a CCW polygon inward by its own distance (negative
 * moves it out) and rebuild the corners from the moved lines. Edge i runs
 * from poly[i] to poly[i + 1].
 */
export function offsetEdges(poly, dist) {
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const d = unit(sub(poly[(i + 1) % n], p));
    return { p: add(p, mul(leftNormal(d), dist[i])), d };
  });
  return lines.map((l, i) => {
    const prev = lines[(i - 1 + n) % n];
    return lineX(prev.p, prev.d, l.p, l.d) ?? l.p;
  });
}

/** Grow a CCW outline by `k` (shrink when negative); miter corners. */
export function offsetPolygon(poly, k) {
  if (!k) return poly;
  return offsetEdges(poly, poly.map(() => -k));
}

/** Convex hull (monotone chain), CCW. */
export function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(sub(lower.at(-1), lower.at(-2)), sub(p, lower.at(-2))) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of pts.slice().reverse()) {
    while (upper.length >= 2 && cross(sub(upper.at(-1), upper.at(-2)), sub(p, upper.at(-2))) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Rotation that puts the convex hull's minimum-area bounding box axis
 * aligned, long side horizontal. Returns the angle in radians.
 */
export function minAreaAngle(points) {
  const h = convexHull(points);
  let best = { area: Infinity, angle: 0 };
  for (let i = 0; i < h.length; i++) {
    const d = sub(h[(i + 1) % h.length], h[i]);
    const a = -Math.atan2(d[1], d[0]);
    const r = points.map((p) => rotate(p, a));
    const b = bbox(r), w = b.maxX - b.minX, ht = b.maxY - b.minY;
    if (w * ht < best.area - 1e-9) best = { area: w * ht, angle: w >= ht ? a : a + Math.PI / 2 };
  }
  return best.angle;
}

export const rotate = (p, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
};

export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Do two convex polygons overlap by more than `eps`? Separating axis test;
 * polygons that only share an edge or touch do not count.
 */
export function convexOverlap(a, b, eps = 1e-3) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const n = leftNormal(unit(sub(poly[(i + 1) % poly.length], poly[i])));
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const p of a) { const v = dot(p, n); aMin = Math.min(aMin, v); aMax = Math.max(aMax, v); }
      for (const p of b) { const v = dot(p, n); bMin = Math.min(bMin, v); bMax = Math.max(bMax, v); }
      if (aMax <= bMin + eps || bMax <= aMin + eps) return false;
    }
  }
  return true;
}

/** Shortest distance from point p to segment ab. */
export function pointSegDist(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return len(sub(p, add(a, mul(ab, t))));
}

/** Rigid transform {a, t}: rotate by a, then translate by t. */
export const apply = (tf, p) => add(rotate(p, tf.a), tf.t);

/** The rigid transform that maps segment (p0, p1) onto (q0, q1). */
export function alignSegment(p0, p1, q0, q1) {
  const a = Math.atan2(q1[1] - q0[1], q1[0] - q0[0]) - Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  return { a, t: sub(q0, rotate(p0, a)) };
}

/** Rectangle on segment a→b from along-distance s0..s1, inward depth d0..d1. */
export function edgeRect(a, b, s0, s1, d0, d1) {
  const u = unit(sub(b, a)), m = leftNormal(u);
  const at = (s, d) => add(add(a, mul(u, s)), mul(m, d));
  return [at(s0, d0), at(s1, d0), at(s1, d1), at(s0, d1)];
}

/**
 * Round the corners of a polygon: radii[i] is the fillet radius at vertex
 * i (0 keeps it sharp). Each fillet shrinks until its tangent points fit
 * on the two edges; an edge between two fillets is shared in proportion
 * to what each asks for. Arcs are split into steps of at most `stepDeg`.
 */
export function filletCorners(poly, radii, stepDeg = 12) {
  const n = poly.length;
  const at = (i) => poly[(i + n) % n];
  const rOf = (i) => radii[(i + n) % n] ?? 0;
  // Half the turn at each vertex, and the tangent length its radius asks for.
  const half = poly.map((P, i) => {
    const u1 = unit(sub(at(i - 1), P)), u2 = unit(sub(at(i + 1), P));
    return Math.acos(Math.max(-1, Math.min(1, dot(u1, u2)))) / 2;
  });
  const usable = (i) => rOf(i) > 0 && half[(i + n) % n] > 1e-3 && half[(i + n) % n] < Math.PI / 2 - 1e-3;
  const want = (i) => (usable(i) ? rOf(i) / Math.tan(half[(i + n) % n]) : 0);
  // Share of the edge from i to j that vertex i may use.
  // A fillet may run right up to a sharp neighbour: a stub shorter than a
  // later inset would turn inside out.
  const share = (i, j) => (usable(j) ? want(i) / (want(i) + want(j)) : 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const P = poly[i];
    if (!usable(i)) {
      out.push(P);
      continue;
    }
    const prev = at(i - 1), next = at(i + 1);
    const u1 = unit(sub(prev, P)), u2 = unit(sub(next, P));
    const tLen = Math.min(want(i), len(sub(prev, P)) * share(i, i - 1), len(sub(next, P)) * share(i, i + 1));
    const r = tLen * Math.tan(half[i]);
    const C = add(P, mul(unit(add(u1, u2)), r / Math.sin(half[i])));
    const T1 = add(P, mul(u1, tLen)), T2 = add(P, mul(u2, tLen));
    const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    let sweep = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1;
    // The arc turns the short way round, through the side away from P.
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ((stepDeg * Math.PI) / 180)));
    for (let k = 0; k <= steps; k++) {
      const a = a1 + (sweep * k) / steps;
      out.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]);
    }
  }
  // Two fillets that meet mid-edge share a tangent point: keep one.
  return out.filter((p, i) => len(sub(p, out[(i + 1) % out.length])) > 1e-6);
}
