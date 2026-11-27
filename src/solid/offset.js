/**
 * Even-wall inner shell: every face plane moves inward along its own
 * normal by the wall, instead of the whole surface scaling about the
 * origin. Faces near the centre no longer pin the wall for the rest of
 * the shape, and spike flanks get the same thickness as everything else.
 *
 * Displacements are linear in the wall, so they are computed once for a
 * 1 mm wall (`dHat`) and scaled. Each corner moves to where no incident
 * face plane is closer than the wall and the excess is least
 * ({@link fitCorner}): exact where the offset planes meet in one point
 * (every three-valent corner, every regular solid), slightly thick where
 * four or more planes meet without a common point.
 */

import { edgeList } from "../skeleton.js";

/**
 * Per-corner inward displacement for a 1 mm wall.
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {{ normal: number[] }[]} frames
 * @param {number[]} [asOne]  faces whose corners all move as one
 *   (see {@link cornerOffsetsForWall})
 * @returns {Float64Array} xyz per skeleton vertex
 */
export function cornerOffsets(skeleton, frames, asOne = []) {
  return fitOffsets(skeleton, frames, asOne).dHat;
}

/** Share of the wall a corner cluster must keep from every plane it touches. */
const RIGID_WALL_KEPT = 0.999;

/**
 * {@link cornerOffsets}, and the `asOne` faces that have no single move: a
 * sliver that runs from one face to another facing it (a strip planed off
 * the whole length of an edge) is asked for opposite moves by its two ends,
 * and the nearest fit leaves no wall at them.
 * @param {Float64Array} [plain]  the offsets without `asOne`, if at hand:
 *   corners no as-one face reaches keep them, and are not fitted again
 * @returns {{ dHat: Float64Array, misfits: number[] }}
 */
function fitOffsets(skeleton, frames, asOne, plain = null) {
  const P = skeleton.positions;
  const n = P.length / 3;
  // Corners joined by a very short edge (Distort's vertex splits, the tiny
  // triangles of a light Truncate) move as one: an exact offset would fold
  // that edge within a fraction of a millimetre of wall.
  let minInradius = Infinity;
  for (const fr of frames) minInradius = Math.min(minInradius, fr.inradius);
  const shortLen = 0.05 * minInradius;
  const root = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (root[i] !== i) i = root[i] = root[root[i]];
    return i;
  };
  for (const [a, c] of skeleton.edges ?? edgeList(skeleton.faces)) {
    const len = Math.hypot(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]);
    if (len < shortLen) root[find(a)] = find(c);
  }
  for (const f of asOne) {
    const ring = skeleton.faces[f];
    for (let k = 1; k < ring.length; k++) root[find(ring[k])] = find(ring[0]);
  }

  /** Inward unit normals per cluster root, coplanar duplicates dropped. */
  const inward = new Map();
  for (let f = 0; f < skeleton.faces.length; f++) {
    const [nx, ny, nz] = frames[f].normal;
    for (const corner of skeleton.faces[f]) {
      const v = find(corner);
      let list = inward.get(v);
      if (!list) inward.set(v, (list = []));
      if (!list.some((a) => a[0] * -nx + a[1] * -ny + a[2] * -nz > 1 - 1e-9)) {
        list.push([-nx, -ny, -nz]);
      }
    }
  }
  const out = new Float64Array(n * 3);
  /** Clusters an as-one face is part of. */
  const merged = new Set(asOne.map((f) => find(skeleton.faces[f][0])));
  /** Those of them some plane ends up closer to than the wall. */
  const short = new Set();
  for (const [v, list] of inward) {
    if (plain && !merged.has(v)) {
      // Same corners and planes as without the as-one faces: same fit.
      out[v * 3] = plain[v * 3]; out[v * 3 + 1] = plain[v * 3 + 1]; out[v * 3 + 2] = plain[v * 3 + 2];
      continue;
    }
    const d = fitCorner(list);
    out[v * 3] = d[0]; out[v * 3 + 1] = d[1]; out[v * 3 + 2] = d[2];
    if (merged.has(v) &&
      list.some((a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2] < RIGID_WALL_KEPT)) short.add(v);
  }
  for (let v = 0; v < n; v++) {
    const r = find(v);
    if (r === v) continue;
    out[v * 3] = out[r * 3]; out[v * 3 + 1] = out[r * 3 + 1]; out[v * 3 + 2] = out[r * 3 + 2];
  }
  const misfits = asOne.filter((f) => short.has(find(skeleton.faces[f][0])));
  return { dHat: out, misfits };
}

