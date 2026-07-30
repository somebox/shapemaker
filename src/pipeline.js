/**
 * Stage runner + per-stage cache.
 *
 * Cache key = hash of that stage's relevant params. `faceIndex` is NOT part of
 * any key — re-resting must never rebuild the solid.
 *
 * The cache is an *instance*, not module state, so two compiles with different
 * quality settings (preview LOD vs full-quality export — SPEC § Architecture)
 * do not evict each other. `runPipeline` uses a shared default instance for
 * convenience; callers that need isolation create their own.
 */

import { icosidodecahedron } from "./points/icosidodeca.js";
import { edgeList } from "./skeleton.js";
import { buildShell } from "./solid/shell.js";
import { validationError } from "./validate.js";

/** Two slots per stage: enough for the preview/export pair, no unbounded growth. */
export function createPipeline() {
  const points = new Map();
  const solids = new Map();

  const remember = (map, key, make) => {
    if (map.has(key)) return map.get(key);
    const value = make();
    if (map.size >= 2) map.delete(map.keys().next().value);
    map.set(key, value);
    return value;
  };

  return {
    run(state) {
      const pointsKey = JSON.stringify({
        base: state.base,
        circumdiameterMm: state.circumdiameterMm,
      });
      const skeleton = remember(points, pointsKey, () => {
        if (state.base !== "icosidodeca") {
          throw validationError("points", "base", `Base "${state.base}" arrives in M3`);
        }
        const { positions, faces } = icosidodecahedron(state.circumdiameterMm / 2);
        return { positions, faces, edges: edgeList(faces) };
      });

      const solidKey = JSON.stringify({
        pointsKey,
        wallMm: state.wallMm,
        borderMm: state.borderMm ?? null,
        borderFraction: state.borderFraction ?? null,
        filletMm: state.filletMm,
        edgeDiv: state.edgeDiv,
        openings: state.openings,
        depth: state.depth,
      });
      const solid = remember(solids, solidKey, () =>
        buildShell(skeleton, {
          wallMm: state.wallMm,
          borderMm: state.borderMm,
          borderFraction: state.borderFraction,
          filletMm: state.filletMm,
          edgeDiv: state.edgeDiv,
          openings: state.openings,
          depth: state.depth,
        }),
      );

      return { skeleton, solid };
    },
    clear() {
      points.clear();
      solids.clear();
    },
  };
}

const shared = createPipeline();

/** @param {object} state */
export function runPipeline(state) {
  return shared.run(state);
}

/** Clear the shared cache (tests). */
export function clearPipelineCache() {
  shared.clear();
}
