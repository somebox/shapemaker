/**
 * On-sphere jitter: displace each point along the sphere surface, never off
 * it, so every point stays extreme and survives as a hull vertex — no
 * vertices silently swallowed (spec decision).
 *
 * One user-visible seed drives both random placement and jitter; the jitter
 * stream is decorrelated from placement by a fixed XOR so a jittered random
 * hull does not reuse the placement sequence.
 */

import { sfc32 } from "./random.js";

/** Keep jitter's PRNG stream distinct from placement's (same seed). */
const JITTER_STREAM = 0x5f356495;

/**
 * @param {Float64Array} points  normalized flat xyz (unit circumradius)
 * @param {{ seed: number, jitter: number }} params
 *   jitter: percent of circumradius (0–20) — max arc displacement; each
 *   point moves by a uniform random fraction of it in a uniform random
 *   tangent direction.
 * @returns {Float64Array} new array; input untouched. jitter 0 returns a
 *   bit-identical copy (no RNG draws), so exact bases stay exact.
 */
export function jitterPoints(points, { seed, jitter }) {
  const out = Float64Array.from(points);
  if (!(jitter > 0)) return out;

  const rng = sfc32((seed >>> 0) ^ JITTER_STREAM);
  const maxAngle = (jitter / 100); // arc length on the unit sphere = angle

  for (let i = 0; i < out.length; i += 3) {
    let px = out[i], py = out[i + 1], pz = out[i + 2];

    // Random unit tangent at p: project a random direction onto p's plane.
    let tx = 0, ty = 0, tz = 0, len = 0;
    while (len < 1e-6) {
      const rx = 2 * rng() - 1, ry = 2 * rng() - 1, rz = 2 * rng() - 1;
      const d = rx * px + ry * py + rz * pz;
      tx = rx - d * px; ty = ry - d * py; tz = rz - d * pz;
      len = Math.hypot(tx, ty, tz);
    }
    tx /= len; ty /= len; tz /= len;

    // Rotate p toward t by a random arc within the budget.
    const a = maxAngle * rng();
    const cos = Math.cos(a), sin = Math.sin(a);
    px = px * cos + tx * sin;
    py = py * cos + ty * sin;
    pz = pz * cos + tz * sin;
    // Renormalize against float drift — points must stay on the sphere.
    const r = Math.hypot(px, py, pz);
    out[i] = px / r; out[i + 1] = py / r; out[i + 2] = pz / r;
  }
  return out;
}
