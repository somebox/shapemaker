/**
 * THE regeneration entrypoint.
 * compile(state) → { skeleton, mesh, metrics, validation, orientation }
 * compileShape(state) → { skeleton, validation, state }, the same shape with
 * no printed shell, for production steps that don't need one.
 *
 * UI, hash parsing, export buttons, and tests all call these. They never throw
 * for bad input: every user-reachable failure comes back as `validation`, so a
 * stale URL hash or an out-of-range preset degrades instead of blanking.
 */

import { DEFAULT_STATE, PRINT_KEYS } from "./schema.js";
import { runPipeline, hullSkeletonForBase, scaleSkeleton } from "./pipeline.js";
import { computeOrientation, defaultRestingFace } from "./orient.js";
import { computeMetrics } from "./metrics.js";
import { computeLimits, borderPrintabilityWarning } from "./limits.js";
import { validateState } from "./validate.js";
import { csgLoadError, csgReady, needsCsg } from "./solid/csg.js";

/**
 * Result when nothing could be built. `limits` still describes the shape
 * when its skeleton builds, so the controls can show what fits.
 */
function emptyResult(state, validation) {
  return {
    skeleton: null, mesh: null, metrics: null, validation, orientation: null, state,
    limits: limitsForState(state),
  };
}

/**
 * Status line for Normal openings that cannot go fully straight: how many,
 * how far they tilt, and the wall that would straighten them all.
 * @param {{ axisLeanFaces: number|null, axisCentreFaces: number|null, axisTiltMaxDeg: number|null, normalStraightWallMm: number|null }} info
 * @param {number} faceCount
 * @param {number} wallMm
 */
function straightAxisWarning(info, faceCount, wallMm) {
  if (!(info.axisLeanFaces > 0)) return null;
  const centre = info.axisCentreFaces ?? 0;
  const tilted = info.axisLeanFaces - centre;
  const parts = [];
  if (tilted > 0) {
    parts.push(
      `${tilted} of ${faceCount} openings tilt up to ${info.axisTiltMaxDeg.toFixed(1)}° ` +
      `beside a tight edge to keep an inner rim`,
    );
  }
  if (centre > 0) {
    parts.push(
      `${centre} of ${faceCount} openings follow the centre because a straight ` +
      `hole misses their inner face`,
    );
  }
  const fit = info.normalStraightWallMm;
  // Only a wall below the current one is advice; a fit at or above it
  // would contradict the tilt (the per-edge limit is linear, the corners
  // of uneven shapes are not quite).
  const hint = fit != null && fit >= 0.1 && fit < wallMm
    ? ` — a Wall of ${(Math.floor(fit * 10) / 10).toFixed(1)} mm or less keeps them straight`
    : "";
  return { stage: "solid", key: "openingAxis", message: parts.join("; ") + hint };
}

/**
 * Slider ceilings for a state, or null when its skeleton cannot be built
 * (unknown base, a skeleton operator refusing the parameters).
 * @param {Partial<typeof DEFAULT_STATE>} state
 */
export function limitsForState(state) {
  const s = { ...DEFAULT_STATE, ...state };
  if (!(s.circumdiameterMm > 0)) return null;
  // Best effort on an already-failing state: any skeleton failure here is
  // reported by the compile that called it, so it only means "no limits".
  try {
    const unit = hullSkeletonForBase(s.base, s);
    return limitsFor(scaleSkeleton(unit, s.circumdiameterMm / 2), s);
  } catch {
    return null;
  }
}

/**
 * Wall and border ceilings come from the skeleton the shell will actually
 * solidify — exceeding them is a hard validation error. Fillet and rounding
 * may use the pre-subdivision solid when subdivided: tiny sub-faces would
 * crush those sliders to near-zero, and the shell clamps both per-feature
 * at solidify time, so a generous ceiling is safe.
 */
function limitsFor(skeleton, state) {
  const limits = computeLimits(skeleton, state);
  if ((state.subdiv ?? 0) > 0) {
    const unit = hullSkeletonForBase(state.base, { ...state, subdiv: 0, soften: 0 });
    const preSub = computeLimits(scaleSkeleton(unit, state.circumdiameterMm / 2), state);
    if (limits.filletMmMax != null && preSub.filletMmMax != null) {
      limits.filletMmMax = Math.max(limits.filletMmMax, preSub.filletMmMax);
    }
    if (limits.roundingMmMax != null && preSub.roundingMmMax != null) {
      limits.roundingMmMax = Math.max(limits.roundingMmMax, preSub.roundingMmMax);
    }
  }
  return limits;
}

