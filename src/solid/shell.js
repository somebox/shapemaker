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
import { inscribedMomentEllipse, ellipseMinorAxis, ellipsePolyline } from "../geom/ellipse.js";
import {
  radialSample, quadToTris, edgeClearances, rayToRing, straightRing, zipperBand,
} from "../geom/annulus.js";
import { edgeList, inradiusRange } from "../skeleton.js";
import {
  cornerOffsets, evenWallFit, evenWallLimits, meanValueWeights, offsetWallRange,
} from "./offset.js";
import { faceFrames } from "../faceframe.js";
import { assertMeshInvariants, toMesh } from "../mesh.js";
import { validationError } from "../validate.js";
import { buildEdgeRounding } from "./edgeround.js";
import { subtractAll } from "./csg.js";
import { polysNear, surfacePolys, throughCutter, throughDepth } from "./through.js";

/**
 * A hole generator works purely in face-local 2D. Adding `circle` or `mirror`
 * (v1.1) means adding one of these — the solidifier does not change.
 * `minWidth` is the opening's narrowest width in mm, given where it is not
 * the inset polygon's: the floor on openings is checked against it too.
 * @typedef {{
 *   generate: (faceCorners2d: Float64Array, borderFraction: number, filletMm: number, filletSegments?: number) =>
 *     { opening: Float64Array, radiusUsed: number, minWidth?: number }
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
 * Openings narrower than this stay closed: nothing that small prints, and
 * the two sides of a slot a few microns wide end up crossing (as walls
 * under Even, where each leans its own way, or as cutter contacts under
 * Through).
 */
const OPENING_MIN_MM = 0.2;

/**
 * Inner flat a Normal opening keeps along every inner edge (about one
 * extrusion width), capped at half the outer border so a thin border on a
 * thin wall still goes straight. Rounding does not raise it: a straight
 * wall wins, and the rim radius shrinks to the inner flat that is left.
 */
const NORMAL_MIN_FLAT_MM = 0.4;

/**
 * Even walls: how many times the inner copy of a corner's rounding may
 * halve to fit its inner faces (down to 1/64 of its size).
 */
const INNER_FIT_HALVINGS = 6;

/**
 * Even walls: how far the inner boundary ring may stand off the inner
 * face, as rise over the width of the band between it and the opening,
 * before the inner rounding there is drawn in. A corner's inner position is
 * a best fit where four or more faces meet, so an inner face can tilt; a
 * strip end copied flat then sits above or below it, and an opening wall
 * beside a band that steep passes through it.
 */
const INNER_BAND_RISE = 0.1;

/** Normal openings tilting less than this count as straight in reports. */
const AXIS_TILT_REPORT_DEG = 1;

/**
 * Rim-roundover and dihedral-strip arc segments from edgeDiv and optional
 * subtended arc length (mm). Draft 2 / Normal 3 / Fine 6 at small radii,
 * scaling up to 12 on wide fillets so large roundovers stay smooth under
 * flat shading.
 * @param {number} edgeDiv
 * @param {number} [arcMm]
 */
