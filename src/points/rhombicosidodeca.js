/**
 * Rhombicosidodecahedron — Archimedean solid with 12 pentagons, 30 squares
 * and 20 triangles (60 vertices, 120 equal edges, vertex figure 3.4.4.5).
 *
 * Vertices (edge 2, before normalize) are one permutation parity of
 *   (±1, ±1, ±φ³), (±φ², ±φ, ±2φ), (±(2+φ), 0, ±φ²).
 * All three families must share the same parity — mixing parities pairs a
 * solid with its mirror and breaks the hull. The parity used here is the
 * mirror of the cyclic one, chosen so the solid sits like the rest of the
 * φ family: pentagon normals coincide with icosahedronVerts' (0, ±1, ±φ)
 * axes and square normals with the icosidodecahedron's vertex directions.
 * (The cyclic parity instead lines triangles up with dodecahedronPoints,
 * whose own convention is the mirror of the icosahedron's — see the
 * chirality note in rhombic.js.)
 */

import { PHI, normalizePoints } from "./platonic.js";

/** @returns {Float64Array} flat xyz, unit circumradius; edge = 2/√(8φ+7) */
export function rhombicosidodecaPoints() {
  const phi2 = PHI * PHI;
  const phi3 = phi2 * PHI;
  const pts = [];
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      for (const s3 of [-1, 1]) {
        pushFamily(pts, s1, s2, s3 * phi3);
        pushFamily(pts, s1 * phi2, s2 * PHI, s3 * 2 * PHI);
      }
      pushFamily(pts, s1 * (2 + PHI), 0, s2 * phi2);
    }
  }
  return normalizePoints(pts);
}

/** The three odd permutations of (a, b, c) — one consistent parity. */
function pushFamily(pts, a, b, c) {
  pts.push([a, c, b], [c, b, a], [b, a, c]);
}