/** A face must keep this share of its width on the inner surface. */
const FACE_WIDTH_KEPT = 0.1;

/**
 * Corner displacements for one wall thickness (still per millimetre of it).
 * The edge limit below keeps every inner edge pointing its own way, but a
 * sliver face between two long edges can still turn inside out: the planes
 * either side of it close over it within a fraction of a millimetre, and
 * its inner copy flips while each of its edges keeps its direction. Where
 * the wall would leave a narrow face less than a tenth of its width, the
 * face's corners move as one instead, as the ends of a very short edge do:
 * the inner face keeps its outer shape and the wall beside it is a little
 * thicker than asked. A face with no such move (see {@link fitOffsets})
 * keeps its corners' own moves, and {@link offsetFaceLimit} refuses the
 * wall that turns it inside out.
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {{ origin: number[], u: number[], w: number[], normal: number[], edgeDist: number[] }[]} frames
 * @param {number} wallMm
 * @param {Float64Array} [plain]  `cornerOffsets(skeleton, frames)`, if at hand
 * @param {Map<string, object>} [fits]  fits already made for this skeleton,
 *   kept between calls that try many walls (see {@link evenWallCeiling})
 * @returns {Float64Array} xyz per skeleton vertex; `plain` itself when no
 *   face needs it
 */
export function cornerOffsetsForWall(
  skeleton, frames, wallMm, plain = cornerOffsets(skeleton, frames), fits = null,
) {
  // The same faces move as one over a range of walls: fit each set once.
  const fitFor = (faces) => {
    if (!fits) return fitOffsets(skeleton, frames, faces, plain);
    const key = faces.join(",");
    let fit = fits.get(key);
    if (!fit) fits.set(key, (fit = fitOffsets(skeleton, frames, faces, plain)));
    return fit;
  };
  let dHat = plain;
  const asOne = [];
  /** Thin faces with no single move; their corners keep their own. */
  const loose = new Set();
  for (let pass = 0; pass < 4; pass++) {
    const thin = thinnedFaces(skeleton, frames, dHat, wallMm)
      .filter((f) => !asOne.includes(f) && !loose.has(f));
    if (thin.length === 0) break;
    asOne.push(...thin);
    for (;;) {
      const fit = fitFor(asOne);
      dHat = fit.dHat;
      if (fit.misfits.length === 0) break;
      for (const f of fit.misfits) {
        loose.add(f);
        asOne.splice(asOne.indexOf(f), 1);
      }
      if (asOne.length === 0) {
        dHat = plain;
        break;
      }
    }
  }
  return dHat;
}

/**
 * Width under which a face counts as narrow: the measure that makes an
 * edge short (see `cornerOffsets`).
 */
function narrowBelow(frames) {
  let minInradius = Infinity;
  for (const fr of frames) minInradius = Math.min(minInradius, fr.inradius);
  return 0.05 * minInradius;
}

/**
 * Narrow faces whose inner copy keeps less than a tenth of their width
 * somewhere. Exported for tests.
 */
