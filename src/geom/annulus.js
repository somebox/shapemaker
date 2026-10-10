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
 * Inward half-planes of a closed ring's edges, each moved in by `floor`:
 * a point x is inside when mx·x + my·y ≥ h for every edge. Edges shorter
 * than a micrometre-scale tolerance carry no direction and are skipped.
 * On a convex ring the half-planes cut out the ring inset by `floor`; on a
 * slightly non-convex one (Even-wall corners) they cut out a little less.
 *
 * @param {Float64Array|number[]} Bx  ring, either winding
 * @param {Float64Array|number[]} By
 * @param {number} [floor=0]
 * @returns {{ mx: number, my: number, h: number, edge: number }[]}
 */
export function ringHalfPlanes(Bx, By, floor = 0) {
  const m = Bx.length;
  let area2 = 0;
  let ref = 0;
  for (let k = 0; k < m; k++) {
    const k2 = (k + 1) % m;
    area2 += Bx[k] * By[k2] - Bx[k2] * By[k];
    ref = Math.max(ref, Math.abs(Bx[k]), Math.abs(By[k]));
  }
  const sgn = area2 >= 0 ? 1 : -1;
  const out = [];
  for (let e = 0; e < m; e++) {
    const e2 = (e + 1) % m;
    const ex = Bx[e2] - Bx[e], ey = By[e2] - By[e];
    const len = Math.hypot(ex, ey);
    if (!(len > 1e-9 * ref)) continue;
    // Left normal of a CCW edge points inward.
    const mx = (-ey * sgn) / len, my = (ex * sgn) / len;
    out.push({ mx, my, h: mx * Bx[e] + my * By[e] + floor, edge: e });
  }
  return out;
}

/**
 * Per edge of ring B, the smallest signed distance from ring P to that
 * edge's line (positive inside B). Skipped edges read Infinity, so indices
 * line up with B.
 *
 * @param {Float64Array|number[]} Bx
 * @param {Float64Array|number[]} By
 * @param {Float64Array|number[]} Px
 * @param {Float64Array|number[]} Py
 * @returns {Float64Array}
 */
export function edgeClearances(Bx, By, Px, Py) {
  const out = new Float64Array(Bx.length).fill(Infinity);
  for (const { mx, my, h, edge } of ringHalfPlanes(Bx, By)) {
    let d = Infinity;
    for (let k = 0; k < Px.length; k++) d = Math.min(d, mx * Px[k] + my * Py[k] - h);
    out[edge] = d;
  }
  return out;
}

/**
 * Inner rim of a straight opening. Straight down the face normal every
 * opening point keeps its face-frame position P_k; a point that would come
 * closer than `floor` to an edge of the inner face B instead moves back
 * along the ray from a centre `o` to that inset, so only the stretch near a
 * tight edge tilts and the rest of the wall stays straight.
 *
 * The result is the radial boundary of P ∩ inset(B) about `o`: with P
 * convex and `o` inside both, every Q_k lies on its own ray from `o` in
 * ring order, so the wall quads between P and Q never fold. `o` is the
 * frame origin (the face centroid, which every opening contains) when it
 * clears the inset, otherwise the centroid of P ∩ inset(B).
 *
 * @param {Float64Array|number[]} Bx  inner face boundary in the face frame
 * @param {Float64Array|number[]} By
 * @param {Float64Array|number[]} Px  opening ring (convex, contains 0,0)
 * @param {Float64Array|number[]} Py
 * @param {number} floor  inner flat to keep along every edge
 * @returns {{ Qx: Float64Array, Qy: Float64Array, ox: number, oy: number } | null}
 *   null when less than 5% of the opening's area fits the inset
 */
export function straightRing(Bx, By, Px, Py, floor) {
  const planes = ringHalfPlanes(Bx, By, floor);
  const n = Px.length;
  let ref = 0;
  for (let k = 0; k < n; k++) ref = Math.max(ref, Math.abs(Px[k]), Math.abs(Py[k]));
  const margin = 1e-6 * ref;

  let ox = 0, oy = 0;
  if (!planes.every((p) => -p.h > margin)) {
    // Clip the opening to the inset and take the centroid of what is left.
    let poly = [];
    for (let k = 0; k < n; k++) poly.push([Px[k], Py[k]]);
    for (const { mx, my, h } of planes) {
      const next = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ga = mx * a[0] + my * a[1] - h, gb = mx * b[0] + my * b[1] - h;
        if (ga >= 0) next.push(a);
        if ((ga >= 0) !== (gb >= 0)) {
          const t = ga / (ga - gb);
          next.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
      }
      poly = next;
      if (poly.length < 3) return null;
    }
    const full = polygonMoments(Px, Py);
    const cut = polygonMoments(poly.map((p) => p[0]), poly.map((p) => p[1]));
    if (!(Math.abs(cut.area) >= 0.05 * Math.abs(full.area))) return null;
    ox = cut.cx;
    oy = cut.cy;
  }

  const Qx = new Float64Array(n), Qy = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const dx = Px[k] - ox, dy = Py[k] - oy;
    let t = 1;
    for (const { mx, my, h } of planes) {
      const g0 = mx * ox + my * oy - h;
      const dv = mx * dx + my * dy;
      if (dv < 0) t = Math.min(t, g0 / -dv);
    }
    Qx[k] = ox + t * dx;
    Qy[k] = oy + t * dy;
  }
  return { Qx, Qy, ox, oy };
}

/**
 * Distance from (qx, qy) along the unit direction (tx, ty) to the edge of
 * ring B, for a point inside B. Infinity if no edge lies ahead.
 */
