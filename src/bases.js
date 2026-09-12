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
import { cuboctahedronPoints } from "./points/cuboctahedron.js";
import { rhombicosidodecaPoints } from "./points/rhombicosidodeca.js";
import {
  rhombicDodecaPoints,
  rhombicTriacontaPoints,
} from "./points/rhombic.js";
import {
  globePoints,
  GLOBE_MERIDIAN_MIN,
  GLOBE_MERIDIAN_MAX,
} from "./points/globe.js";
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
 *   seeded?: boolean,      // seed shapes geometry even without jitter
 *   pointsRange?: { min: number, max: number },  // Density values that change geometry (default 4–60)
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
  cuboctahedron: {
    label: "Cuboctahedron",
    shortLabel: "Cubocta",
    points: cuboctahedronPoints,
    regular: true,
  },
  rhombicosidodeca: {
    label: "Rhombicosidodecahedron",
    shortLabel: "Rhombicosi",
    points: rhombicosidodecaPoints,
    regular: true,
  },
  rhombicdodeca: {
    label: "Rhombic dodecahedron",
    shortLabel: "Rhomb 12",
    points: rhombicDodecaPoints,
    regular: true,
  },
  rhombictriaconta: {
    label: "Rhombic triacontahedron",
    shortLabel: "Rhomb 30",
    points: rhombicTriacontaPoints,
    regular: true,
  },
  globe: {
    label: "Globe",
    shortLabel: "Globe",
    points: globePoints,
    regular: false,
    parametric: true,
    pointsRange: { min: GLOBE_MERIDIAN_MIN, max: GLOBE_MERIDIAN_MAX },
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
    seeded: true,
  },
});

/** Stable UI / schema order. */
export const BASE_IDS = Object.freeze(Object.keys(BASES));

/** @param {string} id */
export function isKnownBase(id) {
  return Object.prototype.hasOwnProperty.call(BASES, id);
}
