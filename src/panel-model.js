/**
 * What the panel holds, as plain data: its tabs, which tab owns each control
 * and error, and the words on the tabs and status line. The DOM is ui.js.
 */

import { CONTROL_DEFS } from "./schema.js";
import { fmt } from "./controls.js";

export const TABS = Object.freeze([
  Object.freeze({ id: "shape", title: "Shape" }),
  Object.freeze({ id: "openings", title: "Openings" }),
  Object.freeze({ id: "build", title: "Build" }),
  Object.freeze({ id: "files", title: "Files" }),
]);

export const DEFAULT_TAB = "shape";

/** Keys that name a tab: every control, and error keys no control carries. */
const KEY_TABS = new Map([
  ...CONTROL_DEFS.map((d) => [d.key, d.group]),
  ["borderMm", "openings"],
  ["base", "shape"],
  ["faceIndex", "build"],
]);

/**
 * @param {string} [key] a control or error key
 * @returns {string|null} the tab that holds it; null when no tab does
 */
export function tabOfKey(key) {
  return KEY_TABS.get(key) ?? null;
}

/** @param {string|null} [id] */
export function validTab(id) {
  return TABS.some((t) => t.id === id) ? id : DEFAULT_TAB;
}

/**
 * The Build tab's caption.
 * @param {object} state
 * @param {{ process: string, cut: object, fold: object } | null} [job]
 */
export function buildCaption(state, job = null) {
  if (job?.process === "cut") return `Cut ${fmt(job.cut.sheetMm)} mm`;
  if (job?.process === "fold") return `Fold ${job.fold.join}`;
  return state.depth === "solid" ? "Print solid" : `Print ${fmt(state.wallMm)} mm`;
}

/** The Openings tab's caption. */
export function openingsCaption(state) {
  if (!state.openings) return "closed";
  return state.borderFraction != null
    ? `${Math.round(state.borderFraction * 100)}% border`
    : `${fmt(state.borderMm)} mm border`;
}

/**
 * What each tab's caption says, so a design reads at a glance.
 * @param {{ state: object, job?: object | null }} args
 * @returns {Record<string, string>} by tab id
 */
export function tabCaptions({ state, job = null }) {
  return {
    shape: `${fmt(state.circumdiameterMm)} mm`,
    openings: openingsCaption(state),
    build: buildCaption(state, job),
  };
}
