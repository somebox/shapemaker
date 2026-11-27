/**
 * Proactive slider ceilings derived from the skeleton (and current border),
 * not from failed validation or applied fillet ranges.
 */

import { faceFrames, projectToFrame } from "./faceframe.js";
import { inradiusRange } from "./skeleton.js";
import { filletRMax, insetScale, collapseMicroEdges } from "./geom/poly2.js";
import { edgeKey } from "./geom/edgesub.js";
import { DEFAULT_STATE, SPIKE_T_MAX } from "./schema.js";
import { evenWallCeiling } from "./solid/offset.js";
import { buildMacroTopology } from "./solid/macro-topo.js";
import { shareRunWidths } from "./solid/edgeround.js";

/** Practical FDM floor (≈ 6 lines at 0.4 mm nozzle). */
export const PRINTABLE_BORDER_MM = 2.5;

/**
 * Printability guidance when the thinnest applied border cannot reach the
 * FDM floor — derived from state + limits + optional applied min mm.
 *
 * @param {{ openings?: boolean, borderFraction?: number|null, borderMm?: number|null }} state
 * @param {{ borderMmMax: number|null }} limits
 * @param {{ min?: number|null }} [appliedBorderMm]  metrics.borderMm when known
 * @returns {{ stage: string, key: string, message: string } | null}
 */
export function borderPrintabilityWarning(state, limits, appliedBorderMm = null) {
  if (state.openings === false) return null;

  let thinnest = null;
  if (appliedBorderMm?.min != null && Number.isFinite(appliedBorderMm.min)) {
    thinnest = appliedBorderMm.min;
  } else if (state.borderMm != null && Number.isFinite(state.borderMm)) {
    thinnest = state.borderMm;
  } else if (
    state.borderFraction != null &&
    Number.isFinite(state.borderFraction) &&
    limits.borderMmMax != null
  ) {
    // Constant fraction → thinnest strut ≈ frac × minEdgeDist;
    // borderMmMax = minEdgeDist × 0.95.
    thinnest = state.borderFraction * (limits.borderMmMax / 0.95);
  } else {
    const max = limits.borderMmMax;
    if (max == null || !Number.isFinite(max) || max >= PRINTABLE_BORDER_MM) {
      return null;
    }
    thinnest = max;
  }

  if (thinnest == null || !Number.isFinite(thinnest) || thinnest >= PRINTABLE_BORDER_MM) {
    return null;
  }
  const key = state.borderFraction != null ? "borderFraction" : "borderMm";
  return {
    stage: "limits",
    key,
    message:
      `Thinnest borders on this shape are ${thinnest.toFixed(1)} mm — below the ` +
      `≈${PRINTABLE_BORDER_MM} mm printable floor. Scale up or reduce density to print this.`,
  };
}
/**
 * Even-wall ceilings of the last few skeletons, newest first. Every
 * rebuild asks for the ceiling, and dragging Wall, Rounding, Border or
 * Fillet rebuilds on the same skeleton. The corner offsets, and where
 * slivers are in play the search for the first refused wall (tens of
 * milliseconds, 150 on some shapes), are worked out once per shape. Kept
 * by content, as copies: a rebuild makes a new skeleton object each time.
 */
const wallCeilings = [];
const WALL_CEILINGS_KEPT = 4;

function evenWallCeilingOf(skeleton, frames) {
  const hit = wallCeilings.find((kept) => sameSkeleton(kept, skeleton));
  if (hit) return hit.ceiling;
  const ceiling = evenWallCeiling(skeleton, frames);
  wallCeilings.unshift({
    positions: skeleton.positions.slice(),
    faces: skeleton.faces.map((ring) => ring.slice()),
    ceiling,
  });
  wallCeilings.length = Math.min(wallCeilings.length, WALL_CEILINGS_KEPT);
  return ceiling;
}

function sameSkeleton(a, b) {
  if (a.positions.length !== b.positions.length || a.faces.length !== b.faces.length) return false;
  for (let i = 0; i < a.positions.length; i++) {
    if (a.positions[i] !== b.positions[i]) return false;
  }
  for (let f = 0; f < a.faces.length; f++) {
    const p = a.faces[f], q = b.faces[f];
    if (p.length !== q.length) return false;
    for (let k = 0; k < p.length; k++) if (p[k] !== q[k]) return false;
  }
  return true;
}

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {{
 *   depth?: string,
 *   openings?: boolean,
 *   borderMm?: number|null,
 *   borderFraction?: number|null,
 *   wallMm?: number,  // rounding ceiling input; defaults to DEFAULT_STATE.wallMm
 * }} state
 * @returns {{ wallMmMax: number|null, borderMmMax: number|null, borderFractionMax: number|null, filletMmMax: number|null, roundingMmMax: number|null, spikeMin: number, spikeMax: number }}
 */
