/**
 * Flat registry of supported shape bases. Not an entity system —
 * IDs, labels, and point generators only.
 */

import {
  tetrahedronPoints,
  cubePoints,
  octahedronPoints,
  dodecahedronPoints,
  icosahedronPoints,
} from "./points/platonic.js";
import { icosidodecaPoints } from "./points/icosidodeca.js";
import { randomSpherePoints } from "./points/random.js";

/**
 * @typedef {{
 *   label: string,
 *   points: (params?: { points: number, seed: number, separation: number }) => Float64Array,
 *   regular: boolean,
 *   parametric?: boolean,  // points() consumes (points, seed, separation)
 *   merge?: false,         // false: skip coplanar merge (hull tris = faces)
 * }} BaseDef
 */

/** @type {Readonly<Record<string, BaseDef>>} */
export const BASES = Object.freeze({
  tetrahedron: {
    label: "Tetrahedron",
    points: tetrahedronPoints,
    regular: true,
  },
  cube: {
    label: "Cube",
    points: cubePoints,
    regular: true,
  },
  octahedron: {
    label: "Octahedron",
    points: octahedronPoints,
    regular: true,
  },
  dodecahedron: {
    label: "Dodecahedron",
    points: dodecahedronPoints,
    regular: true,
  },
  icosahedron: {
    label: "Icosahedron",
    points: icosahedronPoints,
    regular: true,
  },
  icosidodeca: {
    label: "Icosidodecahedron",
    points: icosidodecaPoints,
    regular: true,
  },
  random: {
    label: "Random hull",
    points: randomSpherePoints,
    regular: false,
    parametric: true,
    merge: false,
  },
});

/** Stable UI / schema order. */
export const BASE_IDS = Object.freeze(Object.keys(BASES));

/** @param {string} id */
export function isKnownBase(id) {
  return Object.prototype.hasOwnProperty.call(BASES, id);
}

/** Options for schema dropdowns (enabled bases only). */
export function baseSelectOptions() {
  return BASE_IDS.map((id) => ({
    value: id,
    label: BASES[id].label,
  }));
}
