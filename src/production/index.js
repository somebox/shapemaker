/**
 * Production: from a shape to the files that make it. The only API the app
 * and the CLI use, as compile() is for the shape. Nothing here touches the
 * DOM, a file system or a viewer.
 *
 *   state → compile / compileShape → produce(shape, job) → finishProduction
 *     → listArtifacts (files) · summarize (words) · sheetViews (pictures)
 *
 * print needs compile()'s mesh; cut and fold need only the skeleton, so give
 * them compileShape()'s result.
 */

import { compile, compileShape } from "../compile.js";
import { OPENING_GENERATORS } from "../solid/shell.js";
import { loadCsg, needsCsg, weldTouching } from "../solid/csg.js";
import { DEFAULT_STATE } from "../schema.js";
import { buildSheet } from "../sheet/index.js";
import { weldPlates, PRINT_BEDS } from "../sheet/printclips.js";
import { MAX_BORDER } from "../sheet/cut.js";
import { normalizeJob, boardOf } from "./job.js";

export { JOB_DEFS, PROCESSES, PROCESS_STOCK, normalizeJob, serializeJob, settingsOf, settingApplies, boardOf } from "./job.js";
export { designStem, listArtifacts, sheetViews, exportNotes } from "./artifacts.js";
export { summarize } from "./summary.js";

/** The state's openings, as the sheet engine takes them; null when closed. */
export function openingSpec(state) {
  return state.openings
    ? { generator: OPENING_GENERATORS[state.openingStyle], borderFraction: state.borderFraction ?? DEFAULT_STATE.borderFraction, filletMm: state.filletMm }
    : null;
}

/** buildSheet options for a job on a shape. */
export function sheetOptions(job, state) {
  const m = job[job.process];
  const common = { mode: job.process, board: boardOf(m), labels: m.labels, marginMm: m.marginMm, gapMm: m.gapMm, openings: openingSpec(state) };
  return job.process === "cut"
    ? {
        ...common, coupon: true, join: m.join, sheetMm: m.sheetMm, kerfMm: m.kerfMm, clearanceMm: m.clearanceMm,
        clipsBy: m.clipsBy, clipSize: m.clipSize, clipsPerEdge: m.clipsPerEdge, clipPlace: m.clipPlace, clipWidthMm: m.clipWidthMm,
        printBed: PRINT_BEDS[m.printBed],
      }
    : {
        // Felt and cloth take no score line: sewn stock is only marked.
        ...common, join: m.join, foldStyle: m.join === "sew" ? "mark" : m.foldStyle,
        seamMm: m.seamMm, sewHoles: m.sewHoles, rootFace: state.faceIndex,
      };
}

/**
 * Changes to the shape that would answer a warning, in the app's fix
 * pattern: closed faces offer the Border that opens them, when one exists.
 */
function shapeFixes(sheet) {
  const { filledPanels, minBorderFraction } = sheet.stats;
  if (sheet.mode !== "cut" || !filledPanels) return [];
  const need = Math.ceil(minBorderFraction * 100);
  return need <= MAX_BORDER * 100 ? [{ label: `Use ${need}% border`, patch: { borderFraction: need / 100 } }] : [];
}

/**
 * Plan a job on a shape. Everything is computed here but welding, which
 * finishProduction does once the mesh library is in. Bad input comes back as
 * ok: false, never as a throw.
 * @param {{ skeleton: object, state: object }} shape  from compileShape, or compile for print
 * @param {object} [rawJob]
 */
export function produce(shape, rawJob) {
  const job = normalizeJob(rawJob);
  const base = { process: job.process, job, state: shape.state, skeleton: shape.skeleton };
  if (!shape.skeleton) return { ...base, ok: false, error: "No model to lay out" };
  if (job.process === "print") {
    return shape.mesh
      ? { ...base, ok: true, compiled: shape, warnings: shape.validation.warnings.map((w) => w.message), fixes: [], weld: null }
      : { ...base, ok: false, error: "Print needs the compiled shell" };
  }
  try {
    const opts = sheetOptions(job, shape.state);
    const sheet = buildSheet(shape.skeleton, opts);
    const m = job.cut;
    const pending = job.process === "cut" && m.clipsBy === "print" && m.clipPlace === "corners" && m.weld && sheet.plates.length > 0;
    return {
      ...base, ok: true, sheet, board: opts.board, openings: opts.openings,
      warnings: sheet.warnings, fixes: shapeFixes(sheet), weld: pending ? { pending: true } : null,
    };
  } catch (err) {
    console.error("produce:", err);
    return { ...base, ok: false, error: `Couldn't lay this shape out: ${err.message}` };
  }
}

/**
 * The steps that can't run straight away: welding printed corner clips,
 * which waits for the mesh library. Returns a new production.
 * @param {ReturnType<typeof produce>} prod
 */
export async function finishProduction(prod) {
  if (!prod.weld?.pending) return prod;
  try {
    await loadCsg();
    const res = weldPlates(prod.sheet, prod.skeleton, weldTouching, PRINT_BEDS[prod.job.cut.printBed]);
    return {
      ...prod,
      sheet: { ...prod.sheet, plates: res.plates, stats: { ...prod.sheet.stats, plates: res.plates.length } },
      weld: { pieces: res.welded, clips: res.weldedClips },
    };
  } catch (err) {
    console.error("weld:", err);
    return { ...prod, weld: { error: err.message } };
  }
}

/**
 * State and job to finished production, in one call, for headless callers.
 * Applies a production's fixes when asked, as a user pressing them would.
 * @param {object} state
 * @param {object} [rawJob]
 * @param {{ applyFixes?: boolean }} [opts]
 */
export async function runJob(state, rawJob, { applyFixes = false } = {}) {
  const job = normalizeJob(rawJob);
  let shape;
  if (job.process === "print") {
    if (needsCsg({ ...DEFAULT_STATE, ...state })) await loadCsg();
    shape = compile(state);
  } else {
    shape = compileShape(state);
  }
  if (!shape.validation.ok || !shape.skeleton) {
    return { ok: false, process: job.process, job, state: shape.state, error: shape.validation.errors.map((e) => e.message).join("; ") };
  }
  let prod = produce(shape, job);
  if (applyFixes && prod.ok && prod.fixes.length) {
    const patch = Object.assign({}, ...prod.fixes.map((f) => f.patch));
    prod = produce(compileShape({ ...state, ...patch }), job);
  }
  return prod.ok ? finishProduction(prod) : prod;
}
