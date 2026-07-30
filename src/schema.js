/**
 * Parameter schema — defaults, labels, bounds, visibility, and the canonical
 * state codec shared by projects, hash, presets, and dirty comparison.
 */

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
  "faceIndex",
]);

/** Authoring defaults — millimetre border only (no borderFraction). */
export const DEFAULT_STATE = Object.freeze({
  base: "icosidodeca",
  circumdiameterMm: 100,
  borderMm: 3.2,
  depth: "hollow",
  wallMm: 1.4,
  openings: true,
  edgeDiv: 10,
  filletMm: 4.5,
  faceIndex: -1,
});

/** @type {ControlDef[]} */
export const CONTROL_DEFS = [
  {
    key: "base",
    group: "shape",
    label: "Base",
    type: "select",
    options: [
      { value: "icosidodeca", label: "Icosidodecahedron" },
      { value: "tetrahedron", label: "Tetrahedron — in development", disabled: true },
      { value: "cube", label: "Cube — in development", disabled: true },
      { value: "octahedron", label: "Octahedron — in development", disabled: true },
      { value: "dodecahedron", label: "Dodecahedron — in development", disabled: true },
      { value: "icosahedron", label: "Icosahedron — in development", disabled: true },
      { value: "random", label: "Random hull — in development", disabled: true },
    ],
  },
  {
    key: "circumdiameterMm",
    group: "shape",
    label: "Size",
    type: "range",
    unit: "mm",
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
