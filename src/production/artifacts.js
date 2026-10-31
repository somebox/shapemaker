/**
 * Every file a production makes, as one list: what it is, how to name it and
 * how to get its bytes. The Export dialog shows this list and the CLI writes
 * it, so the two can't drift apart.
 */

import { writeBinaryStl } from "../export/stl.js";
import { exportSvg } from "../export/svg.js";
import { halfExportMatrices } from "../split.js";
import { apply } from "../sheet/geom2.js";
import { boardSvg, LAYERS } from "../sheet/svg.js";
import { plateMesh, PRINT_BEDS } from "../sheet/printclips.js";
import { foldTestStrip } from "../sheet/fold.js";
import { packParts } from "../sheet/layout.js";
import { designStem } from "./names.js";
import { fmt, plural } from "./summary.js";

export { designStem };

/** What each cut-file layer does, in words. */
export const LAYER_NAMES = Object.freeze({ cut: "cut", mark: "engrave", valley: "valley fold", mountain: "mountain fold", score: "score" });

/** Thumbnail colours: a board's stock by process, then print beds. */
export const SHEET_FILL = Object.freeze({ cut: "#d8b98c", fold: "#f3f0e8", plate: "#2b2b31" });
export const PLATE_CLIP = "#e08040";
const CUT_STROKE = "#c0392b";

/**
 * The flat layouts of a production: each laser board, then each print
 * plate. The Flat view draws these and the sheet files come from them.
 * @param {ReturnType<import('./index.js').produce>} prod
 */
export function sheetViews(prod) {
  if (!prod.sheet) return [];
  const boards = prod.sheet.boards.map((b, i) => ({ kind: "board", id: `board${i + 1}`, label: `Board ${i + 1}`, items: b.items, size: prod.board }));
  const bed = prod.process === "cut" ? PRINT_BEDS[prod.job.cut.printBed] : null;
  const count = new Map();
  for (const p of prod.sheet.plates) count.set(p.letter, (count.get(p.letter) ?? 0) + 1);
  const seen = new Map();
  const plates = prod.sheet.plates.map((plate) => {
    const k = (seen.get(plate.letter) ?? 0) + 1;
    seen.set(plate.letter, k);
    const corners = plate.letter === "corners";
    const nth = count.get(plate.letter) > 1 ? k : "";
    return {
      kind: "plate", plate, id: `${corners ? "corners" : `clips${plate.letter}`}${k > 1 ? k : ""}`,
      label: `Print ${corners ? "corners" : plate.letter}${nth}`, items: plate.items, size: bed,
    };
  });
  return [...boards, ...plates];
}

/** A small SVG of parts on a board or bed, for the export list. */
function thumbSvg(items, size, fill, stroke, solid = false) {
  const d = items
    .map(({ part, tf }) => part.paths
      .filter((p) => p.layer === "cut" && p.closed)
      .map((p) => `M${p.pts.map((q) => apply(tf, q)).map(([x, y]) => `${fmt(x, 1)},${fmt(size.h - y, 1)}`).join("L")}Z`)
      .join(""))
    .join("");
  const look = solid ? `fill="${stroke}" stroke="none"` : `fill="none" stroke="${stroke}" stroke-width="${fmt(Math.max(size.w, size.h) / 160, 2)}"`;
  return `<svg viewBox="0 0 ${fmt(size.w)} ${fmt(size.h)}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${fill}"/><path d="${d}" fill-rule="evenodd" ${look}/></svg>`;
}

const isCoupon = (it) => it.part.kind === "coupon";

