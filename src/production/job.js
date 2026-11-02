/**
 * Production jobs: how a shape gets made. A job is plain JSON, separate from
 * the shape's state: which process, and each process's own settings, kept
 * while the others are in use.
 *
 * JOB_DEFS is the one table of those settings: defaults, bounds, labels and
 * when each applies. The panel builds its rows from it, the CLI its flags,
 * and normalizeJob checks saved jobs against it.
 */

import { BOARD_PROFILES } from "../sheet/layout.js";
import { PRINT_BEDS } from "../sheet/printclips.js";

export const PROCESSES = Object.freeze(["print", "cut", "fold"]);

/** What each process works in, in words. */
export const PROCESS_STOCK = Object.freeze({ cut: "Rigid sheet: plywood, acrylic, MDF", fold: "Thin stock: paper, card, felt" });

const BOARD_MIN = 50, BOARD_MAX = 2000;

const range = (key, label, min, max, step, unit, dflt, more = {}) => ({ key, kind: "range", label, min, max, step, unit, default: dflt, ...more });
/** options: [value, text, hint?] */
const choice = (key, label, dflt, options, more = {}) => ({ key, kind: "choice", label, default: dflt, options, ...more });

const hasClips = (m) => m.join !== "ties";
const printsClips = (m) => hasClips(m) && m.clipsBy === "print";
const sews = (m) => m.join === "sew";

/** Where a process's stock goes; both sheet processes share these. */
const stock = (board) => [
  { key: "board", kind: "board", label: "Board", default: board, group: "make" },
  { key: "boardSize", kind: "size", label: "Size", default: { w: 300, h: 200 }, group: "make", when: (m) => m.board === "custom" },
  choice("labels", "Labels", true, [[true, "On"], [false, "Off"]], { group: "make" }),
  // Layout tolerances: flags and saved jobs only, no panel row.
  range("marginMm", "Margin", 0, 50, 0.5, "mm", 5, { group: null }),
  range("gapMm", "Gap", 0, 20, 0.5, "mm", 2, { group: null }),
];

/**
 * Groups: main (Form), clips and advanced (Form, collapsed), make (Make),
 * null (no panel row).
 */
export const JOB_DEFS = Object.freeze({
  print: [],
  cut: [
    range("sheetMm", "Sheet", 0.5, 8, 0.5, "mm", 3, { group: "main" }),
    choice("join", "Join", "clips", [
      ["clips", "Clips", "A small clip in the plane square to each edge, through a slot in each panel; holds any angle"],
      ["ties", "Ties", "Pairs of holes along each edge for zip ties or wire"],
      ["fingers", "Fingers", "Finger joints: the two edges interlock, flush, glued; near-90° edges only, others get clips"],
    ], { group: "main" }),
    choice("clipSize", "Size", "auto", [
      ["auto", "Auto", "The largest clip whose arms stay clear of the openings"],
      ["small", "S"], ["medium", "M"], ["large", "L"],
    ], { group: "clips", when: hasClips }),
    choice("clipsPerEdge", "Per edge", "auto", [
      ["auto", "Auto", "One, or two on edges of 70 mm and more"],
      [1, "1"], [2, "2"], [3, "3"],
    ], { group: "clips", when: hasClips }),
    choice("clipPlace", "Place", "middle", [
      ["middle", "Middle", "Spread along each edge"],
      ["corners", "Corners", "Near each end of the edge, just clear of the next side's clips"],
    ], { group: "clips", when: hasClips }),
    choice("clipsBy", "Made by", "cut", [
      ["cut", "Laser", "Cut from the sheet with the panels"],
      ["print", "Print", "3D-printed with chamfered edges, one STL per clip shape"],
    ], { group: "clips", when: hasClips }),
    // Never thinner than the sheet: its slots have to take the sheet.
    range("clipWidthMm", "Width", 1, 12, 0.5, "mm", 3, { group: "clips", when: printsClips, floor: (m) => m.sheetMm }),
    choice("weld", "Weld", false, [
      [false, "Off"],
      [true, "On", "Printed corner clips that touch become one piece"],
    ], { group: "clips", when: (m) => printsClips(m) && m.clipPlace === "corners" }),
    range("kerfMm", "Kerf", 0, 0.4, 0.01, "mm", 0, { group: "advanced" }),
    // Tenths of a millimetre, as the fit strip's slots are labelled.
    choice("clearanceMm", "Fit", 0.1, [
      [-0.2, "−2", "The slot marked −2 on the fit strip"],
      [-0.1, "−1", "The slot marked −1 on the fit strip"],
      [0, "0", "The slot marked 0 on the fit strip"],
      [0.1, "+1", "The slot marked +1 on the fit strip"],
      [0.2, "+2", "The slot marked +2 on the fit strip"],
    ], { group: "advanced" }),
    { key: "printBed", kind: "bed", label: "Print bed", default: "prusa-core-one", group: "advanced", when: printsClips },
    ...stock("falcon-a1"),
  ],
  fold: [
    choice("join", "Join", "tape", [
      ["tape", "Tape", "Plain open edges; tape them inside"],
      ["flaps", "Flaps", "Glue flaps on one side of each open edge"],
      ["sew", "Sew", "Seams: an allowance on both pieces, sewn face to face from the inside. Leave the last seam open to turn it right side out"],
    ], { group: "main" }),
    range("seamMm", "Allowance", 3, 15, 0.5, "mm", 6, { group: "main", when: sews }),
    choice("sewHoles", "Holes", false, [
      [false, "Off", "Dashed stitch line, for a needle through felt or cloth"],
      [true, "On", "Holes along the stitch line, for leather or thick felt"],
    ], { group: "main", when: sews }),
    choice("foldStyle", "Fold lines", "score", [
      ["score", "Score", "Low-power lines, valley and mountain on their own layers"],
      ["perforate", "Perforate", "Dashed through-cuts; folds easily, weaker"],
      ["mark", "Mark", "Engraved only; fold by hand"],
    ], { group: "main", when: (m) => !sews(m) }),
    ...stock("a4"),
  ],
});

