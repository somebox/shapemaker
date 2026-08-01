/**
 * THE regeneration entrypoint.
 * compile(state) → { skeleton, mesh, metrics, validation, orientation }
 *
 * UI, hash parsing, export buttons, and tests all call this. It never throws
 * for bad input: every user-reachable failure comes back as `validation`, so a
 * stale URL hash or an out-of-range preset degrades instead of blanking.
 */

import { DEFAULT_STATE } from "./schema.js";
import { runPipeline } from "./pipeline.js";
import { computeOrientation, defaultRestingFace } from "./orient.js";
import { computeMetrics } from "./metrics.js";
import { computeLimits } from "./limits.js";
import { validateState } from "./validate.js";

/** Result when nothing could be built. */
function failed(state, validation) {
  return { skeleton: null, mesh: null, metrics: null, validation, orientation: null, state };
}

/**
 * @param {Partial<typeof DEFAULT_STATE>} [partial]
 */
export function compile(partial = {}) {
  const state = { ...DEFAULT_STATE, ...partial };

  // Border has two mutually exclusive spellings and they describe different
  // shapes: a constant mm gives every face the same frame width, a constant
  // fraction scales frame width with face size. An explicit borderFraction
  // therefore displaces the default borderMm rather than being ignored by it;
  // supplying both explicitly is a validation error, not a silent precedence.
  if (partial.borderFraction != null && partial.borderMm === undefined) {
    state.borderMm = null;
  }

  // 1. Pure parameter checks — before any geometry runs.
  const validation = validateState(state);
  if (!validation.ok) return failed(state, validation);

  // 2. Geometry. Stages throw validationError() for constraints that need a
  //    skeleton to evaluate (border vs apothem, wall vs inradius).
  let skeleton, solid;
  try {
    ({ skeleton, solid } = runPipeline(state));
  } catch (err) {
    validation.ok = false;
    validation.errors.push(asValidationEntry(err, "pipeline"));
    return failed(state, validation);
  }

  // 3. Resting face. An unknown index is recoverable — fall back and warn
  //    rather than fail, so shared links survive shape changes.
  let faceIndex = state.faceIndex;
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= skeleton.faces.length) {
    const fallback = defaultRestingFace(skeleton);
    if (Number.isInteger(faceIndex) && faceIndex >= 0) {
      validation.warnings.push({
        stage: "orient",
        key: "faceIndex",
        message: `Resting face ${faceIndex} does not exist on this shape — using face ${fallback}`,
        clampTo: fallback,
      });
    }
    faceIndex = fallback;
  }

  let orientation, metrics;
  try {
    orientation = computeOrientation(skeleton, faceIndex);
    metrics = computeMetrics({
      skeleton,
      info: solid.info,
      orientation,
      watertight: solid.info.watertight,
      limits: computeLimits(skeleton, state),
    });
  } catch (err) {
    validation.ok = false;
    validation.errors.push(asValidationEntry(err, "orient"));
    return failed(state, validation);
  }

  return {
    skeleton,
    mesh: solid.mesh,
    metrics,
    validation,
    orientation,
    state: { ...state, faceIndex },
  };
}

/** Unwrap a thrown Error into the structured validation entry shape. */
function asValidationEntry(err, fallbackStage) {
  return {
    stage: err.validation?.stage ?? fallbackStage,
    key: err.validation?.key,
    message: err.message,
    clampTo: err.validation?.clampTo,
    faceIds: err.validation?.faceIds,
  };
}

export { DEFAULT_STATE };
