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
  // Wide-radius fillets at slider ceiling across 3-valent, 4-valent, and spiked solids.
  { base: "cube", depth: "solid", openings: false, roundingMm: 23, wallModes: ["even"] },
  { base: "icosidodeca", depth: "solid", openings: false, roundingMm: 21, wallModes: ["even"] },
  { base: "icosidodeca", roundingMm: 5.7, wallModes: ["even"] },
  { base: "octahedron", spike: Math.sqrt(3), depth: "solid", openings: false, roundingMm: 6.6, wallModes: ["even"] },
  // Smoothed + rounded cubes and spiked stars (hollow Even/Scaled and solid closed).
  { base: "cube", soften: 50, roundingMm: 1.5, edgeDiv: 4 },
  { base: "cube", soften: 80, roundingMm: 2, depth: "solid", openings: false, edgeDiv: 4, wallModes: ["even"] },
  { base: "octahedron", spike: Math.sqrt(3), soften: 50, roundingMm: 0.5, borderFraction: 0.45, filletMm: 1, edgeDiv: 4 },
  { base: "octahedron", spike: Math.sqrt(3), soften: 80, roundingMm: 1.5, depth: "solid", openings: false, edgeDiv: 4, wallModes: ["even"] },
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

// The scan the suites above and form/through/wall-mode rely on: it has to
// find a crossing when there is one.
describe("the crossing scan", () => {
  /** Möller–Trumbore on the open segment p0→p1 and the open triangle: the scan's edge test, written plainly. */
  const segmentHitsTriangle = (p0, p1, v0, v1, v2, eps = 1e-9) => {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const e1 = sub(v1, v0), e2 = sub(v2, v0), d = sub(p1, p0);
    const pv = cross(d, e2), det = dot(e1, pv);
    if (Math.abs(det) <= eps) return false;
    const inv = 1 / det, tv = sub(p0, v0), qv = cross(tv, e1);
    const u = dot(tv, pv) * inv, v = dot(d, qv) * inv, t = dot(e2, qv) * inv;
    return u > eps && v > eps && u + v < 1 - eps && t > eps && t < 1 - eps;
  };
  /** The same pairs with no tree and no shortcuts: every triangle against every other. */
  const everyPair = ({ positions: P, indices: I }) => {
    const tri = (t) => [0, 1, 2].map((k) => [0, 1, 2].map((c) => P[I[t * 3 + k] * 3 + c]));
    const out = [];
    for (let t = 0; t < I.length / 3; t++) {
      const a = tri(t), A = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
      for (let u = t + 1; u < I.length / 3; u++) {
        if (A.includes(I[u * 3]) || A.includes(I[u * 3 + 1]) || A.includes(I[u * 3 + 2])) continue;
        const b = tri(u);
        if ([0, 1, 2].some((k) => segmentHitsTriangle(a[k], a[(k + 1) % 3], ...b)
          || segmentHitsTriangle(b[k], b[(k + 1) % 3], ...a))) out.push([t, u]);
      }
    }
    return out;
  };

  it("finds exactly the pairs that checking every pair finds", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // Triangles thrown into a box: large and small, every seventh nearly
    // flat, every fifth sharing a corner with an earlier one.
    for (const [count, size] of [[40, 30], [200, 20], [600, 8]]) {
      const positions = [], indices = [];
      for (let t = 0; t < count; t++) {
        const centre = [rnd() * 100, rnd() * 100, rnd() * 100], first = positions.length / 3;
        for (let v = 0; v < 3; v++) {
          for (let c = 0; c < 3; c++) positions.push(centre[c] + (rnd() - 0.5) * size * (t % 7 === 0 && c === 2 ? 1e-7 : 1));
        }
        indices.push(first, first + 1, t % 5 === 4 ? Math.floor(rnd() * first) : first + 2);
      }
      const want = everyPair({ positions, indices });
      assert.ok(want.length > 5, `${count} triangles: ${want.length} pairs cross`);
      assert.deepEqual(selfIntersections({ positions, indices }), want, `${count} triangles`);
      assert.deepEqual(selfIntersections({ positions: Float32Array.from(positions), indices }),
        everyPair({ positions: Float32Array.from(positions), indices }), `${count} triangles, float32`);
      // A limit stops the scan early: that many pairs, each one a real one.
      const some = selfIntersections({ positions, indices }, 3);
      assert.equal(some.length, 3);
      for (const pair of some) assert.ok(want.some((w) => w[0] === pair[0] && w[1] === pair[1]));
    }
  });

  it("finds a corner pushed through a built shell", () => {
    const r = compile({ base: "cube" });
    const indices = r.mesh.indices;
    assert.deepEqual(selfIntersections({ positions: r.mesh.positions64, indices }), []);
    // One vertex moved to the far side of the centre: its triangles now
    // run through both walls.
    const positions = Float64Array.from(r.mesh.positions64);
    for (let c = 0; c < 3; c++) positions[c] = -positions[c];
    const hits = selfIntersections({ positions, indices });
    assert.ok(hits.length > 0);
    assert.deepEqual(hits, everyPair({ positions, indices }));
    assert.equal(selfIntersections({ positions, indices }, 1).length, 1);
    assert.deepEqual(selfIntersections({ positions: [], indices: [] }), []);
  });
});
