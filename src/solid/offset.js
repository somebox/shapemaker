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
 * @returns {Float64Array} xyz per skeleton vertex
 */
export function cornerOffsets(skeleton, frames) {
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
  for (const [v, list] of inward) {
    const d = fitCorner(list);
    out[v * 3] = d[0]; out[v * 3 + 1] = d[1]; out[v * 3 + 2] = d[2];
  }
  for (let v = 0; v < n; v++) {
    const r = find(v);
    if (r === v) continue;
    out[v * 3] = out[r * 3]; out[v * 3 + 1] = out[r * 3 + 1]; out[v * 3 + 2] = out[r * 3 + 2];
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
 * Most planes at one corner for which every candidate active set is tried.
 * Ordinary corners meet 3–6 planes. Smooth on a dense globe gathers a pole's
 * short edges into one corner of up to hundreds of planes, where trying every
 * set of three (cubic in the count) took minutes and locked the app.
 */
export const ENUMERATE_MAX_PLANES = 10;

/**
 * Displacement δ with a·δ ≥ 1 for every inward normal a (no plane closer
 * than the wall) and Σ(a·δ − 1)² least (no thicker than it must be). In 3D
 * the optimum sits on at most three active planes. Up to
 * {@link ENUMERATE_MAX_PLANES} planes, each candidate active set is solved
 * exactly and the best feasible one wins; above it, an active-set descent
 * ({@link fitMany}) finds the same optimum, to rounding, in a few steps
 * each linear in the planes: about 4 on average and at most 25 on dense
 * smoothed globes, 3 on a corner of 3,000 planes. Every step stays
 * feasible, and the run stops after 8k + 50 steps (never reached in
 * testing), so at worst a fit is slightly thick, never too thin.
 * @param {number[][]} normals  inward unit normals
 * @param {{ enumerateMax?: number }} [opts]  tests compare the two methods
 * @returns {number[]}
 */
export function fitCorner(normals, { enumerateMax = ENUMERATE_MAX_PLANES } = {}) {
  if (normals.length === 1) return [...normals[0]];
  if (normals.length > enumerateMax) return fitMany(normals);
  // Normals spanning less than 3D (a crease) leave a free direction; a
  // tiny ridge on |δ|² then picks the shortest move.
  return fitWithRidge(normals, 0) ?? fitWithRidge(normals, 1e-9) ?? [0, 0, 0];
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clears = (normals, d) => normals.every((a) => dot3(a, d) >= 1 - 1e-9);

/** H = Σ a aᵀ + ridge·I and g = Σ a: the plain fit solves H δ = g. */
function normalEquations(normals, ridge = 0) {
  const H = [[ridge, 0, 0], [0, ridge, 0], [0, 0, ridge]];
  const g = [0, 0, 0];
  for (const a of normals) {
    for (let i = 0; i < 3; i++) {
      g[i] += a[i];
      for (let j = 0; j < 3; j++) H[i][j] += a[i] * a[j];
    }
  }
  return { H, g };
}

function fitWithRidge(normals, RIDGE) {
  const { H, g } = normalEquations(normals, RIDGE);
  const free = solveLinear(H.map((row, i) => [...row, g[i]]));
  if (free && clears(normals, free)) return free;
  // Normals spanning more than a hemisphere admit no feasible point; the
  // plain fit is the least-bad answer and the wall limit will reject it.
  return enumerate(normals, H, g, RIDGE) ?? free;
}

/**
 * Axes along which the normals lean less than this fraction of the most
 * are treated as free: the fit leaves them alone, as the ridge pass does
 * for a crease. A fit along such an axis would sit ~1e10 walls deep.
 */
const RANK_TOL = 1e-10;

/** Cubic enumeration stays quick (a few ms) up to this many planes. */
const ENUMERATE_FALLBACK_MAX = 40;

/**
 * The fit for a corner of many planes, by descent in a frame where it is
 * well conditioned. The frame is H's eigenbasis, each axis scaled by how
 * much the normals lean on it, so the plain fit's matrix is close to the
 * identity even when the normals lie all but in one plane (the fit then
 * sits millions of walls deep, and solving in the original frame loses
 * it). Axes no normal leans on are dropped and stay at zero, which is
 * the shortest move along a crease. Neither case needs enumeration.
 * @param {number[][]} normals  inward unit normals
 * @returns {number[]}
 */
function fitMany(normals) {
  const { H } = normalEquations(normals);
  const axes = eigenvectors3(H);
  const sigma = axes.map((v) => Math.sqrt(normals.reduce((s, a) => s + dot3(a, v) ** 2, 0)));
  const top = Math.max(...sigma);
  const keep = sigma.map((s) => s > RANK_TOL * top);
  const B = normals.map((a) => axes.map((v, j) => (keep[j] ? dot3(a, v) / sigma[j] : 0)));
  const { H: Hb, g: gb } = normalEquations(B);
  // A dropped axis has no normal on it; a unit diagonal pins it at zero.
  keep.forEach((kept, j) => { if (!kept) Hb[j][j] = 1; });
  const toDelta = (y) => {
    const d = [0, 0, 0];
    axes.forEach((v, j) => {
      if (!keep[j]) return;
      for (let c = 0; c < 3; c++) d[c] += (y[j] / sigma[j]) * v[c];
    });
    return d;
  };

  // Back in the original frame, a fit that clears every plane is scaled
  // out to clear them exactly: on a corner tens of thousands of walls deep
  // (nearly opposing planes), rounding in the scaled frame can leave it
  // ~1e-12 of its depth inside the nearest one.
  const clearing = (y) => {
    const d = toDelta(y);
    const m = Math.min(...normals.map((a) => dot3(a, d)));
    return m < 1 && m > 0 ? d.map((x) => x / m) : d;
  };
  const free = solveLinear(Hb.map((row, i) => [...row, gb[i]]));
  if (free && clears(B, free)) return clearing(free);
  let fit = free ? descend(B, Hb, gb, free) : undefined;
  if (fit === undefined && normals.length <= ENUMERATE_FALLBACK_MAX) {
    // The search for a start failed numerically (never seen in testing):
    // enumerate, exact, while that stays quick.
    fit = enumerate(B, Hb, gb);
  }
  if (fit) return clearing(fit);
  // null: no point clears every plane, so the plain fit, as enumeration
  // returns for small corners.
  return free ? toDelta(free) : [0, 0, 0];
}

/**
 * Eigenvectors of a symmetric 3×3 matrix by cyclic Jacobi rotations — an
 * orthonormal basis that diagonalises it.
 * @param {number[][]} M
 * @returns {number[][]} three unit vectors
 */
function eigenvectors3(M) {
  const A = M.map((row) => [...row]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = A[0][1] ** 2 + A[0][2] ** 2 + A[1][2] ** 2;
    const diag = A[0][0] ** 2 + A[1][1] ** 2 + A[2][2] ** 2;
    if (!(off > 1e-40 * diag)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (A[p][q] === 0) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let r = 0; r < 3; r++) {
        const arp = A[r][p], arq = A[r][q];
        A[r][p] = c * arp - s * arq;
        A[r][q] = s * arp + c * arq;
      }
      for (let r = 0; r < 3; r++) {
        const apr = A[p][r], aqr = A[q][r];
        A[p][r] = c * apr - s * aqr;
        A[q][r] = s * apr + c * aqr;
      }
      for (let r = 0; r < 3; r++) {
        const vrp = V[r][p], vrq = V[r][q];
        V[r][p] = c * vrp - s * vrq;
        V[r][q] = s * vrp + c * vrq;
      }
    }
  }
  return [0, 1, 2].map((j) => [V[0][j], V[1][j], V[2][j]]);
}

/**
 * Best feasible fit over every active set of one to three planes — exact,
 * and cubic in the planes.
 * @returns {number[]|null} null when no set gives a feasible fit
 */
function enumerate(normals, H, g, ridge = 0) {
  const k = normals.length;
  const cost = (d) =>
    normals.reduce((c, a) => c + (dot3(a, d) - 1) ** 2, ridge * dot3(d, d));
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
    if (!clears(normals, d)) return;
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
  return best;
}

/**
 * Primal active-set descent for the corner fit (Nocedal & Wright §16.5):
 * start feasible, minimise on the planes held active, step until another
 * plane blocks, and release a plane whose multiplier says the optimum lies
 * off it. Every iterate stays feasible, so stopping early (a degenerate
 * working set, or the iteration cap) still leaves no plane closer than the
 * wall — at worst a corner slightly thicker than it need be.
 * @param {number[][]} normals
 * @param {number[][]} H  Σ a aᵀ (+ ridge)
 * @param {number[]} g    Σ a
 * @param {number[]} free  the unconstrained fit, infeasible here
 * @returns {number[]|null|undefined} null when no direction clears every
 *   plane; undefined when finding a start failed numerically
 */
function descend(normals, H, g, free) {
  const k = normals.length;
  const dot = (a, d) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  // Push a direction out until its nearest plane is one wall away. The
  // margin is judged per unit length: the hull point below is short when
  // the corner is wide.
  const pushOut = (dir) => {
    let m = Infinity;
    for (const a of normals) m = Math.min(m, dot(a, dir));
    return m > HULL_MARGIN * len(dir) ? dir.map((x) => x / m) : null;
  };
  // The plain fit and the normals' sum usually clear every plane already.
  // On a wide or nearly flat corner both can miss; the nearest point of
  // the normals' hull clears them whenever anything does.
  let d = pushOut(free) ?? pushOut(g);
  if (!d) {
    const hull = minNormPoint(normals);
    d = pushOut(hull.x);
    if (!d) return hull.settled ? null : undefined;
  }

  let first = 0;
  for (let i = 1; i < k; i++) if (dot(normals[i], d) < dot(normals[first], d)) first = i;
  const W = [first];

  /**
   * Minimiser of the fit with every plane in W held at the wall, and the
   * multipliers (H δ + Σ μ a = g): [δx, δy, δz, μ...], or null if W's
   * normals are dependent. A null-space solve: W's normals are
   * orthonormalised (A = L Q), the walls fix δ along Q by substitution,
   * and the fit picks it along the rest. Two planes nearly parallel or
   * nearly opposite leave the full KKT matrix too ill-conditioned to
   * eliminate in float64, but not this.
   */
  const solveOn = () => {
    const m = W.length;
    /** @type {number[][]} */ const Q = [];
    const L = W.map(() => [0, 0, 0]);
    for (let i = 0; i < m; i++) {
      const a = normals[W[i]];
      let v = [...a];
      // Gram–Schmidt, twice for orthogonality to working precision.
      for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < i; j++) {
          const r = dot(Q[j], v);
          L[i][j] += r;
          v = [v[0] - r * Q[j][0], v[1] - r * Q[j][1], v[2] - r * Q[j][2]];
        }
      }
      const n = len(v);
      if (!(n > 1e-13 * len(a))) return null;
      L[i][i] = n;
      Q.push([v[0] / n, v[1] / n, v[2] / n]);
    }
    // The walls: L z = 1, with z = Q δ.
    const z = [];
    for (let i = 0; i < m; i++) {
      let r = 1;
      for (let j = 0; j < i; j++) r -= L[i][j] * z[j];
      z.push(r / L[i][i]);
    }
    const delta = [0, 0, 0];
    Q.forEach((q, i) => { for (let c = 0; c < 3; c++) delta[c] += z[i] * q[c]; });
    // The fit along the free directions Z: (Zᵀ H Z) w = Zᵀ (g − H δ).
    const Z = completeBasis(Q);
    if (Z.length) {
      const Hd = H.map((row) => dot(row, delta));
      const r = [g[0] - Hd[0], g[1] - Hd[1], g[2] - Hd[2]];
      const rows = Z.map((za) => [...Z.map((zb) => dot(za, H.map((row) => dot(row, zb)))), dot(za, r)]);
      const w = solveLinear(rows);
      if (!w) return null;
      Z.forEach((zv, a) => { for (let c = 0; c < 3; c++) delta[c] += w[a] * zv[c]; });
    }
    // Multipliers: Lᵀ μ = Q (g − H δ), by back substitution.
    const Hd = H.map((row) => dot(row, delta));
    const res = [g[0] - Hd[0], g[1] - Hd[1], g[2] - Hd[2]];
    const mu = new Array(m).fill(0);
    for (let j = m - 1; j >= 0; j--) {
      let r = dot(Q[j], res);
      for (let i = j + 1; i < m; i++) r -= L[i][j] * mu[i];
      mu[j] = r / L[j][j];
    }
    return [...delta, ...mu];
  };

  for (let iter = 0; iter < 8 * k + 50; iter++) {
    const x = solveOn();
    // Every iterate clears every plane, so stopping here is safe.
    if (!x) return d;
    const p = [x[0] - d[0], x[1] - d[1], x[2] - d[2]];
    // Tolerances scale with the move: a nearly flat corner can sit
    // thousands of walls deep, where rounding alone exceeds 1e-12.
    const scale = Math.max(1, len(d));
    const pn = len(p);
    if (pn < 1e-12 * scale) {
      // Optimal on W. A positive multiplier (H δ + Σ μ a = g) means the fit
      // improves by leaving that plane; release the worst one.
      let worst = -1, worstMu = 1e-12 * scale;
      for (let q = 0; q < W.length; q++) {
        if (x[3 + q] > worstMu) { worstMu = x[3 + q]; worst = q; }
      }
      if (worst < 0) return d;
      W.splice(worst, 1);
      continue;
    }
    // A plane whose normal lies in the span of W's (a duplicate, say)
    // keeps its distance along any step that holds W, so it never blocks;
    // rounding can make it look as if it does, and adding it would leave W
    // singular and stop the descent short.
    const cross = (a, b) =>
      [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const spanNormal = W.length === 2 ? cross(normals[W[0]], normals[W[1]]) : null;
    const inSpan = (c) => {
      if (W.length >= 3) return true;
      const cc = dot(c, c);
      if (W.length === 1) {
        const w = normals[W[0]], x = cross(w, c);
        return dot(x, x) <= 1e-18 * dot(w, w) * cc;
      }
      const s = dot(spanNormal, c);
      return s * s <= 1e-18 * dot(spanNormal, spanNormal) * cc;
    };
    let alpha = 1, block = -1;
    for (let i = 0; i < k; i++) {
      if (W.includes(i)) continue;
      const ap = dot(normals[i], p);
      if (ap >= -1e-15 * pn || inSpan(normals[i])) continue;
      const t = Math.max(0, (1 - dot(normals[i], d)) / ap);
      if (t < alpha) { alpha = t; block = i; }
    }
    d = [d[0] + alpha * p[0], d[1] + alpha * p[1], d[2] + alpha * p[2]];
    if (block >= 0) W.push(block);
  }
  return d;
}

/**
 * Unit vectors completing orthonormal rows Q (0–3 of them) to a basis of
 * space.
 * @param {number[][]} Q
 * @returns {number[][]}
 */
function completeBasis(Q) {
  const cross = (a, b) =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unitOf = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  if (Q.length === 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (Q.length === 2) return [unitOf(cross(Q[0], Q[1]))];
  if (Q.length === 3) return [];
  const q = Q[0];
  // The axis q leans on least, so the cross product is well sized.
  const ax = Math.abs(q[0]) <= Math.abs(q[1]) && Math.abs(q[0]) <= Math.abs(q[2]) ? [1, 0, 0]
    : Math.abs(q[1]) <= Math.abs(q[2]) ? [0, 1, 0] : [0, 0, 1];
  const z1 = unitOf(cross(q, ax));
  return [z1, cross(q, z1)];
}

/**
 * Least clearance, per unit length, for a direction to count as clearing
 * every plane. Corners shallower than this would sit more than a billion
 * walls deep; they are treated as having no feasible point.
 */
const HULL_MARGIN = 1e-9;

/**
 * Point of the points' convex hull nearest the origin — Wolfe's algorithm
 * (1976). Every point a then has a·z ≥ |z|², so z clears all of them by the
 * widest margin; z is (near) zero when the origin is inside the hull and no
 * such direction exists. Stops early once z clears every point by
 * {@link HULL_MARGIN}, which is all the descent needs.
 *
 * In 3D the corral holds at most four points, so the nearest point of its
 * affine hull has a closed form (line, plane, or the origin itself inside
 * a tetrahedron). Those use cross products of edge vectors rather than a
 * Gram system, which would square the conditioning: on a nearly flat
 * corner the corral is a sliver and the margin is ~1e-7.
 * @param {number[][]} pts  unit vectors
 * @returns {{ x: number[], settled: boolean }} settled is false when the
 *   search stopped on a numerical failure rather than an answer
 */
function minNormPoint(pts) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) =>
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let maxSq = 0, s0 = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = dot(pts[i], pts[i]);
    maxSq = Math.max(maxSq, q);
    if (q < dot(pts[s0], pts[s0])) s0 = i;
  }
  let S = [s0], w = [1];
  let x = [...pts[s0]];
  /** Weights v (Σv = 1) of the point of S's affine hull nearest the origin. */
  const affineMin = () => {
    const P = S.map((s) => pts[s]);
    if (P.length === 1) return [1];
    if (P.length === 2) {
      const e = sub(P[1], P[0]);
      const ee = dot(e, e);
      if (!(ee > 0)) return null;
      const t = -dot(P[0], e) / ee;
      return [1 - t, t];
    }
    if (P.length === 3) {
      const n = cross(sub(P[1], P[0]), sub(P[2], P[0]));
      const nn = dot(n, n);
      if (!(nn > 0)) return null;
      const h = dot(n, P[0]) / nn;
      const y = [n[0] * h, n[1] * h, n[2] * h];
      return [0, 1, 2].map((i) =>
        dot(cross(sub(P[(i + 1) % 3], y), sub(P[(i + 2) % 3], y)), n) / nn);
    }
    if (P.length === 4) {
      // The affine hull is all of space: the origin itself, by signed volumes.
      const vol = (a, b, c, d) => dot(sub(b, a), cross(sub(c, a), sub(d, a)));
      const total = vol(P[0], P[1], P[2], P[3]);
      if (!(Math.abs(total) > 0)) return null;
      const o = [0, 0, 0];
      return [
        vol(o, P[1], P[2], P[3]) / total,
        vol(P[0], o, P[2], P[3]) / total,
        vol(P[0], P[1], o, P[3]) / total,
        vol(P[0], P[1], P[2], o) / total,
      ];
    }
    return null;
  };
  for (let major = 0; major < 4 * pts.length + 50; major++) {
    const xx = dot(x, x);
    // The origin is (within the margin of) the hull: nothing clears it.
    if (xx <= HULL_MARGIN * HULL_MARGIN * maxSq) return { x, settled: true };
    let j = 0;
    for (let i = 1; i < pts.length; i++) if (dot(x, pts[i]) < dot(x, pts[j])) j = i;
    const m = dot(x, pts[j]);
    if (m > HULL_MARGIN * Math.sqrt(xx)) return { x, settled: true };
    if (m >= xx * (1 - 1e-12)) return { x, settled: true };
    if (S.includes(j)) return { x, settled: false };
    S.push(j);
    w.push(0);
    for (let minor = 0; minor < 8; minor++) {
      const v = affineMin();
      if (!v) return { x, settled: false };
      if (v.every((vi) => vi > 1e-12)) { w = v; break; }
      // Step from w toward v until a weight reaches zero, and drop it.
      let theta = 1;
      for (let i = 0; i < S.length; i++) {
        if (v[i] <= 1e-12 && w[i] > v[i]) theta = Math.min(theta, w[i] / (w[i] - v[i]));
      }
      w = w.map((wi, i) => (1 - theta) * wi + theta * v[i]);
      const keep = w.map((wi) => wi > 1e-12);
      S = S.filter((_, i) => keep[i]);
      w = w.filter((_, i) => keep[i]);
    }
    x = [0, 0, 0];
    S.forEach((s, i) => { for (let c = 0; c < 3; c++) x[c] += w[i] * pts[s][c]; });
  }
  return { x, settled: false };
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
