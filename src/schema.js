/**
 * Parameter schema — defaults, labels, bounds, visibility, and the canonical
 * state codec shared by projects, hash, presets, and dirty comparison.
 */

import { BASES } from "./bases.js";

/** @typedef {{ key: string, group: string, label: string, type: string, unit?: string, min?: number, max?: number, step?: number, options?: {value:string,label:string,disabled?:boolean}[], numeric?: boolean, boolean?: boolean, customTag?: boolean, hideWhen?: (s:object)=>boolean, inertWhen?: (s:object)=>boolean, boundsForState?: (s:object)=>({min:number,max:number}|null) }} ControlDef */

/** Canonical geometry keys in documented order. */
export const STATE_KEYS = Object.freeze([
  "base",
  "circumdiameterMm",
  "borderFraction",
  "borderMm",
  "depth",
  "wallMm",
  "openings",
  "openingStyle",
  "filletMm",
  "roundingMm",
  "edgeDiv",
  "points",
  "seed",
  "separation",
  "jitter",
  "jitterMode",
  "dual",
  "truncate",
  "spike",
  "subdiv",
  "subdivStyle",
  "soften",
  "faceIndex",
]);

/** Spike slider / validation ceiling (apex radius in parent circumradius units). */
export const SPIKE_T_MAX = 4;

/**
 * Authoring defaults — relative border (fraction of face apothem). Constant
 * millimetres remain valid for legacy hashes/projects and headless fits;
 * exactly one of borderFraction / borderMm is authoritative when openings.
 * points/seed/separation drive the random base (and seed will drive jitter);
 * they are canonical for every base so hashes and projects stay uniform.
 */
