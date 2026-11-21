/**
 * Fixed-order surface subdivision — the first skeleton operator. Each level
 * splits every face flat, in its own plane. Two styles:
 *
 * - "radial" (default): triangles 4:1 via edge midpoints, larger polygons
 *   as centroid fans over the midpoint-split boundary — 2k triangles per
 *   k-gon (8 openings per cube side at level 1).
 * - "grid": triangles still 4:1; larger polygons split into k corner
 *   QUADS (corner, edge midpoint, centroid, previous midpoint) — k per
 *   k-gon (4 openings per cube side at level 1, 16 at level 2).
 *
 * Every edge splits at its midpoint in both styles, so mixed-face solids
 * (icosidodeca: pentagons meeting triangles) stay closed with no
 * T-junctions.
 *
 * Smooth on subdivided meshes (`level > 0`) is a true localized edge fillet:
 * soften sets a rounding radius R = s × the parent inradius, and every vertex
 * projects onto the rounded parent solid (parent inset by R, Minkowski-expanded
 * by R) — never inflating flat face interiors outward. On spiked meshes, each
 * convex spike pyramid fillets its tip and ridges inward via its own flank
 * planes while concave valley edges relax outward. When `level === 0`
 * (`Subdivide = None`), Smooth is applied directly in the shell solidifier via
 * `buildEdgeRounding` so the base face/opening count is preserved.
 */

import { assertSkeleton, assertStarShaped, edgeList } from "./skeleton.js";
import { applyFaceIdentity } from "./hull.js";
import { faceFrames } from "./faceframe.js";

export const SUBDIV_MAX = 2;

/**
 * Effective skeleton subdivision level (explicit `subdiv` only; when
 * `subdiv === 0`, Smooth fillets edges/corners/valleys in `buildShell`
 * without multiplying faces or openings).
 *
 * @param {number} [subdiv]
 * @returns {number}
 */
export function effectiveSubdivLevel(subdiv = 0) {
  return Math.min(SUBDIV_MAX, Math.max(0, Math.floor(subdiv ?? 0)));
}

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 *   unit skeleton (all vertices on the circumsphere)
 * @param {number} level  0 returns the input untouched; clamped to SUBDIV_MAX
 * @param {number} [soften]  0–1 edge fillet: 0 keeps the exact flat solid
 *   (grids of openings on planar faces), 1 rounds down to the inscribed ball.
 * @param {"radial"|"grid"} [style]  polygon split pattern. Default "radial".
 * @returns {{
 *   positions: Float64Array,
 *   faces: number[][],
 *   edges: number[][],
 *   macroFaceId: number[],
 * }}
 */
