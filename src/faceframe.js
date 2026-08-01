/**
 * Face-local 2D frame — the abstraction boundary the spec names.
 *
 * Almost all opening geometry is 2D. This module is the only place that knows
 * how to get in and out of a face's plane, so solid/shell.js can stay dumb
 * ("per face: build annulus quads in 2D; stitch by global edge keys") and
 * OpeningGenerators never touch 3D at all.
 */

import { newell } from "./skeleton.js";

/**
 * @typedef {{
 *   faceIndex: number,
 *   origin: number[],    // face centroid, world
 *   u: number[],         // in-plane basis, toward ring[0]
 *   w: number[],         // in-plane basis, u × normal ordering (CCW from outside)
 *   normal: number[],      // outward unit plane normal
 *   inradius: number,      // origin → face plane distance
 *   edgeDist: number[],    // centroid → each edge line, in plane
 *   edgeDistMin: number,   // the binding one for insetting
 *   edgeDistMax: number,
 *   sides: number,
 * }} FaceFrame
 *
 * On a regular polygon every `edgeDist` equals the apothem. They diverge on
 * irregular faces (M5 jitter), which is why the frame reports all of them:
 * a centroid scale of (1 − b/edgeDistMin) guarantees the *narrowest* border
 * on the face is exactly b, and the widest is edgeDistMax/edgeDistMin × b.
 * Measuring from one arbitrary edge instead would make results depend on
 * where the face ring happens to start.
 */

/**
 * Build the local frame for one face.
 *
 * The plane normal uses Newell's method rather than the radial direction, so
 * it stays correct for irregular faces (M5 jitter) where the centroid
 * direction and the true plane normal diverge. On the symmetric M1 solid the
 * two agree to float noise.
 *
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {number} faceIndex
 * @returns {FaceFrame}
 */
export function toFaceFrame(skeleton, faceIndex) {
  const { positions, faces } = skeleton;
  const ring = faces[faceIndex];
  const n = ring.length;

  const frame = newell(positions, ring);
  let [cx, cy, cz] = frame.centroid;
  let [nx, ny, nz] = frame.normal;
  // Orient outward (origin is inside the convex solid).
  if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; }

  // Frame origin = polygon AREA centroid, not the ring-vertex average. The
  // two agree on regular polygons and triangles, but vertex-split jitter adds
  // near-coincident ring vertices whose double weight would drag a vertex
  // average toward them — off-centering the opening and crushing edgeDistMin
  // and the fillet headroom. Area weighting is immune to ring multiplicity.
  {
    // Provisional in-plane basis about the vertex mean, then 2D shoelace.
    let ux0 = positions[ring[0] * 3] - cx;
    let uy0 = positions[ring[0] * 3 + 1] - cy;
    let uz0 = positions[ring[0] * 3 + 2] - cz;
    const ul0 = Math.hypot(ux0, uy0, uz0);
    ux0 /= ul0; uy0 /= ul0; uz0 /= ul0;
    const wx0 = ny * uz0 - nz * uy0;
    const wy0 = nz * ux0 - nx * uz0;
    const wz0 = nx * uy0 - ny * ux0;
    let A2 = 0, gx = 0, gy = 0;
    let px = 0, py = 0;
    for (let k = 0; k <= n; k++) {
      const vi = ring[k % n] * 3;
      const dx = positions[vi] - cx, dy = positions[vi + 1] - cy, dz = positions[vi + 2] - cz;
      const x = dx * ux0 + dy * uy0 + dz * uz0;
      const y = dx * wx0 + dy * wy0 + dz * wz0;
      if (k > 0) {
        const cross = px * y - x * py;
        A2 += cross;
        gx += (px + x) * cross;
        gy += (py + y) * cross;
      }
      px = x; py = y;
    }
    if (Math.abs(A2) > 1e-30) {
      gx /= 3 * A2;
      gy /= 3 * A2;
      cx += gx * ux0 + gy * wx0;
      cy += gx * uy0 + gy * wy0;
      cz += gx * uz0 + gy * wz0;
    }
  }

  // In-plane basis: u toward the first ring vertex, w = normal × u.
  let ux = positions[ring[0] * 3] - cx;
  let uy = positions[ring[0] * 3 + 1] - cy;
  let uz = positions[ring[0] * 3 + 2] - cz;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  const wx = ny * uz - nz * uy;
  const wy = nz * ux - nx * uz;
  const wz = nx * uy - ny * ux;

  // Perpendicular distance from the centroid to every edge *line*:
  //   d = |(a−c) × (b−c)| / |b−a|
  const edgeDist = new Array(n);
  let edgeDistMin = Infinity, edgeDistMax = -Infinity;
  for (let k = 0; k < n; k++) {
    const a = ring[k] * 3, b = ring[(k + 1) % n] * 3;
    const axc = positions[a] - cx, ayc = positions[a + 1] - cy, azc = positions[a + 2] - cz;
    const bxc = positions[b] - cx, byc = positions[b + 1] - cy, bzc = positions[b + 2] - cz;
    const rx = ayc * bzc - azc * byc;
    const ry = azc * bxc - axc * bzc;
    const rz = axc * byc - ayc * bxc;
    const len = Math.hypot(
      positions[b] - positions[a],
      positions[b + 1] - positions[a + 1],
      positions[b + 2] - positions[a + 2],
    );
    const d = Math.hypot(rx, ry, rz) / len;
    edgeDist[k] = d;
    if (d < edgeDistMin) edgeDistMin = d;
    if (d > edgeDistMax) edgeDistMax = d;
  }

  return {
    faceIndex,
    origin: [cx, cy, cz],
    u: [ux, uy, uz],
    w: [wx, wy, wz],
    normal: [nx, ny, nz],
    inradius: Math.abs(cx * nx + cy * ny + cz * nz),
    edgeDist,
    edgeDistMin,
    edgeDistMax,
    sides: n,
  };
}

/** Frames for every face, in face order. */
export function faceFrames(skeleton) {
  const out = [];
  for (let i = 0; i < skeleton.faces.length; i++) out.push(toFaceFrame(skeleton, i));
  return out;
}

/**
 * World point → face-local 2D [x, y].
 * @param {FaceFrame} f
 */
export function projectToFrame(f, px, py, pz) {
  const dx = px - f.origin[0], dy = py - f.origin[1], dz = pz - f.origin[2];
  return [
    dx * f.u[0] + dy * f.u[1] + dz * f.u[2],
    dx * f.w[0] + dy * f.w[1] + dz * f.w[2],
  ];
}

/**
 * Face-local 2D → world point [X, Y, Z].
 * @param {FaceFrame} f
 */
export function fromFaceFrame(f, x, y) {
  return [
    f.origin[0] + x * f.u[0] + y * f.w[0],
    f.origin[1] + x * f.u[1] + y * f.w[1],
    f.origin[2] + x * f.u[2] + y * f.w[2],
  ];
}