export function computeLimits(skeleton, state) {
  const frames = faceFrames(skeleton);
  const inradius = inradiusRange(frames);
  const depth = state.depth ?? "hollow";
  const openings = state.openings !== false;

  const even = (state.wallMode ?? DEFAULT_STATE.wallMode) === "even";
  const wallMmMax = depth !== "hollow"
    ? null
    : even
      // 90% of the wall the builder first refuses: an inner edge folds or
      // an inner face turns inside out, with the offsets that wall is
      // built with.
      ? evenWallCeilingOf(skeleton, frames)
      : inradius.min * 0.9;

  let borderMmMax = null;
  let borderFractionMax = null;
  let filletMmMax = null;
  let roundingMmMax = null;
  // Rounding clamps per feature (each macro edge by its adjacent faces'
  // tangency-band allowances and corner trim), so the slider ceiling is the
  // largest radius any edge or opening rim on the model can actually use.
  let maxStage2 = maxMacroEdgeRoundingMm(skeleton, frames, openings, state);

  if (openings) {
    let minEdgeDist = Infinity;
    let minFillet = Infinity;
    let minBorderFlat = Infinity;
    borderFractionMax = 0.9;
    for (let fi = 0; fi < frames.length; fi++) {
      const frame = frames[fi];
      minEdgeDist = Math.min(minEdgeDist, frame.edgeDistMin);

      const ring = skeleton.faces[fi];
      const corners = [];
      for (const vi of ring) {
        corners.push(projectToFrame(
          frame,
          skeleton.positions[vi * 3],
          skeleton.positions[vi * 3 + 1],
          skeleton.positions[vi * 3 + 2],
        ));
      }
      const fraction = state.borderMm != null
        ? state.borderMm / frame.edgeDistMin
        : state.borderFraction;
      if (Number.isFinite(fraction) && fraction >= 0 && fraction < 1) {
        // Micro edges are swallowed by the fillet path, so they must not
        // drag the slider ceiling down either.
        minFillet = Math.min(
          minFillet,
          filletRMax(collapseMicroEdges(insetScale(corners, fraction))) * 0.999,
        );
        minBorderFlat = Math.min(minBorderFlat, frame.edgeDistMin * fraction);
      }
    }
    // Constant-mm ceiling (legacy / printability): still the smallest face.
    borderMmMax = minEdgeDist * 0.95;
    filletMmMax = Number.isFinite(minFillet) ? minFillet : null;

    if (depth === "hollow" && Number.isFinite(minBorderFlat)) {
      const wallMm = state.wallMm ?? DEFAULT_STATE.wallMm;
      // Even walls keep each inner face's flat; Scaled shrinks it by s.
      const s = even ? 1 : 1 - wallMm / inradius.min;
      if (s > 0 && Number.isFinite(s)) {
        const rimMax = 0.95 * Math.min(wallMm / 2, s * minBorderFlat);
        if (rimMax > 0) maxStage2 = Math.max(maxStage2, rimMax);
      }
    }
  }
  roundingMmMax = maxStage2 > 0 ? maxStage2 : null;

  return {
    wallMmMax,
    borderMmMax,
    borderFractionMax,
    filletMmMax,
    roundingMmMax,
    spikeMin: 0,
    spikeMax: SPIKE_T_MAX,
  };
}

/**
 * Maximum physical ball radius (mm) that Stage-2 dihedral edge rounding can
 * apply across the skeleton's convex macro edges, accounting for per-edge
 * face-band budgets (w = r·cot(ω/2) ≤ allow) and the 0.45·len corner-trim
 * solver in buildEdgeRounding.
 */
