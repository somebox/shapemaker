/**
 * Pure resting-face transform: face normal → −Z, then translate so z_min = 0.
 * Skeleton/mesh vertex buffers stay unoriented; the matrix is applied at
 * draw time and at export.
 */

import { toFaceFrame } from "./faceframe.js";
import { newell } from "./skeleton.js";

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {number} faceIndex
 * @returns {{ faceIndex: number, matrix: Float64Array }}
 *   matrix is column-major 4×4
 */
export function computeOrientation(skeleton, faceIndex) {
  const { positions, faces } = skeleton;
  if (faceIndex < 0 || faceIndex >= faces.length) {
    throw new Error(`faceIndex ${faceIndex} out of range [0, ${faces.length})`);
  }

  // Use the true plane normal, not the centroid's radial direction: on an
  // irregular hull face those differ, and only the plane normal actually puts
  // the face flat on the bed. They coincide on the regular M1 solid.
  const [nx, ny, nz] = toFaceFrame(skeleton, faceIndex).normal;

  // Rotation that maps n → (0, 0, -1)
  const R = alignVectors([nx, ny, nz], [0, 0, -1]);

  // Translate so min-z of oriented skeleton verts is 0
  let zMin = Infinity;
  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const zp = R[2] * x + R[6] * y + R[10] * z; // row 2 of R (column-major)
    if (zp < zMin) zMin = zp;
  }

  // Full 4×4: [R | t] with t = (0, 0, -zMin)
  const M = new Float64Array(16);
  M.set(R);
  M[14] = -zMin;
  M[15] = 1;
  return { faceIndex, matrix: M };
}

/**
 * Face whose outward normal best matches `normal` (largest dot product).
 * Used to keep resting orientation stable when jitter/seed rebuilds the face
 * list (merge-skip changes indices; the geometric underside should not jump).
 *
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {[number, number, number]|number[]} normal
 * @returns {number} faceIndex
 */
export function nearestFaceByNormal(skeleton, normal) {
  const [tx, ty, tz] = normal;
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < skeleton.faces.length; i++) {
    const [nx, ny, nz] = toFaceFrame(skeleton, i).normal;
    const d = nx * tx + ny * ty + nz * tz;
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}

/**
 * Default resting face: maximum area, then most sides, then lowest index
 * (face identity already sorted the list).
 *
 * On dodecahedron / icosidodecahedron this selects a pentagon. On uniform
 * Platonic solids every face ties on area and sides, so index 0 wins.
 *
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 */
export function defaultRestingFace(skeleton) {
  const { positions, faces } = skeleton;
  let best = 0;
  let bestArea = -1;
  let bestSides = -1;
  for (let i = 0; i < faces.length; i++) {
    const area = faceArea(positions, faces[i]);
    const sides = faces[i].length;
    if (
      area > bestArea + 1e-12 ||
      (Math.abs(area - bestArea) <= 1e-12 && sides > bestSides)
    ) {
      best = i;
      bestArea = area;
      bestSides = sides;
    }
  }
  return best;
}

/** Planar polygon area via Newell magnitude / 2. */
function faceArea(positions, ring) {
  return newell(positions, ring).area;
}

/**
 * Rotation matrix (column-major 4×4, no translation) aligning vector a → b.
 * Uses Rodrigues' formula via a stable cross/dot construction.
 */
function alignVectors(a, b) {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  const dot = ax * bx + ay * by + az * bz;

  const M = new Float64Array(16);
  M[15] = 1;

  // Already aligned
  if (dot > 1 - 1e-12) {
    M[0] = M[5] = M[10] = 1;
    return M;
  }
  // Opposite — 180° about any perpendicular axis
  if (dot < -1 + 1e-12) {
    // Pick axis ⟂ a
    let ux, uy, uz;
    if (Math.abs(ax) < 0.9) { ux = 1; uy = 0; uz = 0; }
    else { ux = 0; uy = 1; uz = 0; }
    // v = normalize(u × a) — any axis perpendicular to a will do
    let vx = uy * az - uz * ay;
    let vy = uz * ax - ux * az;
    let vz = ux * ay - uy * ax;
    const vl = Math.hypot(vx, vy, vz);
    vx /= vl; vy /= vl; vz /= vl;
    // Rodrigues at θ = π reduces to R = 2vvᵀ − I
    M[0] = 2 * vx * vx - 1;
    M[1] = 2 * vx * vy;
    M[2] = 2 * vx * vz;
    M[4] = 2 * vy * vx;
    M[5] = 2 * vy * vy - 1;
    M[6] = 2 * vy * vz;
    M[8] = 2 * vz * vx;
    M[9] = 2 * vz * vy;
    M[10] = 2 * vz * vz - 1;
    return M;
  }

  // v = a × b
  let vx = ay * bz - az * by;
  let vy = az * bx - ax * bz;
  let vz = ax * by - ay * bx;
  const vl = Math.hypot(vx, vy, vz);
  vx /= vl; vy /= vl; vz /= vl;
  const c = dot;
  const sin = vl; // |a × b| = sin θ for unit a, b — measured before normalising
  const k = 1 - c;
  // Rodrigues: R = I c + [v]_× s + v v^T (1-c)
  M[0] = c + vx * vx * k;
  M[1] = vx * vy * k + vz * sin;
  M[2] = vx * vz * k - vy * sin;
  M[4] = vy * vx * k - vz * sin;
  M[5] = c + vy * vy * k;
  M[6] = vy * vz * k + vx * sin;
  M[8] = vz * vx * k + vy * sin;
  M[9] = vz * vy * k - vx * sin;
  M[10] = c + vz * vz * k;
  return M;
}

/** Apply column-major 4×4 to a point → [x,y,z]. */
export function transformPoint(M, x, y, z) {
  return [
    M[0] * x + M[4] * y + M[8] * z + M[12],
    M[1] * x + M[5] * y + M[9] * z + M[13],
    M[2] * x + M[6] * y + M[10] * z + M[14],
  ];
}
