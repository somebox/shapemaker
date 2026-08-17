/**
 * Stage-2 edge rounding: dihedral edge strips + corner patches.
 *
 * The rolling-ball construction assumes a convex dihedral (centre inside
 * both face planes). Reflex valleys (spike folds) skip: r = 0 on those
 * edges, so the points round and the gutters stay sharp.
 *
 * Rounding follows the MACRO feature graph: coplanar subdivision seams are
 * refinement, not dihedrals, so they never get a zero-radius strip. Each
 * macro edge carries r_e = min(roundingMm, local allowances of both adjacent
 * faces, constituent micro-edge budgets). A small feature never caps the
 * model. Smooth-bent facets stay independent so Form Rounding operates on
 * the faceted surface.
 *
 * Construction per edge (faces a, b; in-plane inward edge normals t_a,
 * t_b — not orthogonal in general): a TRUE circular arc of radius r in
 * the cross-section plane, swept along the edge. The circle's centre sits
 * r inside both face planes (c = p + (r/sin ω)(t_a + t_b), ω = dihedral)
 * and touches each face along its tangency line at width w = r·cot(ω/2)
 * from the edge — so the strip surface IS the tangent cylinder of the
 * rolling-ball blend. Strips are trimmed at each true corner (3+ macros)
 * to the binding face's inset; the gap closes with a cap sampled from the
 * outer envelope of the corner's tangent sphere and the same cylinders.
 *
 * Each microface keeps its own inset ring (clipped to the macro boundary)
 * so the shell still emits one opening per subdivided face.
 *
 * All verts are pushed through the caller's list BEFORE the inner-shell
 * scale copy, so hollow depths mirror the rounding for free.
 */

import { edgeKey } from "../geom/edgesub.js";
import { earClip } from "../geom/capfill.js";
import { buildMacroTopology } from "./macro-topo.js";

/**
 * Ordered incident edges/faces around each vertex (cyclic fan).
 * @returns {Map<number, { edges: number[][], faces: number[] }>}
 */
