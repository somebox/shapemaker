/**
 * Core types for the compile contract.
 *
 * Skeleton  { positions: Float64Array, faces: number[][], edges: [i,j][] }  // convex
 * Mesh      { positions: Float32Array, indices: Uint32Array, faceId: Uint32Array }
 * orientation { faceIndex, matrix }  // column-major 4×4; applied at draw + export
 *
 * compile(state) → { skeleton, mesh, metrics, validation, orientation }
 *
 * Authoring defaults and the canonical codec live in schema.js.
 */

/** @typedef {{ positions: Float64Array, faces: number[][], edges: number[][] }} Skeleton */
/** @typedef {{ positions: Float32Array, indices: Uint32Array, faceId: Uint32Array, positions64?: Float64Array }} Mesh */
/** @typedef {{ faceIndex: number, matrix: Float64Array }} Orientation */
/** @typedef {{ ok: boolean, errors: object[], warnings: object[] }} Validation */
