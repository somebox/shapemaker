/**
 * Interactive-performance policy. When a compile is known to take a while,
 * sliders stop recompiling per drag tick (commit lands on release) and the
 * app shows a busy badge before the blocking work starts, so the UI never
 * looks locked.
 */

import { effectiveSubdivLevel } from "./subdivide.js";

/**
 * Threshold in milliseconds. At or below it, live-drag recompiles stay
 * comfortably interactive; above it, sliders switch to commit-on-release
 * and heavy runs are deferred behind a paint so the busy badge is visible.
 */
export const HEAVY_COMPILE_MS = 100;

/**
 * Marginal shell cost per skeleton face. A light solid's measured time is
 * dominated by fixed overhead, so scaling it alone under-predicts the first
 * subdivision click (5 ms × 4² = 80 ms for a real ~500 ms compile); the
 * per-face floor catches that from the projected face count.
 */
const FLOOR_MS_PER_FACE = 0.6;

/**
 * Spike replaces each n-gon with n triangles (typical 3–5× faces). Use 4
 * so a first-spike click from a light compile trips heavy mode the way
 * subdiv does. Changing t on an already-spiked mesh is topology-neutral.
 */
const SPIKE_FACE_SCALE = 4;

/** Bases whose unsubdivided hull has ≤ 12 faces (auto-refines 2 levels). */
const COARSE_BASES = new Set([
  "tetrahedron",
  "cube",
  "octahedron",
  "dodecahedron",
  "rhombicdodeca",
]);

/** Duals whose unsubdivided hull has ≤ 12 faces. */
const COARSE_DUAL_BASES = new Set([
  "tetrahedron",
  "cube",
  "octahedron",
  "icosahedron",
]);

/** Two-level auto-refined triangle counts for the 5 coarse bases (4, 6, 8, 12, 12 faces). */
const COARSE_AUTO2_FACES = new Set([64, 128, 192, 384, 480]);

/**
 * Estimate the pre-subdivision face count for `state`, recovering it when
 * `prevFaces` was measured on an already-subdivided `prevState`.
 */
function unrefinedFaceCount(state, prevState, prevFaces) {
  if (state?.base) {
    if (state.truncate > 0) return 20;
    if (state.spike > 0) return state.base === "tetrahedron" ? 12 : 24;
    if (state.dual) return COARSE_DUAL_BASES.has(state.base) ? 8 : 20;
    return COARSE_BASES.has(state.base) ? 8 : 20;
  }
  if (!(prevFaces > 0)) return 0;
  const prevSub = prevState?.subdiv ?? 0;
  if (prevSub > 0) {
    return Math.max(4, Math.round(prevFaces / Math.pow(4, prevSub)));
  }
  if ((prevState?.soften ?? 0) > 0) {
    if (prevFaces <= 12) return prevFaces;
    return COARSE_AUTO2_FACES.has(prevFaces)
      ? Math.round(prevFaces / 16)
      : Math.round(prevFaces / 4);
  }
  return prevFaces;
}

/**
 * Predict the next compile duration from the last measured one.
 * Subdivision multiplies faces ~4× per level; turning Spike on multiplies
 * ~4× (n-gons → n triangles). Scales compose when both change. Shrinking
 * promptly leaves heavy mode when the user backs off. The per-face floor
 * catches overhead-dominated measurements on the first heavy click.
 *
 * @param {number} lastMs  last measured compile duration (0 = no data)
 * @param {{ base?: string, subdiv?: number, soften?: number, spike?: number, truncate?: number, dual?: boolean } | null | undefined} prevState
 * @param {{ base?: string, subdiv?: number, soften?: number, spike?: number, truncate?: number, dual?: boolean } | null | undefined} nextState
 * @param {number} [prevFaces]  face count of the last compiled skeleton
 * @returns {number} estimated milliseconds
 */
export function predictedCompileMs(lastMs, prevState, nextState, prevFaces = 0) {
  const est = lastMs > 0 ? lastMs : 0;
  const prevBaseFaces = unrefinedFaceCount(prevState, prevState, prevFaces);
  const nextBaseFaces = unrefinedFaceCount(nextState, prevState, prevFaces);
  const prevSub = effectiveSubdivLevel(
    prevState?.subdiv ?? 0,
    prevState?.soften ?? 0,
    prevBaseFaces,
  );
  const nextSub = effectiveSubdivLevel(
    nextState?.subdiv ?? 0,
    nextState?.soften ?? 0,
    nextBaseFaces,
  );
  const dSub = nextSub - prevSub;
  const prevSpike = (prevState?.spike ?? 0) > 0;
  const nextSpike = (nextState?.spike ?? 0) > 0;
  const spikeScale = !prevSpike && nextSpike
    ? SPIKE_FACE_SCALE
    : prevSpike && !nextSpike
      ? 1 / SPIKE_FACE_SCALE
      : 1;
  const subdivScale = dSub === 0 ? 1 : Math.pow(4, dSub);
  const scale = spikeScale * subdivScale;
  if (scale === 1) return est;
  const scaled = est * scale;
  if (scale > 1 && prevFaces > 0) {
    return Math.max(scaled, FLOOR_MS_PER_FACE * prevFaces * scale);
  }
  return scaled;
}
