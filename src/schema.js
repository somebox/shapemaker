/**
 * Parameter schema — defaults, labels, bounds, visibility, and the canonical
 * state codec shared by projects, hash, presets, and dirty comparison.
 */

import { BASES } from "./bases.js";

/** @typedef {{ key: string, group: string, label: string, type: string, unit?: string, min?: number, max?: number, step?: number, options?: {value:string,label:string,disabled?:boolean}[], hideWhen?: (s:object)=>boolean, inertWhen?: (s:object)=>boolean }} ControlDef */

/** Canonical geometry keys in documented order. */
export const STATE_KEYS = Object.freeze([
  "base",
  "circumdiameterMm",
  "borderMm",
  "depth",
  "wallMm",
  "openings",
  "filletMm",
  "edgeDiv",
  "points",
  "seed",
  "separation",
  "jitter",
  "jitterMode",
  "subdiv",
  "soften",
  "faceIndex",
]);

/**
 * Authoring defaults — millimetre border only (no borderFraction).
 * points/seed/separation drive the random base (and seed will drive jitter);
 * they are canonical for every base so hashes and projects stay uniform, and
 * they are additive-with-defaults, so pre-0.4 files normalize unchanged.
 */
export const DEFAULT_STATE = Object.freeze({
  base: "icosidodeca",
  circumdiameterMm: 100,
  borderMm: 3.2,
  depth: "hollow",
  wallMm: 1.4,
  openings: true,
  filletMm: 4.5,
  edgeDiv: 10,
  points: 24,
  seed: 1337,
  separation: 0.5,
  jitter: 0,
  jitterMode: "surface",
  subdiv: 0,
  soften: 0,
  faceIndex: -1,
});

/**
 * Quality levels — UI vocabulary over canonical edgeDiv. Fillet arc segments
 * derive from edgeDiv in the solidifier (round(edgeDiv × 6.4)), so Normal is
 * exactly the historical 10 / 64 pair and parity anchors are untouched.
 */
export const QUALITY_LEVELS = Object.freeze([
  Object.freeze({ id: "draft", label: "Draft", edgeDiv: 4 }),
  Object.freeze({ id: "normal", label: "Normal", edgeDiv: 10 }),
  Object.freeze({ id: "fine", label: "Fine", edgeDiv: 20 }),
]);

/** @param {number} edgeDiv @returns {string|null} level id, or null = custom */
export function qualityLevelFor(edgeDiv) {
  return QUALITY_LEVELS.find((q) => q.edgeDiv === edgeDiv)?.id ?? null;
}

/**
 * Separation for a point count — the coupled write behind the Density
 * slider. Matches the retired Sparse/Medium/Dense chip anchors at 12/24/48
 * (0.6/0.5/0.4) and clamps to a workable band elsewhere.
 * @param {number} points
 * @returns {number}
 */
export function separationForPoints(points) {
  const s = 0.6 - 0.1 * Math.log2(points / 12);
  return Math.round(Math.min(0.7, Math.max(0.3, s)) * 100) / 100;
}

/**
 * The mean-edge ↔ scale link is a bijection only on exact regular shapes;
 * on parametric hulls (sphere, random) or under jitter the Edge field
 * becomes a readout.
 */
export function edgeInputReadOnly(state) {
  return !BASES[state.base]?.regular || state.jitter > 0;
}

