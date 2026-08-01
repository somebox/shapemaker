/**
 * Plane-perturbation jitter for merged regular bases: tilt and offset each
 * face plane a little, then rebuild the vertex set by re-intersecting the
 * planes through the dual hull. Faces stay planar convex polygons — a
 * jittered cube is six wobbly quads, not a triangle shatter — and every
 * solidifier guarantee holds.
 *
 * Duality: a plane (n, d) with the origin inside maps to the dual point
 * q = n/d. The hull of the dual points is the dual polyhedron; each of its
 * faces (plane m·x = e) maps back to a primal vertex v = m/e, and each of
 * its vertices maps back to a primal face whose ring is the cycle of dual
 * faces around that dual vertex. Planarity is exact by construction: q_i on
 * a dual face ⇔ n_i·v = d_i for that face's primal vertex.
 *
 * Vertices where 4+ faces meet (e.g. all 30 on the icosidodecahedron) split
 * into valence-3 clusters joined by short edges whose length grows linearly
 * from zero with amplitude — gradual geometry, not a topology cliff. Face
 * count is preserved; the border inset (uniform centroid scale) is
 * unaffected by the short edges.
 */

import { sfc32 } from "./points/random.js";
import { hullToSkeleton, applyFaceIdentity } from "./hull.js";
import { assertSkeleton, edgeList } from "./skeleton.js";
import { faceFrames } from "./faceframe.js";
import { JITTER_AMPLITUDE_SCALE } from "./points/jitter.js";

/** Keep the plane stream distinct from placement's and point-jitter's. */
const PLANE_STREAM = 0x9e3779b9;

/**
 * Fraction of the budget every tilt draws at minimum. A floor keeps the
 * split edges at high-valence vertices safely above assertSkeleton's
 * zero-length tolerance for any seed, without changing the perceived range.
 */
const TILT_FLOOR = 0.3;

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 *   merged unit skeleton (exact regular base)
 * @param {{ seed: number, jitter: number, mode?: "surface"|"radial"|"both" }} params
 *   jitter: UI percent 0–50 — tilt budget in radians and relative offset
 *   budget after JITTER_AMPLITUDE_SCALE, matching on-sphere jitter's feel.
 *   mode: "surface" tilts planes (lateral wobble, default); "radial" offsets
 *   them along their normals (center-to-surface wobble); "both" does both.
 *   Every mode draws the same RNG sequence per plane, so switching modes
 *   reworks the same underlying randomness rather than rerolling.
 * @returns {{ positions: Float64Array, faces: number[][], edges: number[][] }}
 *   new unit skeleton; input untouched. jitter 0 returns the input as-is.
 */
export function perturbSkeletonPlanes(skeleton, { seed, jitter, mode = "surface" }) {
  if (!(jitter > 0)) return skeleton;

  const rng = sfc32((seed >>> 0) ^ PLANE_STREAM);
  const budget = (jitter / 100) * JITTER_AMPLITUDE_SCALE;
  const tilt = mode !== "radial";
  const offset = mode !== "surface";

  // Perturbed planes (unit normal, offset > 0), in face-identity order so
  // the draw sequence is deterministic per seed.
  const frames = faceFrames(skeleton);
  const planes = frames.map((f) => {
    let [nx, ny, nz] = f.normal;

    // Random unit tangent at n (same recipe as on-sphere jitter).
    let tx = 0, ty = 0, tz = 0, len = 0;
    while (len < 1e-6) {
      const rx = 2 * rng() - 1, ry = 2 * rng() - 1, rz = 2 * rng() - 1;
      const d = rx * nx + ry * ny + rz * nz;
      tx = rx - d * nx; ty = ry - d * ny; tz = rz - d * nz;
      len = Math.hypot(tx, ty, tz);
    }
    tx /= len; ty /= len; tz /= len;
    const a = budget * (TILT_FLOOR + (1 - TILT_FLOOR) * rng());
    const dr = budget * (2 * rng() - 1);

    let px = nx, py = ny, pz = nz;
    if (tilt) {
      const cos = Math.cos(a), sin = Math.sin(a);
      px = nx * cos + tx * sin;
      py = ny * cos + ty * sin;
      pz = nz * cos + tz * sin;
      const r = Math.hypot(px, py, pz);
      px /= r; py /= r; pz /= r;
    }
    const d = f.inradius * (offset ? 1 + dr : 1);
    return { nx: px, ny: py, nz: pz, d };
  });

  // Dual hull of q = n/d. Default merge tolerances only collapse truly
  // coincident planes, so the vertex-split topology is deterministic.
  const dualPts = new Float64Array(planes.length * 3);
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    dualPts[i * 3] = p.nx / p.d;
    dualPts[i * 3 + 1] = p.ny / p.d;
    dualPts[i * 3 + 2] = p.nz / p.d;
  }
  const dual = hullToSkeleton(dualPts);
  if (dual.positions.length !== dualPts.length) {
    throw new Error("plane perturbation collapsed two faces into one");
  }

  // Primal vertices: one per dual face, v = m/e from that face's plane.
  const dualFrames = faceFrames(dual);
  const positions = new Float64Array(dual.faces.length * 3);
  for (let j = 0; j < dualFrames.length; j++) {
    const m = dualFrames[j].normal;
    const e = dualFrames[j].inradius;
    if (!(e > 0)) throw new Error("dual face through the origin — unbounded primal");
    positions[j * 3] = m[0] / e;
    positions[j * 3 + 1] = m[1] / e;
    positions[j * 3 + 2] = m[2] / e;
  }

  // Primal faces: the cycle of dual faces around each dual vertex, walked
  // via directed edges (consistent winding makes each step unique).
  /** @type {Map<number, number>} directed dual edge a→b → face using it */
  const dirToFace = new Map();
  /** @type {Map<number, number>} dual vertex → any incident face */
  const vertFace = new Map();
  dual.faces.forEach((ring, j) => {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      dirToFace.set(a * 0x100000 + b, j);
      if (!vertFace.has(a)) vertFace.set(a, j);
    }
  });

  /** @type {number[][]} */
  const rings = [];
  for (let i = 0; i < planes.length; i++) {
    const f0 = vertFace.get(i);
    if (f0 == null) {
      // The perturbed plane no longer bounds the intersection: at high
      // amplitude neighbors can cut a face away entirely. Dropping a
      // non-binding half-space leaves the solid unchanged, so the face
      // simply vanishes — gradual geometry, not an error.
      continue;
    }
    const ring = [];
    let f = f0;
    const guard = dual.faces.length + 2;
    do {
      ring.push(f);
      const r = dual.faces[f];
      const at = r.indexOf(i);
      const next = r[(at + 1) % r.length];
      f = dirToFace.get(next * 0x100000 + i);
      if (f == null) throw new Error("dual walk broke — dual hull is not closed");
      if (ring.length > guard) throw new Error("dual walk did not close");
    } while (f !== f0);
    rings.push(ring);
  }

  // Back to unit circumradius (pipeline scales by size assuming unit).
  let maxR2 = 0;
  for (let j = 0; j < positions.length; j += 3) {
    const r2 = positions[j] ** 2 + positions[j + 1] ** 2 + positions[j + 2] ** 2;
    if (r2 > maxR2) maxR2 = r2;
  }
  const inv = 1 / Math.sqrt(maxR2);
  for (let j = 0; j < positions.length; j++) positions[j] *= inv;

  const faces = applyFaceIdentity(positions, rings);
  const out = { positions, faces, edges: edgeList(faces) };
  assertSkeleton(out);
  return out;
}
