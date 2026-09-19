/**
 * Twisted globe — the lat/long globe with every other latitude ring rotated
 * half a meridian step, so each band between two rings is an antiprism:
 * a zigzag of triangles instead of a row of trapezoids.
 *
 * Meridians `m` come from the Density slider (`points`), as on the globe.
 * Rings = round(m/2)−1 are uniform in polar angle; poles are exact vertices.
 * Every face is a triangle (pole fans + antiprism bands), so the base runs
 * with coplanar merge OFF — hull triangles are the faces.
 *
 * Topology: V = m·rings+2, F = 2·m·rings, E = V+F−2. Twice the globe's face
 * count at the same m, so the ceiling is 24 (F = 528) rather than 36.
 *
 * Its dual is the ring-ball form: one hexagon-ish face per band vertex and
 * an m-gon at each pole.
 */

export const TWISTED_GLOBE_MERIDIAN_MIN = 6;
export const TWISTED_GLOBE_MERIDIAN_MAX = 24;

/** Density (`points`) → effective meridian count. */
export function twistedGlobeMeridians(points) {
  return Math.max(
    TWISTED_GLOBE_MERIDIAN_MIN,
    Math.min(TWISTED_GLOBE_MERIDIAN_MAX, Math.floor(points ?? 16)),
  );
}

/**
 * @param {{ points?: number }} [params]
 * @returns {Float64Array} flat xyz, unit circumradius
 */
export function twistedGlobePoints(params = {}) {
  const m = twistedGlobeMeridians(params.points);
  const rings = Math.round(m / 2) - 1;
  const V = m * rings + 2;
  const out = new Float64Array(V * 3);

  // North / south poles
  out[2] = 1;
  out[5] = -1;

  let i = 2;
  for (let r = 1; r <= rings; r++) {
    const phi = (Math.PI * r) / (rings + 1);
    const z = Math.cos(phi);
    const xy = Math.sin(phi);
    // Odd rings carry the half-step twist.
    const offset = r % 2 === 1 ? Math.PI / m : 0;
    for (let k = 0; k < m; k++) {
      const th = (2 * Math.PI * k) / m + offset;
      out[i * 3] = xy * Math.cos(th);
      out[i * 3 + 1] = xy * Math.sin(th);
      out[i * 3 + 2] = z;
      i++;
    }
  }
  return out;
}