/**
 * Full state from partial input. Border has two mutually exclusive spellings.
 * Fraction scales with face size; millimetres keep a constant strut (legacy /
 * headless fits). An explicit spelling displaces the other — including the
 * default fraction.
 * @param {Partial<typeof DEFAULT_STATE>} partial
 */
function withDefaults(partial) {
  const state = { ...DEFAULT_STATE, ...partial };
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
  return state;
}

/**
 * The resting face. An unknown index is recoverable — fall back and warn
 * rather than fail, so shared links survive shape changes.
 */
function resolveFace(skeleton, faceIndex, validation) {
  if (Number.isInteger(faceIndex) && faceIndex >= 0 && faceIndex < skeleton.faces.length) return faceIndex;
  const fallback = defaultRestingFace(skeleton);
  if (Number.isInteger(faceIndex) && faceIndex >= 0) {
    validation.warnings.push({
      stage: "orient",
      key: "faceIndex",
      message: `Resting face ${faceIndex} does not exist on this shape — using face ${fallback}`,
      clampTo: fallback,
    });
  }
  return fallback;
}

/**
 * The shape alone: the same skeleton compile() builds, with no shell, so
 * what only a printed shell cares about (wall, rounding, quality) can
 * neither fail it nor slow it down.
 * @param {Partial<typeof DEFAULT_STATE>} [partial]
 */
export function compileShape(partial = {}) {
  const state = withDefaults(partial);
  const printDefaults = Object.fromEntries(PRINT_KEYS.map((k) => [k, DEFAULT_STATE[k]]));
  const validation = validateState({ ...state, ...printDefaults });
  if (!validation.ok) return { skeleton: null, validation, state };
  let skeleton;
  try {
    skeleton = scaleSkeleton(hullSkeletonForBase(state.base, state), state.circumdiameterMm / 2);
  } catch (err) {
    if (!err?.validation) throw err; // internal invariant — a bug, not bad input
    validation.ok = false;
    validation.errors.push(asValidationEntry(err, "pipeline"));
    return { skeleton: null, validation, state };
  }
  return { skeleton, validation, state: { ...state, faceIndex: resolveFace(skeleton, state.faceIndex, validation) } };
}

/**
 * @param {Partial<typeof DEFAULT_STATE>} [partial]
 */
export function compile(partial = {}) {
  const state = withDefaults(partial);

  // 1. Pure parameter checks — before any geometry runs.
  const validation = validateState(state);
  if (!validation.ok) return emptyResult(state, validation);

  // Through sides run on a mesh library that loads on demand (loadCsg). The app
  // waits for it before building, so this is a failed load or a headless
  // caller that skipped the await.
  if (needsCsg(state) && !csgReady()) {
    validation.ok = false;
    validation.errors.push({
      stage: "solid",
      key: "openingAxis",
      message: csgLoadError()
        ? "Through sides couldn't load — reload to try again, or use Straight"
        : "Through sides aren't loaded yet (headless callers: await loadCsg() first)",
      clampTo: "normal",
    });
    return emptyResult(state, validation);
  }

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
  // 3. Resting face.
  const faceIndex = resolveFace(skeleton, state.faceIndex, validation);

  let orientation, metrics;
  try {
    orientation = computeOrientation(skeleton, faceIndex);
    const limits = limitsFor(skeleton, state);
    // State-derived, so shared links / presets / project opens see it too —
    // not only the edit that clamped a border.
    const guidance = borderPrintabilityWarning(state, limits, solid.info.borderMm);
    if (guidance) validation.warnings.push(guidance);
    const axisWarning = straightAxisWarning(solid.info, skeleton.faces.length, state.wallMm);
    if (axisWarning) validation.warnings.push(axisWarning);
    if (solid.info.throughClosedFaces > 0) {
      validation.warnings.push({
        stage: "solid",
        key: "openingAxis",
        message:
          `${solid.info.throughClosedFaces} of ${skeleton.faces.length} faces are too ` +
          `small to cut through and stay closed`,
      });
    }
    if (solid.info.looseDropped > 0) {
      const v = solid.info.looseVolumeMm3 / 1000;
      const cm3 = v < 0.01 ? "< 0.01" : v.toFixed(2);
      validation.warnings.push({
        stage: "solid",
        key: "breakOut",
        message:
          `Break out cut ${solid.info.looseDropped} loose ` +
          `piece${solid.info.looseDropped === 1 ? "" : "s"} free (${cm3} cm³); ` +
          `they are left out of the model`,
      });
    }
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

