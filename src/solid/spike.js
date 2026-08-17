/**
 * Spike — erect a pyramid on every face of a unit skeleton.
 *
 * Apex sits on the centroid ray (origin → face centroid) at radius `t`
 * (parent circumradius is 1). t greater than the face inradius is a spike;
 * t smaller (but > 0) is a dimple. Schema 0 skips the operator entirely —
 * it is not "apex at the origin".
 *
 * Lateral faces stay unmerged triangles so openings remain one-per-side
 * even at stellation heights where some triangles become coplanar.
 *
 * Order: jitter → truncate → spike → subdivide. The parent is still a
 * convex (or already-spiked) closed mesh; this module does not re-hull.
 */

import { applyFaceIdentity } from "../hull.js";
import {
  assertSkeleton,
  assertStarShaped,
  circumradius,
  edgeList,
  inradiusRange,
  newell,
} from "../skeleton.js";
import { faceFrames } from "../faceframe.js";
import { SPIKE_T_MAX } from "../schema.js";
import { validationError } from "../validate.js";

/** Below this, pyramids are thinner than assertSkeleton's planarity floor. */
const DEGEN_REL = 1e-8;

/**
 * First-stellation apex radius: where a face's centroid ray meets a
 * neighbouring face plane. On isohedral parents every neighbour agrees
 * (octahedron → √3, dodecahedron / icosahedron → the two classical stars
 * that are first stellations). Returns NaN when no neighbour plane cuts
 * the ray (cube: adjacent faces are perpendicular to the face-normal ray).
 *
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @returns {number}
 */
export function firstStellationT(skeleton) {
  const frames = faceFrames(skeleton);
  const { faces } = skeleton;
  /** @type {Map<number, number[]>} */
  const edgeFaces = new Map();
  for (let fi = 0; fi < faces.length; fi++) {
    const ring = faces[fi];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const key = a < b ? a * 0x100000 + b : b * 0x100000 + a;
      let list = edgeFaces.get(key);
      if (!list) {
        list = [];
        edgeFaces.set(key, list);
      }
      list.push(fi);
    }
  }
  const ts = [];
  for (const pair of edgeFaces.values()) {
    if (pair.length !== 2) continue;
    const [i, j] = pair;
    const t = rayPlaneT(frames[i], frames[j]);
    if (Number.isFinite(t) && t > 0) ts.push(t);
    const t2 = rayPlaneT(frames[j], frames[i]);
    if (Number.isFinite(t2) && t2 > 0) ts.push(t2);
  }
  if (!ts.length) return NaN;
  ts.sort((a, b) => a - b);
  return ts[Math.floor(ts.length / 2)];
}

/**
 * Great stellated dodecahedron on a unit icosahedron: t = 3 × inradius.
 * 60 tris collapse to 12 planes.
 * @param {{ positions: Float64Array, faces: number[][] }} icosa  unit icosa skeleton
 */
export function greatStellatedDodecaT(icosa) {
  return 3 * inradiusRange(faceFrames(icosa)).min;
}

/**
 * Great dodecahedron as a dimple on a unit icosahedron: t = 1 / (√5 × inradius).
 * 60 tris collapse to 12 planes.
 * @param {{ positions: Float64Array, faces: number[][] }} icosa
 */
export function greatDodecahedronT(icosa) {
  return 1 / (Math.sqrt(5) * inradiusRange(faceFrames(icosa)).min);
}

/**
 * Apex radius along face `frame`'s centroid ray where it meets `neigh`'s plane.
 * @param {{ origin: number[], inradius: number, normal: number[] }} frame
 * @param {{ origin: number[], inradius: number, normal: number[] }} neigh
 */
function rayPlaneT(frame, neigh) {
  const [cx, cy, cz] = frame.origin;
  const cr = Math.hypot(cx, cy, cz);
  if (!(cr > 0)) return NaN;
  const ux = cx / cr, uy = cy / cr, uz = cz / cr;
  const [nx, ny, nz] = neigh.normal;
  const den = nx * ux + ny * uy + nz * uz;
  if (Math.abs(den) < 1e-12) return NaN;
  return neigh.inradius / den;
}

/**
 * Count distinct supporting planes (coplanar-merge groups). At classical
 * stellation heights the unmerged triangles collapse: 24→8, 60→12, 60→20.
 * Scale-invariant; stronger than Euler, which holds at any height.
 *
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @returns {number}
 */
