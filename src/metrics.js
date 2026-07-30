/**
 * Metrics computed once in compile. Viewer/UI never re-derive.
 *
 * Orientation-invariant: tris, volume, wall, edge stats, watertight
 * Placed (needs matrix): bbox/extents, height, longest near-horizontal edge
 *
 * Placed bbox = bbox of transformed skeleton corners (30 pts), not the full mesh.
 */

import { transformPoint } from "./orient.js";

/**
 * @param {object} args
 * @param {{ positions: Float64Array, faces: number[][], edges: number[][] }} args.skeleton
 * @param {{ triangleCount: number, volume: number, wall: {min: number|null, max: number|null}, borderMm: object }} args.info
 * @param {{ matrix: Float64Array }} args.orientation
 * @param {boolean} args.watertight
 */
export function computeMetrics({ skeleton, info, orientation, watertight }) {
  const edgeStats = edgeLengthStats(skeleton);
  const placed = placedBBox(skeleton.positions, orientation.matrix);
  const longestFlat = longestNearHorizontal(skeleton, orientation.matrix, 5 * Math.PI / 180);

  return {
    // invariant
    triangleCount: info.triangleCount,
    volumeMm3: info.volume,
    volumeCm3: info.volume / 1000,
    wallMm: info.wall,
    borderMm: info.borderMm,
    filletMm: info.filletMm,
    openingMinDiameterMm: info.openingMinDiameterMm,
    faceMetrics: info.faceMetrics,
    edgeMm: edgeStats,
    watertight,
    // placed
    bboxMm: placed.bbox,
    extentsMm: placed.extents,
    heightMm: placed.extents[2],
    longestHorizontalMm: longestFlat,
  };
}

function edgeLengthStats(skeleton) {
  const { positions, edges } = skeleton;
  let min = Infinity, max = -Infinity, sum = 0;
  for (const [i, j] of edges) {
    const L = Math.hypot(
      positions[i * 3] - positions[j * 3],
      positions[i * 3 + 1] - positions[j * 3 + 1],
      positions[i * 3 + 2] - positions[j * 3 + 2],
    );
    min = Math.min(min, L);
    max = Math.max(max, L);
    sum += L;
  }
  return { min, mean: sum / edges.length, max };
}

function placedBBox(positions, M) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = transformPoint(M, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  return {
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    extents: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

/** Longest skeleton edge whose direction is within `tiltRad` of horizontal. */
function longestNearHorizontal(skeleton, M, tiltRad) {
  let best = 0;
  for (const [i, j] of skeleton.edges) {
    const a = transformPoint(M, skeleton.positions[i * 3], skeleton.positions[i * 3 + 1], skeleton.positions[i * 3 + 2]);
    const b = transformPoint(M, skeleton.positions[j * 3], skeleton.positions[j * 3 + 1], skeleton.positions[j * 3 + 2]);
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-12) continue;
    const tilt = Math.abs(Math.asin(Math.max(-1, Math.min(1, dz / L))));
    if (tilt <= tiltRad) best = Math.max(best, L);
  }
  return best;
}
