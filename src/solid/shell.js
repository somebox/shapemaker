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
import { buildEdgeRounding } from "./edgeround.js";

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

/**
 * Rim-roundover arc segments from edgeDiv. Draft 2 / Normal 3 / Fine 6.
 * @param {number} edgeDiv
 */
export function roundingSegmentsFor(edgeDiv) {
  return Math.max(2, Math.round(edgeDiv * 0.3));
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
 *   roundingMm?: number,
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
    roundingMm = 0,
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

  const EPS_R = 1e-9;
  const roundingActive = roundingMm > EPS_R;

  const verts = [];
  for (let i = 0; i < nCorners; i++) {
    verts.push([corners[i * 3], corners[i * 3 + 1], corners[i * 3 + 2]]);
  }

  // One shared subdivision per polyhedron edge: both faces index the same
  // points, so neighbours meet exactly — no cracks, no T-junctions.
  // (With Stage-2 rounding the strips own the per-edge sampling instead.)
  const edgeExtra = new Map();
  const ts = edgeInteriorFractions(edgeDiv);
  if (!roundingActive) {
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
  }

  // Stage-2 dihedral rounding: per-edge proportional radii — each edge is
  // clamped by ITS OWN faces' flat allowances, so one small feature never
  // caps the whole model. Built before the inner-shell copy so hollow
  // depths mirror the rounding for free.
  let stage2 = null;
  if (roundingActive) {
    /** allowance per (face, edgeKey): share of the flat this face can give */
    const allow = new Map();
    for (let fi = 0; fi < faces.length; fi++) {
      const ring = faces[fi];
      const frame = frames[fi];
      const frac = openings
        ? (borderMm != null ? borderMm / frame.edgeDistMin : borderFraction)
        : null;
      if (openings && frac >= 1.0 - 1e-12) {
        throw validationError(
          "solid",
          borderMm != null ? "borderMm" : "borderFraction",
          `Border ${(frac * frame.edgeDistMin).toFixed(2)} mm is too wide: this ` +
          `${ring.length}-sided face allows at most ` +
          `${frame.edgeDistMin.toFixed(2)} mm before the opening closes`,
          { clampTo: frame.edgeDistMin * 0.95, faceIds: [fi] },
        );
      }
      for (let k = 0; k < ring.length; k++) {
        const key = edgeKey(ring[k], ring[(k + 1) % ring.length]);
        const width = frame.edgeDist[k];
        // Openings: Stage 2 may take up to 60% of the border band along this
        // edge (Stage 1's rim clamp then adapts to the measured remainder).
        // Closed faces: up to 45% of the centroid-to-edge distance.
        const a = openings ? 0.6 * frac * width : 0.45 * width;
        const prev = allow.get(key);
        allow.set(key, prev == null ? a : Math.min(prev, a));
      }
    }
    stage2 = buildEdgeRounding(skeleton, frames, {
      radiusForEdge: (key) => {
        const a = allow.get(key) ?? roundingMm;
        return Math.max(1e-4, Math.min(roundingMm, a));
      },
      // Raw band-width budget: on acute dihedrals the tangency band is
      // wider than the radius (w = r·cot(ω/2) > r) and must still fit.
      allowForEdge: (key) => allow.get(key) ?? roundingMm,
      segments: roundingSegmentsFor(edgeDiv),
      lengthwise: ts,
      pushVert: (x, y, z) => {
        verts.push([x, y, z]);
        return verts.length - 1;
      },
      getVert: (i) => verts[i],
    });
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

    // Ordered outer boundary ring (absolute vert indices). Stage-2 uses the
    // inset ring (strip boundaries + inset corners); otherwise corner + that
    // edge's shared interior points, corner, …
    /** @type {number[]} */
    let BOr;
    if (stage2) {
      BOr = stage2.faceRings.get(fi);
    } else {
      BOr = [];
      for (let k = 0; k < ring.length; k++) {
        const i = ring[k], j = ring[(k + 1) % ring.length];
        BOr.push(baseO + i);
        const extra = edgeExtra.get(edgeKey(i, j));
        if (i < j) BOr.push(...extra.map((x) => baseO + x));
        else BOr.push(...[...extra].reverse().map((x) => baseO + x));
      }
    }

    const m = BOr.length;

    if (!openings) {
      // Fan from a dedicated face-centre vertex, never from a corner: two
      // faces sharing a corner would emit the same directed diagonal from it,
      // which is a manifold violation (caught by assertMeshInvariants).
      const cOuter = verts.length;
      verts.push([cx, cy, cz]);
      for (let k = 0; k < m; k++) {
        triIdx.push(cOuter, BOr[k], BOr[(k + 1) % m]);
        faceIds.push(fi);
      }
      if (depth === "hollow") {
        const cInner = verts.length;
        verts.push([cx * s, cy * s, cz * s]);
        for (let k = 0; k < m; k++) {
          triIdx.push(cInner, BOr[(k + 1) % m] + baseI, BOr[k] + baseI);
          faceIds.push(fi);
        }
      }
      continue;
    }

    const B2x = new Float64Array(m);
    const B2y = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const p = verts[BOr[k]];
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      B2x[k] = dx * ux + dy * uy + dz * uz;
      B2y[k] = dx * wx + dy * wy + dz * wz;
    }

    // The authored opening derives from the ORIGINAL face corners — rounding
    // must never move or shrink the opening itself.
    const corner2d = new Float64Array(ring.length * 2);
    for (let k = 0; k < ring.length; k++) {
      if (stage2) {
        const p = verts[ring[k]];
        const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
        corner2d[k * 2] = dx * ux + dy * uy + dz * uz;
        corner2d[k * 2 + 1] = dx * wx + dy * wy + dz * wz;
      } else {
        const idx = k * edgeDiv;
        corner2d[k * 2] = B2x[idx];
        corner2d[k * 2 + 1] = B2y[idx];
      }
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
    /** @type {number[]} virtual outer-lip corners (not always pushed) */
    const ooPts = [];
    for (let k = 0; k < m; k++) {
      minR = Math.min(minR, rad[k]);
      const ox = rad[k] * Math.cos(ang[k]);
      const oy = rad[k] * Math.sin(ang[k]);
      ooPts.push([
        cx + ox * ux + oy * wx,
        cy + ox * uy + oy * wy,
        cz + ox * uz + oy * wz,
      ]);
    }

    // Per-face rounding clamp from exact per-ray flat widths + wall lengths.
    let rFace = 0;
    if (roundingMm > EPS_R && depth === "hollow" && s != null) {
      let minFlat = Infinity;
      let minWall = Infinity;
      for (let k = 0; k < m; k++) {
        const Rb = Math.hypot(B2x[k], B2y[k]);
        const flat = Rb - rad[k];
        if (flat < minFlat) minFlat = flat;
        const op = ooPts[k];
        const wallLen = Math.hypot(op[0], op[1], op[2]) * (1 - s);
        if (wallLen < minWall) minWall = wallLen;
      }
      // 2r < wall; r < inner flat (≈ s·outer flat). Outer flat is looser.
      rFace = Math.min(roundingMm, 0.499 * minWall, 0.95 * s * minFlat);
      if (!(rFace > EPS_R)) rFace = 0;
    }

    const BO = BOr;
    const BI = depth === "hollow" ? BOr.map((v) => v + baseI) : null;

    /** @type {number[]} */
    let OO = [];
    /** @type {number[]} */
    let OI = [];

    if (rFace > EPS_R) {
      // Stage-1 rim roundovers: OO/OI are virtual; emit arc rings instead.
      const J = roundingSegmentsFor(edgeDiv);
      const uvec = [ux, uy, uz];
      const wvec = [wx, wy, wz];

      // Outer arc rings F_out … W_top (j = 0..J); inner W_bot … F_in.
      /** @type {number[][]} */
      const outerRings = [];
      /** @type {number[][]} */
      const innerRings = [];
      for (let j = 0; j <= J; j++) {
        const theta = (j / J) * (Math.PI / 2);
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);
        /** @type {number[]} */
        const oRing = [];
        /** @type {number[]} */
        const iRing = [];
        for (let k = 0; k < m; k++) {
          const oo = ooPts[k];
          const ooLen = Math.hypot(oo[0], oo[1], oo[2]);
          const dk = [-oo[0] / ooLen, -oo[1] / ooLen, -oo[2] / ooLen];
          const tk = [
            Math.cos(ang[k]) * uvec[0] + Math.sin(ang[k]) * wvec[0],
            Math.cos(ang[k]) * uvec[1] + Math.sin(ang[k]) * wvec[1],
            Math.cos(ang[k]) * uvec[2] + Math.sin(ang[k]) * wvec[2],
          ];
          // Outer: P = OO + r(1−sinθ)·t + r(1−cosθ)·d
          const ox =
            oo[0] + rFace * (1 - sinT) * tk[0] + rFace * (1 - cosT) * dk[0];
          const oy =
            oo[1] + rFace * (1 - sinT) * tk[1] + rFace * (1 - cosT) * dk[1];
          const oz =
            oo[2] + rFace * (1 - sinT) * tk[2] + rFace * (1 - cosT) * dk[2];
          oRing.push(verts.length);
          verts.push([ox, oy, oz]);
          // Inner: Q = OI + r(1−cosθ)·t − r(1−sinθ)·d ; OI = s·OO
          const oi = [oo[0] * s, oo[1] * s, oo[2] * s];
          const ix =
            oi[0] + rFace * (1 - cosT) * tk[0] - rFace * (1 - sinT) * dk[0];
          const iy =
            oi[1] + rFace * (1 - cosT) * tk[1] - rFace * (1 - sinT) * dk[1];
          const iz =
            oi[2] + rFace * (1 - cosT) * tk[2] - rFace * (1 - sinT) * dk[2];
          iRing.push(verts.length);
          verts.push([ix, iy, iz]);
        }
        outerRings.push(oRing);
        innerRings.push(iRing);
      }

      // Chain: BO → F_out → arcs → W_top → W_bot → arcs → F_in → BI.
      // Outer j=0 is F_out, j=J is W_top; inner j=0 is W_bot, j=J is F_in
      // (same θ formula — do not reverse inner rings).
      /** @type {number[][]} */
      const chain = [BO, ...outerRings, ...innerRings, BI];

      for (let b = 0; b < chain.length - 1; b++) {
        const R0 = chain[b];
        const R1 = chain[b + 1];
        for (let k = 0; k < m; k++) {
          const k2 = (k + 1) % m;
          pushQuad(triIdx, faceIds, R0[k], R0[k2], R1[k2], R1[k], fi);
        }
      }
    } else {
      // Byte-identity path: push OO/OI and the original three bands verbatim.
      for (let k = 0; k < m; k++) {
        OO.push(verts.length);
        verts.push(ooPts[k]);
      }
      if (depth === "hollow") {
        for (let k = 0; k < m; k++) {
          const p = verts[OO[k]];
          OI.push(verts.length);
          verts.push([p[0] * s, p[1] * s, p[2] * s]);
        }
      }
      for (let k = 0; k < m; k++) {
        const k2 = (k + 1) % m;
        pushQuad(triIdx, faceIds, BO[k], BO[k2], OO[k2], OO[k], fi);
        if (depth === "hollow") {
          pushQuad(triIdx, faceIds, BI[k2], BI[k], OI[k], OI[k2], fi);
          pushQuad(triIdx, faceIds, OO[k], OO[k2], OI[k2], OI[k], fi);
        }
      }
    }

    faceMetrics.push({
      faceIndex: fi,
      sides: ring.length,
      borderMinMm,
      borderMaxMm,
      filletUsedMm: radiusUsed,
      roundingUsedMm: rFace,
      openingMinDiameterMm: 2 * minR,
    });
  }

  if (stage2) {
    for (const [a, b, c, d, fid] of stage2.quads) {
      pushQuad(triIdx, faceIds, a, b, c, d, fid);
      if (depth === "hollow") {
        pushQuad(triIdx, faceIds, d + baseI, c + baseI, b + baseI, a + baseI, fid);
      }
    }
    for (const [a, b, c, fid] of stage2.tris) {
      triIdx.push(a, b, c);
      faceIds.push(fid);
      if (depth === "hollow") {
        triIdx.push(c + baseI, b + baseI, a + baseI);
        faceIds.push(fid);
      }
    }
  }

  // Stage-2 rounding orphans the raw corner verts (rings own the surface);
  // compact so the buffers only carry referenced vertices. The r=0 path
  // stays untouched for byte identity.
  let outVerts = verts;
  let outTris = triIdx;
  if (stage2) {
    const remap = new Map();
    outVerts = [];
    outTris = new Array(triIdx.length);
    for (let i = 0; i < triIdx.length; i++) {
      const v = triIdx[i];
      let m = remap.get(v);
      if (m === undefined) {
        m = outVerts.length;
        outVerts.push(verts[v]);
        remap.set(v, m);
      }
      outTris[i] = m;
    }
  }

  const positions = new Float64Array(outVerts.length * 3);
  for (let i = 0; i < outVerts.length; i++) {
    positions[i * 3] = outVerts[i][0];
    positions[i * 3 + 1] = outVerts[i][1];
    positions[i * 3 + 2] = outVerts[i][2];
  }
  const mesh = toMesh(positions, new Uint32Array(outTris), new Uint32Array(faceIds));
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
      roundingMm: stage2
        ? {
            min: Math.min(
              stage2.radiusMin,
              ...faceMetrics.map((f) => f.roundingUsedMm || Infinity),
            ),
            max: Math.max(
              stage2.radiusMax,
              ...faceMetrics.map((f) => f.roundingUsedMm || 0),
            ),
          }
        : range(faceMetrics, (f) => [
            f.roundingUsedMm ?? 0,
            f.roundingUsedMm ?? 0,
          ]),
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
