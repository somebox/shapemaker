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
import { perturbSkeletonPlanes } from "./plane-perturb.js";
import { subdivideSkeleton } from "./subdivide.js";

/**
 * Generator + jitter params for a base — minimal, so cache keys stay small.
 * Jitter applies to any base; its seed rides along whenever jitter > 0.
 */
function generatorParams(base, state) {
  const jitter = state.jitter ?? DEFAULT_STATE.jitter;
  const subdiv = state.subdiv ?? DEFAULT_STATE.subdiv;
  const out = {
    ...(jitter > 0
      ? {
          jitter,
          seed: state.seed ?? DEFAULT_STATE.seed,
          mode: state.jitterMode ?? DEFAULT_STATE.jitterMode,
        }
      : {}),
    ...(subdiv > 0
      ? { subdiv, soften: state.soften ?? DEFAULT_STATE.soften }
      : {}),
  };
  if (!BASES[base]?.parametric) return out;
  return {
    ...out,
    points: state.points ?? DEFAULT_STATE.points,
    seed: state.seed ?? DEFAULT_STATE.seed,
    separation: state.separation ?? DEFAULT_STATE.separation,
  };
}

/**
 * Merge policy — coplanar merge runs for exact regular generators; jittered
 * regulars keep it too, because their jitter is applied to face *planes*
 * after the merge (vertices re-derived via the dual hull, polygons kept).
 * Random bases with nonzero jitter still skip: jittered random points are
 * almost never coplanar, so merging would be a no-op with over-merge risk.
 */
function mergePolicy(base, params) {
  if (BASES[base]?.merge === false) return MERGE_SKIP_ID;
  if (params.jitter > 0 && !BASES[base]?.regular) return MERGE_SKIP_ID;
  return MERGE_POLICY_ID;
}

/**
 * On-sphere point jitter for non-regular bases; identity elsewhere. Regular
 * bases jitter after the hull stage via plane perturbation instead.
 */
function withJitter(base, cloud, params) {
  if (!(params.jitter > 0)) return cloud;
  if (BASES[base]?.regular) return cloud;
  return jitterPoints(cloud, {
    seed: params.seed,
    jitter: params.jitter,
    mode: params.mode,
  });
}

/**
 * Hull stage for one base. Operation order is load-bearing:
 * jitter (distort the form) → subdivide (add resolution) → smooth (fillet).
 * Plane perturbation must run on the simple base solid — perturbing the
 * near-coplanar plane families a subdivision creates makes most of them
 * non-binding, silently discarding the subdivision and its smoothing. The
 * parametric bases follow the same order naturally (points jitter before
 * the hull).
 */
function buildUnitSkeleton(base, cloud, merge, params) {
  let sk = hullToSkeleton(cloud, merge === MERGE_SKIP_ID ? { merge: false } : {});
  if (BASES[base]?.regular && params.jitter > 0) {
    sk = perturbSkeletonPlanes(sk, {
      seed: params.seed,
      jitter: params.jitter,
      mode: params.mode,
    });
  }
  if (params.subdiv > 0) {
    sk = subdivideSkeleton(sk, params.subdiv, (params.soften ?? 0) / 100);
  }
  return sk;
}

/** Two slots per stage: enough for the preview/export pair, no unbounded growth. */
export function createPipeline() {
  const points = new Map();
  const hulls = new Map();
  const solids = new Map();

  // LRU: a hit re-inserts the key so the most-recently-used entry survives
  // eviction (Map preserves insertion order; delete+set refreshes it).
  const remember = (map, key, make) => {
    if (map.has(key)) {
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    }
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
        withJitter(base, BASES[base].points(params), params),
      );
      const merge = mergePolicy(base, params);
      const hullKey = JSON.stringify({ pointsKey, merge });
      return remember(hulls, hullKey, () =>
        buildUnitSkeleton(base, cloud, merge, params),
      );
    },

    run(state) {
      if (!isKnownBase(state.base)) {
        throw validationError("points", "base", `Unknown base "${state.base}"`);
      }

      const params = generatorParams(state.base, state);
      const pointsKey = JSON.stringify({ base: state.base, ...params });
      const cloud = remember(points, pointsKey, () =>
        withJitter(state.base, BASES[state.base].points(params), params),
      );

      const merge = mergePolicy(state.base, params);
      const hullKey = JSON.stringify({ pointsKey, merge });
      const unitSkeleton = remember(hulls, hullKey, () =>
        buildUnitSkeleton(state.base, cloud, merge, params),
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
