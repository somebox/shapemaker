/**
 * Printed clips: the same clip outlines as the laser cuts, made on a 3D
 * printer instead. Each clip is a prism (as thick as the sheet, or wider if
 * asked; the slots follow) with a 45° chamfer round both faces, which
 * softens what shows through an opening and takes up the first layer's
 * squash. Clips are grouped by shape, one
 * set of plates per shape, since printed clips carry no letter.
 */

import { packParts } from "./layout.js";
import { apply, area, offsetPolygon, convexHull } from "./geom2.js";
import { printedClipSolid } from "./assembly.js";
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
  // An edge shorter than the inset would turn inside out once inset: fold
  // it into its neighbour (a fraction of a millimetre off the outline).
  P = dropShortEdges(P, 2.5 * e);
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

/** Drop vertices until no edge of the polygon is shorter than `min`. */
function dropShortEdges(P, min) {
  const out = P.slice();
  for (let i = 0; i < out.length && out.length > 3; ) {
    const a = out[i], b = out[(i + 1) % out.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < min) out.splice((i + 1) % out.length, 1);
    else i++;
  }
  return out;
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
 * One plate as a mesh for writeBinaryStl, clips lying flat on z = 0, each
 * as thick as its part says (a printed clip's width), else t.
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function plateMesh(plate, t) {
  const tris = [];
  for (const { part, tf } of plate.items) {
    if (part.mesh) {
      // A welded corner piece: already lying in its print pose.
      const { positions: P, indices: I } = part.mesh;
      const at = (k) => [...apply(tf, [P[3 * k], P[3 * k + 1]]), P[3 * k + 2]];
      for (let i = 0; i < I.length; i += 3) tris.push([at(I[i]), at(I[i + 1]), at(I[i + 2])]);
      continue;
    }
    const outline = part.paths.find((p) => p.layer === "cut" && p.closed).pts.map((q) => apply(tf, q));
    const thick = part.thick ?? t;
    tris.push(...chamferedPrism(outline, thick, chamferOf(thick)));
  }
  const positions = new Float32Array(tris.length * 9);
  let o = 0;
  for (const tri of tris) for (const p of tri) for (const x of p) positions[o++] = x;
  return { positions, indices: Uint32Array.from({ length: tris.length * 3 }, (_, i) => i) };
}

/**
 * Weld printed clips that meet at a corner into one piece, and lay out
 * every printed part: welded corners on their own plates, the clips that
 * stayed apart on plates by letter. A corner piece is a small hub; each of
 * its tabs points along its own panel's normal, so a panel still drops
 * straight onto its tabs.
 *
 * @param {ReturnType<import('./index.js').buildSheet>} sheet  with printed clips
 * @param {{ positions: Float64Array }} skeleton
 * @param {(solids: number[][][][]) => { members: number[], positions: Float64Array, indices: Uint32Array }[]} weldTouching
 *   from solid/csg.js, loaded
 * @param {{ w: number, h: number }} bed
 * @returns {{ plates: { letter: string, items: object[] }[], welded: number, weldedClips: number }}
 */
export function weldPlates(sheet, skeleton, weldTouching, bed) {
  const { joints } = sheet.extracted;
  const t = sheet.dims.t;
  const printed = sheet.parts.filter((p) => p.print);
  // Clips near an end of their edge belong to that corner.
  const byCorner = new Map();
  for (const c of printed) {
    const j = joints[c.joint - 1], mid = j.lengthMm / 2;
    if (Math.abs(c.at - mid) < 1e-6) continue;
    const v = c.at < mid ? j.v0 : j.v1;
    byCorner.set(v, [...(byCorner.get(v) ?? []), c]);
  }
  const used = new Set(), pieces = [];
  for (const [v, clips] of byCorner) {
    if (clips.length < 2) continue;
    for (const weld of weldTouching(clips.map((c) => printedClipSolid(skeleton, sheet.extracted, c, t)))) {
      for (const i of weld.members) used.add(clips[i]);
      const mesh = printPose(weld.positions, weld.indices);
      const hull = convexHull(Array.from({ length: mesh.positions.length / 3 }, (_, k) => [mesh.positions[3 * k], mesh.positions[3 * k + 1]]));
      pieces.push({
        name: `corner ${v + 1}`,
        kind: "weld",
        clips: weld.members.map((i) => clips[i]),
        mesh,
        paths: [{ layer: "cut", closed: true, pts: hull }],
      });
    }
  }
  const plates = clipPlates(printed.filter((c) => !used.has(c)), bed);
  for (const board of pieces.length ? packParts(pieces, bed, { marginMm: 5, gapMm: 4 }).boards : []) {
    plates.push({ letter: "corners", items: board.items });
  }
  return { plates, welded: pieces.length, weldedClips: used.size };
}

/**
 * Turn a closed mesh so it prints with the least overhang: try resting it
 * on each of its larger flat faces, and keep the pose whose downward-facing
 * area steeper than 45° (off the bed) is smallest. Returns it lying on z = 0.
 */
export function printPose(P, I) {
  const n = I.length / 3;
  const tri = (i) => [0, 1, 2].map((k) => [P[3 * I[3 * i + k]], P[3 * I[3 * i + k] + 1], P[3 * I[3 * i + k] + 2]]);
  const normals = [], areas = [];
  for (let i = 0; i < n; i++) {
    const [a, b, c] = tri(i);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const x = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...x);
    normals.push(l ? x.map((q) => q / l) : [0, 0, 1]);
    areas.push(l / 2);
  }
  // Candidate rest faces: the largest groups of equal normals.
  const groups = new Map();
  normals.forEach((nm, i) => {
    const key = nm.map((q) => Math.round(q * 50)).join(",");
    const g = groups.get(key) ?? { nm, area: 0 };
    g.area += areas[i];
    groups.set(key, g);
  });
  const candidates = [...groups.values()].sort((a, b) => b.area - a.area).slice(0, 12);
  let best = null;
  for (const { nm: down } of candidates) {
    const h = (p) => -(p[0] * down[0] + p[1] * down[1] + p[2] * down[2]);
    let minH = Infinity;
    for (let k = 0; k < P.length / 3; k++) minH = Math.min(minH, h([P[3 * k], P[3 * k + 1], P[3 * k + 2]]));
    let overhang = 0;
    for (let i = 0; i < n; i++) {
      const facing = normals[i][0] * down[0] + normals[i][1] * down[1] + normals[i][2] * down[2];
      if (facing <= Math.SQRT1_2) continue;
      const onBed = tri(i).every((p) => h(p) - minH < 0.05);
      if (!onBed) overhang += areas[i];
    }
    if (!best || overhang < best.overhang - 1e-6) best = { down, overhang };
  }
  const R = rotationTo(best.down, [0, 0, -1]);
  const out = new Float64Array(P.length);
  let minZ = Infinity;
  for (let k = 0; k < P.length; k += 3) {
    for (let r = 0; r < 3; r++) out[k + r] = R[r][0] * P[k] + R[r][1] * P[k + 1] + R[r][2] * P[k + 2];
    minZ = Math.min(minZ, out[k + 2]);
  }
  for (let k = 2; k < out.length; k += 3) out[k] -= minZ;
  return { positions: out, indices: I, overhangMm2: best.overhang };
}

/** Rotation matrix taking unit vector a onto unit vector b. */
function rotationTo(a, b) {
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (c > 1 - 1e-9) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (c < -1 + 1e-9) {
    // Half turn about any axis square to a.
    const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const k = [a[1] * ax[2] - a[2] * ax[1], a[2] * ax[0] - a[0] * ax[2], a[0] * ax[1] - a[1] * ax[0]];
    const l = Math.hypot(...k), [x, y, z] = k.map((q) => q / l);
    return [[2 * x * x - 1, 2 * x * y, 2 * x * z], [2 * x * y, 2 * y * y - 1, 2 * y * z], [2 * x * z, 2 * y * z, 2 * z * z - 1]];
  }
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const K = [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]];
  const K2 = K.map((row, i) => row.map((_, j) => K[i][0] * K[0][j] + K[i][1] * K[1][j] + K[i][2] * K[2][j]));
  const f = 1 / (1 + c);
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) + K[i][j] + K2[i][j] * f));
}