export function thinnedFaces(skeleton, frames, dHat, wallMm) {
  const P = skeleton.positions;
  const thinMm = narrowBelow(frames);
  const out = [];
  for (let f = 0; f < skeleton.faces.length; f++) {
    const ring = skeleton.faces[f];
    const { origin, u, w, edgeDist, edgeDistMin } = frames[f];
    // Only a narrow face moves as one: a wide one would drag its
    // neighbours' corners far from where their own planes put them.
    if (!(2 * edgeDistMin < thinMm)) continue;
    const n = ring.length;
    const outer = new Float64Array(n * 2), inner = new Float64Array(n * 2);
    for (let k = 0; k < n; k++) {
      const v = ring[k];
      const dx = P[v * 3] - origin[0], dy = P[v * 3 + 1] - origin[1], dz = P[v * 3 + 2] - origin[2];
      const ex = wallMm * dHat[v * 3], ey = wallMm * dHat[v * 3 + 1], ez = wallMm * dHat[v * 3 + 2];
      outer[k * 2] = dx * u[0] + dy * u[1] + dz * u[2];
      outer[k * 2 + 1] = dx * w[0] + dy * w[1] + dz * w[2];
      inner[k * 2] = outer[k * 2] + ex * u[0] + ey * u[1] + ez * u[2];
      inner[k * 2 + 1] = outer[k * 2 + 1] + ex * w[0] + ey * w[1] + ez * w[2];
    }
    // Where the centroid lands on the inner face, and which way the ring runs.
    const wgt = meanValueWeights(outer, 0, 0);
    let mx = 0, my = 0, area2 = 0;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      mx += wgt[k] * inner[k * 2];
      my += wgt[k] * inner[k * 2 + 1];
      area2 += outer[k * 2] * outer[k2 * 2 + 1] - outer[k2 * 2] * outer[k * 2 + 1];
    }
    const turn = area2 < 0 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const ax = inner[k * 2], ay = inner[k * 2 + 1];
      const bx = inner[k2 * 2] - ax, by = inner[k2 * 2 + 1] - ay;
      const len = Math.hypot(bx, by);
      const dist = len > 0 ? (turn * (bx * (my - ay) - by * (mx - ax))) / len : 0;
      if (dist < FACE_WIDTH_KEPT * edgeDist[k]) {
        out.push(f);
        break;
      }
    }
  }
  return out;
}

/**
 * Largest wall before an inner edge folds: each skeleton edge must keep at
 * least 10% of its length, pointing the same way, on the inner surface.
 * Edges shrink linearly with the wall, so the limit is closed form.
 * @param {{ positions: Float64Array, faces: number[][], edges?: number[][] }} skeleton
 * @param {Float64Array} dHat
 * @returns {number} wall limit in mm (Infinity if nothing shrinks)
 */
export function offsetWallLimit(skeleton, dHat) {
  const P = skeleton.positions;
  let limit = Infinity;
  for (const [a, c] of skeleton.edges ?? edgeList(skeleton.faces)) {
    const ex = P[c * 3] - P[a * 3], ey = P[c * 3 + 1] - P[a * 3 + 1], ez = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = dHat[c * 3] - dHat[a * 3];
    const fy = dHat[c * 3 + 1] - dHat[a * 3 + 1];
    const fz = dHat[c * 3 + 2] - dHat[a * 3 + 2];
    const shrink = -(ex * fx + ey * fy + ez * fz);
    if (shrink > 0) limit = Math.min(limit, (0.9 * (ex * ex + ey * ey + ez * ez)) / shrink);
  }
  return limit;
}

/** A face must keep this share of its area on the inner surface. */
const FACE_AREA_KEPT = 0.01;

/**
 * Largest wall before a face turns inside out on the inner surface. The
 * edge limit keeps every inner edge pointing its own way, but a small face
 * between steep neighbours (a triangle Truncate leaves) can still flip:
 * each of its edges turns by less than a right angle while the ring they
 * form reverses. Seen along its own normal, each face must keep 1% of its
 * area: a tenth of its size each way, as each edge keeps a tenth of its
 * length. (A face that shrinks evenly reaches both limits at the same
 * wall.) That area is quadratic in the wall, so the limit is closed form.
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {{ origin: number[], u: number[], w: number[], edgeDistMin: number, inradius: number }[]} frames
 * @param {Float64Array} dHat
 * @param {{ skipNarrow?: boolean }} [opts]  leave out the narrow faces that
 *   {@link cornerOffsetsForWall} moves as one once the wall is known
 * @returns {{ limit: number, face: number }} wall limit in mm (Infinity if
 *   no face shrinks that far) and the face that sets it (-1 if none)
 */
