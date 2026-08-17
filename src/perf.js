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
 * Spike replaces each n-gon with n triangles (typical 3–5× faces). Use 4
 * so a first-spike click from a light compile trips heavy mode the way
 * subdiv does. Changing t on an already-spiked mesh is topology-neutral.
 */
const SPIKE_FACE_SCALE = 4;

/**
 * Predict the next compile duration from the last measured one.
 * Subdivision multiplies faces ~4× per level; turning Spike on multiplies
 * ~4× (n-gons → n triangles). Scales compose when both change. Shrinking
 * promptly leaves heavy mode when the user backs off. The per-face floor
 * catches overhead-dominated measurements on the first heavy click.
 *
 * @param {number} lastMs  last measured compile duration (0 = no data)
 * @param {{ subdiv?: number, spike?: number } | null | undefined} prevState
 * @param {{ subdiv?: number, spike?: number } | null | undefined} nextState
 * @param {number} [prevFaces]  face count of the last compiled skeleton
 * @returns {number} estimated milliseconds
 */
export function predictedCompileMs(lastMs, prevState, nextState, prevFaces = 0) {
  const est = lastMs > 0 ? lastMs : 0;
  const dSub = (nextState?.subdiv ?? 0) - (prevState?.subdiv ?? 0);
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
