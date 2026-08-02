/**
 * Latitude/longitude globe — parametric base with edges on lat/long lines.
 *
 * Meridians `m` come from the Density slider (`points`). For the globe that
 * value means meridian count (not vertex count), and the base advertises
 * `pointsRange` 6–36 so the Density control matches geometry. At m=36,
 * F ≈ m²/2 = 648 — about as heavy as the densest existing subdiv-2 solids —
 * so 36 is the ceiling. Rings = round(m/2)−1 are uniform in polar angle;
 * poles are exact vertices. Band quads are exactly planar (parallel
 * horizontal chords), so coplanar merge yields true trapezoid faces + pole
 * triangle fans — edges follow lat/long lines. Leave merge ON (no
 * `merge: false` on the base).
 *
 * Topology: V = m·rings+2, F = m·(rings+1), E = V+F−2.
 */

/**
 * Meridian bounds — also advertised to the UI as the base's Density range
 * (`pointsRange` in the registry), so the slider clamps to the values that
 * actually change geometry instead of dead-zoning at 37–60.
 */
export const GLOBE_MERIDIAN_MIN = 6;
export const GLOBE_MERIDIAN_MAX = 36;

/** Density (`points`) → effective meridian count. */
export function globeMeridians(points) {
  return Math.max(
    GLOBE_MERIDIAN_MIN,
    Math.min(GLOBE_MERIDIAN_MAX, Math.floor(points ?? 24)),
  );
}

/**
 * @param {{ points?: number }} [params]
 * @returns {Float64Array} flat xyz, unit circumradius
 */
export function globePoints(params = {}) {
  const m = globeMeridians(params.points);
  const rings = Math.round(m / 2) - 1;
  const V = m * rings + 2;
  const out = new Float64Array(V * 3);

  // North / south poles
  out[0] = 0;
  out[1] = 0;
  out[2] = 1;
  out[3] = 0;
  out[4] = 0;
  out[5] = -1;

  let i = 2;
  for (let r = 1; r <= rings; r++) {
    const phi = (Math.PI * r) / (rings + 1);
    const z = Math.cos(phi);
    const xy = Math.sin(phi);
    for (let k = 0; k < m; k++) {
      const th = (2 * Math.PI * k) / m;
      out[i * 3] = xy * Math.cos(th);
      out[i * 3 + 1] = xy * Math.sin(th);
      out[i * 3 + 2] = z;
      i++;
    }
  }
  return out;
}
