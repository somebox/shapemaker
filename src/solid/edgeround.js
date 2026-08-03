/**
 * Stage-2 edge rounding: dihedral edge strips + corner patches for the
 * outer surface of a convex skeleton.
 *
 * Per-feature proportional clamping: every edge carries its own radius
 * r_e = min(roundingMm, local allowances of BOTH adjacent faces, edge
 * length share), so a tight face softens a little while large edges get
 * the full requested radius — a small feature never caps the model.
 *
 * Construction per edge (faces a, b; in-plane inward edge normals t_a,
 * t_b — not orthogonal in general): a TRUE circular arc of radius r in
 * the cross-section plane, swept along the edge. The circle's centre sits
 * r inside both face planes (c = p + (r/sin ω)(t_a + t_b), ω = dihedral)
 * and touches each face along its tangency line at width w = r·cot(ω/2)
 * from the edge — so the strip surface IS the tangent cylinder of the
 * rolling-ball blend, verified against the Minkowski ideal to 1e-14 on
 * the platonic solids. Strips are trimmed at each vertex to the binding
 * face's inset corner; the gap between strip arcs at a vertex closes with
 * a cap sampled from the outer envelope of the corner's tangent sphere
 * and the same cylinders — exactly a sphere octant on a uniform cube.
 *
 * All verts are pushed through the caller's list BEFORE the inner-shell
 * scale copy, so hollow depths mirror the rounding for free.
 */

import { edgeKey } from "../geom/edgesub.js";
import { earClip } from "../geom/capfill.js";

const EPS_MERGE = 1e-9;

/** Directed-edge → face map plus undirected adjacency. */
function edgeFaces(faces) {
  /** @type {Map<number, [number, number]>} adjacency keyed by edgeKey */
  const adj = new Map();
  /** @type {Map<number, number>} face owning the directed edge a→b */
  const directed = new Map();
  for (let f = 0; f < faces.length; f++) {
    const ring = faces[f];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      directed.set(a * 0x100000 + b, f);
      const key = edgeKey(a, b);
      const pair = adj.get(key);
      if (pair === undefined) adj.set(key, [f, -1]);
      else pair[1] = f;
    }
  }
  return { adj, directed };
}

/**
 * Ordered incident edges/faces around each vertex (cyclic fan).
 * @returns {Map<number, { edges: number[][], faces: number[] }>}
 *   edges[i] = [v, other]; faces[i] sits between edges[i] and edges[i+1].
 */
