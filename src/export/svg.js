/**
 * SVG export: a clean line drawing of the placed mesh from the viewer camera.
 *
 * Matches the viewport's framing — perspective projection from the live
 * orbit camera — but renders outlines only: silhouette and crease edges with
 * hidden lines removed. No grid, no scale annotations, no shading.
 *
 * Hidden-line removal is analytic, not painted: each feature edge is clipped
 * against the screen-space triangles that could occlude it, and only the
 * visible parameter intervals are stroked. The output therefore contains
 * nothing but the visible line segments — no white masks — so it stays small
 * and directly editable in vector tools.
 *
 * Depth comparison uses w = 1/z (perspective) or w = −z (orthographic):
 * both are affine over a plane in screen space, so edge-vs-triangle
 * occlusion reduces to one linear inequality per pair and each pair removes
 * at most one interval. The mesh is closed and consistently wound (mesh.js
 * invariants), so outward normals come straight from the winding and only
 * front-facing triangles can occlude.
 */

import { transformPoint } from "../orient.js";

/** Dihedral angle between adjacent triangles that earns a crease line. */
const CREASE_COS = Math.cos((25 * Math.PI) / 180);

/** Output canvas long-side length in SVG user units (px). */
const CANVAS = 1000;

const EDGE_STROKE = 1.8;

/** Grid resolution for the occluder lookup (cells per canvas side). */
const GRID = 40;

/**
 * @param {{
 *   mesh: { positions: Float32Array, indices: Uint32Array, positions64?: Float64Array },
 *   orientation: { matrix: Float64Array },
 *   camera?: {
 *     position: { x: number, y: number, z: number },
 *     target: { x: number, y: number, z: number },
 *     up?: { x: number, y: number, z: number },
 *   } | null,
 *   label?: string,
 * }} args
 * @returns {string} standalone SVG markup
 */
