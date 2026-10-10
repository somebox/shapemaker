// Stage-2 rounding cases that used to throw "mesh is not closed",
// "directed edge twice", "repeated vertex" or "degenerate triangle".

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { selfIntersections } from "./self-intersect.js";

const CASES = [
  // Distort splits corners into short edges: strip and inset corner must agree.
  { base: "icosahedron", jitter: 30, roundingMm: 1.6 },
  { base: "icosahedron", jitter: 12.5, roundingMm: 2 },
  { base: "rhombicenneaconta", jitter: 30, roundingMm: 1 },
  { base: "icosidodeca", jitter: 12.5, roundingMm: 2 },
  // Tiny cap loops where earcut returned an incomplete triangulation.
  { base: "sphere", truncate: 25, roundingMm: 2 },
  { base: "random", truncate: 12.5, roundingMm: 2 },
  // An untrimmed sharp strip end and an inset corner on the same point.
  { base: "twistedglobe", jitter: 12.5, roundingMm: 0.5, openings: false },
  { base: "twistedglobe", jitter: 30, jitterMode: "both", roundingMm: 1 },
];

describe("Stage-2 rounding regressions", () => {
  for (const c of CASES) {
    for (const wallMode of ["even", "scaled"]) {
      it(`${JSON.stringify(c)} (${wallMode})`, () => {
        const r = compile({ ...c, wallMode });
        assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
        assert.equal(r.metrics.watertight, true);
      });
    }
  }
});

// Cases that built closed but folded through themselves (prototype
// meshcheck's self-intersection test).
const CROSSING = [
  // A strip arc on the line from the corner sphere's centre through the
  // vertex: the cap's apex sat on its own boundary.
  { base: "tetrahedron", truncate: 30, roundingMm: 1.5, edgeDiv: 4 },
  // Corner fans folding between strips of very different radii.
  { base: "icosidodeca", jitter: 10, roundingMm: 3, edgeDiv: 4 },
  { base: "random", dual: true, roundingMm: 3, edgeDiv: 4 },
  // Tiny truncation faces: folded fans, and (Even) an inner rim lip cutting
  // the inner edge between samples.
  { base: "random", truncate: 30, roundingMm: 1.5, edgeDiv: 4 },
  // Even walls on a subdivided edge: the inner strip moved by its end
  // corners only, while the faces beside it moved by their own corners.
  { subdiv: 1, wallMm: 4, roundingMm: 1.5, wallModes: ["even"] },
  // A sharp 0.7 mm spoke from Jitter: the flat corner fill's best-fit
  // projection made an ear of a reflex corner, lying back across a face.
  { base: "cuboctahedron", jitter: 10, roundingMm: 1.5, edgeDiv: 4 },
  // Spike valleys: flat corner fills that tip just past edge-on are fine
  // and must keep their ear-clip (a fan there crosses the next face).
  { base: "random", spike: 1, roundingMm: 1.5 },
  // A face outline that steps 0.7 µm out to a sharp strip end and back:
  // the rim lips on the spur's two rays crossed.
  { base: "globe", jitter: 10, roundingMm: 0.5, wallModes: ["scaled"] },
];

describe("Stage-2 rounding does not fold through itself", () => {
  for (const { wallModes = ["even", "scaled"], ...c } of CROSSING) {
    for (const wallMode of wallModes) {
      it(`${JSON.stringify(c)} (${wallMode})`, () => {
        const r = compile({ ...c, wallMode });
        assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
        assert.deepEqual(selfIntersections(r.mesh, 5), []);
      });
    }
  }
});
