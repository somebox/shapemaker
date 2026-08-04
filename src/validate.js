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
    err("points", "base", `Unknown base "${state.base}"`, {
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

  // Random-base parameters. Validated for every state (they are canonical
  // with defaults), so a corrupt hash cannot smuggle bad values behind a
  // regular base and detonate later on a base switch.
  if (!Number.isInteger(state.points) || state.points < 4 || state.points > 60) {
    err("points", "points", "Point count must be a whole number from 4 to 60");
  }
  if (!Number.isInteger(state.seed) || state.seed < 0 || state.seed > 0xffffffff) {
    err("points", "seed", "Seed must be a whole number from 0 to 4294967295");
  }
  if (!(Number.isFinite(state.separation) && state.separation >= 0 && state.separation <= 1)) {
    err("points", "separation", "Separation must be between 0 and 1");
  }
  if (!(Number.isFinite(state.jitter) && state.jitter >= 0 && state.jitter <= 50)) {
    err("points", "jitter", "Jitter must be between 0 and 50 % of the size");
  }
  if (!["surface", "radial", "both"].includes(state.jitterMode)) {
    err("points", "jitterMode", "Jitter direction must be surface, radial, or both");
  }
  if (!(Number.isInteger(state.subdiv) && state.subdiv >= 0 && state.subdiv <= 2)) {
    err("points", "subdiv", "Subdivide must be 0, 1, or 2");
  }
  if (!["radial", "grid"].includes(state.subdivStyle)) {
    err("points", "subdivStyle", "Subdivide pattern must be radial or grid");
  }
  if (!(Number.isFinite(state.soften) && state.soften >= 0 && state.soften <= 100)) {
    err("points", "soften", "Smooth must be between 0 and 100 %");
  }
  // Jitter is allowed on every base (locked session model). Regular bases
  // perturb face planes (polygons kept); random jitters points on the sphere.

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

  // Rounding softens rims AND dihedral edges — valid on every depth/face mode.
  if (!(Number.isFinite(state.roundingMm) && state.roundingMm >= 0)) {
    err("solid", "roundingMm", "Rounding must be 0 mm or more");
  }

  return { ok: errors.length === 0, errors, warnings };
}

function isPositiveFinite(x) {
  return Number.isFinite(x) && x > 0;
}
