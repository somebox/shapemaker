/**
 * Printed clips: the same clip outlines as the laser cuts, made on a 3D
 * printer instead. Each clip is a prism as thick as the sheet with a 45°
 * chamfer round both faces, which softens what shows through an opening
 * and takes up the first layer's squash. Clips are grouped by shape, one
 * set of plates per shape, since printed clips carry no letter.
 */

import { packParts } from "./layout.js";
import { apply, area, offsetPolygon } from "./geom2.js";
import { triangulate as earcut } from "../../vendor/earcut/earcut.js";

/** Print areas in mm, with room left for the skirt and purge line. */
export const PRINT_BEDS = Object.freeze({
  "prusa-core-one": { label: "Prusa Core One / One+", w: 250, h: 220 },
  "prusa-mk4": { label: "Prusa MK4 / MK4S", w: 250, h: 210 },
  "bambu-x1": { label: "Bambu X1 / P1", w: 256, h: 256 },
  "bambu-a1-mini": { label: "Bambu A1 mini", w: 180, h: 180 },
});

/** Chamfer on a printed clip's faces, mm. */
export const chamferOf = (t) => Math.min(0.6, 0.2 * t);

/**
 * Triangles of a chamfered prism over a CCW outline, in local coordinates
 * [x, y, z] with z from 0 to t. Rings share vertices exactly, so the
 * result is closed.
 * @param {number[][]} outline
 * @returns {number[][][]}
 */
export function chamferedPrism(outline, t, e) {
  let P = outline;
  if (area(P) < 0) P = P.slice().reverse();
  const inner = offsetPolygon(P, -e);
  const rings = [
    inner.map(([x, y]) => [x, y, 0]),
    P.map(([x, y]) => [x, y, e]),
    P.map(([x, y]) => [x, y, t - e]),
    inner.map(([x, y]) => [x, y, t]),
  ];
  const tris = [];
  const idx = earcut(inner.flat());
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    tris.push([rings[0][a], rings[0][c], rings[0][b]]);
    tris.push([rings[3][a], rings[3][b], rings[3][c]]);
  }
  const n = P.length;
  for (let r = 0; r < 3; r++) {
    const lo = rings[r], hi = rings[r + 1];
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      tris.push([lo[k], lo[k1], hi[k1]], [lo[k], hi[k1], hi[k]]);
    }
  }
  return tris;
}

/**
 * Lay printed clips out on beds, one set of plates per clip shape.
 * @param {{ name: string, paths: object[] }[]} clips
 * @param {{ w: number, h: number }} bed
 * @returns {{ letter: string, items: { part: object, tf: object }[] }[]}
 */
export function clipPlates(clips, bed) {
  const byLetter = new Map();
  for (const c of clips) {
    const letter = c.name.replace(/^clip /, "");
    byLetter.set(letter, [...(byLetter.get(letter) ?? []), c]);
  }
  const plates = [];
  for (const [letter, set] of [...byLetter].sort(([a], [b]) => a.length - b.length || a.localeCompare(b))) {
    for (const board of packParts(set, bed, { marginMm: 5, gapMm: 3 }).boards) plates.push({ letter, items: board.items });
  }
  return plates;
}

/**
 * One plate as a mesh for writeBinaryStl, clips lying flat on z = 0.
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function plateMesh(plate, t) {
  const e = chamferOf(t);
  const tris = [];
  for (const { part, tf } of plate.items) {
    const outline = part.paths.find((p) => p.layer === "cut" && p.closed).pts.map((q) => apply(tf, q));
    tris.push(...chamferedPrism(outline, t, e));
  }
  const positions = new Float32Array(tris.length * 9);
  let o = 0;
  for (const tri of tris) for (const p of tri) for (const x of p) positions[o++] = x;
  return { positions, indices: Uint32Array.from({ length: tris.length * 3 }, (_, i) => i) };
}
