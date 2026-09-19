/**
 * Wireframe SVG thumbnails for the start chooser — pure projection of unit
 * skeletons, no WebGL. Edges adjacent to a viewer-facing face draw as front
 * strokes; fully hidden edges draw faint, so tiny cards still read as solids.
 */

import { hullSkeletonForBase } from "./pipeline.js";
import { edgeList } from "./skeleton.js";

/** Fixed 3/4 view: yaw about Z (model is Z-up), then tilt toward the viewer. */
const YAW = 0.58;
const TILT = 0.44;

/** @type {Map<string, string>} */
const cache = new Map();

/**
 * @param {{ base: string, points?: number, seed?: number, separation?: number, jitter?: number, dual?: boolean, truncate?: number, spike?: number, subdiv?: number }} state
 * @returns {string} standalone `<svg>` markup (aria-hidden; stroke = currentColor)
 */
export function startThumbSvg(state) {
  const key = [
    state.base,
    state.points,
    state.seed,
    state.separation,
    state.jitter,
    state.dual,
    state.truncate,
    state.spike,
    state.subdiv,
  ].join("|");
  const hit = cache.get(key);
  if (hit) return hit;

  const skeleton = hullSkeletonForBase(state.base, state);
  const svg = skeletonThumbSvg(skeleton);
  cache.set(key, svg);
  return svg;
}

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton unit circumradius
 * @returns {string}
 */
export function skeletonThumbSvg(skeleton) {
  const { positions, faces } = skeleton;
  const n = positions.length / 3;

  const cy = Math.cos(YAW), sy = Math.sin(YAW);
  const ct = Math.cos(TILT), st = Math.sin(TILT);
  // Rotated coords: screen x/y (SVG y down); depth runs along rotated +y,
  // with the viewer at -y.
  const sxs = new Float64Array(n);
  const sys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const x1 = x * cy - y * sy;
    const y1 = x * sy + y * cy;
    sxs[i] = x1;
    sys[i] = -(y1 * st + z * ct);
  }

  // A face is front when its rotated outward normal points toward the viewer
  // (depth component < 0). Newell y-term over rotated coords (x=sxs, z=-sys).
  const frontFace = new Array(faces.length);
  for (let f = 0; f < faces.length; f++) {
    const ring = faces[f];
    let ny = 0;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      ny += (-sys[a] - -sys[b]) * (sxs[a] + sxs[b]);
    }
    frontFace[f] = ny < 0;
  }

  // Edge → adjacent faces, from face rings.
  /** @type {Map<number, boolean>} edge key → any adjacent front face */
  const edgeFront = new Map();
  for (let f = 0; f < faces.length; f++) {
    const ring = faces[f];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const keyE = lo * 0x100000 + hi;
      edgeFront.set(keyE, (edgeFront.get(keyE) ?? false) || frontFace[f]);
    }
  }

  let front = "";
  let back = "";
  for (const [a, b] of edgeList(faces)) {
    const seg = `M${r3(sxs[a])} ${r3(sys[a])}L${r3(sxs[b])} ${r3(sys[b])}`;
    if (edgeFront.get(a * 0x100000 + b)) front += seg;
    else back += seg;
  }

  return (
    `<svg viewBox="-1.2 -1.2 2.4 2.4" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    (back
      ? `<path class="thumb-back" d="${back}" fill="none" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke"/>`
      : "") +
    `<path class="thumb-front" d="${front}" fill="none" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
    `</svg>`
  );
}

function r3(v) {
  return String(Math.round(v * 1000) / 1000);
}
