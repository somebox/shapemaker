/**
 * Shell solidifier — policy only: depth × OpeningGenerator → geom/*.
 * Port of prototype/icosidodecahedron.py build(), without orientation/repair.
 *
 * This module is deliberately shape-family agnostic: everything it needs about
 * the polyhedron arrives through skeleton.js / faceframe.js. That is what lets
 * M3 add platonic bases without editing the solidifier.
 *
 * Border: the inset is a centroid *scale* (Python's `1 - border/apothem`), not
 * a true polygon offset — the two coincide only on regular faces. The scale
 * fraction is therefore the authoritative quantity and millimetres are a
 * derived view, which is what makes M2's relative-border-primary UI cheap.
 */

import { edgeInteriorFractions, edgeKey } from "../geom/edgesub.js";
import { filletPolygon, insetScale } from "../geom/poly2.js";
import { radialSample, quadToTris } from "../geom/annulus.js";
import { edgeList, inradiusRange } from "../skeleton.js";
import { faceFrames } from "../faceframe.js";
import { assertMeshInvariants, toMesh } from "../mesh.js";
import { validationError } from "../validate.js";

/**
 * A hole generator works purely in face-local 2D. Adding `circle` or `mirror`
 * (v1.1) means adding one of these — the solidifier does not change.
 * @typedef {{
 *   generate: (faceCorners2d: Float64Array, borderFraction: number, filletMm: number, filletSegments?: number) =>
 *     { opening: Float64Array, radiusUsed: number }
 * }} OpeningGenerator
 */

/**
 * Tessellation rule: fillet arc segments derived from edgeDiv — density is
 * ONE user concept with one knob. Normal (edgeDiv 10) → exactly 64, so the
 * parity anchors (7200 tris, 16.150 cm³) are identity-preserved; Draft 4 →
 * 26, Fine 20 → 128. The floor keeps degenerate-arc risk out at edgeDiv 1.
 * @param {number} edgeDiv
 */
export function filletSegmentsFor(edgeDiv) {
  return Math.max(4, Math.round(edgeDiv * 6.4));
}

/** @type {OpeningGenerator} */
export const insetFillet = {
  generate(faceCorners2d, borderFraction, filletMm, filletSegments = 64) {
    const inset = insetScale(faceCorners2d, borderFraction);
    const pairs = [];
    for (let i = 0; i < inset.length; i += 2) pairs.push([inset[i], inset[i + 1]]);
    const { polyline, radius } = filletPolygon(pairs, filletMm, filletSegments);
    return { opening: polyline, radiusUsed: radius };
  },
};

/**
 * Build a hollow (or solid) shell mesh from a convex skeleton.
 *
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {{
 *   wallMm: number,
 *   borderMm?: number|null,
 *   borderFraction?: number|null,
 *   filletMm: number,
 *   edgeDiv?: number,
 *   openings?: boolean,
 *   depth?: 'hollow'|'solid',
 *   openingGenerator?: OpeningGenerator,
 * }} opts
 */
