/**
 * Parameter validation — data, never exceptions crossing the compile boundary.
 *
 * Two kinds of check live in the app:
 *   1. Pure parameter checks (here): cheap, run before any geometry.
 *   2. Geometric checks (in the stages): need a skeleton — e.g. "border wider
 *      than the smallest face apothem". Those throw `validationError(...)`,
 *      which compile() unwraps into the same structured shape.
 *
 * The rule: a user-reachable bad input must produce a message naming the
 * parameter at fault. An error that leaks an implementation invariant
 * ("mesh is not closed", "signed volume is not positive") is a bug in this
 * file, not a validation result.
 */

import { isKnownBase } from "./bases.js";
const DEPTHS = new Set(["solid", "hollow"]);

/**
 * Attach structured validation info to an Error so compile() can unwrap it.
 * @param {string} stage
 * @param {string} key
 * @param {string} message
 * @param {{ clampTo?: number, faceIds?: number[] }} [extra]
 */
export function validationError(stage, key, message, extra = {}) {
  const err = new Error(message);
  err.validation = { stage, key, message, ...extra };
  return err;
}

/**
 * Pure parameter checks — no geometry, no skeleton required.
 * @param {object} state
 * @returns {{ ok: boolean, errors: object[], warnings: object[] }}
 */
export function validateState(state) {
  const errors = [];
  const warnings = [];
  const err = (stage, key, message, extra = {}) =>
    errors.push({ stage, key, message, ...extra });

  if (!isKnownBase(state.base)) {
    err("points", "base", `Unknown base shape "${state.base}"`, {
      clampTo: "icosidodeca",
    });
  }

  if (!isPositiveFinite(state.circumdiameterMm)) {
    err("points", "circumdiameterMm", "Size must be a positive number of mm");
  }

  if (!DEPTHS.has(state.depth)) {
    err("solid", "depth", `Depth must be "solid" or "hollow", got "${state.depth}"`);
  }

  if (state.depth === "hollow" && !isPositiveFinite(state.wallMm)) {
    err("solid", "wallMm", "Wall thickness must be greater than 0 mm");
  }

  if (!Number.isInteger(state.edgeDiv) || state.edgeDiv < 1) {
    err("solid", "edgeDiv", "Edge divisions must be a whole number ≥ 1");
  }

  if (state.openings) {
    // Openings need an inner surface to close the rim against. A solid body
    // with through-holes is a different construction (v1.1), not this one.
    if (state.depth === "solid") {
      err("solid", "openings", "Openings require a hollow shell", {
        clampTo: false,
      });
    }
    const hasMm = state.borderMm != null;
    const hasFrac = state.borderFraction != null;
    if (!hasMm && !hasFrac) {
      err("solid", "borderMm", "Openings need a border width");
    }
    if (hasMm && hasFrac) {
      // They describe different shapes (constant width vs width proportional
      // to face size), so silently preferring one would misrepresent the URL.
      err("solid", "borderMm",
        "Set the border in mm or as a fraction of face size, not both");
    }
    if (hasMm && !isPositiveFinite(state.borderMm)) {
      err("solid", "borderMm", "Border must be greater than 0 mm");
    }
    if (hasFrac && !(state.borderFraction > 0 && state.borderFraction < 1)) {
      err("solid", "borderFraction", "Border fraction must be between 0 and 1");
    }
    if (!(Number.isFinite(state.filletMm) && state.filletMm >= 0)) {
      err("solid", "filletMm", "Fillet must be 0 mm or more");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function isPositiveFinite(x) {
  return Number.isFinite(x) && x > 0;
}
