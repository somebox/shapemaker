/**
 * Metrics computed once in compile. Viewer/UI never re-derive.
 *
 * Orientation-invariant: tris, volume, wall, edge stats, watertight
 * Placed (needs matrix): bbox/extents, height, longest near-horizontal edge,
 * print risk (flat-bridge edges + overhang faces)
 *
 * Placed bbox = bbox of transformed skeleton corners (30 pts), not the full mesh.
 */

import { transformPoint } from "./orient.js";
import { newell } from "./skeleton.js";

/** Edges within this tilt of horizontal flag as flat-bridge risk. */
export const FLAT_TILT_RAD = (5 * Math.PI) / 180;

/**
 * Outward normal z (placed) below this → overhang risk
 * (≈ 45° past vertical toward the bed).
 */
export const OVERHANG_NZ = -Math.SQRT1_2;

/**
 * Geometry at placed z below this sits on the plate: supported, not a risk.
 * The resting face lands at exactly z = 0 by construction (orient.js).
 */
const BED_EPS_MM = 0.01;

/**
 * @param {object} args
 * @param {{ positions: Float64Array, faces: number[][], edges: number[][] }} args.skeleton
 * @param {{ triangleCount: number, volume: number, wall: {min: number|null, max: number|null}, borderMm: object }} args.info
 * @param {{ matrix: Float64Array }} args.orientation
 * @param {boolean} args.watertight
 * @param {{ wallMmMax: number|null, borderMmMax: number|null, filletMmMax: number|null, roundingMmMax?: number|null }} [args.limits]
 */
export function computeMetrics({ skeleton, info, orientation, watertight, limits }) {
  const edgeStats = edgeLengthStats(skeleton);
  const placed = placePositions(skeleton.positions, orientation.matrix);
  const bbox = placedBBox(placed);
  const flat = flatEdgeScan(skeleton.edges, placed);

  return {
    // invariant
    triangleCount: info.triangleCount,
    volumeMm3: info.volume,
    volumeCm3: info.volume / 1000,
    wallMm: info.wall,
    borderMm: info.borderMm,
    filletMm: info.filletMm,
    roundingMm: info.roundingMm ?? { min: null, max: null },
    openingMinDiameterMm: info.openingMinDiameterMm,
    faceMetrics: info.faceMetrics,
    edgeMm: edgeStats,
    watertight,
    limits: limits ?? {
      wallMmMax: null,
      borderMmMax: null,
      borderFractionMax: null,
      filletMmMax: null,
      roundingMmMax: null,
    },
    // placed
    bboxMm: bbox.bbox,
    extentsMm: bbox.extents,
    heightMm: bbox.extents[2],
    longestHorizontalMm: flat.longestMm,
    printRisk: {
      flatEdgeIndices: flat.flatEdgeIndices,
      overhangFaceIndices: overhangScan(skeleton.faces, placed),
    },
  };
}

/**
 * Print risk for an orientation other than the compiled one (face remap in
 * the session adapter). Same scans computeMetrics runs.
 * @param {{ positions: Float64Array, faces: number[][], edges: number[][] }} skeleton
 * @param {Float64Array} matrix column-major 4×4
 * @returns {{ flatEdgeIndices: number[], overhangFaceIndices: number[] }}
 */
export function computePrintRisk(skeleton, matrix) {
  const placed = placePositions(skeleton.positions, matrix);
  return {
    flatEdgeIndices: flatEdgeScan(skeleton.edges, placed).flatEdgeIndices,
    overhangFaceIndices: overhangScan(skeleton.faces, placed),
  };
}

/** Transform all skeleton vertices into the placed (printed) frame. */
function placePositions(positions, M) {
  const out = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = transformPoint(M, positions[i], positions[i + 1], positions[i + 2]);
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return out;
}

/**
 * One pass over placed edges: longest near-horizontal span (any height —
 * the Inspect readout) and bridge-risk edge indices (bed-contact edges are
 * supported by the plate and excluded).
 */
function flatEdgeScan(edges, placed) {
  let longestMm = 0;
  const flatEdgeIndices = [];
  for (let ei = 0; ei < edges.length; ei++) {
    const [i, j] = edges[ei];
    const az = placed[i * 3 + 2], bz = placed[j * 3 + 2];
    const dx = placed[j * 3] - placed[i * 3];
    const dy = placed[j * 3 + 1] - placed[i * 3 + 1];
    const dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-12) continue;
    const tilt = Math.abs(Math.asin(Math.max(-1, Math.min(1, dz / L))));
    if (tilt > FLAT_TILT_RAD) continue;
    longestMm = Math.max(longestMm, L);
    if (az > BED_EPS_MM || bz > BED_EPS_MM) flatEdgeIndices.push(ei);
  }
  return { longestMm, flatEdgeIndices };
}

/**
 * Faces whose placed outward normal tilts past OVERHANG_NZ toward the bed.
 * The skeleton is consistently wound outward (assertSkeleton), so Newell on
 * the placed ring gives the outward normal directly. Faces resting on the
 * plate are supported and excluded.
 */
function overhangScan(faces, placed) {
  const overhangFaceIndices = [];
  for (let fi = 0; fi < faces.length; fi++) {
    const ring = faces[fi];
    let zMax = -Infinity;
    for (const vi of ring) zMax = Math.max(zMax, placed[vi * 3 + 2]);
    if (zMax <= BED_EPS_MM) continue; // bed contact
    const { normal } = newell(placed, ring);
    if (normal[2] < OVERHANG_NZ) overhangFaceIndices.push(fi);
  }
  return overhangFaceIndices;
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

function placedBBox(placed) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < placed.length; i += 3) {
    const x = placed[i], y = placed[i + 1], z = placed[i + 2];
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  return {
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    extents: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}
