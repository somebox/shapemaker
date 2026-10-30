/**
 * Sheet output — Cut and Fold modes. The sample script
 * (scripts/sheet-samples.mjs) drives it headless for test cuts, and the
 * in-app mockup (mockup.js, behind ?sheet) drives it live.
 *
 *   skeleton (mm) → panels + joints → parts (cut | fold) → boards → SVG
 *                                       └ printed clips → plates → STL
 */

import { extractPanels } from "./panels.js";
import { buildCut, fitCoupon } from "./cut.js";
import { buildFold } from "./fold.js";
import { packParts, BOARD_PROFILES } from "./layout.js";
import { boardSvg, LAYERS } from "./svg.js";
import { clipPlates, PRINT_BEDS } from "./printclips.js";

export { BOARD_PROFILES, PRINT_BEDS, LAYERS, boardSvg };

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton  in mm
 * @param {{
 *   mode: 'cut'|'fold',
 *   board: { w: number, h: number },
 *   coupon?: boolean,
 *   printBed?: { w: number, h: number },  for printed clips (clipsBy: 'print')
 *   marginMm?: number, gapMm?: number,
 * } & object} opts  plus the mode's own options (see buildCut / buildFold)
 */
export function buildSheet(skeleton, opts) {
  const extracted = extractPanels(skeleton);
  const res = opts.mode === "cut" ? buildCut(extracted, opts) : buildFold(extracted, opts);
  const parts = [
    ...res.parts,
    ...(opts.mode === "cut" && opts.coupon ? fitCoupon({ ...opts, slotMm: opts.clipsBy === "print" ? Math.max(opts.sheetMm, opts.clipWidthMm ?? opts.sheetMm) : opts.sheetMm }) : []),
    ...(opts.extraParts ?? []),
  ];
  // Printed clips go to print plates instead of the boards.
  const printed = parts.filter((p) => p.print);
  const { boards, oversize } = packParts(parts.filter((p) => !p.print), opts.board, { marginMm: opts.marginMm, gapMm: opts.gapMm });
  const plates = printed.length ? clipPlates(printed, opts.printBed ?? PRINT_BEDS["prusa-core-one"]) : [];
  const warnings = [...res.warnings];
  if (oversize.length) warnings.push(`${oversize.length} parts are larger than the board (${oversize.slice(0, 3).join(", ")}…)`);
  return {
    mode: opts.mode,
    extracted,
    parts,
    boards,
    plates,
    joins: res.joins,
    dims: res.dims,
    warnings,
    stats: { ...res.stats, boards: boards.length, plates: plates.length },
  };
}
