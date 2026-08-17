/**
 * Macro-face topology for Stage-2 rounding.
 *
 * Subdivision splits a parent face into coplanar microfaces. Those internal
 * seams are mesh refinement, not dihedral features: rounding must follow the
 * parent (macro) graph. Smooth can bend a parent group out of plane — those
 * facets stay independent so Form Rounding operates on the faceted surface.
 *
 * Parent-face ids from subdivision are authoritative when the tagged faces
 * are still coplanar. Absent ids (no subdiv), adjacent coplanar faces merge
 * the same way.
 */

import { edgeKey } from "../geom/edgesub.js";

const COPLANAR_DOT = 1 - 1e-9;
const COLLINEAR_DOT = 1 - 1e-9;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * @param {{ positions: Float64Array, faces: number[][], macroFaceId?: number[] }} skeleton
 * @param {{ normal: number[] }[]} frames
 * @returns {{
 *   macroFaceId: number[],
 *   adj: Map<string, [number, number]>,
 *   directed: Map<number, number>,
 *   outerRing: number[][],
 *   edges: {
 *     verts: number[],
 *     keys: string[],
 *     fa: number,
 *     fb: number,
 *     ma: number,
 *     mb: number,
 *   }[],
 *   keyToEdge: Map<string, number>,
 *   cornerVerts: Set<number>,
 *   vertEdges: Map<number, number[]>,
 *   internalKeys: Set<string>,
 * }}
 */
export function buildMacroTopology(skeleton, frames) {
  const { positions, faces } = skeleton;
  const n = faces.length;
  const P = (vi) => [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]];

  const { adj, directed } = edgeFaces(faces);
  const parentTag = skeleton.macroFaceId;

  const uf = [...Array(n).keys()];
  const find = (a) => {
    while (uf[a] !== a) a = uf[a] = uf[uf[a]];
    return a;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) uf[b] = a;
  };

  for (const [, [fa, fb]] of adj) {
    if (fa < 0 || fb < 0) continue;
    if (dot(frames[fa].normal, frames[fb].normal) <= COPLANAR_DOT) continue;
    if (parentTag && parentTag[fa] !== parentTag[fb]) continue;
    unite(fa, fb);
  }

  const rootToMacro = new Map();
  const macroFaceId = new Array(n);
  let nMacro = 0;
  for (let f = 0; f < n; f++) {
    const r = find(f);
    if (!rootToMacro.has(r)) rootToMacro.set(r, nMacro++);
    macroFaceId[f] = rootToMacro.get(r);
  }

  const members = Array.from({ length: nMacro }, () => []);
  for (let f = 0; f < n; f++) members[macroFaceId[f]].push(f);

  const outerRing = members.map((group, m) =>
    outerRingForMacro(m, group, faces, directed, macroFaceId),
  );

  const internalKeys = new Set();
  /** @type {Map<string, { u: number, v: number, key: string, fa: number, fb: number }[]>} */
  const byPair = new Map();
  for (const [key, [fa, fb]] of adj) {
    if (fa < 0 || fb < 0) continue;
    const ma = macroFaceId[fa], mb = macroFaceId[fb];
    if (ma === mb) {
      internalKeys.add(key);
      continue;
    }
    const pair = ma < mb ? `${ma},${mb}` : `${mb},${ma}`;
    const [u, v] = key.split(",").map(Number);
    const list = byPair.get(pair);
    const rec = { u, v, key, fa, fb };
    if (list) list.push(rec);
    else byPair.set(pair, [rec]);
  }

  const edges = [];
  const keyToEdge = new Map();
  for (const segs of byPair.values()) {
    for (const chain of chainSegments(segs, P)) {
      if (chain.verts.length < 2) continue;
      const a = chain.verts[0], b = chain.verts[1];
      const fa = directed.get(a * 0x100000 + b);
      const fb = directed.get(b * 0x100000 + a);
      if (fa == null || fb == null) continue;
      const ei = edges.length;
      edges.push({
        verts: chain.verts,
        keys: chain.keys,
        fa,
        fb,
        ma: macroFaceId[fa],
        mb: macroFaceId[fb],
      });
      for (const k of chain.keys) keyToEdge.set(k, ei);
    }
  }

  const macrosAt = new Map();
  for (let f = 0; f < n; f++) {
    const m = macroFaceId[f];
    for (const v of faces[f]) {
      let set = macrosAt.get(v);
      if (!set) {
        set = new Set();
        macrosAt.set(v, set);
      }
      set.add(m);
    }
  }
  const cornerVerts = new Set();
  for (const [v, set] of macrosAt) {
    if (set.size >= 3) cornerVerts.add(v);
  }

  /** @type {Map<number, number[]>} */
  const vertEdges = new Map();
  for (let ei = 0; ei < edges.length; ei++) {
    const verts = edges[ei].verts;
    for (const v of [verts[0], verts[verts.length - 1]]) {
      const list = vertEdges.get(v);
      if (list) list.push(ei);
      else vertEdges.set(v, [ei]);
    }
  }

  return {
    macroFaceId,
    adj,
    directed,
    outerRing,
    edges,
    keyToEdge,
    cornerVerts,
    vertEdges,
    internalKeys,
  };
}

