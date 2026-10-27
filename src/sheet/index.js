/**
 * Sheet output — Cut and Fold modes. Not wired into the app yet; the
 * sample script (scripts/sheet-samples.mjs) drives it headless so the
 * output can be test-cut before any UI exists.
 *
 *   skeleton (mm) → panels + joints → parts (cut | fold) → boards → SVG
 */

import { extractPanels } from "./panels.js";
import { buildCut, fitCoupon } from "./cut.js";
import { buildFold } from "./fold.js";
import { packParts, BOARD_PROFILES } from "./layout.js";
import { boardSvg, LAYERS } from "./svg.js";

export { BOARD_PROFILES, LAYERS, boardSvg };

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton  in mm
 * @param {{
 *   mode: 'cut'|'fold',
 *   board: { w: number, h: number },
 *   coupon?: boolean,
 *   marginMm?: number, gapMm?: number,
 * } & object} opts  plus the mode's own options (see buildCut / buildFold)
 */
export function buildSheet(skeleton, opts) {
  const extracted = extractPanels(skeleton);
  const res = opts.mode === "cut" ? buildCut(extracted, opts) : buildFold(extracted, opts);
  const parts = [
    ...res.parts,
    ...(opts.mode === "cut" && opts.coupon ? fitCoupon(opts) : []),
    ...(opts.extraParts ?? []),
  ];
  const { boards, oversize } = packParts(parts, opts.board, { marginMm: opts.marginMm, gapMm: opts.gapMm });
  const warnings = [...res.warnings];
  if (oversize.length) warnings.push(`${oversize.length} parts are larger than the board (${oversize.slice(0, 3).join(", ")}…)`);
  return {
    mode: opts.mode,
    extracted,
    parts,
    boards,
    joins: res.joins,
    dims: res.dims,
    warnings,
    stats: { ...res.stats, boards: boards.length },
  };
}