export function buildShell(skeleton, opts) {
  const {
    wallMm,
    borderMm = null,
    borderFraction = null,
    filletMm = 4.5,
    edgeDiv = 10,
    openings = true,
    depth = "hollow",
    openingGenerator = insetFillet,
  } = opts;

  if (openings && depth !== "hollow") {
    throw validationError("solid", "openings", "Openings require a hollow shell", {
      clampTo: false,
    });
  }
  if (openings && borderMm == null && borderFraction == null) {
    throw validationError("solid", "borderMm", "Openings need a border width");
  }

  const corners = skeleton.positions;
  const faces = skeleton.faces;
  const nCorners = corners.length / 3;

  const frames = faceFrames(skeleton);
  const inradius = inradiusRange(frames);

  // The inner surface is a uniform scale about the origin, so the thinnest
  // wall lands on the face nearest the centre; wallMm sizes that one.
  if (depth === "hollow" && wallMm >= inradius.min) {
    throw validationError(
      "solid",
      "wallMm",
      `Wall ${wallMm} mm is too thick — the closest face is only ` +
      `${inradius.min.toFixed(2)} mm from the centre`,
      { clampTo: inradius.min * 0.9 },
    );
  }
  const s = depth === "hollow" ? 1.0 - wallMm / inradius.min : null;

  const verts = [];
  for (let i = 0; i < nCorners; i++) {
    verts.push([corners[i * 3], corners[i * 3 + 1], corners[i * 3 + 2]]);
  }

  // One shared subdivision per polyhedron edge: both faces index the same
  // points, so neighbours meet exactly — no cracks, no T-junctions.
  const edgeExtra = new Map();
  const ts = edgeInteriorFractions(edgeDiv);
  for (const [a, b] of edgeList(faces)) {
    const A = verts[a], B = verts[b];
    const idx = [];
    for (let t = 0; t < ts.length; t++) {
      const u = ts[t];
      idx.push(verts.length);
      verts.push([
        A[0] + (B[0] - A[0]) * u,
        A[1] + (B[1] - A[1]) * u,
        A[2] + (B[2] - A[2]) * u,
      ]);
    }
    edgeExtra.set(edgeKey(a, b), idx);
  }

  const nOuter = verts.length;
  const baseO = 0;
  let baseI = -1;
  if (depth === "hollow") {
    baseI = verts.length;
    for (let i = 0; i < nOuter; i++) {
      verts.push([verts[i][0] * s, verts[i][1] * s, verts[i][2] * s]);
    }
  }

  const triIdx = [];
  const faceIds = [];
  // Per-face, not keyed by side count: congruent faces only exist on regular
  // solids. On a jittered hull two triangles differ in size and clamp value,
  // and a side-count key would let the last one overwrite the rest.
  /** @type {{faceIndex:number, sides:number, borderMinMm:number, borderMaxMm:number, filletUsedMm:number, openingMinDiameterMm:number}[]} */
  const faceMetrics = [];

  for (let fi = 0; fi < faces.length; fi++) {
    const ring = faces[fi];
    const frame = frames[fi];
    const [cx, cy, cz] = frame.origin;
    const [ux, uy, uz] = frame.u;
    const [wx, wy, wz] = frame.w;

    // The inset is a centroid scale, so the narrowest edge binds: sizing the
    // scale from edgeDistMin makes borderMm the *minimum* frame width on the
    // face, never an average that could go thinner somewhere.
    const frac = borderMm != null ? borderMm / frame.edgeDistMin : borderFraction;
    const borderMinMm = frac * frame.edgeDistMin;
    const borderMaxMm = frac * frame.edgeDistMax;

    if (openings && frac >= 1.0 - 1e-12) {
      throw validationError(
        "solid",
        borderMm != null ? "borderMm" : "borderFraction",
        `Border ${borderMinMm.toFixed(2)} mm is too wide: this ${ring.length}-sided ` +
        `face allows at most ${frame.edgeDistMin.toFixed(2)} mm before the opening closes`,
        { clampTo: frame.edgeDistMin * 0.95, faceIds: [fi] },
      );
    }

    // Ordered outer boundary: corner, that edge's interior points, corner, …
    const boundary = [];
    for (let k = 0; k < ring.length; k++) {
      const i = ring[k], j = ring[(k + 1) % ring.length];
      boundary.push(i);
      const extra = edgeExtra.get(edgeKey(i, j));
      if (i < j) boundary.push(...extra);
      else boundary.push(...[...extra].reverse());
    }

    const m = boundary.length;

    if (!openings) {
      // Fan from a dedicated face-centre vertex, never from a corner: two
      // faces sharing a corner would emit the same directed diagonal from it,
      // which is a manifold violation (caught by assertMeshInvariants).
      const cOuter = verts.length;
      verts.push([cx, cy, cz]);
      const BOc = boundary.map((v) => baseO + v);
      for (let k = 0; k < m; k++) {
        triIdx.push(cOuter, BOc[k], BOc[(k + 1) % m]);
        faceIds.push(fi);
      }
      if (depth === "hollow") {
        const cInner = verts.length;
        verts.push([cx * s, cy * s, cz * s]);
        const BIc = boundary.map((v) => baseI + v);
        for (let k = 0; k < m; k++) {
          triIdx.push(cInner, BIc[(k + 1) % m], BIc[k]);
          faceIds.push(fi);
        }
      }
      continue;
    }

    const B2x = new Float64Array(m);
    const B2y = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const p = verts[boundary[k]];
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      B2x[k] = dx * ux + dy * uy + dz * uz;
      B2y[k] = dx * wx + dy * wy + dz * wz;
    }

    const corner2d = new Float64Array(ring.length * 2);
    for (let k = 0; k < ring.length; k++) {
      const idx = k * edgeDiv;
      corner2d[k * 2] = B2x[idx];
      corner2d[k * 2 + 1] = B2y[idx];
    }

    let { opening, radiusUsed } = openingGenerator.generate(
      corner2d,
      frac,
      filletMm,
      filletSegmentsFor(edgeDiv),
    );

    // Sample the opening along the same rays as the boundary points: both
    // rings are convex and contain the centroid, so the rays are in strict
    // angular order and consecutive rays bound exactly one quad.
    const ang = new Float64Array(m);
    for (let k = 0; k < m; k++) ang[k] = Math.atan2(B2y[k], B2x[k]);
    let rad;
    try {
      rad = radialSample(opening, ang);
    } catch {
      // Sliver faces (perturbed subdivision can produce them): a near-max
      // fillet approaches a circle about the incenter, which can exclude
      // the area centroid. The unfilleted inset ring is star-shaped about
      // the centroid by construction — drop the fillet on this face only.
      // If the retry still throws, the face is truly degenerate: that is an
      // internal invariant, so let it propagate.
      ({ opening, radiusUsed } = openingGenerator.generate(corner2d, frac, 0, 1));
      rad = radialSample(opening, ang);
    }
    let minR = Infinity;
    const OO = [];
    const OI = [];
    for (let k = 0; k < m; k++) {
      minR = Math.min(minR, rad[k]);
      const ox = rad[k] * Math.cos(ang[k]);
      const oy = rad[k] * Math.sin(ang[k]);
      OO.push(verts.length);
      verts.push([
        cx + ox * ux + oy * wx,
        cy + ox * uy + oy * wy,
        cz + ox * uz + oy * wz,
      ]);
    }
    if (depth === "hollow") {
      for (let k = 0; k < m; k++) {
        const p = verts[OO[k]];
        OI.push(verts.length);
        verts.push([p[0] * s, p[1] * s, p[2] * s]);
      }
    }
    faceMetrics.push({
      faceIndex: fi,
      sides: ring.length,
      borderMinMm,
      borderMaxMm,
      filletUsedMm: radiusUsed,
      openingMinDiameterMm: 2 * minR,
    });

    const BO = boundary.map((v) => baseO + v);
    const BI = depth === "hollow" ? boundary.map((v) => baseI + v) : null;

    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      pushQuad(triIdx, faceIds, BO[k], BO[k2], OO[k2], OO[k], fi);
      if (depth === "hollow") {
        pushQuad(triIdx, faceIds, BI[k2], BI[k], OI[k], OI[k2], fi);
        pushQuad(triIdx, faceIds, OO[k], OO[k2], OI[k2], OI[k], fi);
      }
    }
  }

  const positions = new Float64Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    positions[i * 3] = verts[i][0];
    positions[i * 3 + 1] = verts[i][1];
    positions[i * 3 + 2] = verts[i][2];
  }
  const mesh = toMesh(positions, new Uint32Array(triIdx), new Uint32Array(faceIds));
  const inv = assertMeshInvariants(mesh);

  return {
    mesh,
    info: {
      inradiusMm: inradius,
      scale: s,
      faceMetrics,
      // Aggregates across every face — meaningful on irregular hulls, where a
      // single representative value would be a lie.
      borderMm: range(faceMetrics, (f) => [f.borderMinMm, f.borderMaxMm]),
      filletMm: range(faceMetrics, (f) => [f.filletUsedMm, f.filletUsedMm]),
      openingMinDiameterMm: faceMetrics.length
        ? Math.min(...faceMetrics.map((f) => f.openingMinDiameterMm))
        : null,
      wall: depth === "hollow"
        ? { min: inradius.min * (1 - s), max: inradius.max * (1 - s) }
        : { min: null, max: null },
      volume: inv.volume,
      triangleCount: inv.triangleCount,
      watertight: inv.ok,
    },
  };
}

/** {min,max} over per-face values, or nulls when there are no openings. */
function range(items, pick) {
  if (!items.length) return { min: null, max: null };
  let min = Infinity, max = -Infinity;
  for (const it of items) {
    const [lo, hi] = pick(it);
    if (lo < min) min = lo;
    if (hi > max) max = hi;
  }
  return { min, max };
}

function pushQuad(triIdx, faceIds, p0, p1, p2, p3, fi) {
  triIdx.push(...quadToTris(p0, p1, p2, p3));
  faceIds.push(fi, fi);
}
