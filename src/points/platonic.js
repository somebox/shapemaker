/**
 * Normalized Platonic solid point clouds (unit circumradius, origin-centered).
 * Topology comes from hullToSkeleton — these emit points only.
 */

const PHI = (1 + Math.sqrt(5)) / 2;

/** @returns {Float64Array} flat xyz */
export function tetrahedronPoints() {
  return normalizePoints([
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ]);
}

/** @returns {Float64Array} */
export function cubePoints() {
  const pts = [];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) pts.push([x, y, z]);
    }
  }
  return normalizePoints(pts);
}

/** @returns {Float64Array} */
export function octahedronPoints() {
  return normalizePoints([
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]);
}

/** @returns {Float64Array} */
export function dodecahedronPoints() {
  const pts = [];
  // Cube vertices
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) pts.push([x, y, z]);
    }
  }
  // Golden rectangles in each plane
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      pts.push([0, s1 / PHI, s2 * PHI]);
      pts.push([s1 / PHI, s2 * PHI, 0]);
      pts.push([s1 * PHI, 0, s2 / PHI]);
    }
  }
  return normalizePoints(pts);
}

/** @returns {Float64Array} */
export function icosahedronPoints() {
  const pts = [];
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      pts.push([0, s1, s2 * PHI]);
      pts.push([s1, s2 * PHI, 0]);
      pts.push([s1 * PHI, 0, s2]);
    }
  }
  return normalizePoints(pts);
}

/**
 * @param {number[][]} pts
 * @returns {Float64Array}
 */
export function normalizePoints(pts) {
  let r2 = 0;
  for (const p of pts) {
    const d = p[0] ** 2 + p[1] ** 2 + p[2] ** 2;
    if (d > r2) r2 = d;
  }
  const R = Math.sqrt(r2);
  if (!(R > 0)) throw new Error("degenerate point cloud");
  const out = new Float64Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    out[i * 3] = pts[i][0] / R;
    out[i * 3 + 1] = pts[i][1] / R;
    out[i * 3 + 2] = pts[i][2] / R;
  }
  return out;
}
