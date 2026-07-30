/**
 * Proactive slider ceilings derived from the skeleton (and current border),
 * not from failed validation or applied fillet ranges.
 */

import { faceFrames, projectToFrame } from "./faceframe.js";
import { inradiusRange } from "./skeleton.js";
import { filletRmax, insetScale } from "./geom/poly2.js";
/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {{
 *   depth?: string,
 *   openings?: boolean,
 *   borderMm?: number|null,
 *   borderFraction?: number|null,
 * }} state
 * @returns {{ wallMmMax: number|null, borderMmMax: number|null, filletMmMax: number|null }}
 */
export function computeLimits(skeleton, state) {
  const frames = faceFrames(skeleton);
  const inradius = inradiusRange(frames);
  const depth = state.depth ?? "hollow";
  const openings = state.openings !== false;

  const wallMmMax = depth === "hollow" ? inradius.min * 0.9 : null;

  let borderMmMax = null;
  let filletMmMax = null;

  if (openings) {
    let minEdgeDist = Infinity;
    let minFillet = Infinity;
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
        minFillet = Math.min(minFillet, filletRmax(insetScale(corners, fraction)) * 0.999);
      }
    }
    borderMmMax = minEdgeDist * 0.95;
    filletMmMax = Number.isFinite(minFillet) ? minFillet : null;
  }

  return { wallMmMax, borderMmMax, filletMmMax };
}