export function subdivideSkeleton(skeleton, level, soften = 0, style = "radial") {
  const n = Math.min(SUBDIV_MAX, Math.floor(level ?? 0));
  if (!(n > 0)) return skeleton;
  const grid = style === "grid";
  const s = Math.min(1, Math.max(0, soften));

  let cur = {
    positions: skeleton.positions,
    faces: skeleton.faces,
    parentId: skeleton.faces.map((_, i) => i),
  };
  for (let i = 0; i < n; i++) cur = subdivideOnce(cur, grid);

  // When s > 0 under Grid, split quads along the canonical (center, corner)
  // diagonal so bent faces stay strictly planar triangles.
  if (s > 0 && grid) {
    const triFaces = [];
    const triId = [];
    for (let fi = 0; fi < cur.faces.length; fi++) {
      const ring = cur.faces[fi];
      const id = cur.parentId[fi];
      if (ring.length === 4) {
        const [mPrev, a, mNext, center] = ring;
        triFaces.push([center, mPrev, a], [center, a, mNext]);
        triId.push(id, id);
      } else {
        triFaces.push(ring);
        triId.push(id);
      }
    }
    cur = { positions: cur.positions, faces: triFaces, parentId: triId };
  }

  const positions = Float64Array.from(cur.positions);
  if (s > 0) {
    const frames = faceFrames(skeleton);
    const { cells, cellOfFace, hasReflex } = decomposeConvexCells(skeleton, frames);
    if (!hasReflex) {
      let rEnd = Infinity;
      const planes = [];
      for (const f of frames) {
        rEnd = Math.min(rEnd, f.inradius);
        planes.push({ n: f.normal, d: f.inradius });
      }
      const R = s * rEnd;
      for (let i = 0; i < positions.length; i += 3) {
        const p = [positions[i], positions[i + 1], positions[i + 2]];
        const q = projectOntoInset(p, planes, R);
        const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist > R + 1e-12 && dist > 1e-12) {
          const k = R / dist;
          positions[i] = q[0] + dx * k;
          positions[i + 1] = q[1] + dy * k;
          positions[i + 2] = q[2] + dz * k;
        }
      }
      const MELT_START = 0.5;
      if (s > MELT_START) {
        const clip = 1 - ((s - MELT_START) / (1 - MELT_START)) * (1 - rEnd);
        for (let i = 0; i < positions.length; i += 3) {
          const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
          if (r > clip) {
            const k = clip / r;
            positions[i] *= k;
            positions[i + 1] *= k;
            positions[i + 2] *= k;
          }
        }
      }
    } else {
      // Spiked / non-convex mesh: fillet each vertex against its own convex
      // spike cell's flank planes (pulling sharp spike tips and ridges inward
      // without clipping across neighbouring spikes or inflating the centre),
      // then relax concave valley vertices outward.
      const nV = positions.length / 3;
      const vertCells = Array.from({ length: nV }, () => new Set());
      for (let fi = 0; fi < cur.faces.length; fi++) {
        const cid = cellOfFace[cur.parentId[fi]];
        for (const v of cur.faces[fi]) vertCells[v].add(cid);
      }
      let rEnd = Infinity;
      for (const f of frames) rEnd = Math.min(rEnd, f.inradius);
      const R = s * 0.45 * rEnd;
      for (let v = 0; v < nV; v++) {
        if (vertCells[v].size !== 1) continue;
        const cid = vertCells[v].values().next().value;
        const planes = cells[cid];
        const i = v * 3;
        const p = [positions[i], positions[i + 1], positions[i + 2]];
        const q = projectOntoInset(p, planes, R);
        const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist > R + 1e-12 && dist > 1e-12) {
          const k = R / dist;
          positions[i] = q[0] + dx * k;
          positions[i + 1] = q[1] + dy * k;
          positions[i + 2] = q[2] + dz * k;
        }
      }
      // Relax valley vertices (shared by 2+ spike cells) outward toward their
      // 1-ring neighbours to round concave inner joints.
      const nbrs = Array.from({ length: nV }, () => new Set());
      for (const ring of cur.faces) {
        for (let k = 0; k < ring.length; k++) {
          const a = ring[k], b = ring[(k + 1) % ring.length];
          nbrs[a].add(b);
          nbrs[b].add(a);
        }
      }
      const lambda = 0.45 * s;
      for (let pass = 0; pass < 2; pass++) {
        const snap = Float64Array.from(positions);
        for (let v = 0; v < nV; v++) {
          if (vertCells[v].size < 2 && pass === 0) continue;
          const list = [...nbrs[v]];
          if (!list.length) continue;
          let nx = 0, ny = 0, nz = 0;
          for (const u of list) {
            nx += snap[u * 3];
            ny += snap[u * 3 + 1];
            nz += snap[u * 3 + 2];
          }
          nx /= list.length;
          ny /= list.length;
          nz /= list.length;
          const w = vertCells[v].size >= 2 ? lambda : 0.2 * lambda;
          positions[v * 3] += w * (nx - snap[v * 3]);
          positions[v * 3 + 1] += w * (ny - snap[v * 3 + 1]);
          positions[v * 3 + 2] += w * (nz - snap[v * 3 + 2]);
        }
      }
    }
  }
  const identified = applyFaceIdentity(positions, cur.faces, cur.parentId);
  const faces = identified.faces;
  const out = {
    positions,
    faces,
    edges: edgeList(faces),
    macroFaceId: identified.tags,
  };
  assertSkeleton(out);
  assertStarShaped(out);
  return out;
}

/**
 * Group parent faces across non-reflex edges into convex cells (1 cell on any
 * convex solid; one cell per spike pyramid on spiked stars).
 */
function decomposeConvexCells(skeleton, frames) {
  const nF = skeleton.faces.length;
  const uf = Array.from({ length: nF }, (_, i) => i);
  const find = (a) => (uf[a] === a ? a : (uf[a] = find(uf[a])));
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) uf[b] = a;
  };
  const edgeMap = new Map();
  let hasReflex = false;
  for (let f = 0; f < nF; f++) {
    const ring = skeleton.faces[f];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const key = a < b ? a * 0x100000 + b : b * 0x100000 + a;
      const prev = edgeMap.get(key);
      if (prev === undefined) {
        edgeMap.set(key, f);
      } else {
        const fa = prev, fb = f;
        const reflex =
          frames[fa].normal[0] * (frames[fb].origin[0] - frames[fa].origin[0]) +
          frames[fa].normal[1] * (frames[fb].origin[1] - frames[fa].origin[1]) +
          frames[fa].normal[2] * (frames[fb].origin[2] - frames[fa].origin[2]) >
          1e-9;
        if (reflex) hasReflex = true;
        else unite(fa, fb);
      }
    }
  }
  const rootToCell = new Map();
  const cells = [];
  const cellOfFace = new Array(nF);
  for (let f = 0; f < nF; f++) {
    const r = find(f);
    let cid = rootToCell.get(r);
    if (cid === undefined) {
      cid = cells.length;
      rootToCell.set(r, cid);
      cells.push([]);
    }
    cellOfFace[f] = cid;
    cells[cid].push({ n: frames[f].normal, d: frames[f].inradius });
  }
  return { cells, cellOfFace, hasReflex };
}

