/**
 * Pure base-change adaptation: one patch, optional one-line warning.
 * Clamps only values that make validation fail (wall, border) — never fillet.
 */

/**
 * @param {{
 *   currentState: object,
 *   nextBase: string,
 *   nextLimits: { wallMmMax: number|null, borderMmMax: number|null, filletMmMax?: number|null },
 * }} args
 * @returns {{ patch: object, warnings: string[] }}
 */
export function adaptStateForBase({ currentState, nextBase, nextLimits }) {
  /** @type {Record<string, unknown>} */
  const patch = {
    base: nextBase,
    faceIndex: -1,
  };
  let reduced = false;

  // Jitter is random-base-only in v0.4; leaving a regular base's state
  // carrying jitter would fail validation, so adaptation zeroes it.
  if (nextBase !== "random" && currentState.jitter > 0) {
    patch.jitter = 0;
    reduced = true;
  }

  const wallMax = nextLimits.wallMmMax;
  if (
    wallMax != null &&
    Number.isFinite(wallMax) &&
    Number.isFinite(currentState.wallMm) &&
    currentState.wallMm > wallMax
  ) {
    patch.wallMm = floor1(wallMax);
    reduced = true;
  }

  // Border ceiling depends on openings; when closed, leave border as portable intent.
  const borderMax = nextLimits.borderMmMax;
  if (
    currentState.openings &&
    borderMax != null &&
    Number.isFinite(borderMax) &&
    Number.isFinite(currentState.borderMm) &&
    currentState.borderMm > borderMax
  ) {
    patch.borderMm = floor1(borderMax);
    reduced = true;
  }

  return {
    patch,
    warnings: reduced
      ? ["Some settings were reduced to fit this shape"]
      : [],
  };
}

/** One-decimal clamp that never exceeds the geometric ceiling. */
function floor1(n) {
  return Math.floor(n * 10) / 10;
}