export const DEFAULT_STATE = Object.freeze({
  base: "icosidodeca",
  circumdiameterMm: 100,
  borderFraction: 0.36,
  depth: "hollow",
  wallMm: 1.4,
  openings: true,
  openingStyle: "polygon",
  filletMm: 4.5,
  roundingMm: 0,
  edgeDiv: 10,
  points: 24,
  seed: 1337,
  separation: 0.5,
  jitter: 0,
  jitterMode: "surface",
  dual: false,
  truncate: 0,
  spike: 0,
  subdiv: 0,
  subdivStyle: "radial",
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
 * The mean-edge ↔ scale link is a bijection only on exact regular shapes
 * (every edge the same length). Jitter breaks that. Spike still scales
 * uniformly, but ridges and valleys have different lengths, so Edge is a
 * readout of the mean rather than a single-length input.
 */
export function isEdgeInputReadOnly(state) {
  return !BASES[state.base]?.regular || state.jitter > 0 || state.spike > 0;
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
    // UI-only derived field — not in STATE_KEYS. The panel converts edits
    // into a circumdiameterMm patch via the mean-edge ratio (see ui.js).
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
    // Density slider for parametric hulls. The value is a point count on
    // sphere/random and a meridian count on globe; separation derives from
    // it (see separationForPoints), applied as a coupled write in
    // normalizePatch. Bases advertising a narrower effective range
    // (globe: 6–36 meridians) clamp the slider via boundsForState so no
    // slider positions are dead.
    key: "points",
    group: "shape",
    label: "Density",
    type: "range",
    unit: "pts",
    min: 4,
    max: 60,
    step: 1,
    inertWhen: (s) => !BASES[s.base]?.parametric,
    boundsForState: (s) => BASES[s.base]?.pointsRange ?? null,
  },
  {
    key: "seed",
    group: "shape",
    label: "Seed",
    type: "seed",
    // Active when the base's placement is seeded, or whenever jitter is on.
    // The sphere/globe lattices are deterministic, so seed only matters under
    // jitter there; random placement always needs seed.
    inertWhen: (s) => !BASES[s.base]?.seeded && !(s.jitter > 0),
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
    // Polar dual (skeleton operator, after jitter, before truncate): faces
    // become vertices and vertices become faces — cube ↔ octahedron, a
    // triangulated sphere → pentagon + hexagon cells. Every corner of a
    // triangulation's dual joins three faces, so Truncate then cuts exactly.
    key: "dual",
    group: "shape",
    label: "Dual",
    type: "segments",
    boolean: true,
    options: [
      { value: "false", label: "Off" },
      { value: "true", label: "On" },
    ],
  },
  {
    // Vertex truncation (skeleton operator, before spike / subdivide): cuts
    // each corner by re-hulling edge points at t% along every edge. 50 is
    // full rectification (cube → cuboctahedron); an icosahedron at ~33 is
    // the soccer ball. Composes with jitter, spike, subdivide, and rounding.
    key: "truncate",
    group: "shape",
    label: "Truncate",
    type: "range",
    unit: "%",
    min: 0,
    max: 50,
    step: 1,
  },
  {
    // Pyramid on every face (after truncate, before subdivide). t is the
    // apex radius in parent circumradius units; 0 skips. t above the face
    // inradius spikes; t below dimples. Smooth is inert (halfspace inset
    // is the convex hull of a star). Rounding stays live but ridge-only:
    // reflex valleys skip the rolling-ball strip.
    key: "spike",
    group: "shape",
    label: "Spike",
    type: "range",
    min: 0,
    max: SPIKE_T_MAX,
    step: 0.01,
  },
  {
    // Surface subdivision (skeleton operator): triangles split 4:1,
    // polygons fan over midpoint-split edges. Order is load-bearing:
    // jitter → dual → truncate → spike → subdivide → smooth.
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
    // Polygon split pattern: Radial fans 2k triangles per k-gon from the
    // centroid (8 openings per cube side at Once); Grid cuts k corner
    // quads (4 per cube side at Once, 16 at Twice). Triangles split 4:1
    // either way. Smooth needs Radial — its sphere clip would bend the
    // flat quads out of plane, so it is inert (and ignored) under Grid.
    key: "subdivStyle",
    group: "shape",
    label: "Pattern",
    type: "segments",
    options: [
      { value: "radial", label: "Radial" },
      { value: "grid", label: "Grid" },
    ],
    inertWhen: (s) => !(s.subdiv > 0),
  },
  {
    // Edge fillet by rounding clip: soften sets a radius (fraction of the
    // inradius) and vertices project onto the rounded parent solid, so
    // edges AND corners soften from the first step while flat interiors
    // hold. 100 turns a cube into its inscribed ball. Needs Subdivide for
    // resolution; most pronounced on cube and tetra.
    key: "soften",
    group: "shape",
    label: "Smooth",
    type: "range",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    inertWhen: (s) => !(s.subdiv > 0) || s.subdivStyle === "grid" || s.spike > 0,
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
    boolean: true,
    options: [
      { value: "true", label: "Open" },
      { value: "false", label: "Closed" },
    ],
  },
  {
    // Opening generator. Polygon is the inset-and-fillet outline of the
    // face; Ellipse is the face's largest inscribed oval under the same
    // Border scale (circles on regular faces) — the ring-ball form, at its
    // best on the pentagon + hexagon cells a Dual produces. Fillet is inert
    // under Ellipse.
    key: "openingStyle",
    group: "form",
    label: "Opening",
    type: "segments",
    options: [
      { value: "polygon", label: "Polygon" },
      { value: "ellipse", label: "Ellipse" },
    ],
    inertWhen: (s) => !s.openings,
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
    inertWhen: (s) => s.depth === "solid",
  },
  {
    // Relative border: fraction of each face's centroid–edge distance
    // (apothem). Scales with every opening — subdiv/globe/mixed faces no
    // longer hard-fail on the smallest strut. Applied mm range is reported
    // in the status strip. Legacy borderMm remains valid via hash/API.
    key: "borderFraction",
    group: "form",
    label: "Border",
    type: "range",
    unit: "%",
    min: 5,
    max: 90,
    step: 1,
    toState: (v) => v / 100,
    fromState: (v) => (v == null ? 0 : v * 100),
    inertWhen: (s) => !s.openings,
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
    inertWhen: (s) => !s.openings || s.openingStyle === "ellipse",
  },
  {
    // Dihedral rounding. On spiked meshes only convex ridges (and apexes)
    // take a radius — reflex valleys skip, because the blend centre would
    // sit outside the fold.
    key: "roundingMm",
    group: "form",
    label: "Rounding",
    type: "range",
    unit: "mm",
    min: 0,
    max: 5,
    step: 0.1,
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
 * Clamp Density into a base's advertised `pointsRange` (e.g. globe 6–36).
 * Bases without a range leave the value unchanged.
 * @param {string} baseId
 * @param {number} points
 * @returns {number}
 */
export function clampPointsForBase(baseId, points) {
  const pr = BASES[baseId]?.pointsRange;
  if (!pr || !Number.isFinite(points)) return points;
  return Math.max(pr.min, Math.min(pr.max, Math.floor(points)));
}

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
  // Border: exactly one spelling. Legacy mm-only input must not inherit the
  // default fraction; fraction-only (or default) clears mm.
  const inMm = input.borderMm !== undefined && input.borderMm !== null;
  const inFrac =
    input.borderFraction !== undefined && input.borderFraction !== null;
  if (inMm && !inFrac) {
    out.borderMm = input.borderMm;
    delete out.borderFraction;
  } else if (inFrac && !inMm) {
    out.borderFraction = input.borderFraction;
    delete out.borderMm;
  } else if (!inMm && !inFrac) {
    delete out.borderMm;
  }
  // Heal Density from legacy hashes/projects so state matches the mesh the
  // generator actually builds (and export filenames stay honest).
  const clamped = clampPointsForBase(/** @type {string} */ (out.base), /** @type {number} */ (out.points));
  if (clamped !== out.points) {
    out.points = clamped;
    out.separation = separationForPoints(clamped);
  }
  return out;
}

/**
 * Canonical serializable state (no nulls, no extras).
 * Omits the inactive border spelling so hashes stay exclusive.
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
  // Prefer fraction when both somehow appear; never emit both.
  if (out.borderFraction != null && out.borderMm != null) {
    delete out.borderMm;
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