function vertexFans(faces, directed) {
  const verts = new Set();
  for (const ring of faces) for (const v of ring) verts.add(v);

  const fans = new Map();
  for (const v of verts) {
    let n0 = null;
    for (const [key, f] of directed) {
      if (Math.floor(key / 0x100000) === v) { n0 = key % 0x100000; break; }
    }
    if (n0 == null) continue;
    const edges = [];
    const facesOrder = [];
    let n = n0;
    do {
      edges.push([v, n]);
      const f = directed.get(v * 0x100000 + n);
      facesOrder.push(f);
      const ring = faces[f];
      const i = ring.indexOf(v);
      n = ring[(i - 1 + ring.length) % ring.length];
    } while (n !== n0 && edges.length <= 64);
    fans.set(v, { edges, faces: facesOrder });
  }
  return fans;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Build strips, corner fans, and per-face inset boundary rings.
 *
 * @param {{ positions: Float64Array, faces: number[][], macroFaceId?: number[] }} skeleton
 * @param {{ normal: number[] }[]} frames
 * @param {{
 *   radiusForEdge: (key: string) => number,
 *   allowForEdge?: (key: string) => number,
 *   segments: number,
 *   lengthwise: number[],
 *   pushVert: (x: number, y: number, z: number) => number,
 *   getVert: (i: number) => number[],
 * }} opts
 * @returns {{
 *   faceRings: Map<number, number[]>,
 *   quads: number[][],
 *   tris: number[][],
 *   radiusMin: number,
 *   radiusMax: number,
 * }}
 */
export function buildEdgeRounding(skeleton, frames, opts) {
  const { positions, faces } = skeleton;
  const { radiusForEdge, allowForEdge, segments: J, lengthwise, pushVert, getVert } = opts;
  const topo = buildMacroTopology(skeleton, frames);
  const {
    macroFaceId, directed, outerRing, cornerVerts, internalKeys,
  } = topo;
  const fans = vertexFans(faces, directed);

  const P = (vi) => [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]];

  const macroAngleAt = (m, v) => {
    const ring = outerRing[m];
    if (!ring || ring.length < 3) return Math.PI / 2;
    const i = ring.indexOf(v);
    if (i < 0) return Math.PI / 2;
    const prev = P(ring[(i - 1 + ring.length) % ring.length]);
    const next = P(ring[(i + 1) % ring.length]);
    const p = P(v);
    const a = norm(sub(prev, p));
    const b = norm(sub(next, p));
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  };

  const edges = [];
  for (const me of topo.edges) {
    const u = me.verts[0], v = me.verts[me.verts.length - 1];
    const U = P(u), V = P(v);
    const d = norm(sub(V, U));
    const t0 = norm(cross(frames[me.fa].normal, d));
    const t1 = norm(cross(frames[me.fb].normal, mul(d, -1)));
    const flat = dot(frames[me.fa].normal, frames[me.fb].normal) > 1 - 1e-9;
    // Outward-normal test: the other face's centroid sits outside this
    // plane iff the dihedral is reflex (a spike valley). The rolling-ball
    // centre formula puts c on the wrong side of those folds — skip them
    // and only round ridges (convex edges and pyramid apexes).
    const reflex = dot(
      frames[me.fa].normal,
      sub(frames[me.fb].origin, frames[me.fa].origin),
    ) > 1e-9;
    const cosw = Math.max(-1, Math.min(1, dot(t0, t1)));
    const sinw = Math.sqrt(Math.max(1 - cosw * cosw, 0));
    const cotHalf = sinw > 1e-9 ? (1 + cosw) / sinw : 1;
    let r = 0;
    let budget = 0;
    if (!flat && !reflex) {
      r = Math.min(...me.keys.map((k) => radiusForEdge(k)));
      budget = Math.min(...me.keys.map((k) => allowForEdge?.(k) ?? r));
      if (!(r > 0) || !Number.isFinite(r)) r = 0;
      if (!(budget > 0) || !Number.isFinite(budget)) budget = 0;
    }
    if (r * cotHalf > budget) r = budget / cotHalf;
    if (!(r > 0) || !Number.isFinite(r)) r = 0;
    const w = r * cotHalf;
    const len = Math.hypot(...sub(V, U));
    if (!(len > 1e-12) || !Number.isFinite(len)) continue;
    edges.push({
      verts: me.verts,
      keys: me.keys,
      fa: me.fa,
      fb: me.fb,
      ma: me.ma,
      mb: me.mb,
      u, v, U, V, d, t0, t1, r, w, cosw, sinw, cotHalf, len,
    });
  }

  const edgeByTopo = new Map();
  for (let i = 0; i < edges.length; i++) {
    for (const k of edges[i].keys) edgeByTopo.set(k, i);
  }

  for (const e of edges) {
    if (e.r === 0) continue;
    for (const vert of [e.u, e.v]) {
      if (!cornerVerts.has(vert)) continue;
      for (const m of [e.ma, e.mb]) {
        const gamma = macroAngleAt(m, vert);
        const wCap = 0.2 * e.len * Math.max(Math.sin(gamma), 0.05);
        if (e.w > wCap) {
          e.w = wCap;
          e.r = e.cotHalf > 1e-9 ? wCap / e.cotHalf : wCap;
        }
      }
    }
  }

  const otherEdgeAtMacro = (m, v, self) => {
    const list = topo.vertEdges.get(v) || [];
    for (const ti of list) {
      const k0 = topo.edges[ti].keys[0];
      const ei = edgeByTopo.get(k0);
      if (ei == null || edges[ei] === self) continue;
      const e = edges[ei];
      if (e.ma === m || e.mb === m) return e;
    }
    return null;
  };

  for (const e of edges) {
    e.trim = {};
    for (const vert of [e.u, e.v]) {
      if (!cornerVerts.has(vert)) {
        e.trim[vert] = { lMax: 0, perFace: {} };
        continue;
      }
      let lMax = 0;
      const perFace = {};
      for (const m of [e.ma, e.mb]) {
        const gamma = macroAngleAt(m, vert);
        const wOther = otherEdgeAtMacro(m, vert, e)?.w ?? e.w;
        const l = (e.w * Math.cos(gamma) + wOther) / Math.max(Math.sin(gamma), 1e-6);
        perFace[m] = Math.max(l, 0);
        lMax = Math.max(lMax, perFace[m]);
      }
      e.trim[vert] = { lMax: Math.min(lMax, 0.45 * e.len), perFace };
    }
  }

  for (const e of edges) {
    const lu = e.trim[e.u].lMax, lv = e.trim[e.v].lMax;
    const U2 = add(e.U, mul(e.d, lu));
    const V2 = add(e.V, mul(e.d, -lv));
    const span = sub(V2, U2);
    const t0edge = e.len > 0 ? lu / e.len : 0;
    const t1edge = e.len > 0 ? 1 - lv / e.len : 1;
    const denom = (t1edge - t0edge) || 1;

    const colFracs = [{ frac: 0, vert: e.u }];
    for (const fr of lengthwise) colFracs.push({ frac: fr, vert: -1 });
    for (let i = 1; i < e.verts.length - 1; i++) {
      const vi = e.verts[i];
      const t = dot(sub(P(vi), e.U), e.d) / e.len;
      const frac = (t - t0edge) / denom;
      if (frac > 1e-9 && frac < 1 - 1e-9) colFracs.push({ frac, vert: vi });
    }
    colFracs.push({ frac: 1, vert: e.v });
    colFracs.sort((a, b) => a.frac - b.frac);
    const merged = [];
    for (const c of colFracs) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last.frac - c.frac) < 1e-9) {
        if (c.vert >= 0) last.vert = c.vert;
      } else {
        merged.push({ frac: c.frac, vert: c.vert });
      }
    }

    const grid = [];
    if (e.r === 0) {
      const row = [];
      for (const c of merged) {
        const p = add(U2, mul(span, c.frac));
        row.push(pushVert(p[0], p[1], p[2]));
      }
      for (let j = 0; j <= J; j++) grid.push(row);
    } else {
      const offs = [];
      if (e.sinw > 1e-6 && e.r > 1e-12) {
        const cRel = mul(add(e.t0, e.t1), e.r / e.sinw);
        const u0 = mul(sub(mul(e.t0, e.w), cRel), 1 / e.r);
        const u1 = mul(sub(mul(e.t1, e.w), cRel), 1 / e.r);
        const A = Math.acos(Math.min(1, Math.max(-1, dot(u0, u1))));
        const sinA = Math.max(Math.sin(A), 1e-9);
        for (let j = 0; j <= J; j++) {
          const phi = (A * j) / J;
          const ua = Math.sin(A - phi) / sinA, ub = Math.sin(phi) / sinA;
          const u = add(mul(u0, ua), mul(u1, ub));
          offs.push(add(cRel, mul(u, e.r)));
        }
      } else {
        for (let j = 0; j <= J; j++) {
          const th = (Math.PI / 2) * (j / J);
          offs.push(add(
            mul(e.t0, e.w * (1 - Math.sin(th))),
            mul(e.t1, e.w * (1 - Math.cos(th))),
          ));
        }
      }
      for (let j = 0; j <= J; j++) {
        const off = offs[j];
        const row = [];
        for (const c of merged) {
          const p = add(add(U2, mul(span, c.frac)), off);
          if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
            throw new Error("rounding strip produced a non-finite vertex");
          }
          row.push(pushVert(p[0], p[1], p[2]));
        }
        grid.push(row);
      }
    }
    e.grid = grid;
    e.cols = merged.length;
    e.colAt = new Map();
    for (let i = 0; i < merged.length; i++) {
      if (merged[i].vert >= 0) e.colAt.set(merged[i].vert, i);
    }
  }

  const vertOnEdge = new Map();
  for (let ei = 0; ei < edges.length; ei++) {
    for (const v of edges[ei].verts) vertOnEdge.set(v, ei);
  }

  for (const [v, eids] of topo.vertEdges) {
    const cands = [];
    for (const ti of eids) {
      const k0 = topo.edges[ti].keys[0];
      const ei = edgeByTopo.get(k0);
      if (ei == null) continue;
      const e = edges[ei];
      const col = e.u === v ? 0 : e.cols - 1;
      for (let j = 0; j <= J; j++) {
        const row = e.grid[j];
        const p = getVert(row[col]);
        const hit = cands.find(
          (c) => Math.hypot(c.p[0] - p[0], c.p[1] - p[1], c.p[2] - p[2]) < 1e-6,
        );
        if (hit) row[col] = hit.idx;
        else cands.push({ idx: row[col], p });
      }
    }
  }

  const cornerIdx = new Map();
  const stripEnd = (e, v, m) => {
    const col = e.u === v ? 0 : e.cols - 1;
    const row = e.ma === m ? e.grid[0] : e.grid[J];
    return { row, col, idx: row[col] };
  };
  const near = (i, p) => {
    const q = getVert(i);
    return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1e-6;
  };
  for (const v of cornerVerts) {
    const eids = topo.vertEdges.get(v) || [];
    const macros = new Set();
    for (const ti of eids) {
      const k0 = topo.edges[ti].keys[0];
      const ei = edgeByTopo.get(k0);
      if (ei == null) continue;
      macros.add(edges[ei].ma);
      macros.add(edges[ei].mb);
    }
    for (const m of macros) {
      let eA = null;
      for (const ti of eids) {
        const k0 = topo.edges[ti].keys[0];
        const ei = edgeByTopo.get(k0);
        if (ei == null) continue;
        const e = edges[ei];
        if (e.ma === m || e.mb === m) {
          eA = e;
          break;
        }
      }
      if (!eA) continue;
      const along = eA.u === v ? eA.d : mul(eA.d, -1);
      const tf = eA.ma === m ? eA.t0 : eA.t1;
      const lf = eA.trim[v].perFace[m] ?? eA.trim[v].lMax;
      const pos = add(add(P(v), mul(along, lf)), mul(tf, eA.w));
      const endA = stripEnd(eA, v, m);
      const eB = otherEdgeAtMacro(m, v, eA);
      const endB = eB ? stripEnd(eB, v, m) : null;
      let idx;
      if (near(endA.idx, pos)) {
        idx = endA.idx;
        if (endB && endB.idx !== idx && near(endB.idx, pos)) endB.row[endB.col] = idx;
      } else if (endB && near(endB.idx, pos)) {
        idx = endB.idx;
      } else {
        idx = pushVert(pos[0], pos[1], pos[2]);
      }
      cornerIdx.set(m * 0x100000 + v, idx);
    }
  }

  const stripPoint = (v, m) => {
    const ei = vertOnEdge.get(v);
    if (ei == null) return null;
    const e = edges[ei];
    const col = e.colAt.get(v);
    if (col == null) return null;
    const row = e.ma === m ? e.grid[0] : e.grid[J];
    return row[col];
  };

  const represent = (v, f) => {
    const m = macroFaceId[f];
    if (cornerVerts.has(v)) {
      const idx = cornerIdx.get(m * 0x100000 + v);
      if (idx !== undefined) return idx;
    }
    const sp = stripPoint(v, m);
    if (sp != null) return sp;
    return v;
  };

  const appendSlice = (out, e, m, a, b) => {
    const row = e.ma === m ? e.grid[0] : e.grid[J];
    const ca = e.colAt.get(a);
    const cb = e.colAt.get(b);
    if (ca == null || cb == null) return;
    const cIdx = cornerVerts.has(a) ? cornerIdx.get(m * 0x100000 + a) : undefined;
    const first = row[ca];
    if (cIdx !== undefined && cIdx !== first) out.push(cIdx);
    if (ca <= cb) {
      for (let t = ca; t <= cb; t++) out.push(row[t]);
    } else {
      for (let t = ca; t >= cb; t--) out.push(row[t]);
    }
    const cNext = cornerVerts.has(b) ? cornerIdx.get(m * 0x100000 + b) : undefined;
    if (cNext !== undefined && out[out.length - 1] === cNext) out.pop();
  };

  const faceRings = new Map();
  for (let f = 0; f < faces.length; f++) {
    const ring = faces[f];
    const m = macroFaceId[f];
    const out = [];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const key = edgeKey(a, b);
      if (internalKeys.has(key)) {
        out.push(represent(a, f));
        out.push(represent(b, f));
        continue;
      }
      const rec = edges[edgeByTopo.get(key)];
      if (!rec) {
        out.push(represent(a, f));
        out.push(represent(b, f));
        continue;
      }
      appendSlice(out, rec, m, a, b);
    }
    const clean = [];
    for (const i of out) {
      if (i == null || !Number.isFinite(i)) continue;
      if (clean.length === 0 || clean[clean.length - 1] !== i) clean.push(i);
    }
    if (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
    if (clean.length < 3) {
      throw new Error(`rounding face ring ${f} has ${clean.length} vertices`);
    }
    faceRings.set(f, clean);
  }

  const quads = [];
  const tris = [];

  const outward = (i0, i1, i2) => {
    const [ax, ay, az] = getVert(i0);
    const [bx, by, bz] = getVert(i1);
    const [cx, cy, cz] = getVert(i2);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return nx * (ax + bx + cx) + ny * (ay + by + cy) + nz * (az + bz + cz) > 0;
  };

  let radiusMin = Infinity;
  let radiusMax = 0;
  for (const e of edges) {
    if (e.r === 0) continue;
    radiusMin = Math.min(radiusMin, e.r);
    radiusMax = Math.max(radiusMax, e.r);
    if (e.cols < 2) continue;
    const flip = !outward(e.grid[0][0], e.grid[0][1], e.grid[1][1]);
    for (let j = 0; j < J; j++) {
      for (let t = 0; t < e.cols - 1; t++) {
        let q = [e.grid[j][t], e.grid[j][t + 1], e.grid[j + 1][t + 1], e.grid[j + 1][t]];
        if (flip) q = [q[3], q[2], q[1], q[0]];
        q.push(e.fa);
        quads.push(q);
      }
    }
  }

  for (const v of cornerVerts) {
    const fan = fans.get(v);
    if (!fan) continue;
    const spokes = [];
    for (let i = 0; i < fan.edges.length; i++) {
      const other = fan.edges[i][1];
      const key = edgeKey(v, other);
      if (internalKeys.has(key)) continue;
      const ei = edgeByTopo.get(key);
      if (ei == null) continue;
      const f = fan.faces[i];
      spokes.push({ other, ei, f, m: macroFaceId[f] });
    }
    const k = spokes.length;
    if (k < 3) continue;

    const loop = [];
    for (let i = 0; i < k; i++) {
      const e = edges[spokes[i].ei];
      const col = e.u === v ? 0 : e.cols - 1;
      const prevM = spokes[(i - 1 + k) % k].m;
      const startSide0 = e.ma === prevM;
      for (let j = 0; j <= J; j++) {
        const jj = startSide0 ? j : J - j;
        loop.push(e.grid[jj][col]);
      }
      loop.push(cornerIdx.get(spokes[i].m * 0x100000 + v));
    }
    const clean = [];
    for (const i of loop) {
      if (i == null) continue;
      if (clean.length === 0 || clean[clean.length - 1] !== i) clean.push(i);
    }
    while (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
    if (clean.length < 3) continue;

    let rMin = Infinity;
    let nAvg = [0, 0, 0];
    for (const s of spokes) rMin = Math.min(rMin, edges[s.ei].r);
    let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let rhs = [0, 0, 0];
    const seen = new Set();
    const seenFaces = [];
    for (const s of spokes) {
      if (seen.has(s.m)) continue;
      seen.add(s.m);
      seenFaces.push(s.f);
      const n = frames[s.f].normal;
      nAvg = add(nAvg, n);
      const dPlane = dot(n, P(v));
      const target = dPlane - rMin;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) A[r][c] += n[r] * n[c];
        rhs[r] += n[r] * target;
      }
    }
    nAvg = norm(nAvg);
    const X = solve3(A, rhs) ?? sub(P(v), mul(nAvg, rMin));
    const capFid = spokes[0].f;

    let nx = 0, ny = 0, nz = 0, sx = 0, sy = 0, sz = 0, perim = 0;
    for (let i = 0; i < clean.length; i++) {
      const a = getVert(clean[i]);
      const b = getVert(clean[(i + 1) % clean.length]);
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      sx += a[0]; sy += a[1]; sz += a[2];
      perim += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    const loopArea = Math.hypot(nx, ny, nz) / 2;
    if (!(loopArea > 1e-9 * perim * perim)) continue;
    const outwardLoop = nx * sx + ny * sy + nz * sz > 0;
    const ordered = outwardLoop ? clean : [...clean].reverse();

    const dirApex = norm(sub(P(v), X));
    const cyls = [];
    for (const s of spokes) {
      const e = edges[s.ei];
      if (!e || !(e.r > 1e-12)) continue;
      const n1 = frames[e.fa].normal;
      const n2 = frames[e.fb].normal;
      const d12 = dot(n1, n2);
      if (!(1 + d12 > 1e-9)) continue;
      const A0 = sub(P(v), mul(add(n1, n2), e.r / (1 + d12)));
      const axis = norm(sub(P(s.other), P(v)));
      const det = 1 - d12 * d12;
      cyls.push({ A: A0, axis, r: e.r, n1, n2, d12, det, sTan: dot(sub(X, A0), axis) });
    }
    const envelope = (d) => {
      let rho = rMin;
      for (const { A: Ac, axis, r, n1, n2, d12, det, sTan } of cyls) {
        const w = sub(X, Ac);
        const wPar = dot(w, axis), dPar = dot(d, axis);
        const wp = [w[0] - axis[0] * wPar, w[1] - axis[1] * wPar, w[2] - axis[2] * wPar];
        const dp = [d[0] - axis[0] * dPar, d[1] - axis[1] * dPar, d[2] - axis[2] * dPar];
        const a = dot(dp, dp);
        if (a < 1e-14) continue;
        const b = dot(wp, dp);
        const c = dot(wp, wp) - r * r;
        const disc = b * b - a * c;
        if (disc <= 0) continue;
        const exit = (-b + Math.sqrt(disc)) / a;
        if (exit <= rho) continue;
        const p = add(X, mul(d, exit));
        if (dot(sub(p, Ac), axis) < sTan - 1e-9) continue;
        const pv = sub(p, Ac);
        const pPar = dot(pv, axis);
        const u = [pv[0] - axis[0] * pPar, pv[1] - axis[1] * pPar, pv[2] - axis[2] * pPar];
        if (det > 1e-12) {
          const u1 = dot(u, n1), u2 = dot(u, n2);
          const c1 = (u1 - d12 * u2) / det;
          const c2 = (u2 - d12 * u1) / det;
          if (c1 < -1e-9 * r || c2 < -1e-9 * r) continue;
        }
        rho = exit;
      }
      return rho;
    };
    const rApex = envelope(dirApex);
    const planes = seenFaces.map((f) => {
      const n = frames[f].normal;
      return { n, d: dot(n, P(v)) };
    });
    const clampRadial = (dir, rho) => {
      for (const { n, d } of planes) {
        const dn = dot(n, dir);
        if (dn > 1e-12) {
          const allowed = (d - dot(n, X)) / dn;
          if (allowed < rho) rho = Math.max(allowed, 0);
        }
      }
      return add(X, mul(dir, rho));
    };
    const compact = loopArea / (perim * perim);
    if (compact < 0.03) {
      const nrm = outwardLoop
        ? norm([nx, ny, nz])
        : norm([-nx, -ny, -nz]);
      const axis = Math.abs(nrm[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const e1 = norm(cross(nrm, axis));
      const e2 = cross(nrm, e1);
      const c0 = mul([sx, sy, sz], 1 / clean.length);
      const pts2d = new Float64Array(ordered.length * 2);
      for (let i = 0; i < ordered.length; i++) {
        const d = sub(getVert(ordered[i]), c0);
        pts2d[i * 2] = dot(d, e1);
        pts2d[i * 2 + 1] = dot(d, e2);
      }
      try {
        const local = earClip(pts2d, [...ordered.keys()]);
        for (let i = 0; i < local.length; i += 3) {
          capEmitTri(
            ordered[local[i]],
            ordered[local[i + 1]],
            ordered[local[i + 2]],
            capFid,
            tris,
          );
        }
        continue;
      } catch {
        // Pathological projection — fall through to the apex fan.
      }
    }

    const apexPos = clampRadial(dirApex, rApex);
    const apex = pushVert(apexPos[0], apexPos[1], apexPos[2]);

    const L = Math.max(2, J);
    let prev = ordered;
    const fanStart = tris.length;
    const interior = new Set([apex]);
    const capTri = (a, b, c) => {
      if (a === b || b === c || a === c) return;
      tris.push([a, b, c, capFid]);
    };
    const capQuad = (a, b, c, d) => {
      capTri(a, b, c);
      capTri(a, c, d);
    };
    for (let l = 1; l < L; l++) {
      const t = l / L;
      const ring = new Array(ordered.length);
      for (let i = 0; i < ordered.length; i++) {
        const b = getVert(ordered[i]);
        const dir = norm(
          add(mul(norm(sub(b, X)), 1 - t), mul(dirApex, t)),
        );
        const p = clampRadial(dir, envelope(dir));
        const nearPt = (idx) => {
          const q = getVert(idx);
          return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-9;
        };
        if (nearPt(prev[i])) {
          ring[i] = prev[i];
        } else if (i > 0 && nearPt(ring[i - 1])) {
          ring[i] = ring[i - 1];
        } else if (i === ordered.length - 1 && nearPt(ring[0])) {
          ring[i] = ring[0];
        } else if (nearPt(apex)) {
          ring[i] = apex;
        } else {
          ring[i] = pushVert(p[0], p[1], p[2]);
          interior.add(ring[i]);
        }
      }
      for (let i = 0; i < ordered.length; i++) {
        const i2 = (i + 1) % ordered.length;
        capQuad(prev[i], prev[i2], ring[i2], ring[i]);
      }
      prev = ring;
    }
    for (let i = 0; i < prev.length; i++) {
      const a = prev[i], b = prev[(i + 1) % prev.length];
      capTri(apex, a, b);
    }

    const nudged = new Set();
    for (let ti = fanStart; ti < tris.length; ti++) {
      const [a, b, c] = tris[ti];
      const pa = getVert(a), pb = getVert(b), pc = getVert(c);
      const ux2 = pb[0] - pa[0], uy2 = pb[1] - pa[1], uz2 = pb[2] - pa[2];
      const vx2 = pc[0] - pa[0], vy2 = pc[1] - pa[1], vz2 = pc[2] - pa[2];
      const area2 = Math.hypot(
        uy2 * vz2 - uz2 * vy2,
        uz2 * vx2 - ux2 * vz2,
        ux2 * vy2 - uy2 * vx2,
      );
      if (area2 > 1e-10) continue;
      const target = [a, b, c].find((i) => interior.has(i) && !nudged.has(i));
      if (target === undefined) continue;
      const pT = getVert(target);
      pT[0] -= nAvg[0] * 1e-3;
      pT[1] -= nAvg[1] * 1e-3;
      pT[2] -= nAvg[2] * 1e-3;
      nudged.add(target);
    }
  }

  if (!Number.isFinite(radiusMin)) radiusMin = 0;
  return { faceRings, quads, tris, radiusMin, radiusMax };
}

function capEmitTri(a, b, c, fid, tris) {
  if (a === b || b === c || a === c) return;
  tris.push([a, b, c, fid]);
}

function solve3(A, b) {
  const det =
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  if (Math.abs(det) < 1e-12) return null;
  const solveCol = (col) => {
    const M = A.map((row) => row.slice());
    for (let r = 0; r < 3; r++) M[r][col] = b[r];
    return (
      M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
      M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
      M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
    ) / det;
  };
  return [solveCol(0), solveCol(1), solveCol(2)];
}
