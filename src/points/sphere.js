/**
 * Fibonacci-lattice points on the unit sphere — the Sphere base.
 *
 * Deterministic by construction (no seed): same point count → identical
 * cloud, bit for bit. The offset lattice avoids exact poles so the hull has
 * no degenerate fan apex, and the golden-angle spiral keeps neighbors evenly
 * spread at every count in the supported 4–60 range. The hull of these
 * points is the app's low-poly sphere; Quality (edgeDiv) refines the shell
 * tessellation, and the points count sets how faceted the sphere itself is.
 */

/** Golden angle in radians: π(3 − √5). */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * @param {{ points?: number }} [params]
 * @returns {Float64Array} flat xyz, unit circumradius
 */
export function fibonacciSpherePoints(params = {}) {
  const n = Math.max(4, Math.min(60, Math.floor(params.points ?? 24)));
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Offset lattice: z strictly inside (−1, 1), never exactly a pole.
    const z = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const th = GOLDEN_ANGLE * i;
    out[i * 3] = r * Math.cos(th);
    out[i * 3 + 1] = r * Math.sin(th);
    out[i * 3 + 2] = z;
  }
  return out;
}
