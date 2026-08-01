/**
 * Stage runner + per-stage cache.
 *
 * points (normalized) → hull/skeleton (unit) → scale to mm → shell.
 * `faceIndex` is never part of a key — re-resting must not rebuild the solid.
 *
 * Size changes rebuild the solid only; QuickHull is not re-run.
 */

import { BASES, isKnownBase } from "./bases.js";
import { hullToSkeleton, MERGE_POLICY_ID, MERGE_SKIP_ID } from "./hull.js";
import { edgeList } from "./skeleton.js";
import { buildShell } from "./solid/shell.js";
import { validationError } from "./validate.js";
import { DEFAULT_STATE } from "./schema.js";
import { jitterPoints } from "./points/jitter.js";

/**
 * Generator + jitter params for a base — minimal, so cache keys stay small.
 * Jitter applies to any base; its seed rides along whenever jitter > 0.
 */
function generatorParams(base, state) {
  const jitter = state.jitter ?? DEFAULT_STATE.jitter;
  const out = jitter > 0 ? { jitter, seed: state.seed ?? DEFAULT_STATE.seed } : {};
  if (!BASES[base]?.parametric) return out;
  return {
    ...out,
    points: state.points ?? DEFAULT_STATE.points,
    seed: state.seed ?? DEFAULT_STATE.seed,
    separation: state.separation ?? DEFAULT_STATE.separation,
  };
}

/**
 * Merge policy — coplanar merge runs ONLY for exact regular generators at
 * jitter 0. Random bases and any nonzero jitter skip it: jittered points are
 * almost never coplanar, so merging would be a no-op with over-merge risk
 * (Phase 4 locked decision; supersedes the earlier tighter-tolerance idea).
 */
function mergePolicy(base, params) {
  if (BASES[base]?.merge === false) return MERGE_SKIP_ID;
  if (params.jitter > 0) return MERGE_SKIP_ID;
  return MERGE_POLICY_ID;
}

/** Apply on-sphere jitter when requested; identity (fresh copy) at jitter 0. */
function withJitter(cloud, params) {
  if (!(params.jitter > 0)) return cloud;
  return jitterPoints(cloud, { seed: params.seed, jitter: params.jitter });
}

/** Two slots per stage: enough for the preview/export pair, no unbounded growth. */
export function createPipeline() {
  const points = new Map();
  const hulls = new Map();
  const solids = new Map();

  const remember = (map, key, make) => {
    if (map.has(key)) return map.get(key);
    const value = make();
    if (map.size >= 2) map.delete(map.keys().next().value);
    map.set(key, value);
    return value;
  };

  return {
    /**
     * Normalized hull skeleton for a base (unit circumradius).
     * Used by base-change adaptation to obtain limits without a full compile.
     * @param {string} base
     * @param {object} [state]  supplies generator params for parametric bases
     */
    hullSkeleton(base, state = {}) {
      if (!isKnownBase(base)) {
        throw validationError("points", "base", `Unknown base "${base}"`);
      }
      const params = generatorParams(base, state);
      const pointsKey = JSON.stringify({ base, ...params });
      const cloud = remember(points, pointsKey, () =>
        withJitter(BASES[base].points(params), params),
      );
      const merge = mergePolicy(base, params);
      const hullKey = JSON.stringify({ pointsKey, merge });
      return remember(hulls, hullKey, () =>
        hullToSkeleton(cloud, merge === MERGE_SKIP_ID ? { merge: false } : {}),
      );
    },

    run(state) {
      if (!isKnownBase(state.base)) {
        throw validationError("points", "base", `Unknown base "${state.base}"`);
      }

      const params = generatorParams(state.base, state);
      const pointsKey = JSON.stringify({ base: state.base, ...params });
      const cloud = remember(points, pointsKey, () =>
        withJitter(BASES[state.base].points(params), params),
      );

      const merge = mergePolicy(state.base, params);
      const hullKey = JSON.stringify({ pointsKey, merge });
      const unitSkeleton = remember(hulls, hullKey, () =>
        hullToSkeleton(cloud, merge === MERGE_SKIP_ID ? { merge: false } : {}),
      );

      const solidKey = JSON.stringify({
        hullKey,
        circumdiameterMm: state.circumdiameterMm,
        wallMm: state.wallMm,
        borderMm: state.borderMm ?? null,
        borderFraction: state.borderFraction ?? null,
        filletMm: state.filletMm,
        edgeDiv: state.edgeDiv,
        openings: state.openings,
        depth: state.depth,
      });

      const { skeleton, solid } = remember(solids, solidKey, () => {
        const R = state.circumdiameterMm / 2;
        const skeleton = scaleSkeleton(unitSkeleton, R);
        const solid = buildShell(skeleton, {
          wallMm: state.wallMm,
          borderMm: state.borderMm,
          borderFraction: state.borderFraction,
          filletMm: state.filletMm,
          edgeDiv: state.edgeDiv,
          openings: state.openings,
          depth: state.depth,
        });
        return { skeleton, solid };
      });

      return { skeleton, solid };
    },

    clear() {
      points.clear();
      hulls.clear();
      solids.clear();
    },
  };
}

/**
 * @param {{ positions: Float64Array, faces: number[][], edges?: number[][] }} unit
 * @param {number} radius
 */
export function scaleSkeleton(unit, radius) {
  const positions = new Float64Array(unit.positions.length);
  for (let i = 0; i < unit.positions.length; i++) {
    positions[i] = unit.positions[i] * radius;
  }
  const faces = unit.faces.map((f) => f.slice());
  return { positions, faces, edges: edgeList(faces) };
}

const shared = createPipeline();

/** @param {object} state */
export function runPipeline(state) {
  return shared.run(state);
}

/** Normalized unit hull for a base (shared cache). */
export function hullSkeletonForBase(base, state = {}) {
  return shared.hullSkeleton(base, state);
}

/** Clear the shared cache (tests). */
export function clearPipelineCache() {
  shared.clear();
}
