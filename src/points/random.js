/**
 * Seeded random points on the unit sphere with minimum angular separation.
 *
 * Deterministic by construction: same (points, seed, separation) → identical
 * cloud, bit for bit. Sampling is dart-throwing with an attempt cap, then a
 * deterministic relaxation of the separation constraint — never an unbounded
 * Poisson rejection loop (which can stall near N = 60 at high separation).
 */

/**
 * sfc32 PRNG — small, fast, seedable; the spec's chosen generator.
 * @param {number} seed  uint32
 * @returns {() => number} uniform [0, 1)
 */
export function sfc32(seed) {
  let a = 0x9e3779b9 ^ seed;
  let b = 0x243f6a88 ^ (seed << 13) ^ (seed >>> 19);
  let c = 0xb7e15162 ^ (seed * 0x85eb) | 0;
  let d = seed | 1;
  // Warm up so nearby seeds decorrelate.
  for (let i = 0; i < 12; i++) next();
  function next() {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ (b >>> 9);
    b = c + (c << 3) | 0;
    c = (c << 21) | (c >>> 11);
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  }
  return next;
}

/**
 * Ideal even-spread angular separation for n points: the polar radius of a
 * spherical cap owning 1/n of the sphere's area (2π(1−cosθ) = 4π/n).
 * @param {number} n
 */
export function idealSeparationRad(n) {
  return Math.acos(1 - 2 / n);
}

/**
 * @param {{ points: number, seed: number, separation: number }} params
 *   points: 4–60; seed: uint32; separation: fraction (0–1) of the ideal
 *   even-spread angle that pairs must keep.
 * @returns {Float64Array} normalized flat xyz, length points × 3
 */
export function randomSpherePoints({ points, seed, separation }) {
  const n = points | 0;
  if (!(n >= 4)) throw new Error(`random base needs ≥ 4 points, got ${points}`);
  const rng = sfc32(seed >>> 0);

  let minAngle = Math.max(0, Math.min(1, separation)) * idealSeparationRad(n);
  const accepted = [];
  const maxAttempts = 200 * n;

  // Dart-throw under the current constraint; relax deterministically if the
  // attempt budget runs out. Each relaxation keeps prior accepted points, so
  // the result is a pure function of the inputs.
  let attempts = 0;
  while (accepted.length < n) {
    if (attempts >= maxAttempts) {
      minAngle *= 0.9;
      attempts = 0;
      continue;
    }
    attempts++;
    const p = randomUnitVector(rng);
    let ok = true;
    for (const q of accepted) {
      // angle between unit vectors via dot product
      const dot = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      if (Math.acos(Math.max(-1, Math.min(1, dot))) < minAngle) {
        ok = false;
        break;
      }
    }
    if (ok) accepted.push(p);
  }

  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = accepted[i][0];
    out[i * 3 + 1] = accepted[i][1];
    out[i * 3 + 2] = accepted[i][2];
  }
  return out;
}

/** Uniform point on the unit sphere. */
function randomUnitVector(rng) {
  const z = 2 * rng() - 1;
  const phi = 2 * Math.PI * rng();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}
