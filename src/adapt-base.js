/**
 * Pure base-change adaptation: one patch, optional one-line warning.
 * Clamps only values that make validation fail (wall, constant-mm border) —
 * never fillet, and never relative border (fraction always fits).
 * Printability guidance lives in limits.js (borderPrintabilityWarning),
 * where every entry path passes through — not here on the edit path.
 */

/**
 * @param {{
 *   currentState: object,
 *   nextBase: string,
 *   nextLimits: { wallMmMax: number|null, borderMmMax: number|null },
 * }} args
 * @returns {{ patch: object, warnings: string[] }}
 */
export function adaptStateForBase({ currentState, nextBase, nextLimits }) {
  /** @type {Record<string, unknown>} */
  const patch = {
    base: nextBase,
  };
  // Only clear resting face when the family actually changes. Jitter/seed
  // reshape must not reset faceIndex — that re-picks orientation and jumps.
  if (currentState.base !== nextBase) {
    patch.faceIndex = -1;
  }
  let reduced = false;

  // Start-from hard-reset owns jitter zeroing. Adaptation only clamps wall/border.

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

  // Relative border always fits; only constant-mm mode can exceed a ceiling.
  const usingFraction =
    currentState.borderFraction != null && currentState.borderMm == null;
  const borderMax = nextLimits.borderMmMax;
  if (
    !usingFraction &&
    currentState.openings &&
    borderMax != null &&
    Number.isFinite(borderMax)
  ) {
    if (Number.isFinite(currentState.borderMm) && currentState.borderMm > borderMax) {
      patch.borderMm = positiveClamp(borderMax);
      reduced = true;
    } else if (!(currentState.borderMm > 0) && currentState.borderFraction == null) {
      // Heal a non-positive mm border (past over-eager clamp). Prefer
      // switching to the default relative border when mm is broken.
      patch.borderMm = null;
      patch.borderFraction = 0.36;
      reduced = true;
    }
  }

  // Heal a missing/invalid fraction when openings and no mm.
  if (
    currentState.openings &&
    currentState.borderMm == null &&
    !(
      Number.isFinite(currentState.borderFraction) &&
      currentState.borderFraction > 0 &&
      currentState.borderFraction < 1
    )
  ) {
    patch.borderFraction = 0.36;
    patch.borderMm = null;
    reduced = true;
  }

  return {
    patch,
    warnings: reduced ? ["Some settings were reduced to fit this shape"] : [],
  };
}

/** One-decimal clamp that never exceeds the geometric ceiling. */
function floor1(n) {
  return Math.floor(n * 10) / 10;
}

/**
 * Clamp to the ceiling without ever producing zero: tiny faces (deep
 * subdivision, high jitter) can push the ceiling below 0.1 mm, where a
 * one-decimal floor would round to an invalid 0.
 */
function positiveClamp(max) {
  const one = floor1(max);
  if (one > 0) return one;
  const two = Math.floor(max * 100) / 100;
  return two > 0 ? two : max * 0.9;
}
