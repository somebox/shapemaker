/**
 * Flat registry of supported shape bases. Not an entity system —
 * IDs, labels, and point generators only.
 * Start-strip chips use shortLabel; full label stays for titles and project names.
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
import { fibonacciSpherePoints } from "./points/sphere.js";

/**
 * @typedef {{
 *   label: string,
 *   shortLabel: string,
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
    shortLabel: "Tetra",
    points: tetrahedronPoints,
    regular: true,
  },
  cube: {
    label: "Cube",
    shortLabel: "Cube",
    points: cubePoints,
    regular: true,
  },
  octahedron: {
    label: "Octahedron",
    shortLabel: "Octa",
    points: octahedronPoints,
    regular: true,
  },
  dodecahedron: {
    label: "Dodecahedron",
    shortLabel: "Dodeca",
    points: dodecahedronPoints,
    regular: true,
  },
  icosahedron: {
    label: "Icosahedron",
    shortLabel: "Icosa",
    points: icosahedronPoints,
    regular: true,
  },
  icosidodeca: {
    label: "Icosidodecahedron",
    shortLabel: "Icosi",
    points: icosidodecaPoints,
    regular: true,
  },
  sphere: {
    label: "Sphere",
    shortLabel: "Sphere",
    points: fibonacciSpherePoints,
    regular: false,
    parametric: true,
    merge: false,
  },
  random: {
    label: "Random hull",
    shortLabel: "Random",
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