export function countPlanes(skeleton) {
  const { positions, faces } = skeleton;
  const R = circumradius(positions);
  const planeDistance = 1e-7 * R;
  const cosTol = Math.cos(1e-6);
  const planes = faces.map((ring) => {
    const { normal, centroid } = newell(positions, ring);
    let nx = normal[0], ny = normal[1], nz = normal[2];
    const offset = nx * centroid[0] + ny * centroid[1] + nz * centroid[2];
    if (offset < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }
    return { nx, ny, nz, offset: Math.abs(offset) };
  });
  const n = planes.length;
  const parent = Uint32Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = planes[i], b = planes[j];
      const dot = a.nx * b.nx + a.ny * b.ny + a.nz * b.nz;
      if (dot < cosTol) continue;
      if (Math.abs(a.offset - b.offset) > planeDistance) continue;
      const ri = find(i), rj = find(j);
      if (ri !== rj) parent[rj] = ri;
    }
  }
  let count = 0;
  for (let i = 0; i < n; i++) if (find(i) === i) count++;
  return count;
}

/**
 * @param {{ positions: Float64Array, faces: number[][], edges?: number[][] }} skeleton
 * @param {number} t  apex radius in parent circumradius units; 0 is identity
 * @returns {{ positions: Float64Array, faces: number[][], edges: number[][] }}
 */
export function spikeSkeleton(skeleton, t) {
  const height = Number(t);
  if (!(height > 0)) return skeleton;
  if (!Number.isFinite(height) || height > SPIKE_T_MAX) {
    throw validationError(
      "points",
      "spike",
      `Spike must be between 0 and ${SPIKE_T_MAX}`,
      { clampTo: height > SPIKE_T_MAX ? SPIKE_T_MAX : 0 },
    );
  }

  let raw;
  try {
    raw = buildSpikeMesh(skeleton, height);
  } catch (err) {
    if (err?.validation) throw err;
    throw validationError(
      "points",
      "spike",
      "This spike height cannot form a closed surface — try a lower value",
      { clampTo: 0 },
    );
  }

  const positions = Float64Array.from(raw.positions);
  let rMax = circumradius(positions);
  if (rMax > 1e-12 && Math.abs(rMax - 1) > 1e-12) {
    const k = 1 / rMax;
    for (let i = 0; i < positions.length; i++) positions[i] *= k;
  }

  const identified = applyFaceIdentity(positions, raw.faces);
  const out = {
    positions,
    faces: identified,
    edges: edgeList(identified),
  };
  try {
    assertStarShaped(out);
    assertSkeleton(out);
  } catch (err) {
    if (err?.validation) throw err;
    throw validationError(
      "points",
      "spike",
      "This spike height folds the surface — try a lower value",
      { clampTo: 0 },
    );
  }
  return out;
}

/**
 * Un-normalized spiked mesh (apexes at radius t). Circumradius restore and
 * face identity happen in spikeSkeleton.
 *
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {number} t
 * @returns {{ positions: Float64Array, faces: number[][] }}
 */
function buildSpikeMesh(skeleton, t) {
  const pos = skeleton.positions;
  const faces = skeleton.faces;
  const nVerts = pos.length / 3;
  const coords = Array.from(pos);
  /** @type {number[][]} */
  const outFaces = [];
  const R = circumradius(pos);
  const degen = Math.max(DEGEN_REL * R, 1e-15);

  for (let fi = 0; fi < faces.length; fi++) {
    const ring = faces[fi];
    const { centroid } = newell(pos, ring);
    const [cx, cy, cz] = centroid;
    const cr = Math.hypot(cx, cy, cz);
    if (!(cr > degen)) {
      throw validationError(
        "points",
        "spike",
        "A face centroid sits on the origin — spike has no ray",
        { clampTo: 0, faceIds: [fi] },
      );
    }
    const inradius = cr; // centroid distance; regular faces: = plane inradius
    if (Math.abs(t - inradius) <= degen) {
      throw validationError(
        "points",
        "spike",
        "Spike height lands in a face plane and collapses the pyramids",
        { clampTo: 0, faceIds: [fi] },
      );
    }
    const ax = (cx / cr) * t;
    const ay = (cy / cr) * t;
    const az = (cz / cr) * t;
    const apex = nVerts + fi;
    coords.push(ax, ay, az);

    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const tri = [a, b, apex];
      orientOutward(coords, tri);
      outFaces.push(tri);
    }
  }

  return { positions: Float64Array.from(coords), faces: outFaces };
}

/** @param {number[] | Float64Array} positions flat xyz (JS array or typed) */
function orientOutward(positions, ring) {
  const { normal, centroid } = newell(positions, ring);
  if (normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2] < 0) {
    ring.reverse();
  }
}
