/**
 * THE regeneration entrypoint.
 * compile(state) → { skeleton, mesh, metrics, validation, orientation }
 *
 * UI, hash parsing, export buttons, and tests all call this. It never throws
 * for bad input: every user-reachable failure comes back as `validation`, so a
 * stale URL hash or an out-of-range preset degrades instead of blanking.
 */

import { DEFAULT_STATE } from "./schema.js";
import { runPipeline, hullSkeletonForBase, scaleSkeleton } from "./pipeline.js";
import { computeOrientation, defaultRestingFace } from "./orient.js";
import { computeMetrics } from "./metrics.js";
import { computeLimits, borderPrintabilityWarning } from "./limits.js";
import { validateState } from "./validate.js";

/** Result when nothing could be built. */
function emptyResult(state, validation) {
  return { skeleton: null, mesh: null, metrics: null, validation, orientation: null, state };
}

/**
 * @param {Partial<typeof DEFAULT_STATE>} [partial]
 */
export function compile(partial = {}) {
  const state = { ...DEFAULT_STATE, ...partial };

  // Border has two mutually exclusive spellings. Fraction scales with face
  // size; millimetres keep a constant strut (legacy / headless fits). An
  // explicit spelling displaces the other — including the default fraction.
  const inMm = partial.borderMm !== undefined && partial.borderMm !== null;
  const inFrac =
    partial.borderFraction !== undefined && partial.borderFraction !== null;
  if (inMm && !inFrac) {
    state.borderMm = partial.borderMm;
    state.borderFraction = null;
  } else if (inFrac && !inMm) {
    state.borderFraction = partial.borderFraction;
    state.borderMm = null;
  } else if (!inMm && !inFrac) {
    state.borderMm = null;
  }

  // 1. Pure parameter checks — before any geometry runs.
  const validation = validateState(state);
  if (!validation.ok) return emptyResult(state, validation);

  // 2. Geometry. Stages throw validationError() for constraints that need a
  //    skeleton to evaluate (border vs apothem, wall vs inradius).
  let skeleton, solid;
  try {
    ({ skeleton, solid } = runPipeline(state));
  } catch (err) {
    if (!err?.validation) throw err; // internal invariant — a bug, not bad input
    validation.ok = false;
    validation.errors.push(asValidationEntry(err, "pipeline"));
    return emptyResult(state, validation);
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
    // Wall and border ceilings must come from the skeleton the shell will
    // actually solidify — exceeding them is a hard validation error. Fillet
    // and rounding may use the pre-subdivision solid when subdivided: tiny
    // sub-faces would crush those sliders to near-zero, and the shell clamps
    // both per-feature at solidify time, so a generous ceiling is safe.
    const limits = computeLimits(skeleton, state);
    if ((state.subdiv ?? 0) > 0) {
      const unit = hullSkeletonForBase(state.base, {
        ...state,
        subdiv: 0,
        soften: 0,
      });
      const preSub = computeLimits(
        scaleSkeleton(unit, state.circumdiameterMm / 2),
        state,
      );
      if (limits.filletMmMax != null && preSub.filletMmMax != null) {
        limits.filletMmMax = Math.max(limits.filletMmMax, preSub.filletMmMax);
      }
      if (limits.roundingMmMax != null && preSub.roundingMmMax != null) {
        limits.roundingMmMax = Math.max(
          limits.roundingMmMax,
          preSub.roundingMmMax,
        );
      }
    }
    // State-derived, so shared links / presets / project opens see it too —
    // not only the edit that clamped a border.
    const guidance = borderPrintabilityWarning(state, limits, solid.info.borderMm);
    if (guidance) validation.warnings.push(guidance);
    metrics = computeMetrics({
      skeleton,
      info: solid.info,
      orientation,
      watertight: solid.info.watertight,
      limits,
    });
  } catch (err) {
    if (!err?.validation) throw err; // internal invariant — a bug, not bad input
    validation.ok = false;
    validation.errors.push(asValidationEntry(err, "orient"));
    return emptyResult(state, validation);
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