function sheetArtifacts(prod, stem0) {
  const m = prod.job[prod.process], cutting = prod.process === "cut";
  const stem = `${stem0}_${prod.process}_${m.join}${cutting ? `_${fmt(m.sheetMm)}mm` : ""}`;
  const views = sheetViews(prod);
  const boards = views.filter((v) => v.kind === "board");
  const size = prod.board;
  const group = cutting ? "Laser cut" : "Laser or cutter";
  const fill = SHEET_FILL[prod.process];
  const file = (id, name, items, detail) => ({
    id, group, name: `${name}.svg`, mime: "image/svg+xml", detail,
    thumb: () => thumbSvg(items, size, fill, CUT_STROKE),
    bytes: () => boardSvg({ items }, size, { title: name }),
    preview: () => boardSvg({ items }, size, { title: name, preview: true }),
  });
  // The fit strip keeps its place in the layout but is its own file, cut
  // first; the model files leave its spot empty, so the sheet needn't move.
  const strip = boards.flatMap((b) => b.items).filter(isCoupon);
  const files = strip.length ? [file("fit-strip", `${stem}_fit-strip`, strip, `Cut this first · slots and a key, on ${fmt(size.w)} × ${fmt(size.h)} mm`)] : [];
  // Scoring power varies by machine and stock, so Score gets a test strip.
  if (!cutting && m.foldStyle === "score" && m.join !== "sew") {
    const test = packParts([foldTestStrip()], size, { marginMm: m.marginMm, gapMm: m.gapMm }).boards[0].items;
    files.push(file("fold-strip", `${stem}_fold-strip`, test, "Cut this first, on a scrap, to tune the score power"));
  }
  boards.forEach((view, i) => {
    const items = view.items.filter((it) => !isCoupon(it));
    if (!items.length) return;
    const name = boards.length > 1 ? `${stem}_board${i + 1}` : stem;
    const used = new Set(items.flatMap((it) => it.part.paths.map((p) => p.layer)));
    const layers = Object.keys(LAYERS).filter((k) => used.has(k)).reverse().map((k) => LAYER_NAMES[k]);
    files.push(file(view.id, name, items, `${plural(items.length, "part")} on ${fmt(size.w)} × ${fmt(size.h)} mm · ${layers.join(", ")}`));
  });
  // One STL per print plate: …_clipsA.stl, …_clipsA2.stl, …_corners.stl
  // Not while welding, which will change them.
  const bed = cutting ? PRINT_BEDS[m.printBed] : null;
  for (const view of prod.weld?.pending ? [] : views.filter((v) => v.kind === "plate")) {
    const { plate } = view;
    const name = `${stem}_${view.id}`;
    const n = plate.items.reduce((a, it) => a + (it.part.clips?.length ?? 1), 0);
    files.push({
      id: view.id, group: "3D print", name: `${name}.stl`, mime: "model/stl",
      detail: plate.letter === "corners"
        ? `${plural(plate.items.length, "welded corner piece")} (${n} clips) · may need supports · ${bed.label}`
        : `${plural(n, "clip")} ${plate.letter}, flat, ${fmt(plate.items[0].part.thick ?? prod.sheet.dims.t)} mm thick · ${bed.label}`,
      thumb: () => thumbSvg(plate.items, bed, SHEET_FILL.plate, PLATE_CLIP, true),
      bytes: () => writeBinaryStl(plateMesh(plate, prod.sheet.dims.t), { header: name }),
    });
  }
  return files;
}

function printArtifacts(prod, stem, { split, camera }) {
  const { mesh, orientation } = prod.compiled;
  const stl = (id, name, source, matrix, detail) => ({
    id, group: "3D print", name: `${name}.stl`, mime: "model/stl", detail,
    bytes: () => writeBinaryStl(source, { header: `shapemaker_${name}`, matrix }),
  });
  const matrices = split && halfExportMatrices(split.planeZ);
  return [
    ...(split
      ? [
          stl("half-a", `${stem}_half-a`, split.a, matrices.matrixA, "First half of the split shell"),
          stl("half-b", `${stem}_half-b`, split.b, matrices.matrixB, "Second half of the split shell"),
        ]
      : [stl("shell", stem, mesh, orientation.matrix, "The shell as shown")]),
    {
      id: "drawing", group: "Drawing", name: `${stem}.svg`, mime: "image/svg+xml", detail: "Line drawing of the model from the current view",
      bytes: () => exportSvg({ mesh, orientation, camera, label: stem }),
    },
  ];
}

/**
 * @param {ReturnType<import('./index.js').produce>} prod
 * @param {{ split?: { a: object, b: object, planeZ: number } | null, camera?: object | null }} [opts]
 *   print only: a chosen split, and the view for the drawing
 * @returns {{ id: string, group: string, name: string, mime: string, detail: string, thumb?: () => string, preview?: () => string, bytes: () => string | ArrayBuffer }[]}
 */
export function listArtifacts(prod, { split = null, camera = null } = {}) {
  if (!prod.ok) return [];
  const stem = designStem(prod.state);
  return prod.process === "print" ? printArtifacts(prod, stem, { split, camera }) : sheetArtifacts(prod, stem);
}

/** What to do with the files, in order; shown with the export list. */
export function exportNotes(prod) {
  if (!prod.ok) return [];
  const notes = [];
  if (prod.process === "cut") {
    notes.push("Cut the fit strip first and push the key (or a printed clip's tab) into its slots; set Fit under Advanced to the slot that takes it snugly.");
  }
  if (prod.process === "fold" && prod.job.fold.foldStyle === "score" && prod.job.fold.join !== "sew") {
    notes.push("Cut the fold strip on a scrap first: V and M should fold cleanly without cutting through; P is a perforated line for comparison.");
  }
  if (prod.process === "fold" && prod.job.fold.join === "sew") {
    notes.push("Sew each seam face to face from the inside, leaving the last one or two open. Turn it right side out, then close the gap with a ladder stitch.");
  }
  return notes;
}
