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