function edgeFaces(faces) {
  /** @type {Map<string, [number, number]>} */
  const adj = new Map();
  /** @type {Map<number, number>} */
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

function outerRingForMacro(mId, members, faces, directed, macroFaceId) {
  let startA = -1, startB = -1;
  for (const f of members) {
    const ring = faces[f];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const opp = directed.get(b * 0x100000 + a);
      if (opp == null || macroFaceId[opp] !== mId) {
        startA = a;
        startB = b;
        break;
      }
    }
    if (startA >= 0) break;
  }
  if (startA < 0) return [];

  const out = [startA];
  let a = startA, b = startB;
  for (let guard = 0; guard < 8192; guard++) {
    out.push(b);
    if (b === startA) break;
    let next = -1;
    for (const f of members) {
      const ring = faces[f];
      const i = ring.indexOf(b);
      if (i < 0) continue;
      const n = ring[(i + 1) % ring.length];
      if (n === a) continue;
      const opp = directed.get(n * 0x100000 + b);
      if (opp == null || macroFaceId[opp] !== mId) {
        next = n;
        break;
      }
    }
    if (next < 0) break;
    a = b;
    b = next;
  }
  if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

function chainSegments(segs, P) {
  /** @type {Map<number, { other: number, key: string }[]>} */
  const nbr = new Map();
  const add = (a, b, key) => {
    const list = nbr.get(a);
    if (list) list.push({ other: b, key });
    else nbr.set(a, [{ other: b, key }]);
  };
  for (const s of segs) {
    add(s.u, s.v, s.key);
    add(s.v, s.u, s.key);
  }
  const used = new Set();
  const unusedFrom = (v) => (nbr.get(v) || []).filter((x) => !used.has(x.key));

  const walk = (v0, toward) => {
    const verts = [v0];
    const keys = [];
    let v = v0;
    let prevDir = null;
    let hint = toward;
    for (let guard = 0; guard < 4096; guard++) {
      const opts = unusedFrom(v);
      let pick = null;
      if (hint != null) {
        pick = opts.find((o) => o.other === hint) ?? null;
        hint = null;
      }
      if (!pick && opts.length === 1 && !prevDir) pick = opts[0];
      else if (!pick && opts.length >= 1 && prevDir) {
        let best = null, bestDot = -2;
        for (const o of opts) {
          const d = norm(sub(P(o.other), P(v)));
          const dp = dot(prevDir, d);
          if (dp > bestDot) {
            bestDot = dp;
            best = o;
          }
        }
        if (best && bestDot > COLLINEAR_DOT) pick = best;
      }
      if (!pick) break;
      used.add(pick.key);
      keys.push(pick.key);
      prevDir = norm(sub(P(pick.other), P(v)));
      v = pick.other;
      verts.push(v);
      if (v === v0) break;
    }
    return { verts, keys };
  };

  const chains = [];
  const starts = [];
  for (const [v, list] of nbr) {
    if (list.length === 1) starts.push(v);
  }
  for (const v of starts) {
    for (const o of unusedFrom(v)) chains.push(walk(v, o.other));
  }
  for (const s of segs) {
    if (used.has(s.key)) continue;
    chains.push(walk(s.u, s.v));
  }
  return chains.filter((c) => c.keys.length > 0);
}
