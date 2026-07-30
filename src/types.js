/**
 * Core types for the compile contract.
 *
 * Skeleton  { positions: Float64Array, faces: number[][], edges: [i,j][] }  // convex
 * Mesh      { positions: Float32Array, indices: Uint32Array, faceId: Uint32Array }
 * orientation { faceIndex, matrix }  // column-major 4×4; applied at draw + export
 *
 * compile(state) → { skeleton, mesh, metrics, validation, orientation }
 */

/** @typedef {{ positions: Float64Array, faces: number[][], edges: number[][] }} Skeleton */
/** @typedef {{ positions: Float32Array, indices: Uint32Array, faceId: Uint32Array, positions64?: Float64Array }} Mesh */
/** @typedef {{ faceIndex: number, matrix: Float64Array }} Orientation */
/** @typedef {{ ok: boolean, errors: object[], warnings: object[] }} Validation */

/**
 * Default M1 state — prototype icosidodecahedron frame ("Prototype TPU" defaults).
 * Schema.js arrives in M2; until then these constants are the source of truth.
 */
export const DEFAULT_STATE = Object.freeze({
  base: "icosidodeca",
  circumdiameterMm: 100,
  /**
   * Border in mm (constant frame width on every face) — the prototype's
   * spelling and the M1 default. `borderFraction` is the alternative
   * spelling (frame width proportional to face size); exactly one may be
   * set. Which becomes the M2 authoring primary is still open — see
   * SPEC.md § Open questions.
   */
  borderMm: 3.2,
  borderFraction: null,
  depth: "hollow",
  wallMm: 1.4,
  openings: true,
  filletMm: 4.5,
  edgeDiv: 10,
  /** Resting face — set to first pentagon after skeleton is known; -1 = auto. */
  faceIndex: -1,
});