export function offsetFaceLimit(skeleton, frames, dHat, { skipNarrow = false } = {}) {
  const P = skeleton.positions;
  const thinMm = skipNarrow ? narrowBelow(frames) : 0;
  let limit = Infinity, face = -1;
  for (let f = 0; f < skeleton.faces.length; f++) {
    const ring = skeleton.faces[f];
    const { origin, u, w, edgeDistMin } = frames[f];
    if (skipNarrow && 2 * edgeDistMin < thinMm) continue;
    const n = ring.length;
    // Corners and their per-millimetre moves in the face plane.
    const p = new Float64Array(n * 2), d = new Float64Array(n * 2);
    for (let k = 0; k < n; k++) {
      const v = ring[k];
      const x = P[v * 3] - origin[0], y = P[v * 3 + 1] - origin[1], z = P[v * 3 + 2] - origin[2];
      const ex = dHat[v * 3], ey = dHat[v * 3 + 1], ez = dHat[v * 3 + 2];
      p[k * 2] = x * u[0] + y * u[1] + z * u[2];
      p[k * 2 + 1] = x * w[0] + y * w[1] + z * w[2];
      d[k * 2] = ex * u[0] + ey * u[1] + ez * u[2];
      d[k * 2 + 1] = ex * w[0] + ey * w[1] + ez * w[2];
    }
    // Twice the signed area at wall t: a0 + a1 t + a2 t².
    let a0 = 0, a1 = 0, a2 = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      a0 += p[k * 2] * p[j * 2 + 1] - p[j * 2] * p[k * 2 + 1];
      a1 += p[k * 2] * d[j * 2 + 1] - d[j * 2] * p[k * 2 + 1]
        + d[k * 2] * p[j * 2 + 1] - p[j * 2] * d[k * 2 + 1];
      a2 += d[k * 2] * d[j * 2 + 1] - d[j * 2] * d[k * 2 + 1];
    }
    if (a0 < 0) { a0 = -a0; a1 = -a1; a2 = -a2; }
    if (!(a0 > 0)) continue;
    const t = firstRoot(a2, a1, (1 - FACE_AREA_KEPT) * a0);
    if (t < limit) { limit = t; face = f; }
  }
  return { limit, face };
}

/**
 * The offsets an Even-wall shell is built with at one wall, and whether
 * that wall holds: no inner edge folds, before or after sliver faces move
 * as one, and no face turns inside out.
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {object[]} frames
 * @param {number} wallMm
 * @param {Float64Array} [plain]  `cornerOffsets(skeleton, frames)`, if at hand
 * @param {{ fits: Map, edge: Map, flip: Map }} [seen]  what earlier calls
 *   for this skeleton worked out (see {@link evenWallCeiling})
 * @returns {{ ok: boolean, dHat: Float64Array, limit: number, cause: 'edge'|'face'|null, face: number }}
 *   `limit` is the wall these offsets hold below; when the wall is refused,
 *   `cause` says which limit refused it and `face` the face that flips
 */
export function evenWallFit(
  skeleton, frames, wallMm, plain = cornerOffsets(skeleton, frames), seen = null,
) {
  const kept = (map, d, make) => {
    if (!map) return make();
    if (!map.has(d)) map.set(d, make());
    return map.get(d);
  };
  const edgeOf = (d) => kept(seen?.edge, d, () => offsetWallLimit(skeleton, d));
  let limit = edgeOf(plain);
  if (wallMm >= limit) return { ok: false, dHat: plain, limit, cause: "edge", face: -1 };
  // Sliver faces this wall would turn inside out move as one piece.
  const dHat = cornerOffsetsForWall(skeleton, frames, wallMm, plain, seen?.fits);
  if (dHat !== plain) {
    limit = edgeOf(dHat);
    if (wallMm >= limit) return { ok: false, dHat, limit, cause: "edge", face: -1 };
  }
  // A face that is not narrow can still turn inside out on the inner
  // surface while its edges keep their direction. No rounding fits that.
  const flip = kept(seen?.flip, dHat, () => offsetFaceLimit(skeleton, frames, dHat));
  if (wallMm >= flip.limit) {
    return { ok: false, dHat, limit: flip.limit, cause: "face", face: flip.face };
  }
  return { ok: true, dHat, limit: Math.min(limit, flip.limit), cause: null, face: -1 };
}

/**
 * The thickest Even wall on offer: 90% of the wall at which the builder
 * first refuses ({@link evenWallFit}). For most shapes that is the edge or
 * face limit of the plain offsets. Where sliver faces move as one above
 * some wall, the offsets, and so the limits, change with the wall, and the
 * first refusal is searched for from below, a few more slivers at a time:
 * far above it dozens of faces can move as one, and fitting those is slow.
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {object[]} frames
 * @param {Float64Array} [plain]  `cornerOffsets(skeleton, frames)`, if at hand
 * @param {number} [under]  only walls below this one (a wall just refused)
 * @returns {number} wall in mm
 */
