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
import { inscribedMomentEllipse, ellipsePolyline } from "../geom/ellipse.js";
import {
  radialSample, quadToTris, edgeClearances, rayToRing, straightRing, zipperBand,
} from "../geom/annulus.js";
import { edgeList, inradiusRange } from "../skeleton.js";
import { cornerOffsets, meanValueWeights, offsetWallLimit, offsetWallRange } from "./offset.js";
import { faceFrames } from "../faceframe.js";
import { assertMeshInvariants, toMesh } from "../mesh.js";
import { validationError } from "../validate.js";
import { buildEdgeRounding } from "./edgeround.js";
import { subtractAll } from "./csg.js";
import { polysNear, surfacePolys, throughCutter, throughDepth } from "./through.js";

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

/** Through openings narrower than this stay closed. */
export const THROUGH_MIN_OPENING_MM = 0.2;

/**
 * Inner flat a Normal opening keeps along every inner edge (about one
 * extrusion width), capped at half the outer border so a thin border on a
 * thin wall still goes straight. Rounding does not raise it: a straight
 * wall wins, and the rim radius shrinks to the inner flat that is left.
 */
export const NORMAL_MIN_FLAT_MM = 0.4;

/** Normal openings tilting less than this count as straight in reports. */
export const AXIS_TILT_REPORT_DEG = 1;

/**
 * Rim-roundover arc segments from edgeDiv. Draft 2 / Normal 3 / Fine 6.
 * @param {number} edgeDiv
 */
export function roundingSegmentsFor(edgeDiv) {
  return Math.max(2, Math.round(edgeDiv * 0.3));
}

/**
 * Circular fillet of radius r between two rays from p (unit directions a
 * and b at angle ω): centre p + (r/sin ω)(a + b), tangent points at
 * w = r·cot(ω/2) along each ray, sampled by slerp from the a-side tangent
 * (index 0) to the b-side tangent (index `segments`). For ω = 90° this is
 * the quarter circle p + r(1−sinθ)a + r(1−cosθ)b.
 *
 * @param {number[]} p
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} r
 * @param {number} segments
 * @returns {number[][]} segments + 1 points
 */
