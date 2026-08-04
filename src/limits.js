/**
 * Proactive slider ceilings derived from the skeleton (and current border),
 * not from failed validation or applied fillet ranges.
 */

import { faceFrames, projectToFrame } from "./faceframe.js";
import { inradiusRange } from "./skeleton.js";
import { filletRMax, insetScale, collapseMicroEdges } from "./geom/poly2.js";
import { DEFAULT_STATE } from "./schema.js";

/** Practical FDM floor (≈ 6 lines at 0.4 mm nozzle); see docs/BORDER_EVIDENCE.md. */
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
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {{
 *   depth?: string,
 *   openings?: boolean,
 *   borderMm?: number|null,
 *   borderFraction?: number|null,
 *   wallMm?: number,  // rounding ceiling input; defaults to DEFAULT_STATE.wallMm
 * }} state
 * @returns {{ wallMmMax: number|null, borderMmMax: number|null, borderFractionMax: number|null, filletMmMax: number|null, roundingMmMax: number|null }}
 */
export function computeLimits(skeleton, state) {
  const frames = faceFrames(skeleton);
  const inradius = inradiusRange(frames);
  const depth = state.depth ?? "hollow";
  const openings = state.openings !== false;

  const wallMmMax = depth === "hollow" ? inradius.min * 0.9 : null;

  let borderMmMax = null;
  let borderFractionMax = null;
  let filletMmMax = null;
  let roundingMmMax = null;
  // Rounding clamps per feature (each edge by its own faces' allowances), so
  // the slider ceiling is the LARGEST useful value, not the tightest limit —
  // a small feature never caps the whole model.
  let maxStage2 = 0;

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
        maxStage2 = Math.max(maxStage2, 0.6 * fraction * frame.edgeDistMax);
      }
    }
    // Constant-mm ceiling (legacy / printability): still the smallest face.
    borderMmMax = minEdgeDist * 0.95;
    filletMmMax = Number.isFinite(minFillet) ? minFillet : null;

    if (depth === "hollow" && Number.isFinite(minBorderFlat)) {
      const wallMm = state.wallMm ?? DEFAULT_STATE.wallMm;
      const s = 1 - wallMm / inradius.min;
      if (s > 0 && Number.isFinite(s)) {
        const rimMax = 0.95 * Math.min(wallMm / 2, s * minBorderFlat);
        if (rimMax > 0) maxStage2 = Math.max(maxStage2, rimMax);
      }
    }
  } else {
    // Closed faces (and solid depth): dihedral rounding only.
    for (const frame of frames) {
      maxStage2 = Math.max(maxStage2, 0.45 * frame.edgeDistMax);
    }
  }
  roundingMmMax = maxStage2 > 0 ? maxStage2 : null;

  return { wallMmMax, borderMmMax, borderFractionMax, filletMmMax, roundingMmMax };
}