export function evenWallCeiling(skeleton, frames, plain = cornerOffsets(skeleton, frames), under = Infinity) {
  const edge = offsetWallLimit(skeleton, plain);
  const flip = offsetFaceLimit(skeleton, frames, plain, { skipNarrow: true }).limit;
  // A face that shrinks evenly reaches both limits at the same wall; the
  // edge figure stands there.
  const top = Math.min(under, flip < edge * (1 - 1e-9) ? flip : edge);
  if (!Number.isFinite(top)) return top;
  // The search tries many walls; most share their offsets and limits.
  const seen = { fits: new Map(), edge: new Map([[plain, edge]]), flip: new Map() };
  const holds = (w) => evenWallFit(skeleton, frames, w, plain, seen).ok;
  /** Slivers the plain offsets leave thin at a wall: more as it grows. */
  const thinAt = (w) => thinnedFaces(skeleton, frames, plain, w).length;
  /** The thickest wall from `lo` to `hi` with at most `count` of them. */
  const thickestWith = (count, lo, hi) => {
    if (thinAt(hi) <= count) return hi;
    for (let step = 0; step < 12; step++) {
      const mid = 0.5 * (lo + hi);
      if (thinAt(mid) <= count) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  let wall = 0.9 * top;
  // Few or no slivers in play: one check settles it for most shapes.
  if (thinAt(wall) <= CEILING_SLIVER_STEP && holds(wall)) return wall;
  for (let round = 0; round < 4; round++) {
    // Where no face is thin yet, the plain offsets and their limits stand.
    let lo = Math.min(
      thickestWith(0, 0, wall), 0.999 * edge,
      0.999 * offsetFaceLimit(skeleton, frames, plain).limit,
    );
    let hi = wall;
    for (let count = CEILING_SLIVER_STEP; lo < wall; count += CEILING_SLIVER_STEP) {
      const w = thickestWith(count, lo, wall);
      if (!(w > lo)) continue;
      if (!holds(w)) {
        hi = w;
        break;
      }
      if (w === wall) return wall;
      lo = w;
    }
    for (let step = 0; step < 10 && hi - lo > 1e-3 * hi; step++) {
      const mid = 0.5 * (lo + hi);
      if (holds(mid)) lo = mid;
      else hi = mid;
    }
    wall = 0.9 * lo;
    if (holds(wall)) return wall;
  }
  return wall;
}

/** How many more slivers each step of the wall search takes on. */
const CEILING_SLIVER_STEP = 4;

/** Smallest positive root of a·t² + b·t + c for c > 0, or Infinity. */
function firstRoot(a, b, c) {
  if (a === 0) return b < 0 ? -c / b : Infinity;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(disc));
  let t = Infinity;
  for (const r of [q / a, q !== 0 ? c / q : Infinity]) if (r > 0 && r < t) t = r;
  return t;
}

/**
 * Mean value coordinates of (x, y) in a convex polygon — smooth inside,
 * linear along each edge, so interpolated values agree with the edge
 * interpolation the neighbouring face uses.
 * @param {Float64Array|number[]} poly  flat xy
 * @param {number} x
 * @param {number} y
 * @returns {Float64Array} one weight per vertex, summing to 1
 */
export function meanValueWeights(poly, x, y) {
  const n = poly.length / 2;
  const w = new Float64Array(n);
  const sx = new Float64Array(n), sy = new Float64Array(n), r = new Float64Array(n);
  let scale = 0;
  for (let i = 0; i < n; i++) {
    sx[i] = poly[i * 2] - x;
    sy[i] = poly[i * 2 + 1] - y;
    r[i] = Math.hypot(sx[i], sy[i]);
    scale = Math.max(scale, r[i]);
  }
  const eps = 1e-12 * (scale || 1);
  for (let i = 0; i < n; i++) {
    if (r[i] <= eps) {
      w[i] = 1;
      return w;
    }
  }
  const tanHalf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cr = sx[i] * sy[j] - sx[j] * sy[i];
    const dt = sx[i] * sx[j] + sy[i] * sy[j];
    if (Math.abs(cr) <= eps * (r[i] + r[j]) && dt < 0) {
      // On edge i → j: linear interpolation along it.
      const t = r[i] / (r[i] + r[j]);
      w[i] = 1 - t;
      w[j] = t;
      return w;
    }
    tanHalf[i] = (r[i] * r[j] - dt) / cr;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    w[i] = (tanHalf[(i - 1 + n) % n] + tanHalf[i]) / r[i];
    sum += w[i];
  }
  for (let i = 0; i < n; i++) w[i] /= sum;
  return w;
}

