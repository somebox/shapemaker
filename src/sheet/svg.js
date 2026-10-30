/**
 * Layered cut file for one board, in millimetres. One stroke colour per
 * operation, which is how LightBurn and most laser software pick layers:
 * cut red, valley folds blue, mountain folds light blue, plain scores
 * green, engraved marks black. Paths only; no fills, no text elements.
 */

import { apply } from "./geom2.js";

export const LAYERS = Object.freeze({
  mark: { color: "#000000", label: "Mark (engrave lines)" },
  score: { color: "#00A000", label: "Score" },
  valley: { color: "#0000FF", label: "Fold: valley as cut" },
  mountain: { color: "#00A0FF", label: "Fold: mountain as cut" },
  cut: { color: "#FF0000", label: "Cut" },
});

const f = (v) => (Math.round(v * 100) / 100).toString();

/**
 * @param {{ items: { part: object, tf: object }[] }} board
 * @param {{ w: number, h: number }} size
 * @param {{ title?: string, preview?: boolean }} [opts]  preview: thicker
 *   strokes, a board frame and part names, for looking rather than cutting
 */
export function boardSvg(board, size, { title = "", preview = false } = {}) {
  const byLayer = Object.fromEntries(Object.keys(LAYERS).map((k) => [k, []]));
  for (const { part, tf } of board.items) {
    for (const p of part.paths) {
      // Parts are built y-up; SVG is y-down, so flip to keep handedness.
      const pts = p.pts.map((q) => apply(tf, q)).map(([x, y]) => [x, size.h - y]);
      byLayer[p.layer].push(`M${pts.map((q) => `${f(q[0])},${f(q[1])}`).join("L")}${p.closed ? "Z" : ""}`);
    }
  }
  const sw = preview ? 0.35 : 0.1;
  const groups = Object.entries(LAYERS)
    .filter(([k]) => byLayer[k].length)
    .map(([k, { color, label }]) =>
      `<g id="${k}" inkscape:groupmode="layer" inkscape:label="${label}" fill="none" stroke="${color}" stroke-width="${preview && k === "mark" ? 0.25 : sw}" stroke-linecap="round" stroke-linejoin="round">\n` +
      byLayer[k].map((d) => `<path d="${d}"/>`).join("\n") +
      "\n</g>",
    );
  const frame = preview
    ? `<rect x="0" y="0" width="${f(size.w)}" height="${f(size.h)}" fill="#fbfaf6" stroke="#bbb" stroke-width="0.5"/>\n`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${f(size.w)}mm" height="${f(size.h)}mm" viewBox="0 0 ${f(size.w)} ${f(size.h)}">\n` +
    (title ? `<title>${title}</title>\n` : "") +
    frame +
    groups.join("\n") +
    "\n</svg>\n"
  );
}