/** @type {ControlDef[]} */
export const CONTROL_DEFS = [
  // `base` stays canonical (STATE_KEYS) but is chosen via the Start strip,
  // not a Shape-group mode dropdown — starts load point packs to modify.
  {
    key: "circumdiameterMm",
    group: "shape",
    label: "Size",
    type: "range",
    unit: "mm",
    // Slider convenience bounds; typed values may exceed (free scale).
    min: 20,
    max: 300,
    step: 0.5,
  },
  {
    key: "edgeLengthMm",
    group: "shape",
    label: "Edge",
    type: "number",
    unit: "mm",
    min: 1,
    max: 200,
    step: 0.1,
  },
  {
    // Direct point-count slider for parametric hulls (sphere, random);
    // separation derives from the count (see separationForPoints), applied
    // as a coupled write in normalizePatch. Replaced the Sparse/Medium/Dense
    // chips after the start-from playtest.
    key: "points",
    group: "shape",
    label: "Density",
    type: "range",
    unit: "pts",
    min: 4,
    max: 60,
    step: 1,
    inertWhen: (s) => !BASES[s.base]?.parametric,
  },
  {
    key: "seed",
    group: "shape",
    label: "Seed",
    type: "seed",
    // Active for random placement or whenever jitter is on. The sphere
    // lattice is deterministic, so its seed only matters under jitter.
    inertWhen: (s) => s.base !== "random" && !(s.jitter > 0),
  },
  {
    // Always shown; allowed on every base. Regular bases perturb face
    // planes (polygons kept, faces may vanish at extremes); parametric
    // bases jitter points on the sphere.
    key: "jitter",
    group: "shape",
    label: "Jitter",
    type: "range",
    unit: "%",
    min: 0,
    max: 50,
    step: 0.5,
  },
  {
    // Direction of the random displacement. Surface slides along the
    // sphere / tilts planes; Radial scales center-to-surface distance
    // (parametric points can sink inside the hull and vanish — accepted).
    key: "jitterMode",
    group: "shape",
    label: "Direction",
    type: "segments",
    options: [
      { value: "surface", label: "Surface" },
      { value: "radial", label: "Radial" },
      { value: "both", label: "Both" },
    ],
    inertWhen: (s) => !(s.jitter > 0),
  },
  {
    // Surface subdivision (skeleton operator): triangles split 4:1,
    // polygons fan over midpoint-split edges. Applied after the hull,
    // before jitter. Smooth controls how far new vertices rise to the
    // circumsphere.
    key: "subdiv",
    group: "shape",
    label: "Subdivide",
    type: "segments",
    numeric: true,
    options: [
      { value: "0", label: "None" },
      { value: "1", label: "Once" },
      { value: "2", label: "Twice" },
    ],
  },
  {
    // Outer-edge fillet by sphere clip: 0 keeps the exact flat solid,
    // rising values round corners and edges onto a shrinking sphere while
    // flat face interiors hold, 100 reaches the inscribed ball. Needs
    // Subdivide for resolution; most pronounced on cube and tetra.
    key: "soften",
    group: "shape",
    label: "Smooth",
    type: "range",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    inertWhen: (s) => !(s.subdiv > 0),
  },
  {
    key: "depth",
    group: "form",
    label: "Shell",
    type: "segments",
    options: [
      { value: "hollow", label: "Hollow" },
      { value: "solid", label: "Solid" },
    ],
  },
  {
    key: "openings",
    group: "form",
    label: "Faces",
    type: "segments",
    options: [
      { value: "true", label: "Open" },
      { value: "false", label: "Closed" },
    ],
  },
  {
    key: "wallMm",
    group: "form",
    label: "Wall",
    type: "range",
    unit: "mm",
    min: 0.4,
    max: 20,
    step: 0.1,
    hideWhen: (s) => s.depth === "solid",
  },
  {
    key: "borderMm",
    group: "form",
    label: "Border",
    type: "range",
    unit: "mm",
    min: 0.5,
    max: 30,
    step: 0.1,
    hideWhen: (s) => !s.openings,
  },
  {
    key: "filletMm",
    group: "form",
    label: "Fillet",
    type: "range",
    unit: "mm",
    min: 0,
    max: 30,
    step: 0.1,
    hideWhen: (s) => !s.openings,
  },
  {
    // Quality is UI-only vocabulary over canonical edgeDiv — one tessellation
    // knob (fillet arc segments derive from it in the solidifier). "Custom"
    // shows when edgeDiv matches no level. Named Quality, never "preset":
    // preset already means shape recipes in this app.
    key: "edgeDiv",
    group: "form",
    label: "Quality",
    type: "segments",
    numeric: true,
    customTag: true,
    options: QUALITY_LEVELS.map((q) => ({ value: String(q.edgeDiv), label: q.label })),
  },
];

/**
 * Normalize arbitrary input into a complete authoring state.
 * @param {object} [input]
 */
export function normalizeState(input = {}) {
  /** @type {Record<string, unknown>} */
  const out = { ...DEFAULT_STATE };
  for (const key of STATE_KEYS) {
    if (input[key] !== undefined && input[key] !== null) {
      out[key] = input[key];
    }
  }
  return out;
}

/**
 * Canonical serializable state (no nulls, no extras, no borderFraction).
 * @param {object} state
 */
export function serializeState(state) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of STATE_KEYS) {
    const v = state[key];
    if (v === undefined || v === null) continue;
    out[key] = v;
  }
  return out;
}

/**
 * Canonical equality for dirty / history gates.
 * @param {object} a
 * @param {object} b
 */
export function statesEqual(a, b) {
  const sa = serializeState(a);
  const sb = serializeState(b);
  for (const key of STATE_KEYS) {
    if (sa[key] !== sb[key]) return false;
  }
  return true;
}