/**
 * Wall actually produced at the corners: each corner's displacement
 * measured along every incident face normal, for a 1 mm wall.
 * @param {{ faces: number[][] }} skeleton
 * @param {{ normal: number[] }[]} frames
 * @param {Float64Array} dHat
 * @returns {{ min: number, max: number }}
 */
export function offsetWallRange(skeleton, frames, dHat) {
  let min = Infinity, max = -Infinity;
  for (let f = 0; f < skeleton.faces.length; f++) {
    const [nx, ny, nz] = frames[f].normal;
    for (const v of skeleton.faces[f]) {
      const t = -(dHat[v * 3] * nx + dHat[v * 3 + 1] * ny + dHat[v * 3 + 2] * nz);
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  return { min, max };
}

/**
 * Displacement δ with a·δ ≥ 1 for every inward normal a (no plane closer
 * than the wall) and Σ(a·δ − 1)² least (no thicker than it must be). In 3D
 * the optimum sits on at most three active planes, so each candidate active
 * set is solved exactly and the best feasible one wins.
 * @param {number[][]} normals  inward unit normals
 * @returns {number[]}
 */
export function fitCorner(normals) {
  if (normals.length === 1) return [...normals[0]];
  // Normals spanning less than 3D (a crease) leave a free direction; a
  // tiny ridge on |δ|² then picks the shortest move.
  return fitWithRidge(normals, 0) ?? fitWithRidge(normals, 1e-9) ?? [0, 0, 0];
}

function fitWithRidge(normals, RIDGE) {
  const k = normals.length;
  const H = [[RIDGE, 0, 0], [0, RIDGE, 0], [0, 0, RIDGE]];
  const g = [0, 0, 0];
  for (const a of normals) {
    for (let i = 0; i < 3; i++) {
      g[i] += a[i];
      for (let j = 0; j < 3; j++) H[i][j] += a[i] * a[j];
    }
  }
  const cost = (d) => {
    let c = RIDGE * (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    for (const a of normals) {
      const r = a[0] * d[0] + a[1] * d[1] + a[2] * d[2] - 1;
      c += r * r;
    }
    return c;
  };
  const feasible = (d) =>
    normals.every((a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2] >= 1 - 1e-9);

  const free = solveLinear(H.map((row, i) => [...row, g[i]]));
  if (free && feasible(free)) return free;

  let best = null, bestCost = Infinity;
  const tryActive = (S) => {
    // KKT: H δ + Σ μ_s a_s = g,  a_s · δ = 1.
    const m = 3 + S.length;
    const rows = [];
    for (let i = 0; i < 3; i++) {
      const row = new Array(m + 1).fill(0);
      for (let j = 0; j < 3; j++) row[j] = H[i][j];
      S.forEach((s, q) => { row[3 + q] = normals[s][i]; });
      row[m] = g[i];
      rows.push(row);
    }
    for (const s of S) {
      const row = new Array(m + 1).fill(0);
      for (let j = 0; j < 3; j++) row[j] = normals[s][j];
      row[m] = 1;
      rows.push(row);
    }
    const x = solveLinear(rows);
    if (!x) return;
    const d = [x[0], x[1], x[2]];
    if (!feasible(d)) return;
    const c = cost(d);
    if (c < bestCost) { bestCost = c; best = d; }
  };
  for (let i = 0; i < k; i++) {
    tryActive([i]);
    for (let j = i + 1; j < k; j++) {
      tryActive([i, j]);
      for (let l = j + 1; l < k; l++) tryActive([i, j, l]);
    }
  }
  // Normals spanning more than a hemisphere admit no feasible point; the
  // plain fit is the least-bad answer and the wall limit will reject it.
  return best ?? free;
}

/** Gaussian elimination with partial pivoting on an augmented matrix. */
function solveLinear(rows) {
  const n = rows.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[p][c])) p = r;
    if (!(Math.abs(rows[p][c]) > 1e-12)) return null;
    [rows[c], rows[p]] = [rows[p], rows[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = rows[r][c] / rows[c][c];
      if (f === 0) continue;
      for (let q = c; q <= n; q++) rows[r][q] -= f * rows[c][q];
    }
  }
  return rows.map((row, i) => row[n] / row[i]);
}