export function roundingSegmentsFor(edgeDiv, arcMm = 0) {
  const base = Math.max(2, Math.round(edgeDiv * 0.3));
  if (!(arcMm > 0)) return base;
  return Math.min(12, Math.max(base, Math.round((arcMm * edgeDiv) / 8)));
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
      // The ellipse lies inside the inset polygon, so it can be narrower
      // than the polygon's width where that one passes the opening floor.
      minWidth: ellipseMinorAxis(e, 1 - borderFraction),
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
    soften = 0,
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
  let dHat = null;
  if (even) {
    const plain = cornerOffsets(skeleton, frames);
    const fit = evenWallFit(skeleton, frames, wallMm, plain);
    if (!fit.ok) {
      // Offer the wall the Wall slider stops at, and name the wall from
      // which walls are refused, with its cause. The limit this wall ran
      // into is neither: sliver faces move as one from some wall on, so
      // the limits at 20 mm say little about where a wall first fails.
      let limits = evenWallLimits(skeleton, frames, plain);
      if (!(limits.ceiling < wallMm)) limits = evenWallLimits(skeleton, frames, plain, wallMm);
      let first = evenWallFit(skeleton, frames, limits.refusedFrom, plain);
      if (first.ok) first = evenWallFit(skeleton, frames, limits.refusedFrom * 1.002, plain);
      if (first.ok) first = fit;
      const beyond = `beyond ${limits.refusedFrom.toFixed(2)} mm on this shape`;
      throw validationError(
        "solid",
        "wallMm",
        first.cause === "face"
          ? `Wall ${wallMm} mm is too thick — a face turns inside out ${beyond}`
          : `Wall ${wallMm} mm is too thick — inner edges fold over ${beyond}`,
        first.cause === "face"
          ? { clampTo: limits.ceiling, faceIds: [first.face] }
          : { clampTo: limits.ceiling },
      );
    }
    dHat = fit.dHat;
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
  const smoothFrac = Math.min(1, Math.max(0, (soften ?? 0) / 100));
  const smoothActive = smoothFrac > 1e-6 && !skeleton.macroFaceId;
  const stage2Active = roundingActive || smoothActive;

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
  if (!stage2Active && !through) {
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
  if (stage2Active) {
    /** allowance per (face, edgeKey): share of the flat this face can give */
    const allow = new Map();
    const smoothAllow = new Map();
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
      // On hollow Even walls, inner corners shift inward by wallMm·dHat,
      // narrowing the inner face near convex ridges; bound Smooth's form
      // fillet by the smaller of outer and inner edge distances so the
      // inner face ring never collapses.
      let innerDists = null;
      if (smoothActive && depth === "hollow" && even) {
        const [cx, cy, cz] = frame.origin;
        const [ux, uy, uz] = frame.u;
        const [wx, wy, wz] = frame.w;
        const pts2 = ring.map((v) => {
          const px = corners[v * 3] + wallMm * dHat[v * 3] - cx;
          const py = corners[v * 3 + 1] + wallMm * dHat[v * 3 + 1] - cy;
          const pz = corners[v * 3 + 2] + wallMm * dHat[v * 3 + 2] - cz;
          return [px * ux + py * uy + pz * uz, px * wx + py * wy + pz * wz];
        });
        innerDists = pts2.map((pa, k) => {
          const pb = pts2[(k + 1) % pts2.length];
          const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
          return Math.max(0, (pa[0] * pb[1] - pa[1] * pb[0]) / len);
        });
      }
      for (let k = 0; k < ring.length; k++) {
        const key = edgeKey(ring[k], ring[(k + 1) % ring.length]);
        const width = frame.edgeDist[k];
        const boundW = innerDists
          ? Math.min(width, innerDists[k])
          : depth === "hollow" && !even
            ? Math.min(width, s * width)
            : width;
        const aRound = roundingActive
          ? (openings ? 0.6 * frac * width : 0.80 * width)
          : 0;
        const aSmooth = smoothActive
          ? smoothFrac * (openings ? 0.88 * frac : 0.80) * boundW
          : 0;
        const prevR = allow.get(key);
        allow.set(key, prevR == null ? aRound : Math.min(prevR, aRound));
        const prevS = smoothAllow.get(key);
        smoothAllow.set(key, prevS == null ? aSmooth : Math.min(prevS, aSmooth));
      }
    }
    const baseSegs = smoothActive
      ? Math.max(roundingSegmentsFor(edgeDiv), Math.round(4 + 8 * smoothFrac))
      : roundingSegmentsFor(edgeDiv);
    stage2 = buildEdgeRounding(skeleton, frames, {
      radiusForEdge: () => (roundingActive ? roundingMm : 0),
      // Band-width budget: in-plane tangency width w = r·cot(ω/2) must fit
      // both adjacent faces' allowances.
      allowForEdge: (key) => allow.get(key) ?? 0,
      smoothAllowForEdge: smoothActive
        ? (key) => smoothAllow.get(key) ?? 0
        : undefined,
      roundValleys: smoothActive,
      segments: baseSegs,
      lengthwise: ts,
      pushVert: (x, y, z, host) => {
        verts.push([x, y, z]);
        if (even) hosts.push(host);
        return verts.length - 1;
      },
      getVert: (i) => verts[i],
      getHost: (i) => hosts[i],
    });
  }

  // Through builds the inner surface on its own: a copy of the rounded outer
  // surface would round the cavity's ridges with the full radius, leaving
  // material along them that is thicker than the wall and that the cutters
  // trim into loose slivers. The surface a wall's thickness inside a ridge
  // rounded by r ≤ wall is the sharp ridge of the inner planes.
  const sharpInner = through && stage2 !== null && depth === "hollow" && stage2.radiusMax <= wallMm;

  // Even walls copy the rounding to the inner shell with each corner's
  // strip ends, inset corners and cap moving as one with the corner.
  // `innerFit` draws a corner's inner copy in towards the corner where the
  // inner faces are too small for it (1 = full size; set by the inner-fit
  // pass below).
  /** @type {Float64Array|null} */
  let innerFit = null;
  const innerCopy = (i) => {
    const host = hosts[i];
    const d = offsetOf(host);
    const p = [verts[i][0] + d[0], verts[i][1] + d[1], verts[i][2] + d[2]];
    if (innerFit) {
      for (const [v, wgt, rx, ry, rz] of host) {
        const k = innerFit[v];
        if (k === 1 || wgt === 0) continue;
        // A blended point carries the place of each end's own point; one
        // that moves with a single corner sits where it is relative to it.
        let x, y, z;
        if (rx !== undefined) {
          x = rx; y = ry; z = rz;
        } else if (host.length === 1) {
          x = verts[i][0] - corners[v * 3];
          y = verts[i][1] - corners[v * 3 + 1];
          z = verts[i][2] - corners[v * 3 + 2];
        } else {
          continue;
        }
        const pull = wgt * (k - 1);
        p[0] += pull * x; p[1] += pull * y; p[2] += pull * z;
      }
    }
    return p;
  };

  const nOuter = verts.length;
  const baseO = 0;
  let baseI = -1;
  if (depth === "hollow") {
    baseI = verts.length;
    for (let i = 0; i < nOuter; i++) {
      if (even) {
        verts.push(innerCopy(i));
      } else {
        verts.push([verts[i][0] * s, verts[i][1] * s, verts[i][2] * s]);
      }
    }
  }

  /** Skeleton corners of a face in its own frame (flat xy). */
  const skelFlat = (fi) => {
    const ring = faces[fi];
    const [cx, cy, cz] = frames[fi].origin;
    const [ux, uy, uz] = frames[fi].u;
    const [wx, wy, wz] = frames[fi].w;
    const out = new Float64Array(ring.length * 2);
    for (let k = 0; k < ring.length; k++) {
      const v = ring[k];
      const dx = corners[v * 3] - cx, dy = corners[v * 3 + 1] - cy, dz = corners[v * 3 + 2] - cz;
      out[k * 2] = dx * ux + dy * uy + dz * uz;
      out[k * 2 + 1] = dx * wx + dy * wy + dz * wz;
    }
    return out;
  };

  /**
   * A face's opening laid out on the outer surface: the boundary ring in
   * the face frame, its rays from the centroid, and the opening sampled
   * along them. Nothing here depends on the inner shell. A face that
   * stays closed says why in `closed`: "narrow" (the opening would be
   * under the floor) or "rounding" (the rounded outline leaves it no room).
   * @param {number} fi
   * @param {number[]} BOr  boundary ring (outer vert indices)
   */
  const layoutFace = (fi, BOr) => {
    const ring = faces[fi];
    const frame = frames[fi];
    const [cx, cy, cz] = frame.origin;
    const [ux, uy, uz] = frame.u;
    const [wx, wy, wz] = frame.w;
    const frac = borderMm != null ? borderMm / frame.edgeDistMin : borderFraction;
    const m = BOr.length;

    const B2x = new Float64Array(m);
    const B2y = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const p = verts[BOr[k]];
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      B2x[k] = dx * ux + dy * uy + dz * uz;
      B2y[k] = dx * wx + dy * wy + dz * wz;
    }

    const ang = new Float64Array(m);
    for (let k = 0; k < m; k++) ang[k] = Math.atan2(B2y[k], B2x[k]);

    // A face with no room for its opening stays closed. On a needle face
    // (Subdivide or Truncate on a distorted shape leaves triangles tens of
    // millimetres long and a fraction wide) the corner rounding can move
    // the outline off the centroid the opening is laid out around, or dent
    // it so that the centroid no longer sees all of it; and an opening can
    // be too narrow to be one.
    let area2 = 0;
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      area2 += B2x[k] * B2y[k2] - B2x[k2] * B2y[k];
    }
    /** Which way the outer ring winds in the face frame. */
    const turn = area2 < 0 ? -1 : 1;
    // Too narrow comes first: such a face stays closed whatever its
    // rounding does. Through sides too: the cutter's own check further
    // down samples the opening at a few angles and can read a narrow one
    // a few percent wide.
    if (2 * (1 - frac) * frame.edgeDistMin < OPENING_MIN_MM) {
      return { B2x, B2y, ang, turn, closed: "narrow" };
    }

    // The authored opening derives from the ORIGINAL face corners — Smooth and
    // Rounding fillet the outer form and border without contracting the opening.
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

    let { opening, radiusUsed, minWidth } = openingGenerator.generate(
      corner2d,
      frac,
      filletMm,
      filletSegmentsFor(edgeDiv),
    );
    // The floor above measures the inset polygon. An opening that says it
    // is narrower than that (an ellipse on a long face) is held to it too,
    // and before the outline is looked at: less rounding cannot open it.
    if (minWidth < OPENING_MIN_MM) return { B2x, B2y, ang, turn, closed: "narrow" };
    // The opening and its band are laid out along rays from the centroid,
    // so it must see every edge of the outline, not merely lie inside it:
    // an edge that runs backwards seen from there folds the band.
    if (stage2 && !fansFrom(Array.from(B2x, (x, k) => [x, B2y[k]]), FRAME_ORIGIN, turn)) {
      return { B2x, B2y, ang, turn, closed: "rounding" };
    }

    // Sample the opening along the same rays as the boundary points: both
    // rings are convex and contain the centroid, so the rays are in strict
    // angular order and consecutive rays bound exactly one quad.
    /** The inset polygon itself, whatever the opening style. */
    const bareInset = () => insetFillet.generate(corner2d, frac, 0, 1).opening;
    /** The same opening without its fillet, sampled. */
    const unfilleted = () => {
      ({ opening, radiusUsed } = openingGenerator.generate(corner2d, frac, 0, 1));
      return radialSample(opening, ang);
    };
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
      rad = unfilleted();
    }
    // Short of excluding the centroid, such a fillet draws the opening's
    // rim up to it: the opening is then off the point it is laid out
    // around, and can be narrower than the floor its unfilleted outline
    // passed. Within half the floor of the centroid, the fillet goes too.
    // (Through sides emit another rim, the cutter, and check that one.)
    if (!through && radiusUsed > 0 && 2 * rimClearance(rad, ang) < OPENING_MIN_MM) {
      rad = unfilleted();
    }
    // An ellipse is built from its samples too, joined by straight
    // segments. Where the rays are few across a sliver (a long edge with
    // points at its ends only), a segment cuts straight across the ellipse
    // and the opening comes out a fraction of its width. Such a face takes
    // the bare inset instead, whose straight edges are built exactly.
    if (!through && 2 * rimClearance(rad, ang) < OPENING_MIN_MM) {
      opening = bareInset();
      radiusUsed = 0;
      rad = radialSample(opening, ang);
    }
    // ... or reach past the outline the rounding leaves it.
    if (stage2 && !through) {
      for (let k = 0; k < m; k++) {
        if (!(rad[k] < Math.hypot(B2x[k], B2y[k]))) {
          return { B2x, B2y, ang, turn, closed: "rounding" };
        }
      }
    }
    // The floor, last, on the rim that is built: the measures further up
    // are of the exact outline, and even the bare inset's samples can cut
    // across a corner the rays miss.
    if (!through && 2 * rimClearance(rad, ang) < OPENING_MIN_MM) {
      return { B2x, B2y, ang, turn, closed: "narrow" };
    }
    let minR = Infinity;
    /** @type {number[][]} virtual outer-lip corners (not always pushed) */
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
    return { B2x, B2y, ang, turn, opening, radiusUsed, rad, minR, ooPts, bareInset };
  };
  /** Layouts the inner-fit pass already made, for the face loop to reuse. */
  const layouts = new Array(faces.length);

  /** A point in a face's frame: x, y in its plane, z along its normal. */
  const flatOf = (fi) => {
    const [cx, cy, cz] = frames[fi].origin;
    const [ux, uy, uz] = frames[fi].u;
    const [wx, wy, wz] = frames[fi].w;
    const [nx, ny, nz] = frames[fi].normal;
    return (p) => {
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      return [
        dx * ux + dy * uy + dz * uz,
        dx * wx + dy * wy + dz * wz,
        dx * nx + dy * ny + dz * nz,
      ];
    };
  };

  /**
   * Faces a repair could not fit: an inner band that still folds or stands
   * off its face after the last halving, an inner opening neither layout
   * holds, or a closed face no point can be fanned from. They are built as
   * they are, counted and reported: they may pass through their neighbours.
   */
  const unfit = new Set();
  /**
   * Open faces whose inner band still folds against the Centre opening
   * after the last halving, but sits on its face. The face loop lays their
   * inner opening out along the inner ring's own rays, and reports them
   * only if that fails too.
   */
  const folded = new Set();

  /**
   * Even walls, Centre: the opening carried to the inner face by the
   * corner-weighted offset, as the face itself is.
   */
  const carryInner = (ring, skel2d, { ooPts, rad, ang }) =>
    ooPts.map((oo, k) => {
      const d = offsetOf(faceHost(
        ring, skel2d, rad[k] * Math.cos(ang[k]), rad[k] * Math.sin(ang[k]),
      ));
      return [oo[0] + d[0], oo[1] + d[1], oo[2] + d[2]];
    });

  /**
   * Even walls: the opening laid out along the inner ring's own rays, each
   * point as far from the inner face's centre towards its ring point as
   * the outer opening is along its ray. It follows the ring wherever the
   * inner face has moved, tilted or changed shape.
   */
  const alongInnerRays = (fi, BOr, skel2d, { rad, B2x, B2y }) => {
    const [cx, cy, cz] = frames[fi].origin;
    const d0 = offsetOf(faceHost(faces[fi], skel2d, 0, 0));
    const c = [cx + d0[0], cy + d0[1], cz + d0[2]];
    return BOr.map((v, k) => {
      const b = verts[v + baseI];
      const f = rad[k] / Math.hypot(B2x[k], B2y[k]);
      return [
        c[0] + f * (b[0] - c[0]),
        c[1] + f * (b[1] - c[1]),
        c[2] + f * (b[2] - c[2]),
      ];
    });
  };

  // Even walls: fit the inner copy of the rounding to the inner faces. They
  // are smaller than the outer ones, and under a thick wall a tiny face
  // (what Truncate leaves of a vertex) can be a third of its outer size or
  // badly out of shape. Strips trimmed for the outer edge then overlap on
  // the inner one, and strips sized for the outer border reach past the
  // inner opening. Each face's inner band is checked before it is built:
  // against the opening as Centre lays it out (for Straight sides too,
  // whose own layout comes later and differs a little), or against the
  // fan of a face that stays closed. Where the band folds, or its ring
  // stands off a tilted inner face, the inner rounding at the corners that
  // stretch moves with halves, towards the sharp inner corner a shape
  // without Rounding has. A last check follows the last halving; what
  // still fails is reported. The outer surface is not involved, and shapes
  // whose inner faces all hold are untouched.
  if (stage2 && even && !sharpInner) {
    const fit = new Float64Array(nCorners).fill(1);
    for (let pass = 0; ; pass++) {
      const tight = new Set();
      const faulty = [];
      for (let fi = 0; fi < faces.length; fi++) {
        const ring = faces[fi];
        const BOr = stage2.faceRings.get(fi);
        const m = BOr.length;
        const [cx, cy, cz] = frames[fi].origin;
        const [ux, uy, uz] = frames[fi].u;
        const [wx, wy, wz] = frames[fi].w;
        const flat = flatOf(fi);
        const B = BOr.map((v) => flat(verts[v + baseI]));
        const lay = openings ? (layouts[fi] ??= layoutFace(fi, BOr)) : null;
        const open = lay && !lay.closed && !through;
        // The inner ring must wind as the outer one does: a ring the
        // strips have turned over would pass a test against itself.
        const Bo = open ? null : BOr.map((v) => flat(verts[v]));
        const turn = lay ? lay.turn : ringArea2(Bo) < 0 ? -1 : 1;
        const [mx, my] = (open ? null : fanPoint(Bo, turn)) ?? FRAME_ORIGIN;
        const d0 = offsetOf(faceHost(ring, skelFlat(fi), mx, my));
        const c = flat([
          cx + mx * ux + my * wx + d0[0],
          cy + mx * uy + my * wy + d0[1],
          cz + mx * uz + my * wz + d0[2],
        ]);
        let faults, leaning = false;
        if (open) {
          lay.oiCentre ??= carryInner(ring, skelFlat(fi), lay);
          const O = lay.oiCentre.map(flat);
          faults = bandFaults(B, O, false, turn);
          // The inner face's own slope along each ray is that of the
          // opening, which is carried by the corner weights; the band
          // should carry on at it.
          for (let k = 0; k < m; k++) {
            const run = Math.hypot(O[k][0] - c[0], O[k][1] - c[1]);
            const band = Math.hypot(B[k][0] - O[k][0], B[k][1] - O[k][1]);
            if (!(run > 0) || !(band > 0)) continue;
            const tilt = (O[k][2] - c[2]) / run;
            const rise = (B[k][2] - O[k][2]) / band;
            if (Math.abs(rise - tilt) > INNER_BAND_RISE) {
              faults.push(k);
              leaning = true;
            }
          }
        } else {
          // Closed (and Through, which cuts later): a fan from the middle.
          faults = bandFaults(B, c, true, turn);
        }
        if (faults.length) faulty.push({ fi, leaning });
        for (const k of faults) {
          for (const v of [BOr[k], BOr[(k + 1) % m]]) {
            for (const [corner, wgt] of hosts[v]) if (wgt > 0) tight.add(corner);
          }
        }
      }
      // What is left after the last halving is built as it is. A ring that
      // stands off its inner face is reported here: no layout of the
      // opening changes that. A band that only folds may yet be laid out
      // along the ring's own rays, and is reported if that fails. (A
      // closed face is reported by `closeFace`, which may yet fan it from
      // another point.)
      if (tight.size === 0 || pass === INNER_FIT_HALVINGS) {
        for (const { fi, leaning } of faulty) {
          const lay = layouts[fi];
          if (!lay || lay.closed || through) continue;
          if (leaning) unfit.add(fi);
          else folded.add(fi);
        }
        break;
      }
      for (const corner of tight) fit[corner] *= 0.5;
      innerFit = fit;
      for (let i = 0; i < nOuter; i++) verts[baseI + i] = innerCopy(i);
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
  /** Those of them the rounded outline, not a small opening, keeps closed. */
  let throughClosedByRounding = 0;
  /** Faces with no room for their opening (Centre and Straight sides). */
  let closedFaces = 0;
  /** Those of them the rounded outline, not a narrow opening, keeps closed. */
  let closedByRounding = 0;
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
    const skel2d = even ? skelFlat(fi) : null;

    const closeFace = () => {
      // Fan from a dedicated face-centre vertex, never from a corner: two
      // faces sharing a corner would emit the same directed diagonal from it,
      // which is a manifold violation (caught by assertMeshInvariants).
      // The vertex sits at the centroid, or at the outline's own mean point
      // where the centroid cannot see all of the outline (the corner
      // rounding can move a needle face's outline off it).
      const flat = flatOf(fi);
      const Bo = BOr.map((v) => flat(verts[v]));
      const turn = ringArea2(Bo) < 0 ? -1 : 1;
      const mid = fanPoint(Bo, turn);
      if (!mid) unfit.add(fi);
      const [mx, my] = mid ?? [0, 0];
      const at = mx !== 0 || my !== 0
        ? [cx + mx * ux + my * wx, cy + mx * uy + my * wy, cz + mx * uz + my * wz]
        : [cx, cy, cz];
      const cOuter = verts.length;
      verts.push(at);
      for (let k = 0; k < m; k++) {
        triIdx.push(cOuter, BOr[k], BOr[(k + 1) % m]);
        faceIds.push(fi);
      }
      if (depth === "hollow") {
        // The inner vertex is the outer one carried in with the face. On a
        // needle face the inner outline can have moved off that point too;
        // then its own mean point is used, if that one sees all of it.
        const inner = sharpInner ? ring : BOr;
        const Bi = inner.map((v) => flat(verts[v + baseI]));
        let ci;
        if (even) {
          const d = offsetOf(faceHost(ring, skel2d, mx, my));
          ci = [at[0] + d[0], at[1] + d[1], at[2] + d[2]];
        } else {
          ci = [at[0] * s, at[1] * s, at[2] * s];
        }
        if (bandFaults(Bi, flat(ci), true, turn).length) {
          const mean = [0, 0, 0];
          for (const v of inner) {
            const p = verts[v + baseI];
            mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2];
          }
          for (let a = 0; a < 3; a++) mean[a] /= inner.length;
          if (bandFaults(Bi, flat(mean), true, turn).length === 0) ci = mean;
          else unfit.add(fi);
        }
        const cInner = verts.length;
        verts.push(ci);
        for (let k = 0; k < inner.length; k++) {
          triIdx.push(cInner, inner[(k + 1) % inner.length] + baseI, inner[k] + baseI);
          faceIds.push(fi);
        }
      }
    };
    if (!openings) {
      closeFace();
      continue;
    }

    const lay = layouts[fi] ?? layoutFace(fi, BOr);
    layouts[fi] = undefined;
    if (lay.closed) {
      closeFace();
      if (through) {
        throughClosedFaces++;
        if (lay.closed === "rounding") throughClosedByRounding++;
      } else {
        closedFaces++;
        if (lay.closed === "rounding") closedByRounding++;
      }
      faceMetrics.push({
        faceIndex: fi,
        sides: ring.length,
        borderMinMm,
        borderMaxMm,
        filletUsedMm: 0,
        roundingUsedMm: 0,
        openingMinDiameterMm: 0,
        axisTiltDeg: 0,
        axisCentre: false,
      });
      continue;
    }
    const { B2x, B2y, ang, rad, ooPts } = lay;
    let { minR, opening, radiusUsed } = lay;

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
      let radT = radialSample(opening, angT);
      // The cutter is the rim Through emits: where a fillet or a thinly
      // sampled ellipse brings it within half the floor of the centroid,
      // the face takes the bare inset, as in `layoutFace`.
      if (2 * rimClearance(radT, angT) < OPENING_MIN_MM) {
        opening = lay.bareInset();
        radiusUsed = 0;
        radT = radialSample(opening, angT);
      }
      const Px = new Float64Array(M), Py = new Float64Array(M);
      for (let k = 0; k < M; k++) {
        Px[k] = radT[k] * Math.cos(angT[k]);
        Py[k] = radT[k] * Math.sin(angT[k]);
      }
      minR = Math.min(...radT);
      // Microscopic faces (heavy Truncate leaves ~0.1 mm squares) stay
      // closed: a cutter that small cannot print and only leaves contacts
      // the boolean resolves into zero-area triangles. Measured on the
      // cutter's edges, as the other Sides settings measure their rim.
      if (2 * rimClearance(radT, angT) < OPENING_MIN_MM) {
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
      // Each ray caps how deep the cutter may end without coming out
      // anywhere (`keep`):
      // - a ray across the cavity at its far side (tOut), so the end stays
      //   in free space;
      // - a ray that only grazes the cavity (the rim over an inner edge, a
      //   sliver of cavity inside a spike) can't hold the end, so the cutter
      //   may run on into the far wall while half a wall stays before the
      //   outside;
      // - a ray through wall only at the neighbour's outside (tExit).
      // Break out drops the last two (`brk`).
      const thin = 0.05 * wallMm;
      const keepMm = 0.5 * wallMm;
      const probe = (only) => {
        const r = {
          entries: [], deepest: -Infinity, tExit: Infinity,
          keep: { stop: Infinity, atExit: false, exitFace: -1 },
          brk: Infinity,
        };
        for (const p of samples) {
          const hit = throughDepth(p, frame.normal, innerPolys, outerPolys, fi, only);
          r.tExit = Math.min(r.tExit, hit.tExit);
          let cap = hit.tExit;
          if (hit.tIn < hit.tExit) {
            const grazes = hit.tOut - hit.tIn < thin;
            r.entries.push({ t: hit.tIn, own: hit.inFace === fi, grazes });
            r.deepest = Math.max(r.deepest, hit.tIn);
            cap = grazes ? hit.tExit - keepMm : hit.tOut;
            if (!grazes) r.brk = Math.min(r.brk, hit.tOut);
          }
          if (cap < r.keep.stop) {
            r.keep = { stop: cap, atExit: cap !== hit.tOut, exitFace: hit.exitFace };
          }
        }
        return r;
      };
      // Nearby faces first; a cutter reaching past them retests against all.
      const reach = 4 * (wallMm + roundingMm);
      let pr = probe(polysNear(outerPolys, outerPolys[fi].c, outerPolys[fi].r, reach));
      if (!(pr.deepest + wallMm + roundingMm < reach)) pr = probe();
      // The cutter ends past every entry it opens. It opens as deep as the
      // cap leaves room for; rays that reach the cavity only deeper, through
      // a neighbour's wall, keep a floor, as parts over solid wall do. It
      // must at least open through the face's own wall.
      const own = pr.entries.filter((e) => e.own).map((e) => e.t);
      const lo = own.length ? Math.max(...own) : Math.min(...pr.entries.map((e) => e.t));
      const levels = [...new Set(pr.entries.map((e) => e.t))]
        .filter((t) => t >= lo)
        .sort((a, b) => b - a);
      /** Deepest level (or shallowest, with `shallow`) that has room before `stop`. */
      const choose = (stop, shallow = false) => {
        for (let j = 0; j < levels.length; j++) {
          const i = shallow ? levels.length - 1 - j : j;
          const room = Math.min(stop, i > 0 ? levels[i - 1] : Infinity) - levels[i];
          if (room > thin) return { level: levels[i], room };
        }
        return null;
      };
      let sel = choose(pr.keep.stop);
      // Even its own wall can't open without coming out somewhere: break
      // out, as shallow as opens the hole, past the cavity's far side if
      // need be. Deeper cuts only notch more of the neighbours.
      let forced = false;
      if (!sel && breakOut && levels.length) {
        sel = choose(pr.brk, true) ?? { level: lo, room: 0 };
        forced = true;
      }
      if (!sel) {
        const pierces = !breakOut && levels.length > 0 && pr.keep.atExit && pr.keep.exitFace >= 0;
        throw validationError(
          "solid",
          pierces ? "openingAxis" : "wallMm",
          pierces
            ? "Through sides would come out through a neighbouring face — " +
              "turn on Break out (Advanced), or set Sides to Straight, a thinner Wall or a wider Border"
            : `Wall ${wallMm} mm is too thick for Through sides — a hole ` +
              "would not open into the inside",
          pierces
            ? { clampTo: "normal", faceIds: [fi, pr.keep.exitFace] }
            : { faceIds: [fi] },
        );
      }
      const opened = pr.entries.filter((e) => e.t <= sel.level);
      const grazed = opened.some((e) => e.grazes);
      const spill = opened.some((e) => !e.own);
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
      // Halfway into the room before the next cap, at most a wall (and
      // rounding) past the entry. Past a grazed ray, or breaking out, the
      // end sits in a wall: keep that notch to a quarter wall.
      const depthMm = sel.level + jig * (sel.room > thin
        ? Math.min(0.5 * sel.room, wallMm + roundingMm, grazed || forced ? 0.25 * wallMm : Infinity)
        : 0.25 * wallMm);
      if (depthMm > pr.tExit) throughBreakOutFaces++;
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
    const oiCentre = even ? (lay.oiCentre ?? carryInner(ring, skel2d, lay)) : null;
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

    // Even walls carry the boundary ring and the opening to the inner face
    // by different blends of the corner offsets. On a sliver face, or a
    // small one whose inner face has shrunk under the Stage-2 strips, the
    // two fall out of step: the inner opening reaches past the inner ring,
    // or a band triangle from the ring lies across the opening. The inner
    // band must keep its winding in the face plane. Where it does not, the
    // inner opening follows the inner ring's own rays instead: each point
    // as far along the line from the inner face's centre to its ring point
    // as the outer opening is along its ray.
    if (even && !straight) {
      const proj = (p) => {
        const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
        return [dx * ux + dy * uy + dz * uz, dx * wx + dy * wy + dz * wz];
      };
      const B = BOr.map((v) => proj(verts[v + baseI]));
      if (bandFaults(B, oiPts.map(proj), false, lay.turn).length) {
        const radial = alongInnerRays(fi, BOr, skel2d, lay);
        if (bandFaults(B, radial.map(proj), false, lay.turn).length === 0) oiPts = radial;
        else unfit.add(fi);
      }
    } else if (folded.has(fi)) {
      // Straight sides have their own layout, which is not checked again:
      // a band that folded against the Centre opening stays reported.
      unfit.add(fi);
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
        let tries = 0;
        for (; tries < 4; tries++, rFace *= 0.5) {
          const F = O.map((o, k) => {
            const w = rFace * lips[k].cotI;
            return [o[0] + w * lips[k].ca, o[1] + w * lips[k].sa];
          });
          if (bandFaults(B, F, false, lay.turn).length === 0) break;
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
      const J = roundingSegmentsFor(edgeDiv, rFace * (Math.PI / 2));

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
      if (depth === "hollow" && !sharpInner) {
        pushQuad(triIdx, faceIds, d + baseI, c + baseI, b + baseI, a + baseI, fid);
      }
    }
    for (const [a, b, c, fid] of stage2.tris) {
      triIdx.push(a, b, c);
      faceIds.push(fid);
      if (depth === "hollow" && !sharpInner) {
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
  // A face that stays closed keeps its own entry, but its border and fillet
  // were not built: the ranges cover the faces that have an opening.
  const opened = faceMetrics.filter((f) => f.openingMinDiameterMm > 0);

  return {
    mesh,
    info: {
      inradiusMm: inradius,
      scale: s,
      faceMetrics,
      // Aggregates across every face — meaningful on irregular hulls, where a
      // single representative value would be a lie.
      borderMm: range(opened, (f) => [f.borderMinMm, f.borderMaxMm]),
      filletMm: range(opened, (f) => [f.filletUsedMm, f.filletUsedMm]),
      roundingMm: roundingActive && stage2
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
      openingMinDiameterMm: faceMetrics.length ? smallestOpening(faceMetrics) : null,
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
      throughClosedByRoundingFaces: through ? throughClosedByRounding : null,
      // Faces with no room for their opening (kept closed).
      closedFaces: openings && !through ? closedFaces : null,
      // Those of them closed by their rounded outline, not a narrow opening.
      closedByRoundingFaces: openings && !through ? closedByRounding : null,
      // Faces a repair could not fit; they may pass through their neighbours.
      unfitFaces: unfit.size,
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

/** The smallest opening among the faces that have one; 0 if none has. */
function smallestOpening(faceMetrics) {
  let least = Infinity;
  for (const f of faceMetrics) {
    if (f.openingMinDiameterMm > 0 && f.openingMinDiameterMm < least) least = f.openingMinDiameterMm;
  }
  return least === Infinity ? 0 : least;
}

function scaleRange({ min, max }, k) {
  return { min: min * k, max: max * k };
}

/**
 * Where a flat ring of [x, y] points in its face frame can be fanned from:
 * the face's centroid (the frame origin) if every ring edge, seen from it,
 * runs the way the ring does; else the ring's own mean point, by the same
 * test; else null. Being inside the ring is not enough: a point inside can
 * still sit behind a dent. Exported for tests.
 * @param {number[][]} B
 * @param {number} [turn]  which way the ring should wind (see `bandFaults`)
 * @returns {number[]|null}
 */
export function fanPoint(B, turn = 0) {
  if (fansFrom(B, FRAME_ORIGIN, turn)) return FRAME_ORIGIN;
  let mx = 0, my = 0;
  for (let k = 0; k < B.length; k++) { mx += B[k][0]; my += B[k][1]; }
  const mean = [mx / B.length, my / B.length];
  return fansFrom(B, mean, turn) ? mean : null;
}
const FRAME_ORIGIN = Object.freeze([0, 0]);

/** Whether every edge of ring B, seen from point c, runs the way B does. */
function fansFrom(B, c, turn = 0) {
  return bandFaults(B, c, true, turn).length === 0;
}

/**
 * How near the rim of an opening comes to the centroid it is laid out
 * around, as that rim is emitted: straight segments between its samples
 * (radius `rad[k]` along angle `ang[k]`). The nearest sample alone is not
 * it. On a sliver the samples can all lie far out along the face while
 * the segment between two of them passes close by the centroid.
 * Exported for tests.
 * @param {Float64Array|number[]} rad
 * @param {Float64Array|number[]} ang
 * @returns {number}
 */
export function rimClearance(rad, ang) {
  const m = rad.length;
  let least = Infinity;
  let ax = rad[m - 1] * Math.cos(ang[m - 1]), ay = rad[m - 1] * Math.sin(ang[m - 1]);
  for (let k = 0; k < m; k++) {
    const bx = rad[k] * Math.cos(ang[k]), by = rad[k] * Math.sin(ang[k]);
    const ex = bx - ax, ey = by - ay;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * ex + ay * ey) / len2)) : 0;
    least = Math.min(least, Math.hypot(ax + t * ex, ay + t * ey));
    ax = bx;
    ay = by;
  }
  return least;
}

/** Twice the signed area of a flat ring of [x, y] points. */
function ringArea2(B) {
  let area2 = 0;
  for (let k = 0, m = B.length; k < m; k++) {
    const k2 = (k + 1) % m;
    area2 += B[k][0] * B[k2][1] - B[k2][0] * B[k][1];
  }
  return area2;
}

/**
 * Where the band between a face ring B and an opening ring F inside it
 * (flat [x, y] points, paired index for index) loses its winding: the
 * quads k → k + 1 with a triangle, split as the band is emitted, that does
 * not turn the way the ring does. With `fan`, F is one point and only the
 * triangle from it to the ring edge counts. `turn` says which way the ring
 * should wind (the sign of its area; 0 takes it from B itself): an inner
 * ring is held to its outer ring's winding, and one that has turned over
 * is a fault all the way round. Exported for tests.
 * @param {number[][]} B
 * @param {number[][]|number[]} F
 * @param {boolean} [fan]
 * @param {number} [turn]
 * @returns {number[]}
 */
export function bandFaults(B, F, fan = false, turn = 0) {
  const m = B.length;
  const area2 = ringArea2(B);
  if (turn !== 0 && !(area2 * turn > 0)) return B.map((_, k) => k);
  const want = area2 > 0 ? -1 : 1;
  const tol = 1e-12 * Math.abs(area2);
  const turns = (p, q, r) =>
    want * ((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) > tol;
  const faults = [];
  for (let k = 0; k < m; k++) {
    const k2 = (k + 1) % m;
    const f = fan ? F : F[k];
    if ((fan || turns(f, F[k2], B[k2])) && turns(f, B[k2], B[k])) continue;
    faults.push(k);
  }
  return faults;
}

function pushQuad(triIdx, faceIds, p0, p1, p2, p3, fi) {
  triIdx.push(...quadToTris(p0, p1, p2, p3));
  faceIds.push(fi, fi);
}
