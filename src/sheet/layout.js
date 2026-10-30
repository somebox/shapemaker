/**
 * Board profiles and a shelf packer: each part turns to its minimum-area
 * box (long side across), then parts fill rows left to right, tallest
 * first, and spill onto new boards. Within a row each part slides left
 * against its neighbours' convex hulls, upright or turned 180°, whichever
 * ends further left — rows of triangles then nest point to base.
 */

import { minAreaAngle, rotate, bbox, add, convexHull, convexOverlap } from "./geom2.js";

/** Slide step when nesting a part against the row, mm. */
const SLIDE_STEP = 0.5;

/** Work areas in mm, width × height as the machine sees them. */
export const BOARD_PROFILES = Object.freeze({
  "falcon-a1": { label: "Creality Falcon A1", w: 381, h: 305 },
  "xtool-s1": { label: "xTool S1", w: 498, h: 330 },
  "xtool-m1": { label: "xTool M1", w: 385, h: 300 },
  glowforge: { label: "Glowforge Basic / Plus / Pro", w: 495, h: 279 },
  "glowforge-aura": { label: "Glowforge Aura", w: 305, h: 305 },
  a4: { label: "A4 sheet", w: 297, h: 210 },
  a3: { label: "A3 sheet", w: 420, h: 297 },
  letter: { label: "US Letter", w: 279.4, h: 215.9 },
  "mat-12x12": { label: "12 × 12 in cutting mat", w: 304.8, h: 304.8 },
});

/**
 * @param {{ name: string, paths: { pts: number[][] }[] }[]} parts
 * @param {{ w: number, h: number }} board
 * @returns {{ boards: { items: { part: object, tf: { a: number, t: number[] } }[] }[], oversize: string[] }}
 */
export function packParts(parts, board, { marginMm = 5, gapMm = 2 } = {}) {
  const W = board.w - 2 * marginMm, H = board.h - 2 * marginMm;
  const sized = parts.map((part) => {
    const hull = convexHull(part.paths.flatMap((p) => p.pts));
    let a = minAreaAngle(hull);
    let s = orient(hull, a);
    if (s.w > W && s.h <= W && s.w <= H) s = orient(hull, a + Math.PI / 2);
    return { part, hull, ...s };
  });
  sized.sort((x, y) => y.h - x.h || y.w - x.w);

  const boards = [], oversize = [];
  let cur = null, row = [], rowRight = 0, y = 0, rowH = 0;
  const newBoard = () => {
    cur = { items: [] };
    boards.push(cur);
    row = [];
    rowRight = 0;
    y = 0;
    rowH = 0;
  };
  for (const s of sized) {
    if (s.w > W + 1e-6 || s.h > H + 1e-6) {
      oversize.push(s.part.name);
      boards.push({ items: [{ part: s.part, tf: place(s, marginMm, marginMm) }], oversize: true });
      continue;
    }
    if (!cur) newBoard();
    let best = nestInRow(s, row, rowRight, gapMm, marginMm, marginMm + y);
    if (best.right > marginMm + W + 1e-6) {
      y += rowH + gapMm;
      row = [];
      rowRight = 0;
      rowH = 0;
      best = nestInRow(s, row, rowRight, gapMm, marginMm, marginMm + y);
    }
    if (y + s.h > H + 1e-6) {
      newBoard();
      best = nestInRow(s, row, rowRight, gapMm, marginMm, marginMm);
    }
    cur.items.push({ part: s.part, tf: best.tf });
    row.push(best.hull);
    rowRight = Math.max(rowRight, best.right - marginMm);
    rowH = Math.max(rowH, s.h);
  }
  return { boards, oversize };
}

/** Bounding box of the hull turned by angle a. */
function orient(hull, a) {
  const b = bbox(hull.map((p) => rotate(p, a)));
  return { a, b, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

/** Rotate by s.a, then move the box's min corner to (x, y). */
function place(s, x, y) {
  return { a: s.a, t: add([x, y], [-s.b.minX, -s.b.minY]) };
}

/**
 * Place a part at the right end of the row, then slide it left until it
 * would come closer than the gap to a hull already in the row. Tries the
 * part as oriented and turned 180°; keeps the one ending furthest left.
 */
function nestInRow(s, row, rowRight, gap, x0, y0) {
  let best = null;
  for (const flip of [0, Math.PI]) {
    const o = { ...s, ...orient(s.hull, s.a + flip) };
    const at = (x) => {
      const tf = place(o, x, y0);
      return { tf, hull: s.hull.map((p) => add(rotate(p, tf.a), tf.t)) };
    };
    let x = x0 + rowRight + (row.length ? gap : 0);
    const clash = (c) => row.some((h) => convexOverlap(c.hull, h, -gap));
    while (x - SLIDE_STEP >= x0 && !clash(at(x - SLIDE_STEP))) x -= SLIDE_STEP;
    const cand = { ...at(x), right: x + o.w };
    if (!best || cand.right < best.right - 1e-6) best = cand;
  }
  return best;
}