export function exportSvg({ mesh, orientation, camera = null, label = "" }) {
  const pos = mesh.positions64 ?? mesh.positions;
  const idx = mesh.indices;
  const nV = pos.length / 3;
  const nT = idx.length / 3;
  const M = orientation.matrix;

  // Placed (resting-orientation) vertices, mm.
  const P = new Float64Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    const [x, y, z] = transformPoint(M, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    P[i * 3] = x;
    P[i * 3 + 1] = y;
    P[i * 3 + 2] = z;
  }

  const view = viewBasis(camera);

  // Screen-space vertices and per-vertex nearness w (larger = nearer).
  const sx = new Float64Array(nV);
  const sy = new Float64Array(nV);
  const wv = new Float64Array(nV);
  for (let i = 0; i < nV; i++) {
    const dx = P[i * 3] - view.origin[0];
    const dy = P[i * 3 + 1] - view.origin[1];
    const dz = P[i * 3 + 2] - view.origin[2];
    const x = dx * view.right[0] + dy * view.right[1] + dz * view.right[2];
    const y = dx * view.up[0] + dy * view.up[1] + dz * view.up[2];
    const z = dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2];
    if (view.perspective) {
      const zc = Math.max(z, 1e-6);
      sx[i] = x / zc;
      sy[i] = -y / zc; // SVG y grows downward
      wv[i] = 1 / zc;
    } else {
      sx[i] = x;
      sy[i] = -y;
      wv[i] = -z;
    }
  }

  // Per-triangle outward normal (unit) and facing.
  const tnx = new Float64Array(nT);
  const tny = new Float64Array(nT);
  const tnz = new Float64Array(nT);
  const front = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    tnx[t] = nx; tny[t] = ny; tnz[t] = nz;
    let ex, ey, ez;
    if (view.perspective) {
      ex = view.origin[0] - (P[a] + P[b] + P[c]) / 3;
      ey = view.origin[1] - (P[a + 1] + P[b + 1] + P[c + 1]) / 3;
      ez = view.origin[2] - (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    } else {
      ex = -view.forward[0]; ey = -view.forward[1]; ez = -view.forward[2];
    }
    front[t] = nx * ex + ny * ey + nz * ez > 0 ? 1 : 0;
  }

  // Undirected edge → its two adjacent triangles.
  const edgeTris = new Map();
  for (let t = 0; t < nT; t++) {
    for (let k = 0; k < 3; k++) {
      const u = idx[t * 3 + k], v = idx[t * 3 + ((k + 1) % 3)];
      const key = u < v ? u * nV + v : v * nV + u;
      const pair = edgeTris.get(key);
      if (pair === undefined) edgeTris.set(key, [t, -1]);
      else pair[1] = t;
    }
  }

  // Feature edges: silhouette (facing flips) or crease (sharp dihedral),
  // with at least one front-facing side.
  const feature = []; // [va, vb, t0, t1, ...]
  for (const [key, pair] of edgeTris) {
    const [t0, t1] = pair;
    const f0 = front[t0], f1 = t1 >= 0 ? front[t1] : 0;
    if (!f0 && !f1) continue;
    const silhouette = f0 !== f1;
    const crease =
      t1 >= 0 &&
      tnx[t0] * tnx[t1] + tny[t0] * tny[t1] + tnz[t0] * tnz[t1] < CREASE_COS;
    if (!silhouette && !crease) continue;
    feature.push(Math.floor(key / nV), key % nV, t0, t1);
  }

  // Frame the drawing on the feature edges (they bound the silhouette).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let e = 0; e < feature.length; e += 4) {
    for (const v of [feature[e], feature[e + 1]]) {
      minX = Math.min(minX, sx[v]);
      maxX = Math.max(maxX, sx[v]);
      minY = Math.min(minY, sy[v]);
      maxY = Math.max(maxY, sy[v]);
    }
  }
  if (feature.length === 0) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const span = Math.max(spanX, spanY);

  // Occluders: front-facing triangles with usable screen area, indexed by a
  // uniform screen-space grid. Each carries the affine nearness function
  // w(sx, sy) of its supporting plane.
  const occ = []; // per occluder: [ax,ay,bx,by,cx,cy, gx,gy,g0, minx,miny,maxx,maxy]
  const cell = span / GRID;
  const grid = new Map(); // cellKey → occluder indices
  const cellOf = (x, y) =>
    `${Math.floor((x - minX) / cell)},${Math.floor((y - minY) / cell)}`;
  const detMin = span * span * 1e-9;
  for (let t = 0; t < nT; t++) {
    if (!front[t]) continue;
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cx = sx[c], cy = sy[c];
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < detMin) continue; // edge-on: occludes nothing usable
    const gx = ((wv[b] - wv[a]) * (cy - ay) - (wv[c] - wv[a]) * (by - ay)) / det;
    const gy = ((wv[c] - wv[a]) * (bx - ax) - (wv[b] - wv[a]) * (cx - ax)) / det;
    const g0 = wv[a] - gx * ax - gy * ay;
    const bMinX = Math.min(ax, bx, cx), bMaxX = Math.max(ax, bx, cx);
    const bMinY = Math.min(ay, by, cy), bMaxY = Math.max(ay, by, cy);
    const rec = [t, ax, ay, bx, by, cx, cy, det, gx, gy, g0];
    const o = occ.push(rec) - 1;
    const x0 = Math.floor((bMinX - minX) / cell), x1 = Math.floor((bMaxX - minX) / cell);
    const y0 = Math.floor((bMinY - minY) / cell), y1 = Math.floor((bMaxY - minY) / cell);
    for (let gx2 = x0; gx2 <= x1; gx2++) {
      for (let gy2 = y0; gy2 <= y1; gy2++) {
        const k = `${gx2},${gy2}`;
        const list = grid.get(k);
        if (list === undefined) grid.set(k, [o]);
        else list.push(o);
      }
    }
  }

  // Clip each feature edge against candidate occluders, keeping the visible
  // parameter intervals.
  const scale = CANVAS / span;
  const pad = CANVAS * 0.04;
  const minSeg = span * 5e-4; // drop sub-pixel slivers
  const seen = new Int32Array(occ.length).fill(-1);
  let d = "";
  for (let e = 0; e < feature.length; e += 4) {
    const va = feature[e], vb = feature[e + 1];
    const t0 = feature[e + 2], t1 = feature[e + 3];
    const x0 = sx[va], y0 = sy[va], x1 = sx[vb], y1 = sy[vb];
    const w0 = wv[va], w1 = wv[vb];
    const dx = x1 - x0, dy = y1 - y0;
    const eps = (Math.abs(w0) + Math.abs(w1)) * 5e-5;

    /** occluded intervals, flat [a0,b0, a1,b1, ...] */
    const hidden = [];
    const ex0 = Math.min(x0, x1), ex1 = Math.max(x0, x1);
    const ey0 = Math.min(y0, y1), ey1 = Math.max(y0, y1);
    const cx0 = Math.floor((ex0 - minX) / cell), cx1 = Math.floor((ex1 - minX) / cell);
    const cy0 = Math.floor((ey0 - minY) / cell), cy1 = Math.floor((ey1 - minY) / cell);
    for (let gx2 = cx0; gx2 <= cx1; gx2++) {
      for (let gy2 = cy0; gy2 <= cy1; gy2++) {
        const list = grid.get(`${gx2},${gy2}`);
        if (list === undefined) continue;
        for (const o of list) {
          if (seen[o] === e) continue;
          seen[o] = e;
          const rec = occ[o];
          if (rec[0] === t0 || rec[0] === t1) continue; // edge lies in these
          clipEdgeAgainstTri(hidden, rec, x0, y0, dx, dy, w0, w1 - w0, eps);
        }
      }
    }

    emitVisible(hidden, (ta, tb) => {
      const len = Math.hypot(dx, dy) * (tb - ta);
      if (len < minSeg) return;
      const X = (t) => r1((x0 + t * dx - minX) * scale + pad);
      const Y = (t) => r1((y0 + t * dy - minY) * scale + pad);
      d += `M${X(ta)} ${Y(ta)}L${X(tb)} ${Y(tb)}`;
    });
  }

  const W = r1(spanX * scale + pad * 2);
  const H = r1(spanY * scale + pad * 2);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
    `width="${W}" height="${H}">\n` +
    `  <title>${escapeXml(label)}</title>\n` +
    `  <path d="${d}" fill="none" stroke="#1a1a1a" stroke-width="${EDGE_STROKE}" ` +
    `stroke-linecap="round"/>\n` +
    `</svg>\n`
  );
}

