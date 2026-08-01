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
 * Experimental soft mapping for the UX start-from prototype: slider percent
 * is scaled down so mid-range values stay subtle. jitter 0 stays identity.
 * Revisit when locking SPEC (may restore 1.0 or switch to plane-perturbation).
 */
export const JITTER_AMPLITUDE_SCALE = 0.25;

/**
 * @param {Float64Array} points  normalized flat xyz (unit circumradius)
 * @param {{ seed: number, jitter: number, mode?: "surface"|"radial"|"both" }} params
 *   jitter: UI percent 0–50 — budget after JITTER_AMPLITUDE_SCALE (arc for
 *   surface displacement, relative radius for radial).
 *   mode: "surface" slides along the sphere (default, no swallowed points);
 *   "radial" scales center-to-surface distance — points can sink inside the
 *   hull and vanish (accepted, gradual); "both" applies both.
 *   Every mode draws the same RNG sequence per point, so switching modes
 *   reworks the same underlying randomness rather than rerolling.
 * @returns {Float64Array} new array; input untouched. jitter 0 returns a
 *   bit-identical copy (no RNG draws), so exact bases stay exact.
 */
export function jitterPoints(points, { seed, jitter, mode = "surface" }) {
  const out = Float64Array.from(points);
  if (!(jitter > 0)) return out;

  const rng = sfc32((seed >>> 0) ^ JITTER_STREAM);
  const budget = (jitter / 100) * JITTER_AMPLITUDE_SCALE;
  const surface = mode !== "radial";
  const radial = mode !== "surface";

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
    const arc = budget * rng();
    const dr = budget * (2 * rng() - 1);

    if (surface) {
      // Rotate p toward t by the arc, renormalized against float drift.
      const cos = Math.cos(arc), sin = Math.sin(arc);
      px = px * cos + tx * sin;
      py = py * cos + ty * sin;
      pz = pz * cos + tz * sin;
      const r = Math.hypot(px, py, pz);
      px /= r; py /= r; pz /= r;
    }
    if (radial) {
      const s = 1 + dr;
      px *= s; py *= s; pz *= s;
    }
    out[i] = px; out[i + 1] = py; out[i + 2] = pz;
  }

  if (radial) {
    // Radial scaling leaves the cloud off unit circumradius; renormalize so
    // the Size slider still means circumdiameter.
    let maxR2 = 0;
    for (let i = 0; i < out.length; i += 3) {
      const r2 = out[i] ** 2 + out[i + 1] ** 2 + out[i + 2] ** 2;
      if (r2 > maxR2) maxR2 = r2;
    }
    const inv = 1 / Math.sqrt(maxR2);
    for (let i = 0; i < out.length; i++) out[i] *= inv;
  }
  return out;
}