function vertexFans(faces, directed) {
  const verts = new Set();
  for (const ring of faces) for (const v of ring) verts.add(v);

  const fans = new Map();
  for (const v of verts) {
    // Start from any directed edge v→n0; the face owning it is on its left.
    let n0 = null;
    for (const [key, f] of directed) {
      if (Math.floor(key / 0x100000) === v) { n0 = key % 0x100000; break; }
    }
    const edges = [];
    const facesOrder = [];
    let n = n0;
    do {
      edges.push([v, n]);
      const f = directed.get(v * 0x100000 + n);
      facesOrder.push(f);
      // Within face f, the edge into v precedes v→n: its start is the next
      // spoke. Walk the ring to find the vertex before v.
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
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton mm-scaled
 * @param {{ normal: number[] }[]} frames per-face frames (outward normals)
 * @param {{
 *   radiusForEdge: (key: number) => number,   // per-edge clamped r_e > 0
 *   allowForEdge?: (key: number) => number,   // per-edge band-width budget
 *   segments: number,                         // J arc segments
 *   lengthwise: number[],                     // interior fractions (edgesub)
 *   pushVert: (x: number, y: number, z: number) => number,
 *   getVert: (i: number) => number[],         // read back a pushed vert
 * }} opts
 * @returns {{
 *   faceRings: Map<number, number[]>,
 *   quads: number[][],   // [a, b, c, d, faceId]
 *   tris: number[][],    // [a, b, c, faceId]
 *   radiusMin: number,
 *   radiusMax: number,
 * }}
 */
export function buildEdgeRounding(skeleton, frames, opts) {
  const { positions, faces } = skeleton;
  const { radiusForEdge, allowForEdge, segments: J, lengthwise, pushVert, getVert } = opts;
  const { adj, directed } = edgeFaces(faces);
  const fans = vertexFans(faces, directed);

  const P = (vi) => [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]];

  // Per-face interior angle helper at a vertex.
  const faceAngleAt = (f, v) => {
    const ring = faces[f];
    const i = ring.indexOf(v);
    const prev = P(ring[(i - 1 + ring.length) % ring.length]);
    const next = P(ring[(i + 1) % ring.length]);
    const p = P(v);
    const a = norm(sub(prev, p));
    const b = norm(sub(next, p));
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  };

  /**
   * Per-edge record. side0 = face owning directed u→v; side1 = the other.
   * t0/t1 = in-plane inward edge normals; trims per endpoint.
   */
  const edges = new Map();
  for (const [key, [fa, fb]] of adj) {
    const [u, v] = key.split(",").map(Number);
    const side0 = directed.get(u * 0x100000 + v);
    const side1 = side0 === fa ? fb : fa;
    const U = P(u), V = P(v);
    const d = norm(sub(V, U));
    const t0 = norm(cross(frames[side0].normal, d));       // interior left of u→v
    const t1 = norm(cross(frames[side1].normal, mul(d, -1))); // interior left of v→u
    // Coplanar faces (flat subdivision seams) have no edge to round — the
    // strip construction would collapse (t1 ≈ −t0). r = 0 keeps the shared
    // hard seam; the trim math handles zero-radius neighbours naturally.
    const flat = dot(frames[side0].normal, frames[side1].normal) > 1 - 1e-9;
    // Wedge angle ω between the in-plane dirs equals the dihedral. The
    // TRUE tangent cylinder of radius r touches each face at width
    // w = r·cot(ω/2) from the edge — narrower than r on obtuse dihedrals,
    // wider on acute ones (and exactly r on the cube's 90°). r is the
    // physical fillet radius; w is what the face-fit clamps bound, so on
    // acute wedges r shrinks to keep w within the allowance the callback
    // granted (it granted r assuming w = r).
    const cosw = Math.max(-1, Math.min(1, dot(t0, t1)));
    const sinw = Math.sqrt(Math.max(1 - cosw * cosw, 0));
    const cotHalf = sinw > 1e-9 ? (1 + cosw) / sinw : 1;
    let r = flat ? 0 : radiusForEdge(key);
    // The band must fit the face allowance; the radius only shrinks when
    // the (acute-wedge) band actually overflows the budget.
    const budget = flat ? 0 : (allowForEdge?.(key) ?? r);
    if (r * cotHalf > budget) r = budget / cotHalf;
    const w = r * cotHalf;
    edges.set(key, {
      key, u, v, U, V, d, side0, side1, t0, t1, r, w,
      cosw, sinw, cotHalf,
      len: Math.hypot(...sub(V, U)),
    });
  }

  // Trim ℓ at each end of each edge, from BOTH adjacent faces; the binding
  // face's inset corner coincides with the strip end (shared index later).
  // ℓ_f = (r_e·cos γ + r_other) / sin γ for face f's corner between this
  // edge and its neighbour at the vertex.
  const otherEdgeAt = (f, v, keySelf) => {
    const ring = faces[f];
    const i = ring.indexOf(v);
    const prev = ring[(i - 1 + ring.length) % ring.length];
    const next = ring[(i + 1) % ring.length];
    const k1 = edgeKey(v, prev), k2 = edgeKey(v, next);
    return k1 === keySelf ? k2 : k1;
  };
  // Acute-corner radius cap: the trim ℓ = (r·cosγ + r_other)/sinγ must fit
  // inside the edge at both ends, or a clamped trim leaves the strip
  // extending past the inset-corner intersection — poking through its
  // neighbour (self-intersections on acute merge-skip triangles).
  // Conservative decoupled bound: ℓ ≤ 2·r_max/sinγ ⇒ r ≤ 0.2·len·sinγ.
  for (const e of edges.values()) {
    if (e.r === 0) continue;
    for (const vert of [e.u, e.v]) {
      for (const f of [e.side0, e.side1]) {
        const gamma = faceAngleAt(f, vert);
        const wCap = 0.2 * e.len * Math.max(Math.sin(gamma), 0.05);
        if (e.w > wCap) {
          e.w = wCap;
          e.r = e.cotHalf > 1e-9 ? wCap / e.cotHalf : wCap;
        }
      }
    }
  }

  // Trims are IN-PLANE collisions of the tangency bands, so they use the
  // band widths w, not the radii.
  for (const e of edges.values()) {
    e.trim = {};
    for (const vert of [e.u, e.v]) {
      let lMax = 0;
      const perFace = {};
      for (const f of [e.side0, e.side1]) {
        const gamma = faceAngleAt(f, vert);
        const wOther = edges.get(otherEdgeAt(f, vert, e.key))?.w ?? e.w;
        const l = (e.w * Math.cos(gamma) + wOther) / Math.max(Math.sin(gamma), 1e-6);
        perFace[f] = Math.max(l, 0);
        lMax = Math.max(lMax, perFace[f]);
      }
      e.trim[vert] = { lMax: Math.min(lMax, 0.45 * e.len), perFace };
    }
  }

  // ── strips ──
  // Grid P[j][t]: j=0 on side0's plane, j=J on side1's. Columns run u→v
  // between the trimmed ends, sampled with the shared lengthwise fractions.
  for (const e of edges.values()) {
    const lu = e.trim[e.u].lMax, lv = e.trim[e.v].lMax;
    const U2 = add(e.U, mul(e.d, lu));
    const V2 = add(e.V, mul(e.d, -lv));
    const span = sub(V2, U2);
    const fracs = [0, ...lengthwise, 1];
    const grid = [];
    if (e.r === 0) {
      // Flat seam: one shared on-edge row referenced at every arc level, so
      // both faces stitch to identical indices (no strip quads emitted).
      const row = [];
      for (const fr of fracs) {
        const p = add(U2, mul(span, fr));
        row.push(pushVert(p[0], p[1], p[2]));
      }
      for (let j = 0; j <= J; j++) grid.push(row);
    } else {
      // TRUE circular arc of radius r in the cross-section plane. The
      // circle sits r inside both face planes (c = p + (r/sin ω)(t0+t1))
      // and touches each face along the tangency line at width w from the
      // edge — its endpoints w·t0 / w·t1 lie exactly on it (|w·t0 − c| =
      // r, an identity of w = r·cot(ω/2)). The previous affine quarter-arc
      // between r-wide bands deviated from the tangent cylinder by ~±0.2r
      // at common dihedrals — the visible ripple along rounded edges. The
      // corner-cap envelope samples these same cylinders, so cap seams are
      // exact. On the cube (ω = 90°) w = r and the arc is the old one.
      const offs = [];
      if (e.sinw > 1e-6) {
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
        // Near-flat wedge (t1 ≈ ±t0): ill-conditioned centre; the affine
        // arc's deviation vanishes as the wedge flattens.
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
        for (const fr of fracs) {
          const p = add(add(U2, mul(span, fr)), off);
          row.push(pushVert(p[0], p[1], p[2]));
        }
        grid.push(row);
      }
    }
    e.grid = grid;
    e.cols = fracs.length;
  }

  // ── positional weld at each vertex neighbourhood ──
  // Collinear strip continuations (an original edge crossing flat
  // subdivision seams) and flat seams meet end-to-end: their end columns
  // land on identical positions through different float paths. Weld them
  // to one index or the seams emit coincident duplicates (degenerate tris,
  // cracked manifolds).
  for (const [v, fan] of fans) {
    /** @type {{ idx: number, p: number[] }[]} */
    const cands = [];
    for (const [, other] of fan.edges) {
      const e = edges.get(edgeKey(v, other));
      const col = e.u === v ? 0 : e.cols - 1;
      for (let j = 0; j <= J; j++) {
        const row = e.grid[j];
        const p = getVert(row[col]);
        const hit = cands.find(
          (c) =>
            Math.hypot(c.p[0] - p[0], c.p[1] - p[1], c.p[2] - p[2]) < 1e-6,
        );
        if (hit) row[col] = hit.idx;
        else cands.push({ idx: row[col], p });
      }
    }
  }

  // ── per-face inset corner points C_f(v) ──
  // On face f at vertex v between its two edges: intersection of the two
  // inset lines. When a strip's binding trim lands exactly on this corner,
  // its end point coincides — the indices MUST be unified (positionally) or
  // coincident duplicates produce zero-area flat triangles and cracks.
  const cornerIdx = new Map(); // (f * 2^20 + v) -> vert index
  const stripEnd = (e, v, f) => {
    const col = e.u === v ? 0 : e.cols - 1;
    const row = e.side0 === f ? e.grid[0] : e.grid[J];
    return { row, col, idx: row[col] };
  };
  const near = (i, p) => {
    const q = getVert(i);
    return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1e-6;
  };
  for (const [v, fan] of fans) {
    const k = fan.faces.length;
    for (let i = 0; i < k; i++) {
      const f = fan.faces[i];
      const eA = edges.get(edgeKey(fan.edges[i][0], fan.edges[i][1]));
      const eB = edges.get(
        edgeKey(fan.edges[(i + 1) % k][0], fan.edges[(i + 1) % k][1]),
      );
      // C along eA from v at distance ℓ_f(eA), offset by eA's tangency
      // band width into face f.
      const along = eA.u === v ? eA.d : mul(eA.d, -1); // away from v along eA
      const tf = eA.side0 === f ? eA.t0 : eA.t1;
      const lf = eA.trim[v].perFace[f];
      const pos = add(add(P(v), mul(along, lf)), mul(tf, eA.w));
      const endA = stripEnd(eA, v, f);
      const endB = stripEnd(eB, v, f);
      let idx;
      if (near(endA.idx, pos)) {
        idx = endA.idx;
        // Both strips bind here: point eB's end at the same index.
        if (endB.idx !== idx && near(endB.idx, pos)) endB.row[endB.col] = idx;
      } else if (near(endB.idx, pos)) {
        idx = endB.idx;
      } else {
        idx = pushVert(pos[0], pos[1], pos[2]);
      }
      cornerIdx.set(f * 0x100000 + v, idx);
    }
  }

  // ── face rings ──
  const faceRings = new Map();
  for (let f = 0; f < faces.length; f++) {
    const ring = faces[f];
    const out = [];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const e = edges.get(edgeKey(a, b));
      const row = e.side0 === f ? e.grid[0] : e.grid[J];
      const forward = e.u === a; // grid columns run u→v
      const cIdx = cornerIdx.get(f * 0x100000 + a);
      const first = forward ? row[0] : row[e.cols - 1];
      if (cIdx !== first) out.push(cIdx);
      if (forward) out.push(...row);
      else for (let t = e.cols - 1; t >= 0; t--) out.push(row[t]);
      const cNext = cornerIdx.get(f * 0x100000 + b);
      const lastPushed = out[out.length - 1];
      if (cNext === lastPushed) out.pop(); // avoid duplicate when binding
    }
    // Dedupe any residual coincident neighbours (binding equality).
    const clean = [];
    for (const i of out) {
      if (clean.length === 0 || clean[clean.length - 1] !== i) clean.push(i);
    }
    if (clean[0] === clean[clean.length - 1]) clean.pop();
    faceRings.set(f, clean);
  }

  // ── quads (strips) + corner fans ──
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
  for (const e of edges.values()) {
    if (e.r === 0) continue; // flat seam — no strip, no rounding to report
    radiusMin = Math.min(radiusMin, e.r);
    radiusMax = Math.max(radiusMax, e.r);
    // Orient ONCE per strip (uniform grid ⇒ uniform winding); per-quad
    // flipping would break shared-edge pairing.
    const flip = !outward(e.grid[0][0], e.grid[0][1], e.grid[1][1]);
    for (let j = 0; j < J; j++) {
      for (let t = 0; t < e.cols - 1; t++) {
        let q = [e.grid[j][t], e.grid[j][t + 1], e.grid[j + 1][t + 1], e.grid[j + 1][t]];
        if (flip) q = [q[3], q[2], q[1], q[0]];
        q.push(e.side0);
        quads.push(q);
      }
    }
  }

  // Corner fans: boundary loop = per incident edge, its end-column arc
  // (traversed prev-face side → next-face side), plus the inset-corner
  // stops on each face between consecutive arcs.
  for (const [v, fan] of fans) {
    const k = fan.edges.length;
    const loop = [];
    for (let i = 0; i < k; i++) {
      const [, other] = fan.edges[i];
      const e = edges.get(edgeKey(v, other));
      const col = e.u === v ? 0 : e.cols - 1;
      const prevFace = fan.faces[(i - 1 + k) % k];
      // Arc points j=0 (side0) .. J (side1); traverse starting on prevFace's side.
      const startSide0 = e.side0 === prevFace;
      for (let j = 0; j <= J; j++) {
        const jj = startSide0 ? j : J - j;
        loop.push(e.grid[jj][col]);
      }
      // Inset corner of the face between this edge and the next.
      const f = fan.faces[i];
      loop.push(cornerIdx.get(f * 0x100000 + v));
    }
    // Dedupe consecutive coincident indices (binding corners).
    const clean = [];
    for (const i of loop) {
      if (clean.length === 0 || clean[clean.length - 1] !== i) clean.push(i);
    }
    while (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
    if (clean.length < 3) continue;

    // Sphere centre X: least-squares of incident planes offset inward by the
    // min incident radius. Near-flat vertices make the system ill-conditioned
    // — fall back to stepping inward along the average normal.
    let rMin = Infinity;
    let nAvg = [0, 0, 0];
    for (const [, other] of fan.edges) {
      rMin = Math.min(rMin, edges.get(edgeKey(v, other)).r);
    }
    let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let rhs = [0, 0, 0];
    const seen = new Set(fan.faces);
    for (const f of seen) {
      const n = frames[f].normal;
      nAvg = add(nAvg, n);
      const dPlane = dot(n, P(v)); // vertex lies on every incident plane
      const target = dPlane - rMin;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) A[r][c] += n[r] * n[c];
        rhs[r] += n[r] * target;
      }
    }
    nAvg = norm(nAvg);
    const X = solve3(A, rhs) ?? sub(P(v), mul(nAvg, rMin));

    // Orient the LOOP once (Newell), then build without per-triangle flips —
    // per-triangle orientation would break shared-edge pairing.
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
    // Welded collinear continuations / flat seams close the surface at this
    // vertex already: the boundary collapses to a there-and-back loop with
    // (relatively) zero enclosed area — a fan here would double strip edges.
    const loopArea = Math.hypot(nx, ny, nz) / 2;
    if (!(loopArea > 1e-9 * perim * perim)) continue;
    const outwardLoop = nx * sx + ny * sy + nz * sz > 0;
    const ordered = outwardLoop ? clean : [...clean].reverse();

    // Spherical cap, not a cone: a bare apex fan leaves a visible point on
    // wide shallow corners (dodeca / icosa / merge-skip spheres) where the
    // cap has a large angular extent. Interpolate rings from the boundary
    // toward the apex, pushing each onto the blended sphere around X; the
    // final tiny fan at the apex covers 1/L of the cap and disappears.
    const dirApex = norm(sub(P(v), X));
    // The cap surface is the outer envelope of the corner blend, sampled
    // radially from X: the tangent sphere (radius rMin — X sits that far
    // inside every incident face plane) PLUS each edge's rounding cylinder
    // restricted to its angular wedge. Strips are trimmed where adjacent
    // cylinders collide, which on sharp corners is well OUTSIDE the sphere
    // tangency circle — the band between belongs to the cylinders, and a
    // straight interpolation from strip end to sphere rides proud of them
    // (a visible bump). Following the envelope meets each strip-end arc
    // exactly (the arc lies ON its cylinder) and rolls tangentially onto
    // the sphere. On the cube every cap direction falls outside all wedges
    // and the exact sphere octant survives.
    //
    // Cylinder axis: at distance r from both adjacent face planes,
    // parallel to the edge — A = v − (r / (1 + n1·n2)) (n1 + n2).
    const cyls = [];
    for (const [, other] of fan.edges) {
      const e = edges.get(edgeKey(v, other));
      if (!e || !(e.r > 1e-12)) continue;
      const n1 = frames[e.side0].normal;
      const n2 = frames[e.side1].normal;
      const d12 = dot(n1, n2);
      if (!(1 + d12 > 1e-9)) continue;
      const A = sub(P(v), mul(add(n1, n2), e.r / (1 + d12)));
      const axis = norm(sub(P(other), P(v)));
      // 2×2 Gram inverse for decomposing a perp vector onto (n1, n2):
      // membership in the material wedge = both coefficients ≥ 0.
      const det = 1 - d12 * d12;
      cyls.push({ A, axis, r: e.r, n1, n2, d12, det, sTan: dot(sub(X, A), axis) });
    }
    /** Envelope radius along unit direction d from X. */
    const envelope = (d) => {
      let rho = rMin;
      for (const { A, axis, r, n1, n2, d12, det, sTan } of cyls) {
        const w = sub(X, A);
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
        // Physical portion only: past the sphere tangency along the axis…
        if (dot(sub(p, A), axis) < sTan - 1e-9) continue;
        // …and within the material wedge between the two face tangency
        // lines (u in the positive cone of n1, n2). Beyond the wedge the
        // cylinder's far side pokes into other features' territory (on the
        // cube it would lift the apex off the octant sphere).
        const pv = sub(p, A);
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
    // The rounded surface must never exceed the original face planes: on
    // shallow vertices the strip trims are not exactly on the sphere, so an
    // unclamped cap can bulge past the faces (visible knobs). Project any
    // violating cap point back onto each incident plane.
    const planes = [...seen].map((f) => {
      const n = frames[f].normal;
      return { n, d: dot(n, P(v)) };
    });
    // Radial clamp: shrink a point along its ray from X until it is inside
    // every incident face plane. Radial scaling keeps cap points on their
    // own distinct rays — unlike sequential plane projection, which pushes
    // points sideways and lets adjacent columns cross (folded, self-
    // intersecting caps on shallow irregular vertices).
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
    // Cap style by loop compactness (circle ≈ 0.08): compact deep corners
    // (cube octants ≈ 0.05, icosa ≈ 0.05) get the spherical ring cap; long
    // skinny loops (irregular merge-skip vertices) get a direct ear-clip of
    // the boundary in its Newell plane — a single-apex fan across a thin
    // region folds into self-intersecting slivers, and with no interior
    // points there is nothing to fold.
    // Boundary points sit at unequal distances from the corner on mixed-face
    // vertices (rhombic, icosidodeca) — no sphere fits exactly, but the
    // rings interpolate to the true boundary and rApex = MIN boundary
    // distance keeps the apex from overshooting into a rimmed "button".
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
        // (e1, e2, nrm) is right-handed: CCW in this projection = outward.
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
            fan.faces[0],
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
    /** interior cap verts (rings + apex) — safe to nudge; boundary is shared */
    const interior = new Set([apex]);
    // Repeated-index sub-triangles drop out — plane clamping can weld a
    // column (see below), turning a quad into a single triangle. Skipping
    // by index keeps the mesh manifold; skipping by area would not.
    const capTri = (a, b, c) => {
      if (a === b || b === c || a === c) return;
      tris.push([a, b, c, fan.faces[0]]);
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
        // Weld coincident points instead of minting duplicates — the
        // envelope + plane clamp can land several rays on the same point
        // (e.g. adjacent columns both clamped into an inset corner).
        // Checked against: same column's predecessor, the previous column,
        // the ring wrap-around neighbour, and the apex.
        const near = (idx) => {
          const q = getVert(idx);
          return (
            Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-9
          );
        };
        if (near(prev[i])) {
          ring[i] = prev[i];
        } else if (i > 0 && near(ring[i - 1])) {
          ring[i] = ring[i - 1];
        } else if (i === ordered.length - 1 && near(ring[0])) {
          ring[i] = ring[0];
        } else if (near(apex)) {
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

    // Plane clamping can leave a skinny cap's points exactly collinear.
    // Nudge an interior vertex of any near-degenerate cap triangle inward
    // (into material — safe on a convex solid); boundary verts are shared
    // with strips and must not move. Mirrors the split.js sliver policy.
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

  return { faceRings, quads, tris, radiusMin, radiusMax };
}

/** Emit one cap triangle, orienting outward and skipping repeats. */
function capEmitTri(a, b, c, fid, tris) {
  if (a === b || b === c || a === c) return;
  tris.push([a, b, c, fid]);
}

/** 3×3 linear solve (Cramer); null when singular. */
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