/**
 * Nearest point of the parent solid inset by R — Dykstra's alternating
 * projection onto {q : n_f·q ≤ d_f − R}. Only planes a point could
 * interact with (violated within a 2R margin) enter the cycle; interior
 * face points converge in one pass, edge/corner points in a few dozen.
 *
 * @param {number[]} p
 * @param {{ n: number[], d: number }[]} planes  parent face planes (unit n)
 * @param {number} R  inset depth
 * @returns {number[]} nearest point in the inset body
 */
function projectOntoInset(p, planes, R) {
  const active = planes.filter(
    ({ n, d }) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] > d - 2 * R - 1e-9,
  );
  const q = [p[0], p[1], p[2]];
  /** Dykstra correction per constraint. */
  const corr = active.map(() => [0, 0, 0]);
  for (let iter = 0; iter < 120; iter++) {
    let moved = 0;
    for (let c = 0; c < active.length; c++) {
      const { n, d } = active[c];
      const y = [q[0] + corr[c][0], q[1] + corr[c][1], q[2] + corr[c][2]];
      const excess = n[0] * y[0] + n[1] * y[1] + n[2] * y[2] - (d - R);
      const nx = excess > 0 ? [y[0] - n[0] * excess, y[1] - n[1] * excess, y[2] - n[2] * excess] : y;
      corr[c] = [y[0] - nx[0], y[1] - nx[1], y[2] - nx[2]];
      moved = Math.max(moved, Math.abs(nx[0] - q[0]), Math.abs(nx[1] - q[1]), Math.abs(nx[2] - q[2]));
      q[0] = nx[0]; q[1] = nx[1]; q[2] = nx[2];
    }
    if (moved < 1e-12) break;
  }
  return q;
}

/**
 * @param {{ positions: ArrayLike<number>, faces: number[][], parentId?: number[] }} skel
 * @param {boolean} [grid]  corner quads instead of centroid fans on n-gons
 * @returns {{ positions: number[], faces: number[][], parentId: number[] }}
 */
function subdivideOnce({ positions, faces, parentId }, grid = false) {
  /** @type {number[]} */
  const pos = Array.from(positions);
  /** @type {Map<number, number>} undirected edge → midpoint vertex */
  const mids = new Map();

  const push = (x, y, z) => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };
  const midpoint = (a, b) => {
    const key = a < b ? a * 0x100000 + b : b * 0x100000 + a;
    let v = mids.get(key);
    if (v == null) {
      v = push(
        (pos[a * 3] + pos[b * 3]) / 2,
        (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2,
        (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2,
      );
      mids.set(key, v);
    }
    return v;
  };

  /** @type {number[][]} */
  const out = [];
  /** @type {number[]} */
  const outId = [];
  const emit = (ring, id) => {
    out.push(ring);
    outId.push(id);
  };
  for (let fi = 0; fi < faces.length; fi++) {
    const ring = faces[fi];
    const id = parentId ? parentId[fi] : fi;
    const k = ring.length;
    if (k === 3) {
      const [a, b, c] = ring;
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      emit([a, ab, ca], id);
      emit([ab, b, bc], id);
      emit([ca, bc, c], id);
      emit([ab, bc, ca], id);
      continue;
    }
    let cx = 0, cy = 0, cz = 0;
    for (const vi of ring) {
      cx += pos[vi * 3];
      cy += pos[vi * 3 + 1];
      cz += pos[vi * 3 + 2];
    }
    const center = push(cx / k, cy / k, cz / k);
    if (grid) {
      for (let i = 0; i < k; i++) {
        const a = ring[i];
        const mPrev = midpoint(ring[(i - 1 + k) % k], a);
        const mNext = midpoint(a, ring[(i + 1) % k]);
        emit([mPrev, a, mNext, center], id);
      }
    } else {
      for (let i = 0; i < k; i++) {
        const a = ring[i], b = ring[(i + 1) % k];
        const m = midpoint(a, b);
        emit([center, a, m], id);
        emit([center, m, b], id);
      }
    }
  }
  return { positions: pos, faces: out, parentId: outId };
}