export function lipArc(p, a, b, r, segments) {
  const cosw = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const sinw = Math.sqrt(Math.max(1 - cosw * cosw, 1e-12));
  const w = (r * (1 + cosw)) / sinw;
  const c = [
    p[0] + (r / sinw) * (a[0] + b[0]),
    p[1] + (r / sinw) * (a[1] + b[1]),
    p[2] + (r / sinw) * (a[2] + b[2]),
  ];
  const u0 = [
    (p[0] + w * a[0] - c[0]) / r,
    (p[1] + w * a[1] - c[1]) / r,
    (p[2] + w * a[2] - c[2]) / r,
  ];
  const u1 = [
    (p[0] + w * b[0] - c[0]) / r,
    (p[1] + w * b[1] - c[1]) / r,
    (p[2] + w * b[2] - c[2]) / r,
  ];
  const A = Math.acos(
    Math.max(-1, Math.min(1, u0[0] * u1[0] + u0[1] * u1[1] + u0[2] * u1[2])),
  );
  const sinA = Math.max(Math.sin(A), 1e-9);
  const out = [];
  for (let j = 0; j <= segments; j++) {
    const phi = (A * j) / segments;
    const ka = Math.sin(A - phi) / sinA, kb = Math.sin(phi) / sinA;
    out.push([
      c[0] + r * (ka * u0[0] + kb * u1[0]),
      c[1] + r * (ka * u0[1] + kb * u1[1]),
      c[2] + r * (ka * u0[2] + kb * u1[2]),
    ]);
  }
  return out;
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
 * Ellipse openings — the ring-ball form. The opening is the face's largest
 * inscribed moment ellipse (geom/ellipse.js) under the same centroid scale
 * as the polygon inset, so Border keeps its meaning: the narrowest strut
 * is still border × the binding centroid-to-edge distance. The ellipse lies
 * inside the polygon inset, so every limit sized for the polygon (border
 * ceiling, Stage-2 band allowance, rim clamp) holds here unchanged.
 * Fillet does not apply; a degenerate face falls back to the bare inset.
 * @type {OpeningGenerator}
 */
export const insetEllipse = {
  generate(faceCorners2d, borderFraction, _filletMm, filletSegments = 64) {
    const e = inscribedMomentEllipse(faceCorners2d);
    if (!e) return { opening: insetScale(faceCorners2d, borderFraction), radiusUsed: 0 };
    return {
      opening: ellipsePolyline(e, 1 - borderFraction, Math.max(64, filletSegments * 2)),
      radiusUsed: 0,
    };
  },
};

/** Canonical `openingStyle` values → generators. */
export const OPENING_GENERATORS = Object.freeze({
  polygon: insetFillet,
  ellipse: insetEllipse,
});

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
 *   openingAxis?: 'center'|'normal'|'through',
 *   breakOut?: boolean,
 *   wallMode?: 'even'|'scaled',
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
    openingAxis = "center",
    breakOut = false,
    wallMode = "scaled",
  } = opts;

  if (openings && depth !== "hollow") {
    throw validationError("solid", "openings", "Openings require a hollow shell", {
      clampTo: false,
    });
  }
  if (openings && borderMm == null && borderFraction == null) {
    throw validationError("solid", "borderMm", "Openings need a border width");
  }

  // Through: build the closed shell, then subtract one straight cutter per
  // opening, so holes may run into neighbouring inner faces and each other.
  const through = openings && openingAxis === "through";
  const normalAxis = openings && openingAxis === "normal";

  const corners = skeleton.positions;
  const faces = skeleton.faces;
  const nCorners = corners.length / 3;

  const frames = faceFrames(skeleton);
  const inradius = inradiusRange(frames);
  /** Border that fits every face (the narrowest binds), as `borderMmMax`. */
  const borderFitMm = 0.95 * Math.min(...frames.map((f) => f.edgeDistMin));

  // Scaled: the inner surface is a uniform scale about the origin, so the
  // thinnest wall lands on the face nearest the centre; wallMm sizes that
  // one. Even: every face plane moves in by wallMm, which is valid until
  // an inner edge folds over.
  const even = depth === "hollow" && wallMode === "even";
  const dHat = even ? cornerOffsets(skeleton, frames) : null;
  if (even) {
    const limit = offsetWallLimit(skeleton, dHat);
    if (wallMm >= limit) {
      throw validationError(
        "solid",
        "wallMm",
        `Wall ${wallMm} mm is too thick — inner edges fold over beyond ` +
        `${limit.toFixed(2)} mm on this shape`,
        { clampTo: limit * 0.9 },
      );
    }
  } else if (depth === "hollow" && wallMm >= inradius.min) {
    throw validationError(
      "solid",
      "wallMm",
      `Wall ${wallMm} mm is too thick — the closest face is only ` +
      `${inradius.min.toFixed(2)} mm from the centre`,
      { clampTo: inradius.min * 0.9 },
    );
  }
  const s = depth === "hollow" && !even ? 1.0 - wallMm / inradius.min : null;
  /** Inner displacement of a point blended from skeleton corners. */
  const offsetOf = (host) => {
    let x = 0, y = 0, z = 0;
    for (const [v, w] of host) {
      x += w * dHat[v * 3]; y += w * dHat[v * 3 + 1]; z += w * dHat[v * 3 + 2];
    }
    return [x * wallMm, y * wallMm, z * wallMm];
  };
  /** Skeleton-corner weights of a face-local point (face corners in 2D). */
  const faceHost = (ring, corner2d, x, y) => {
    const w = meanValueWeights(corner2d, x, y);
    return ring.map((v, k) => [v, w[k]]);
  };

  // Scale-aware floor: values below this cannot form a representable strip
  // (the old 1e-4 mm clamp could both overshoot a tiny request and mint
  // degenerate triangles just above the activation epsilon).
  const rEps = Math.max(1e-7, 1e-6 * inradius.min);
  const roundingActive = roundingMm > rEps;

  const verts = [];
  /** Skeleton-corner weights per outer vertex (Even walls only). */
  const hosts = [];
  for (let i = 0; i < nCorners; i++) {
    verts.push([corners[i * 3], corners[i * 3 + 1], corners[i * 3 + 2]]);
    if (even) hosts.push([[i, 1]]);
  }

  // One shared subdivision per polyhedron edge: both faces index the same
  // points, so neighbours meet exactly — no cracks, no T-junctions.
  // (With Stage-2 rounding the strips own the per-edge sampling instead.
  // Through faces are plain polygons: the cutter carries its own sampling.)
  const edgeExtra = new Map();
  const ts = edgeInteriorFractions(edgeDiv);
  if (!roundingActive && !through) {
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
        if (even) hosts.push([[a, 1 - u], [b, u]]);
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
          { clampTo: borderMm != null ? borderFitMm : 0.9, faceIds: [fi] },
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
        const r = Math.min(roundingMm, a);
        return r > rEps ? r : 0;
      },
      // Raw band-width budget: on acute dihedrals the tangency band is
      // wider than the radius (w = r·cot(ω/2) > r) and must still fit.
      allowForEdge: (key) => allow.get(key) ?? roundingMm,
      segments: roundingSegmentsFor(edgeDiv),
      lengthwise: ts,
      pushVert: (x, y, z, host) => {
        verts.push([x, y, z]);
        if (even) hosts.push(host);
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
      if (even) {
        const d = offsetOf(hosts[i]);
        verts.push([verts[i][0] + d[0], verts[i][1] + d[1], verts[i][2] + d[2]]);
      } else {
        verts.push([verts[i][0] * s, verts[i][1] * s, verts[i][2] * s]);
      }
    }
  }

  const triIdx = [];
  const faceIds = [];
  // Per-face, not keyed by side count: congruent faces only exist on regular
  // solids. On a jittered hull two triangles differ in size and clamp value,
  // and a side-count key would let the last one overwrite the rest.
  /** @type {{faceIndex:number, sides:number, borderMinMm:number, borderMaxMm:number, filletUsedMm:number, openingMinDiameterMm:number}[]} */
  const faceMetrics = [];
  /** Through cutters, one closed mesh per face. */
  const cutters = [];
  /** Thickest wall at which every Normal opening still goes straight. */
  let straightWallMm = Infinity;
  let throughSpillFaces = 0;
  let throughClosedFaces = 0;
  let throughBreakOutFaces = 0;
  let innerPolys = null, outerPolys = null;

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
        { clampTo: borderMm != null ? borderFitMm : 0.9, faceIds: [fi] },
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
        const extra = edgeExtra.get(edgeKey(i, j)) ?? [];
        if (i < j) BOr.push(...extra.map((x) => baseO + x));
        else BOr.push(...[...extra].reverse().map((x) => baseO + x));
      }
    }

    const m = BOr.length;

    /** Skeleton corners in this face's frame, for Even-wall weights. */
    let skel2d = null;
    if (even) {
      skel2d = new Float64Array(ring.length * 2);
      for (let k = 0; k < ring.length; k++) {
        const v = ring[k];
        const dx = corners[v * 3] - cx, dy = corners[v * 3 + 1] - cy, dz = corners[v * 3 + 2] - cz;
        skel2d[k * 2] = dx * ux + dy * uy + dz * uz;
        skel2d[k * 2 + 1] = dx * wx + dy * wy + dz * wz;
      }
    }

    const closeFace = () => {
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
        if (even) {
          const d = offsetOf(faceHost(ring, skel2d, 0, 0));
          verts.push([cx + d[0], cy + d[1], cz + d[2]]);
        } else {
          verts.push([cx * s, cy * s, cz * s]);
        }
        for (let k = 0; k < m; k++) {
          triIdx.push(cInner, BOr[(k + 1) % m] + baseI, BOr[k] + baseI);
          faceIds.push(fi);
        }
      }
    };
    if (!openings) {
      closeFace();
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
        const idx = k * (m / ring.length);
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

    if (through) {
      closeFace();
      innerPolys ??= surfacePolys(faces, (v) => verts[baseI + v]);
      outerPolys ??= surfacePolys(faces, (v) => verts[v]);
      // Same sample count as the Centre/Normal walls, at angles halfway
      // between the corner spokes: a cutter edge crossing a fan spoke
      // exactly leaves zero-area triangles in the boolean.
      const M = ring.length * edgeDiv;
      const a0 = Math.atan2(B2y[0], B2x[0]);
      const angT = new Float64Array(M);
      for (let k = 0; k < M; k++) angT[k] = a0 + ((k + 0.5) * 2 * Math.PI) / M;
      const radT = radialSample(opening, angT);
      const Px = new Float64Array(M), Py = new Float64Array(M);
      for (let k = 0; k < M; k++) {
        Px[k] = radT[k] * Math.cos(angT[k]);
        Py[k] = radT[k] * Math.sin(angT[k]);
      }
      minR = Math.min(...radT);
      // Microscopic faces (heavy Truncate leaves ~0.1 mm squares) stay
      // closed: a cutter that small cannot print and only leaves contacts
      // the boolean resolves into zero-area triangles.
      if (2 * minR < THROUGH_MIN_OPENING_MM) {
        throughClosedFaces++;
        faceMetrics.push({
          faceIndex: fi,
          sides: ring.length,
          borderMinMm,
          borderMaxMm,
          filletUsedMm: radiusUsed,
          roundingUsedMm: 0,
          openingMinDiameterMm: 0,
          axisTiltDeg: 0,
          axisCentre: false,
        });
        continue;
      }
      // The cutter must clear the inner surface wherever the opening reaches
      // the cavity, and stop before the cavity's far side or any other
      // face's outside. Parts of the opening over solid wall leave a ledge.
      const onFace = (x, y) => [
        cx + x * ux + y * wx, cy + x * uy + y * wy, cz + x * uz + y * wz,
      ];
      const samples = [onFace(0, 0)];
      const stride = Math.max(1, Math.floor(M / 32));
      for (let k = 0; k < M; k += stride) {
        samples.push(onFace(Px[k], Py[k]), onFace(0.5 * Px[k], 0.5 * Py[k]));
      }
      const probe = (only) => {
        const r = { tIn: -Infinity, tOut: Infinity, tExit: Infinity, exitFace: -1, spill: false };
        for (const p of samples) {
          const hit = throughDepth(p, frame.normal, innerPolys, outerPolys, fi, only);
          if (hit.tExit < r.tExit) ({ tExit: r.tExit, exitFace: r.exitFace } = hit);
          if (!(hit.tIn < hit.tExit)) continue;
          r.tIn = Math.max(r.tIn, hit.tIn);
          r.tOut = Math.min(r.tOut, hit.tOut);
          if (hit.inFace !== fi) r.spill = true;
        }
        return r;
      };
      // Nearby faces first; a cutter reaching past them retests against all.
      const reach = 4 * (wallMm + roundingMm);
      let pr = probe(polysNear(outerPolys, outerPolys[fi].c, outerPolys[fi].r, reach));
      if (!(pr.tIn + wallMm + roundingMm < reach)) pr = probe();
      const { tIn, tOut, tExit, exitFace, spill } = pr;
      // Break out ignores the neighbour's outside; rays that leave the part
      // before reaching the cavity still never set the depth.
      const stop = breakOut ? tOut : Math.min(tOut, tExit);
      const roomy = stop - tIn > 0.05 * wallMm;
      if (!Number.isFinite(tIn) || (!roomy && !breakOut)) {
        const pierces = !breakOut && Number.isFinite(tIn) && tExit <= tOut && exitFace >= 0;
        throw validationError(
          "solid",
          pierces ? "openingAxis" : "wallMm",
          pierces
            ? "Cut sides would come out through a neighbouring face — " +
              "turn on Break out (Advanced), or set Sides to Straight, a thinner Wall or a wider Border"
            : `Wall ${wallMm} mm is too thick for Cut sides — a hole ` +
              "would not open into the inside",
          pierces
            ? { clampTo: "normal", faceIds: [fi, exitFace] }
            : { faceIds: [fi] },
        );
      }
      const gap = stop - tIn;
      // Rounded rim: the Stage-2 strips keep up to 60% of the border band.
      let lipMm = 0;
      if (roundingActive) {
        lipMm = Math.min(roundingMm, 0.95 * (stage2 ? 0.4 : 1) * borderMinMm, 0.9 * wallMm);
        if (!(lipMm > rEps)) lipMm = 0;
      }
      // Cutter ends sit in free space, so each face gets a slightly
      // different top and depth: coplanar caps on coplanar neighbours
      // (subdivided faces, symmetric solids) leave slivers in the boolean.
      const jig = 0.5 + ((fi * 0.6180339887) % 1) * 0.5;
      // Under Break out a ray may cross a thin sliver of cavity before
      // another ray first reaches it; the cutter then passes that sliver's
      // far wall and ends just past the deepest entry.
      const depthMm = tIn + jig * (roomy
        ? Math.min(0.5 * gap, wallMm + roundingMm)
        : 0.25 * wallMm);
      if (depthMm > tExit) throughBreakOutFaces++;
      cutters.push(throughCutter(frame, Px, Py, {
        lipMm,
        segments: roundingSegmentsFor(edgeDiv),
        topMm: 0.1 * jig * borderMinMm,
        depthMm,
        faceId: fi,
        // Well above the boolean's merge tolerance (~1e-5 of the size):
        // a nudge near it creates the contacts it should remove.
        jitterMm: 1e-4 * inradius.max,
      }));
      if (spill) throughSpillFaces++;
      faceMetrics.push({
        faceIndex: fi,
        sides: ring.length,
        borderMinMm,
        borderMaxMm,
        filletUsedMm: radiusUsed,
        roundingUsedMm: lipMm,
        openingMinDiameterMm: 2 * minR,
        axisTiltDeg: 0,
        axisCentre: false,
      });
      continue;
    }

    // Inner opening ring. Centre: the opening carried to the inner face the
    // same way as the face itself — the origin ray under Scaled walls (the
    // inner shell is s × outer), the corner-weighted offset under Even, so
    // it follows the inner face wherever it shrinks (on a regular solid
    // that is exactly the origin ray again).
    const oiCentre = even
      ? ooPts.map((oo, k) => {
          const d = offsetOf(faceHost(
            ring, skel2d, rad[k] * Math.cos(ang[k]), rad[k] * Math.sin(ang[k]),
          ));
          return [oo[0] + d[0], oo[1] + d[1], oo[2] + d[2]];
        })
      : null;
    let oiPts = even ? oiCentre : ooPts.map((oo) => [oo[0] * s, oo[1] * s, oo[2] * s]);

    // Normal: straight down the face normal, point by point. A point that
    // would leave less than `floor` of inner flat moves back toward the
    // middle of the inner face (straightRing), so only the stretch of wall
    // beside a tight edge tilts. Its points then no longer share rays with
    // the inner boundary samples, so that band is zipped by angle instead
    // of paired by index. A face where no straight hole fits keeps Centre.
    /** @type {null | { Bx: Float64Array, By: Float64Array, Px: Float64Array, Py: Float64Array, Qx: Float64Array, Qy: Float64Array, ox: number, oy: number, tris: number[] }} */
    let straight = null;
    let axisTiltDeg = 0;
    let axisCentre = false;
    if (openingAxis === "normal") {
      const Px = new Float64Array(m), Py = new Float64Array(m);
      for (let k = 0; k < m; k++) {
        Px[k] = rad[k] * Math.cos(ang[k]);
        Py[k] = rad[k] * Math.sin(ang[k]);
      }
      // Inner face boundary seen straight down the normal.
      const Bx = new Float64Array(m), By = new Float64Array(m);
      for (let k = 0; k < m; k++) {
        const p = verts[BOr[k] + baseI];
        const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
        Bx[k] = dx * ux + dy * uy + dz * uz;
        By[k] = dx * wx + dy * wy + dz * wz;
      }
      const outerClear = edgeClearances(B2x, B2y, Px, Py);
      const innerClear = edgeClearances(Bx, By, Px, Py);
      const floor = Math.min(NORMAL_MIN_FLAT_MM, 0.5 * Math.min(...outerClear));
      // Inner edges move in linearly with the wall, so each edge stays
      // clear of the opening up to where its clearance reaches the floor.
      for (let k = 0; k < m; k++) {
        const shrink = outerClear[k] - innerClear[k];
        if (shrink > 1e-9 && Number.isFinite(shrink)) {
          straightWallMm = Math.min(straightWallMm, (wallMm * (outerClear[k] - floor)) / shrink);
        }
      }
      const r = floor > 0 ? straightRing(Bx, By, Px, Py, floor) : null;
      const tris = r && zipperBand(Bx, By, r.Qx, r.Qy, r.ox, r.oy);
      if (tris) {
        straight = { Bx, By, Px, Py, ...r, tris };
        const [nx, ny, nz] = frame.normal;
        oiPts = [];
        for (let k = 0; k < m; k++) {
          const qx = r.Qx[k], qy = r.Qy[k];
          // Even walls: the depth the inner face has under this point
          // (the wall, or a little more beside a corner where four or more
          // faces meet). Scaled: the inner plane's depth.
          let depth = (1 - s) * frame.inradius;
          if (even) {
            const d = offsetOf(faceHost(ring, skel2d, qx, qy));
            depth = -(d[0] * nx + d[1] * ny + d[2] * nz);
          }
          oiPts.push([
            cx + qx * ux + qy * wx - depth * nx,
            cy + qx * uy + qy * wy - depth * ny,
            cz + qx * uz + qy * wz - depth * nz,
          ]);
          const move = Math.hypot(qx - Px[k], qy - Py[k]);
          axisTiltDeg = Math.max(axisTiltDeg, (Math.atan2(move, depth) * 180) / Math.PI);
        }
      } else {
        axisCentre = true;
      }
    }

    // Per-face rounding clamp from exact per-ray flat widths + wall lengths.
    // Rim lips are rolling-ball fillets between the face plane and the
    // opening wall. Under Centre the wall follows the origin ray, so on an
    // off-axis face it is NOT perpendicular to the face: the lip angle ω
    // varies per ray and the tangent length is w = r·cot(ω/2) (outer) /
    // r·tan(ω/2) (inner), exactly as Stage 2's dihedral strips. On-axis
    // rays, and straight Normal walls, reduce to the quarter circle.
    /** @type {{ t: number[], d: number[], sin: number, cotO: number, cotI: number, ca: number, sa: number }[]} */
    const lips = [];

    let rFace = 0;
    if (roundingMm > rEps && depth === "hollow") {
      let rMax = roundingMm;
      for (let k = 0; k < m; k++) {
        const oo = ooPts[k];
        const ooLen = Math.hypot(oo[0], oo[1], oo[2]);
        let d, wallLen;
        if (!straight && !even) {
          d = [-oo[0] / ooLen, -oo[1] / ooLen, -oo[2] / ooLen];
          wallLen = ooLen * (1 - s);
        } else {
          const oi = oiPts[k];
          const wv = [oi[0] - oo[0], oi[1] - oo[1], oi[2] - oo[2]];
          wallLen = Math.hypot(wv[0], wv[1], wv[2]);
          d = [wv[0] / wallLen, wv[1] / wallLen, wv[2] / wallLen];
        }
        // Lips run out along the ray from the centre the opening points
        // share: the face centroid, or a straight face's zip centre, so a
        // tilted stretch of wall keeps its lips on the same rays as its
        // opening points and neighbouring lips cannot cross.
        let ca = Math.cos(ang[k]), sa = Math.sin(ang[k]);
        if (straight && (straight.ox !== 0 || straight.oy !== 0)) {
          const rx = straight.Px[k] - straight.ox, ry = straight.Py[k] - straight.oy;
          const rl = Math.hypot(rx, ry);
          ca = rx / rl;
          sa = ry / rl;
        }
        const t = [ca * ux + sa * wx, ca * uy + sa * wy, ca * uz + sa * wz];
        const cosw = Math.max(-1, Math.min(1, t[0] * d[0] + t[1] * d[1] + t[2] * d[2]));
        const sinw = Math.sqrt(Math.max(1 - cosw * cosw, 1e-12));
        const cotO = (1 + cosw) / sinw; // outer lip: face (+t) meets wall (+d)
        const cotI = (1 - cosw) / sinw; // inner lip: face (+t) meets wall (−d)
        lips.push({ t, d, sin: sinw, cotO, cotI, ca, sa });
        const flat = straight
          ? rayToRing(B2x, B2y, straight.Px[k], straight.Py[k], ca, sa)
          : Math.hypot(B2x[k], B2y[k]) - rad[k];
        // Inner flat: s·outer on the origin ray; otherwise measured from the
        // inner opening point to the inner boundary along the same ray (on a
        // straight face, to wherever that ray leaves the inner face).
        let innerBand;
        if (straight) {
          innerBand = 0.95 *
            rayToRing(straight.Bx, straight.By, straight.Qx[k], straight.Qy[k], ca, sa);
        } else if (!even) {
          innerBand = 0.95 * s * flat;
        } else {
          const bi = verts[BOr[k] + baseI], oi = oiPts[k];
          innerBand = 0.95 *
            ((bi[0] - oi[0]) * t[0] + (bi[1] - oi[1]) * t[1] + (bi[2] - oi[2]) * t[2]);
        }
        // Both tangent bands must fit their flats, and the two wall bands
        // together must fit the wall.
        rMax = Math.min(
          rMax,
          (0.95 * flat) / cotO,
          innerBand / cotI,
          0.499 * wallLen * sinw,
        );
      }
      rFace = rMax;
      if (!(rFace > rEps)) rFace = 0;

      // A straight face zips its inner band from the rim's last ring, the
      // opening pushed out along each ray by the inner tangent length. Where
      // that ring would cut a corner of the inner face between samples, the
      // rim radius halves until it fits, or the rim stays sharp.
      if (straight && rFace > 0) {
        const { Qx, Qy, Bx, By, ox, oy } = straight;
        const Fx = new Float64Array(m), Fy = new Float64Array(m);
        let tris = null;
        for (let tries = 0; tries < 4 && !tris; tries++, rFace *= 0.5) {
          for (let k = 0; k < m; k++) {
            const w = rFace * lips[k].cotI;
            Fx[k] = Qx[k] + w * lips[k].ca;
            Fy[k] = Qy[k] + w * lips[k].sa;
          }
          tris = zipperBand(Bx, By, Fx, Fy, ox, oy);
          if (tris) break;
        }
        if (tris && rFace > rEps) straight.tris = tris;
        else rFace = 0;
      }
      // Even walls move the inner boundary and the inner opening by
      // different blends, so on a tiny face the lip's last ring can fit
      // along every ray yet cut the inner edge between samples. The band
      // from that ring to the boundary must keep its winding in the face
      // plane; the radius halves until it does, or the rim stays sharp.
      if (even && !straight && rFace > 0) {
        const proj = (p) => {
          const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
          return [dx * ux + dy * uy + dz * uz, dx * wx + dy * wy + dz * wz];
        };
        const B = BOr.map((v) => proj(verts[v + baseI]));
        const O = oiPts.map(proj);
        let area2 = 0;
        for (let k = 0; k < m; k++) {
          const k2 = (k + 1) % m;
          area2 += B[k][0] * B[k2][1] - B[k2][0] * B[k][1];
        }
        const want = area2 > 0 ? -1 : 1;
        const tol = 1e-12 * Math.abs(area2);
        const turns = (p, q, r) =>
          want * ((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) > tol;
        let tries = 0;
        for (; tries < 4; tries++, rFace *= 0.5) {
          const F = O.map((o, k) => {
            const w = rFace * lips[k].cotI;
            return [o[0] + w * lips[k].ca, o[1] + w * lips[k].sa];
          });
          let ok = true;
          for (let k = 0; k < m && ok; k++) {
            const k2 = (k + 1) % m;
            ok = turns(F[k], F[k2], B[k2]) && turns(F[k], B[k2], B[k]);
          }
          if (ok) break;
        }
        if (tries === 4 || !(rFace > rEps)) rFace = 0;
      }
    }

    /** Inner band of a straight face: boundary A to opening ring B. */
    const zipInner = (A, B) => {
      const nA = A.length;
      const { tris } = straight;
      for (let i = 0; i < tris.length; i += 3) {
        for (let q = 0; q < 3; q++) {
          const v = tris[i + q];
          triIdx.push(v < nA ? A[v] : B[v - nA]);
        }
        faceIds.push(fi);
      }
    };

    const BO = BOr;
    const BI = depth === "hollow" ? BOr.map((v) => v + baseI) : null;

    /** @type {number[]} */
    let OO = [];
    /** @type {number[]} */
    let OI = [];

    if (rFace > rEps) {
      // Stage-1 rim roundovers: OO/OI are virtual; emit arc rings instead.
      const J = roundingSegmentsFor(edgeDiv);

      // Outer arc rings F_out … W_top (j = 0..J); inner W_bot … F_in.
      /** @type {number[][]} */
      const outerRings = Array.from({ length: J + 1 }, () => []);
      /** @type {number[][]} */
      const innerRings = Array.from({ length: J + 1 }, () => []);
      for (let k = 0; k < m; k++) {
        const oo = ooPts[k];
        const { t, d } = lips[k];
        // Outer lip: from the face (along +t) round to the wall (along +d).
        const outer = lipArc(oo, t, d, rFace, J);
        // Inner lip at OI: from the wall (along −d) round to the inner
        // face (along +t), so j = 0 is W_bot and j = J is F_in.
        const inner = lipArc(oiPts[k], [-d[0], -d[1], -d[2]], t, rFace, J);
        for (let j = 0; j <= J; j++) {
          outerRings[j].push(verts.length);
          verts.push(outer[j]);
          innerRings[j].push(verts.length);
          verts.push(inner[j]);
        }
      }

      // Chain: BO → F_out → arcs → W_top → W_bot → arcs → F_in → BI.
      // Outer j=0 is F_out, j=J is W_top; inner j=0 is W_bot, j=J is F_in
      // (same θ formula — do not reverse inner rings).
      /** @type {number[][]} */
      const chain = straight
        ? [BO, ...outerRings, ...innerRings]
        : [BO, ...outerRings, ...innerRings, BI];

      for (let b = 0; b < chain.length - 1; b++) {
        const R0 = chain[b];
        const R1 = chain[b + 1];
        for (let k = 0; k < m; k++) {
          const k2 = (k + 1) % m;
          pushQuad(triIdx, faceIds, R0[k], R0[k2], R1[k2], R1[k], fi);
        }
      }
      if (straight) zipInner(BI, innerRings[J]);
    } else {
      // Byte-identity path: push OO/OI and the original three bands verbatim.
      for (let k = 0; k < m; k++) {
        OO.push(verts.length);
        verts.push(ooPts[k]);
      }
      if (depth === "hollow") {
        for (let k = 0; k < m; k++) {
          OI.push(verts.length);
          verts.push(oiPts[k]);
        }
      }
      for (let k = 0; k < m; k++) {
        const k2 = (k + 1) % m;
        pushQuad(triIdx, faceIds, BO[k], BO[k2], OO[k2], OO[k], fi);
        if (depth === "hollow") {
          if (!straight) pushQuad(triIdx, faceIds, BI[k2], BI[k], OI[k], OI[k2], fi);
          pushQuad(triIdx, faceIds, OO[k], OO[k2], OI[k2], OI[k], fi);
        }
      }
      if (straight) zipInner(BI, OI);
    }

    faceMetrics.push({
      faceIndex: fi,
      sides: ring.length,
      borderMinMm,
      borderMaxMm,
      filletUsedMm: radiusUsed,
      roundingUsedMm: rFace,
      openingMinDiameterMm: 2 * minR,
      axisTiltDeg,
      axisCentre,
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

  let positions = new Float64Array(outVerts.length * 3);
  for (let i = 0; i < outVerts.length; i++) {
    positions[i * 3] = outVerts[i][0];
    positions[i * 3 + 1] = outVerts[i][1];
    positions[i * 3 + 2] = outVerts[i][2];
  }
  let indices = new Uint32Array(outTris);
  let triFaces = new Uint32Array(faceIds);
  let looseDropped = 0, looseVolume = 0;
  if (through) {
    ({ positions, indices, faceIds: triFaces, dropped: looseDropped, droppedVolume: looseVolume } =
      subtractAll({ positions, indices, faceIds: triFaces }, cutters, { keepLargest: breakOut }));
  }
  const mesh = toMesh(positions, indices, triFaces);
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
      // Normal openings whose wall tilts somewhere (beside a tight inner
      // edge) or that keep Centre because no straight hole fits their inner
      // face; the worst tilt; and the thickest wall at which every opening
      // goes straight. All null unless the axis is Normal.
      axisLeanFaces: normalAxis
        ? faceMetrics.filter((f) => f.axisCentre || f.axisTiltDeg > AXIS_TILT_REPORT_DEG).length
        : null,
      axisCentreFaces: normalAxis ? faceMetrics.filter((f) => f.axisCentre).length : null,
      axisTiltMaxDeg: normalAxis
        ? faceMetrics.reduce((a, f) => Math.max(a, f.axisTiltDeg), 0)
        : null,
      normalStraightWallMm: normalAxis && Number.isFinite(straightWallMm) ? straightWallMm : null,
      // Through openings whose hole reaches past their own inner face.
      throughSpillFaces: through ? throughSpillFaces : null,
      // Through faces too small to open (kept closed).
      throughClosedFaces: through ? throughClosedFaces : null,
      // Break out: holes that cut through a neighbour's outside, and loose
      // pieces those cuts freed (dropped from the mesh).
      throughBreakOutFaces: through ? throughBreakOutFaces : null,
      looseDropped: through ? looseDropped : null,
      looseVolumeMm3: through ? looseVolume : null,
      wall: !(depth === "hollow")
        ? { min: null, max: null }
        : even
          ? scaleRange(offsetWallRange(skeleton, frames, dHat), wallMm)
          : { min: inradius.min * (1 - s), max: inradius.max * (1 - s) },
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

function scaleRange({ min, max }, k) {
  return { min: min * k, max: max * k };
}

function pushQuad(triIdx, faceIds, p0, p1, p2, p3, fi) {
  triIdx.push(...quadToTris(p0, p1, p2, p3));
  faceIds.push(fi, fi);
}
