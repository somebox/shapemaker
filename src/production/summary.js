/**
 * A production in words: the status lines the app shows and the CLI prints.
 */

import { settingsOf } from "./job.js";

export const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString();
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function cutLines(prod) {
  const m = prod.job.cut, st = prod.sheet.stats;
  const clips = Object.values(st.clips ?? {}).reduce((a, n) => a + n, 0);
  const size = m.clipSize === "auto" ? `${st.clipSize}, auto` : st.clipSize;
  const clipText = clips && (st.plates ? `${clips} printed clips (${size}, ${plural(st.plates, "plate")})` : `${plural(clips, "clip")} (${size})`);
  const joins = [clipText, st.ties && plural(st.ties, "tie"), st.fingers && plural(st.fingers, "finger joint"), st.glued && `${st.glued} glued`]
    .filter(Boolean)
    .join(" + ");
  const types = Object.keys(st.clips ?? {}).length;
  const w = prod.weld;
  const weld = w?.pending ? " · welding corners…"
    : w?.error ? " · weld failed"
    : w ? (w.pieces ? ` · ${w.clips} clips weld into ${plural(w.pieces, "corner piece")}` : " · no corner clips touch (try L or wider clips)")
    : "";
  return [
    `cut   ${plural(st.panels, "panel")} · ${joins} · ${boardsText(prod)} · sheet ${fmt(m.sheetMm)} mm`,
    `edges ${fmt(st.dihedralDeg[0], 0)}–${fmt(st.dihedralDeg[1], 0)}° · shortest side ${fmt(st.smallestSideMm)} mm${types ? ` · ${plural(types, "clip shape")}` : ""}${weld}`,
  ];
}

function foldLines(prod) {
  const m = prod.job.fold, st = prod.sheet.stats, sew = m.join === "sew";
  const sewn = [st.seams && plural(st.seams, "seam"), st.darts && plural(st.darts, "dart"), st.whipStitched && `${st.whipStitched} whip-stitched`].filter(Boolean).join(" + ");
  const edges = sew ? sewn || "no seams" : plural(st.openEdges, m.join === "tape" ? "taped edge" : "flap");
  return [
    `fold  ${plural(st.nets, "net")} · ${plural(st.panels, "face")} · ${plural(st.folds, "fold")} · ${edges} · ${boardsText(prod)}`,
    `largest net ${plural(st.largestNet, "face")} · ${sew ? `allowance ${fmt(m.seamMm)} mm, sewn face to face` : `fold lines ${m.foldStyle}`}`,
  ];
}

const boardsText = (prod) => `${plural(prod.sheet.stats.boards, "board")} ${fmt(prod.board.w)}×${fmt(prod.board.h)}`;

function printLines(prod) {
  const { metrics, state } = prod.compiled;
  return [`print ${metrics.triangleCount} triangles · ${metrics.volumeCm3.toFixed(2)} cm³ · ⌀ ${state.circumdiameterMm} mm`];
}

function cutHeadline(prod) {
  const st = prod.sheet.stats;
  const clips = Object.values(st.clips ?? {}).reduce((a, n) => a + n, 0);
  const joins = [
    clips && plural(clips, st.plates ? "printed clip" : "clip"),
    st.ties && plural(st.ties, "tie"),
    st.fingers && plural(st.fingers, "finger joint"),
  ].filter(Boolean);
  return [plural(st.panels, "panel"), ...joins, plural(st.boards, "board")].join(" · ");
}

function foldHeadline(prod) {
  const st = prod.sheet.stats;
  return [plural(st.nets, "net"), plural(st.folds, "fold"), plural(st.boards, "board")].join(" · ");
}

/**
 * A production in one short line, for a status bar; `summarize` has the rest.
 * @param {ReturnType<import('./index.js').produce>} prod
 */
export function headline(prod) {
  if (!prod.ok) return prod.error;
  if (!settingsOf(prod.job)) return printLines(prod)[0];
  return prod.process === "cut" ? cutHeadline(prod) : foldHeadline(prod);
}

/**
 * @param {ReturnType<import('./index.js').produce>} prod
 * @returns {string[]} status lines; warnings and fixes are on the production
 */
export function summarize(prod) {
  if (!prod.ok) return [prod.error];
  if (!settingsOf(prod.job)) return printLines(prod);
  return prod.process === "cut" ? cutLines(prod) : foldLines(prod);
}