export function rayToRing(Bx, By, qx, qy, tx, ty) {
  let s = Infinity;
  for (const { mx, my, h } of ringHalfPlanes(Bx, By)) {
    const dv = mx * tx + my * ty;
    if (dv < 0) s = Math.min(s, (mx * qx + my * qy - h) / -dv);
  }
  return s;
}

/**
 * Triangulate the band between an outer ring A and an inner ring B that
 * are both star-shaped about (ox, oy), walking both by angle — the rings
 * need not have matching samples. Winding matches the index-matched quads
 * quadToTris(A[k+1], A[k], B[k], B[k+1]); on rings whose points share
 * rays the result is exactly those quads.
 *
 * @returns {number[] | null} triangle corners, A[i] as i and B[j] as
 *   A.length + j; null when a ring is not star-shaped about the centre or
 *   B is not strictly inside A along every ray through a vertex of either
 */
export function zipperBand(Ax, Ay, Bx, By, ox, oy) {
  const nA = Ax.length, nB = Bx.length;
  const steps = (X, Y) => {
    const out = new Float64Array(X.length);
    let total = 0;
    for (let i = 0; i < X.length; i++) {
      const i2 = (i + 1) % X.length;
      const ax = X[i] - ox, ay = Y[i] - oy, bx = X[i2] - ox, by = Y[i2] - oy;
      out[i] = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
      total += out[i];
    }
    return { out, total };
  };
  const sa = steps(Ax, Ay), sb = steps(Bx, By);
  const dir = sa.total >= 0 ? 1 : -1;
  for (const s of [sa, sb]) {
    if (!(Math.abs(s.total * dir - 2 * Math.PI) < 1e-6)) return null;
    for (const v of s.out) if (!(v * dir > 0)) return null;
  }
  // Two rings that are radial graphs about the centre cross only if a
  // vertex of one lies on the wrong side of the other along its own ray.
  for (let i = 0; i < nA; i++) {
    const dx = Ax[i] - ox, dy = Ay[i] - oy, r = Math.hypot(dx, dy);
    if (!(rayHit(Bx, By, ox, oy, dx / r, dy / r) < r)) return null;
  }
  for (let j = 0; j < nB; j++) {
    const dx = Bx[j] - ox, dy = By[j] - oy, r = Math.hypot(dx, dy);
    if (!(rayHit(Ax, Ay, ox, oy, dx / r, dy / r) > r)) return null;
  }
  // Start A at the point nearest B[0] in angle.
  const bx0 = Bx[0] - ox, by0 = By[0] - oy;
  let i0 = 0, a0 = Infinity;
  for (let i = 0; i < nA; i++) {
    const ax = Ax[i] - ox, ay = Ay[i] - oy;
    const phi = dir * Math.atan2(bx0 * ay - by0 * ax, bx0 * ax + by0 * ay);
    if (Math.abs(phi) < Math.abs(a0)) { a0 = phi; i0 = i; }
  }
  // Walk by angle, but never emit a triangle that turns over: when the
  // angular choice would fold (a fan from one point grazing a straight run
  // of the other ring), take the other step. Every triangle keeping its
  // orientation is what makes the band a true annulus with no overlap.
  let ref = 0;
  for (let i = 0; i < nA; i++) ref = Math.max(ref, Math.abs(Ax[i] - ox), Math.abs(Ay[i] - oy));
  const tol = 1e-9 * ref * ref;
  const X = (v) => (v < nA ? Ax[v] : Bx[v - nA]);
  const Y = (v) => (v < nA ? Ay[v] : By[v - nA]);
  const turnsOver = (p, q, r) =>
    !(-dir * ((X(q) - X(p)) * (Y(r) - Y(p)) - (X(r) - X(p)) * (Y(q) - Y(p))) > tol);
  const tris = [];
  let s = 0, t = 0;
  let a = a0, b = 0;
  while (s < nA || t < nB) {
    const i = (i0 + s) % nA, j = t % nB;
    const i1 = (i0 + s + 1) % nA, j1 = (t + 1) % nB;
    const aNext = a + dir * sa.out[i];
    const bNext = b + dir * sb.out[j];
    const okA = s < nA && !turnsOver(i1, i, nA + j);
    const okB = t < nB && !turnsOver(i, nA + j, nA + j1);
    if (!okA && !okB) return null;
    if (okA && (!okB || aNext <= bNext + 1e-12)) {
      tris.push(i1, i, nA + j);
      a = aNext;
      s++;
    } else {
      tris.push(i, nA + j, nA + j1);
      b = bNext;
      t++;
    }
  }
  return tris;
}

/** Nearest distance along (dx, dy) from (ox, oy) to the closed ring X, Y. */
function rayHit(X, Y, ox, oy, dx, dy) {
  let best = Infinity;
  for (let i = 0; i < X.length; i++) {
    const i2 = (i + 1) % X.length;
    const ex = X[i2] - X[i], ey = Y[i2] - Y[i];
    const den = dx * ey - dy * ex;
    if (den === 0) continue;
    const px = X[i] - ox, py = Y[i] - oy;
    const t = (px * ey - py * ex) / den;
    const u = (px * dy - py * dx) / den;
    // Rings sampled on shared rays put a vertex exactly on the ray; the
    // tolerance keeps both segments meeting there from missing it.
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

function polygonMoments(X, Y) {
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < X.length; i++) {
    const i2 = (i + 1) % X.length;
    const cr = X[i] * Y[i2] - X[i2] * Y[i];
    a2 += cr;
    cx += (X[i] + X[i2]) * cr;
    cy += (Y[i] + Y[i2]) * cr;
  }
  return { area: a2 / 2, cx: cx / (3 * a2), cy: cy / (3 * a2) };
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
