/**
 * Parameter schema — defaults, labels, bounds, visibility, and the canonical
 * state codec shared by projects, hash, presets, and dirty comparison.
 */

import { baseSelectOptions } from "./bases.js";

/** @typedef {{ key: string, group: string, label: string, type: string, unit?: string, min?: number, max?: number, step?: number, options?: {value:string,label:string,disabled?:boolean}[], hideWhen?: (s:object)=>boolean }} ControlDef */

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
 * Density levels — same idiom as Quality: UI vocabulary writing the canonical
 * (points, separation) pair for the random base. Values are the phase plan's
 * locked mapping; tune only at the review stop.
 */
export const DENSITY_LEVELS = Object.freeze([
  Object.freeze({ id: "sparse", label: "Sparse", points: 12, separation: 0.6 }),
  Object.freeze({ id: "medium", label: "Medium", points: 24, separation: 0.5 }),
  Object.freeze({ id: "dense", label: "Dense", points: 48, separation: 0.4 }),
]);

/** @returns {string|null} level id, or null = custom */
export function densityLevelFor(points, separation) {
  return (
    DENSITY_LEVELS.find((d) => d.points === points && d.separation === separation)
      ?.id ?? null
  );
}

/**
 * The mean-edge ↔ scale link is a bijection only on exact regular shapes;
 * on random hulls or under jitter the Edge field becomes a readout.
 */
export function edgeInputReadOnly(state) {
  return state.base === "random" || state.jitter > 0;
}

/** @type {ControlDef[]} */
export const CONTROL_DEFS = [
  {
    key: "base",
    group: "shape",
    label: "Base",
    type: "select",
    // Enabled family only — random / failing bases are omitted, not disabled.
    options: baseSelectOptions(),
  },
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
    // Writes the canonical (points, separation) pair — see DENSITY_LEVELS.
    key: "density",
    group: "shape",
    label: "Density",
    type: "segments",
    customTag: true,
    options: DENSITY_LEVELS.map((d) => ({ value: d.id, label: d.label })),
    hideWhen: (s) => s.base !== "random",
  },
  {
    key: "seed",
    group: "shape",
    label: "Seed",
    type: "seed",
    hideWhen: (s) => s.base !== "random",
  },
  {
    // Random-base only in v0.4: on merged regular bases point-jitter is a
    // topology cliff, not a gradual change (plane-jitter is on the roadmap).
    key: "jitter",
    group: "shape",
    label: "Jitter",
    type: "range",
    unit: "%",
    min: 0,
    max: 20,
    step: 0.5,
    hideWhen: (s) => s.base !== "random",
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