function maxMacroEdgeRoundingMm(skeleton, frames, openings, state) {
  const { positions, faces } = skeleton;
  const allow = new Map();
  for (let fi = 0; fi < faces.length; fi++) {
    const ring = faces[fi];
    const frame = frames[fi];
    const frac = openings
      ? (state.borderMm != null ? state.borderMm / frame.edgeDistMin : state.borderFraction)
      : null;
    if (openings && !(Number.isFinite(frac) && frac > 0 && frac < 1)) continue;
    for (let k = 0; k < ring.length; k++) {
      const key = edgeKey(ring[k], ring[(k + 1) % ring.length]);
      const width = frame.edgeDist[k];
      const a = openings ? 0.6 * frac * width : 0.80 * width;
      const prev = allow.get(key);
      allow.set(key, prev == null ? a : Math.min(prev, a));
    }
  }
  if (openings && allow.size === 0) return 0;

  let circumradius = 0;
  for (let i = 0; i < positions.length; i += 3) {
    circumradius = Math.max(
      circumradius,
      Math.hypot(positions[i], positions[i + 1], positions[i + 2]),
    );
  }
  const wFloor = 1e-3 * circumradius;

  const topo = buildMacroTopology(skeleton, frames);
  const { outerRing, cornerVerts } = topo;
  const P = (vi) => [positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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
  const macroAngleAt = (m, v) => {
    const ring = outerRing[m];
    if (!ring || ring.length < 3) return Math.PI / 2;
    const i = ring.indexOf(v);
    if (i < 0) return Math.PI / 2;
    const prev = P(ring[(i - 1 + ring.length) % ring.length]);
    const next = P(ring[(i + 1) % ring.length]);
    const p = P(v);
    return Math.acos(
      Math.max(-1, Math.min(1, dot(norm(sub(prev, p)), norm(sub(next, p))))),
    );
  };

  const edges = [];
  for (const me of topo.edges) {
    const u = me.verts[0], v = me.verts[me.verts.length - 1];
    const U = P(u), V = P(v);
    const len = Math.hypot(...sub(V, U));
    if (!(len > 1e-12) || !Number.isFinite(len)) continue;
    const d = norm(sub(V, U));
    const t0 = norm(cross(frames[me.fa].normal, d));
    const t1 = norm(cross(frames[me.fb].normal, [-d[0], -d[1], -d[2]]));
    const flat = dot(frames[me.fa].normal, frames[me.fb].normal) > 1 - 1e-9;
    const reflex = dot(
      frames[me.fa].normal,
      sub(frames[me.fb].origin, frames[me.fa].origin),
    ) > 1e-9;
    const cosw = Math.max(-1, Math.min(1, dot(t0, t1)));
    const sinw = Math.sqrt(Math.max(1 - cosw * cosw, 0));
    const cotHalf = sinw > 1e-9 ? (1 + cosw) / sinw : 1;
    let w = 0;
    if (!flat && !reflex) {
      w = Math.min(...me.keys.map((k) => allow.get(k) ?? 0));
      if (!(w >= wFloor) || !Number.isFinite(w)) w = 0;
    }
    const r = cotHalf > 1e-9 ? w / cotHalf : w;
    edges.push({ keys: me.keys, ma: me.ma, mb: me.mb, u, v, d, r, w, cotHalf, len });
  }

  const edgeByTopo = new Map();
  for (let i = 0; i < edges.length; i++) {
    for (const k of edges[i].keys) edgeByTopo.set(k, i);
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
  const trimAt = (e, vert, m) => {
    const gamma = macroAngleAt(m, vert);
    const wOther = otherEdgeAtMacro(m, vert, e)?.w ?? e.w;
    return Math.max(
      (e.w * Math.cos(gamma) + wOther) / Math.max(Math.sin(gamma), 1e-6),
      0,
    );
  };
  const setWidth = (e, w) => {
    e.w = w;
    e.r = e.w < wFloor ? 0 : e.cotHalf > 1e-9 ? e.w / e.cotHalf : e.w;
    if (e.r === 0) e.w = 0;
  };
  // The builder gives each straight run of strips one width, and narrows a
  // run together: a ceiling solved edge by edge would promise a radius the
  // builder then clamps, leaving dead travel at the top of the slider.
  if (!skeleton.macroFaceId) shareRunWidths(edges, topo, cornerVerts, edgeByTopo, setWidth);
  const narrow = (e, k) => {
    for (const x of e.run ?? [e]) setWidth(x, x.w * k);
  };
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const e of edges) {
      for (const vert of [e.u, e.v]) {
        if (!cornerVerts.has(vert)) continue;
        for (const m of [e.ma, e.mb]) {
          const l = trimAt(e, vert, m);
          const cap = 0.45 * e.len;
          if (!(l > cap)) continue;
          const other = otherEdgeAtMacro(m, vert, e);
          const k = pass < 11 ? (0.999 * cap) / l : 0;
          if (e.w > 0) narrow(e, k);
          if (other && other.w > 0) narrow(other, k);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  let rMax = 0;
  for (const e of edges) {
    if (e.r > rMax) rMax = e.r;
  }
  return rMax;
}
