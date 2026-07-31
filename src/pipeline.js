/**
 * Stage runner + per-stage cache.
 *
 * points (normalized) → hull/skeleton (unit) → scale to mm → shell.
 * `faceIndex` is never part of a key — re-resting must not rebuild the solid.
 *
 * Size changes rebuild the solid only; QuickHull is not re-run.
 */

import { BASES, isKnownBase } from "./bases.js";
import { hullToSkeleton, MERGE_POLICY_ID } from "./hull.js";
import { edgeList } from "./skeleton.js";
import { buildShell } from "./solid/shell.js";
import { validationError } from "./validate.js";

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
     */
    hullSkeleton(base) {
      if (!isKnownBase(base)) {
        throw validationError("points", "base", `Unknown base "${base}"`);
      }
      const pointsKey = JSON.stringify({ base });
      const cloud = remember(points, pointsKey, () => BASES[base].points());
      const hullKey = JSON.stringify({ pointsKey, merge: MERGE_POLICY_ID });
      return remember(hulls, hullKey, () => hullToSkeleton(cloud));
    },

    run(state) {
      if (!isKnownBase(state.base)) {
        throw validationError("points", "base", `Unknown base "${state.base}"`);
      }

      const pointsKey = JSON.stringify({ base: state.base });
      const cloud = remember(points, pointsKey, () => BASES[state.base].points());

      const hullKey = JSON.stringify({ pointsKey, merge: MERGE_POLICY_ID });
      const unitSkeleton = remember(hulls, hullKey, () => hullToSkeleton(cloud));

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
export function hullSkeletonForBase(base) {
  return shared.hullSkeleton(base);
}

/** Clear the shared cache (tests). */
export function clearPipelineCache() {
  shared.clear();
}