/**
 * Subtract from the edge the parameter interval where occluder `rec` covers
 * it in screen space AND is strictly nearer. Appends to `hidden`.
 *
 * The edge is P(t) = (x0,y0) + t·(dx,dy) with nearness w(t) = w0 + t·dw;
 * the occluder's nearness over its plane is affine in screen space, so the
 * difference is linear in t and each pair hides at most one interval.
 */
function clipEdgeAgainstTri(hidden, rec, x0, y0, dx, dy, w0, dw, eps) {
  const [, ax, ay, bx, by, cx, cy, det, gx, gy, g0] = rec;
  // Screen-space clip: keep t where P(t) is inside the triangle. Orient by
  // det so "inside" is consistent for either winding.
  let lo = 0, hi = 1;
  const s = det > 0 ? 1 : -1;
  // Each directed tri edge (E0→E1): inside where cross(E1−E0, P(t)−E0)·s ≥ 0.
  for (const [ex, ey, fx, fy] of [
    [ax, ay, bx, by],
    [bx, by, cx, cy],
    [cx, cy, ax, ay],
  ]) {
    const ux = fx - ex, uy = fy - ey;
    const fa = (ux * (y0 - ey) - uy * (x0 - ex)) * s;
    const fb = (ux * (y0 + dy - ey) - uy * (x0 + dx - ex)) * s;
    // fa/fb: signed "outside-ness" at t=0 / t=1 (positive = inside).
    if (fa < 0 && fb < 0) return; // fully outside this half-plane
    if (fa < 0 || fb < 0) {
      const tc = fa / (fa - fb);
      if (fa < 0) lo = Math.max(lo, tc);
      else hi = Math.min(hi, tc);
      if (lo >= hi) return;
    }
  }

  // Depth: occluded where wTri(t) − wEdge(t) > eps on [lo, hi].
  const wt = (t) => gx * (x0 + t * dx) + gy * (y0 + t * dy) + g0;
  const dLo = wt(lo) - (w0 + lo * dw) - eps;
  const dHi = wt(hi) - (w0 + hi * dw) - eps;
  if (dLo <= 0 && dHi <= 0) return; // occluder is behind throughout
  let a = lo, b = hi;
  if (dLo <= 0 || dHi <= 0) {
    const tc = lo + (dLo / (dLo - dHi)) * (hi - lo);
    if (dLo <= 0) a = tc;
    else b = tc;
  }
  if (b > a) hidden.push(a, b);
}

/** Merge hidden intervals and call emit(a, b) for each visible gap in [0,1]. */
function emitVisible(hidden, emit) {
  if (hidden.length === 0) {
    emit(0, 1);
    return;
  }
  const iv = [];
  for (let i = 0; i < hidden.length; i += 2) iv.push([hidden[i], hidden[i + 1]]);
  iv.sort((p, q) => p[0] - q[0]);
  let cursor = 0;
  for (const [a, b] of iv) {
    if (a > cursor) emit(cursor, a);
    cursor = Math.max(cursor, b);
    if (cursor >= 1) return;
  }
  if (cursor < 1) emit(cursor, 1);
}

/**
 * Orthonormal view basis. With a camera: perspective from its position
 * toward its target. Without: the fixed orthographic ¾ fallback (headless).
 */
function viewBasis(camera) {
  if (!camera) {
    return {
      origin: [0, 0, 0],
      right: [1, 0, 0],
      up: [0, 0, 1],
      forward: [0, -1, 0],
      perspective: false,
    };
  }
  const origin = [camera.position.x, camera.position.y, camera.position.z];
  let fx = camera.target.x - origin[0];
  let fy = camera.target.y - origin[1];
  let fz = camera.target.z - origin[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;

  // right = forward × up; when forward is parallel to up (straight-down or
  // straight-up view) fall back to alternate up hints until one works.
  const hints = [camera.up ?? { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }];
  let rx = 0, ry = 0, rz = 0, rl = 0;
  for (const upIn of hints) {
    rx = fy * upIn.z - fz * upIn.y;
    ry = fz * upIn.x - fx * upIn.z;
    rz = fx * upIn.y - fy * upIn.x;
    rl = Math.hypot(rx, ry, rz);
    if (rl > 1e-6) break;
  }
  rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  return {
    origin,
    right: [rx, ry, rz],
    up: [ux, uy, uz],
    forward: [fx, fy, fz],
    perspective: true,
  };
}

function r1(v) {
  return String(Math.round(v * 10) / 10);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
