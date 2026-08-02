/**
 * Cuboctahedron — Archimedean solid, 12 vertices at the midpoints of a
 * cube's edges (equivalently: permutations of (±1, ±1, 0)).
 * Unit circumradius via normalizePoints; all edges equal R after normalize.
 */

import { normalizePoints } from "./platonic.js";

/** @returns {Float64Array} flat xyz, unit circumradius */
export function cuboctahedronPoints() {
  const pts = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      pts.push([a, b, 0]);
      pts.push([a, 0, b]);
      pts.push([0, a, b]);
    }
  }
  return normalizePoints(pts);
}