/** Processes with settings of their own. */
const SETTLED = PROCESSES.filter((p) => JOB_DEFS[p].length);

/** Does def accept value v? */
export function validSetting(def, v) {
  switch (def.kind) {
    case "range": return typeof v === "number" && v >= def.min && v <= def.max;
    case "choice": return def.options.some(([value]) => value === v);
    case "board": return typeof v === "string" && (v === "custom" || Object.hasOwn(BOARD_PROFILES, v));
    case "bed": return typeof v === "string" && Object.hasOwn(PRINT_BEDS, v);
    case "size": return [v?.w, v?.h].every((n) => typeof n === "number" && n >= BOARD_MIN && n <= BOARD_MAX);
    default: return false;
  }
}

/**
 * A complete job from anything: missing or invalid settings take their
 * defaults, so an old or hand-edited file still opens.
 * @param {object} [raw]
 */
export function normalizeJob(raw) {
  const job = { process: PROCESSES.includes(raw?.process) ? raw.process : "print" };
  for (const process of SETTLED) {
    const from = raw?.[process] ?? {};
    job[process] = Object.fromEntries(
      JOB_DEFS[process].map((def) => [def.key, validSetting(def, from[def.key]) ? structuredClone(from[def.key]) : structuredClone(def.default)]),
    );
  }
  return job;
}

/**
 * Canonical JSON form. The process in use is written out in full, as state
 * is, so a later change of default can't change an existing design; the
 * others keep only what differs from their defaults.
 * @param {object} job
 */
export function serializeJob(job) {
  const n = normalizeJob(job);
  const out = { process: n.process };
  for (const process of SETTLED) {
    const kept = JOB_DEFS[process].filter((def) => process === n.process || JSON.stringify(n[process][def.key]) !== JSON.stringify(def.default));
    if (kept.length) out[process] = Object.fromEntries(kept.map((def) => [def.key, n[process][def.key]]));
  }
  return out;
}

/** The settings of the job's own process; null for print. */
export const settingsOf = (job) => job[job.process] ?? null;

/** Does this setting apply, given the process's other settings? */
export const settingApplies = (def, settings) => !def.when || def.when(settings);

/** The board of a process's settings, as { label, w, h }. */
export function boardOf(settings) {
  if (settings.board !== "custom") return BOARD_PROFILES[settings.board];
  const { w, h } = settings.boardSize;
  return { label: `${w} × ${h} mm`, w, h };
}
