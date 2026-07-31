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

/**
 * @typedef {{
 *   label: string,
 *   points: () => Float64Array,
 *   regular: boolean,
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
