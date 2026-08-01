/**
 * Interactive-performance policy. When a compile is known to take a while,
 * sliders stop recompiling per drag tick (commit lands on release) and the
 * app shows a busy badge before the blocking work starts, so the UI never
 * looks locked.
 */

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
 * Predict the next compile duration from the last measured one. Subdivision
 * is the one control whose single click multiplies the workload before any
 * measurement exists: each level at least quadruples the face count and
 * compile time is roughly linear in faces, so scale by 4 per level either
 * way (shrinking promptly leaves heavy mode when the user backs off) and
 * apply the per-face floor to the projected count.
 *
 * @param {number} lastMs  last measured compile duration (0 = no data)
 * @param {{ subdiv?: number } | null | undefined} prevState
 * @param {{ subdiv?: number } | null | undefined} nextState
 * @param {number} [prevFaces]  face count of the last compiled skeleton
 * @returns {number} estimated milliseconds
 */
export function predictedCompileMs(lastMs, prevState, nextState, prevFaces = 0) {
  const est = lastMs > 0 ? lastMs : 0;
  const d = (nextState?.subdiv ?? 0) - (prevState?.subdiv ?? 0);
  if (d === 0) return est;
  const scale = Math.pow(4, d);
  const scaled = est * scale;
  if (d > 0 && prevFaces > 0) {
    return Math.max(scaled, FLOOR_MS_PER_FACE * prevFaces * scale);
  }
  return scaled;
}
