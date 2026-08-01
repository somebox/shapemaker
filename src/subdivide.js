/**
 * Fixed-order surface subdivision — the first skeleton operator. Each level
 * splits every face flat, in its own plane: triangles 4:1 via edge
 * midpoints, larger polygons as centroid fans over the midpoint-split
 * boundary. Every edge splits at its midpoint, so mixed-face solids
 * (icosidodeca: pentagons meeting triangles) stay closed with no
 * T-junctions.
 *
 * Smooth is an outer-edge fillet by sphere clip: vertices outside a clip
 * radius pull radially onto it, so corners and edges round off while flat
 * face interiors keep their planes — overall dimensions hold, only
 * sharpness melts. The clip radius runs from the circumsphere (soften 0,
 * no effect) down to the nearest face plane (soften 1, a full ball).
 *
 * The result stays a convex triangulation, so all solidifier guarantees
 * hold. Runs AFTER jitter (plane perturbation on regulars, point jitter on
 * parametric bases): jitter distorts the simple form, subdivision adds
 * resolution to it, smooth fillets it. The reverse order would hand the
 * plane perturbation near-coplanar plane families whose members mostly
 * stop binding — silently discarding subdivision and smoothing.
 */

import { assertSkeleton, edgeList } from "./skeleton.js";
import { applyFaceIdentity } from "./hull.js";
import { faceFrames } from "./faceframe.js";

export const SUBDIV_MAX = 2;

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 *   unit skeleton (all vertices on the circumsphere)
 * @param {number} level  0 returns the input untouched; clamped to SUBDIV_MAX
 * @param {number} [soften]  0–1 edge fillet: 0 keeps the exact flat solid
 *   (grids of openings on planar faces), 1 rounds everything down to the
 *   inscribed ball. Default 0.
 * @returns {{ positions: Float64Array, faces: number[][], edges: number[][] }}
 */
export function subdivideSkeleton(skeleton, level, soften = 0) {
  const n = Math.min(SUBDIV_MAX, Math.floor(level ?? 0));
  if (!(n > 0)) return skeleton;
  const s = Math.min(1, Math.max(0, soften));

  let cur = { positions: skeleton.positions, faces: skeleton.faces };
  for (let i = 0; i < n; i++) cur = subdivideOnce(cur);

  const positions = Float64Array.from(cur.positions);
  if (s > 0) {
    // Fillet clip: from the circumsphere down to the nearest face plane.
    let rEnd = Infinity;
    for (const f of faceFrames(skeleton)) rEnd = Math.min(rEnd, f.inradius);
    const clip = 1 - s * (1 - rEnd);
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
      if (r > clip) {
        const k = clip / r;
        positions[i] *= k;
        positions[i + 1] *= k;
        positions[i + 2] *= k;
      }
    }
  }
  const faces = applyFaceIdentity(positions, cur.faces);
  const out = { positions, faces, edges: edgeList(faces) };
  assertSkeleton(out);
  return out;
}

/**
 * @param {{ positions: ArrayLike<number>, faces: number[][] }} skel
 * @returns {{ positions: number[], faces: number[][] }}
 */
function subdivideOnce({ positions, faces }) {
  /** @type {number[]} */
  const pos = Array.from(positions);
  /** @type {Map<number, number>} undirected edge → midpoint vertex */
  const mids = new Map();

  // New vertices stay on the parent geometry — splitting is flat; rounding
  // is the caller's sphere clip.
  const push = (x, y, z) => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };
  const midpoint = (a, b) => {
    const key = a < b ? a * 0x100000 + b : b * 0x100000 + a;
    let v = mids.get(key);
    if (v == null) {
      v = push(
        (pos[a * 3] + pos[b * 3]) / 2,
        (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2,
        (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2,
      );
      mids.set(key, v);
    }
    return v;
  };

  /** @type {number[][]} */
  const out = [];
  for (const ring of faces) {
    const k = ring.length;
    if (k === 3) {
      const [a, b, c] = ring;
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      continue;
    }
    // n-gon: flat centroid fan over the midpoint-split boundary.
    let cx = 0, cy = 0, cz = 0;
    for (const vi of ring) {
      cx += pos[vi * 3];
      cy += pos[vi * 3 + 1];
      cz += pos[vi * 3 + 2];
    }
    const center = push(cx / k, cy / k, cz / k);
    for (let i = 0; i < k; i++) {
      const a = ring[i], b = ring[(i + 1) % k];
      const m = midpoint(a, b);
      out.push([center, a, m], [center, m, b]);
    }
  }
  return { positions: pos, faces: out };
}
