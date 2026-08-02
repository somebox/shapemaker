/**
 * Catalan solids: rhombic dodecahedron (dual of cuboctahedron) and
 * rhombic triacontahedron (dual of icosidodecahedron).
 *
 * Vertices sit at two radii — normalizePoints divides by the outer radius
 * only, so the inner ring stays inside the unit circumsphere. That is
 * intentional: nothing in the hull/shell pipeline assumes a single radius.
 */

import { PHI, cubeVerts, icosahedronVerts, normalizePoints } from "./platonic.js";

/**
 * Rhombic dodecahedron: cube vertices (±1,±1,±1) + axis (±2,0,0) cyclic.
 * @returns {Float64Array} flat xyz — a two-radius solid: axis verts at unit
 *   radius (×6), cube verts at √3/2 (×8); edge = √3/2 after normalize.
 */
export function rhombicDodecaPoints() {
  const pts = cubeVerts();
  for (const s of [-1, 1]) {
    pts.push([2 * s, 0, 0]);
    pts.push([0, 2 * s, 0]);
    pts.push([0, 0, 2 * s]);
  }
  return normalizePoints(pts);
}

/**
 * Rhombic triacontahedron: icosahedron verts + dodecahedron verts paired
 * so every face is a golden rhombus.
 *
 * Chirality trap: the dodeca-family cyclic triple must be (0, ±φ, ±1/φ),
 * the *mirror* of dodecahedronPoints' (0, ±1/φ, ±φ). The wrong pairing
 * keeps all 32 vertices on the hull but collapses to F=36 triangles
 * (broken Euler) instead of 30 planar rhombi. Do not reuse the Platonic
 * dodeca convention here. The icosa family is shared with icosahedronPoints
 * (same orientation is load-bearing for the rhombi).
 *
 * @returns {Float64Array} flat xyz — a two-radius solid: icosa verts at unit
 *   radius (×12), dodeca-type verts at √(3/(2+φ)) ≈ 0.9106 (×20);
 *   edge = 1/φ after normalize.
 */
export function rhombicTriacontaPoints() {
  const pts = [...icosahedronVerts(), ...cubeVerts()];
  // Dodeca-family cyclic: (0, ±φ, ±1/φ) — NOT (0, ±1/φ, ±φ)
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      pts.push([0, s1 * PHI, s2 / PHI]);
      pts.push([s1 / PHI, 0, s2 * PHI]);
      pts.push([s1 * PHI, s2 / PHI, 0]);
    }
  }
  return normalizePoints(pts);
}
