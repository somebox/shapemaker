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
  // Rounding with Truncate on irregular shapes, from a sweep of random
  // states (each in the wall mode it was found in). The sphere and the
  // globe also had corner caps under a millimetre across whose fan left
  // fins against the strip ends: flat overlaps in double precision,
  // crossings in the float32 positions scanned here.
  // Even walls: the inner copy of the rounding at full size on an inner
  // face a fraction of the outer one. Strips wider than the inner border:
  { base: "random", wallMm: 2.4, roundingMm: 0.5, truncate: 40, borderFraction: 0.2, filletMm: 0, seed: 1311, wallModes: ["even"] },
  { base: "sphere", wallMm: 4, roundingMm: 3, jitter: 8, jitterMode: "both", truncate: 15, filletMm: 1.5, seed: 1441, points: 12, wallModes: ["even"] },
  { base: "random", roundingMm: 1.5, jitterMode: "both", truncate: 15, borderFraction: 0.2, filletMm: 0, seed: 181, wallModes: ["even"] },
  { base: "twistedglobe", roundingMm: 1.5, edgeDiv: 4, jitter: 20, jitterMode: "radial", truncate: 40, filletMm: 0, seed: 4909, wallModes: ["even"] },
  // strip ends trimmed for the outer edge overlapping on the inner one:
  { base: "cuboctahedron", wallMm: 4, roundingMm: 3, jitter: 20, jitterMode: "radial", truncate: 15, borderFraction: 0.2, seed: 3931, points: 12, wallModes: ["even"] },
  { base: "cuboctahedron", wallMm: 4, roundingMm: 1.5, jitter: 8, jitterMode: "radial", truncate: 15, openingStyle: "ellipse", borderFraction: 0.6, seed: 2962, points: 12, wallModes: ["even"] },
  // and needle faces whose inner copy is a different shape altogether.
  { base: "rhombicosidodeca", wallMm: 2.4, roundingMm: 1.5, jitter: 20, jitterMode: "radial", truncate: 40, borderFraction: 0.2, filletMm: 0, seed: 2619, wallModes: ["even"] },
  { base: "globe", wallMm: 4, roundingMm: 3, jitter: 8, jitterMode: "radial", truncate: 40, filletMm: 1.5, seed: 360, wallModes: ["even"] },
  // A rounded strip ending against a sharp one on a straight boundary (the
  // face across is split into two nearly coplanar parts): the outline
  // stepped square in, backwards as seen from the face centre, and the rim
  // lips on the two rays crossed.
  { base: "rhombicenneaconta", wallMm: 4, roundingMm: 0.5, jitter: 8, truncate: 40, filletMm: 1.5, seed: 2452, wallModes: ["scaled"] },
  // Even walls, inner faces tilted against the outer ones (a corner's inner
  // position is a best fit where four or more faces meet): strip ends
  // copied flat stood off the inner face, and the opening wall passed
  // through the band beside them.
  { base: "cuboctahedron", wallMm: 4, roundingMm: 3, jitter: 20, jitterMode: "surface", truncate: 15, borderFraction: 0.6, filletMm: 0, seed: 4847, edgeDiv: 4, wallModes: ["even"] },
  { base: "icosidodeca", wallMm: 2.4, roundingMm: 1.5, jitter: 8, jitterMode: "radial", truncate: 40, borderFraction: 0.2, filletMm: 1.5, seed: 4181, edgeDiv: 4, wallModes: ["even"] },
  // Needle faces from Subdivide on a distorted shape: the corner rounding
  // moved the outline off the centroid the opening is laid out around, or
  // in past the opening, and the opening's walls crossed. They stay closed.
  { base: "cube", wallMm: 2.4, roundingMm: 3, jitter: 20, jitterMode: "both", truncate: 15, borderFraction: 0.6, filletMm: 1.5, seed: 3876, subdiv: 1, edgeDiv: 4, wallModes: ["scaled"] },
  { base: "cuboctahedron", wallMm: 2.4, roundingMm: 3, jitter: 8, jitterMode: "radial", borderFraction: 0.6, filletMm: 1.5, seed: 2956, points: 12, subdiv: 1, edgeDiv: 4, wallModes: ["even"] },
  // A corner cap 0.09 mm deep on a truncated tetrahedron, its fan flat
  // against the one strip that runs untrimmed to the corner.
  { base: "tetrahedron", wallMm: 4, roundingMm: 0.5, jitter: 8, jitterMode: "radial", truncate: 40, borderFraction: 0.2, filletMm: 0, seed: 4138, wallModes: ["even"] },
  // The same faults with Smooth on, from a sweep of random states with
  // Smooth 20, 50 or 80: with Rounding and Truncate,
  { base: "cube", wallMm: 1.4, roundingMm: 1.5, truncate: 15, borderFraction: 0.36, filletMm: 4.5, openingStyle: "ellipse", seed: 4799, edgeDiv: 4, soften: 80, wallModes: ["even"] },
  { base: "tetrahedron", wallMm: 4, roundingMm: 1.5, jitter: 8, jitterMode: "both", truncate: 15, borderFraction: 0.36, filletMm: 0, seed: 3982, points: 12, soften: 80, wallModes: ["even"] },
  // with Smooth alone,
  { base: "dodecahedron", wallMm: 4, roundingMm: 0, truncate: 15, borderFraction: 0.2, filletMm: 4.5, seed: 2265, edgeDiv: 4, soften: 50, wallModes: ["even"] },
  // and with Subdivide. In the second, the corners of some needle faces
  // are drawn in while the shared point of two mitred strips at a knee
  // kept its place from before the mitre.
  { base: "octahedron", wallMm: 4, roundingMm: 0.5, jitter: 8, jitterMode: "surface", borderFraction: 0.36, filletMm: 1.5, seed: 4760, subdiv: 1, soften: 20, wallModes: ["even"] },
  { base: "dodecahedron", wallMm: 1.4, roundingMm: 1.5, jitter: 20, jitterMode: "radial", truncate: 15, borderFraction: 0.2, filletMm: 4.5, seed: 4409, subdiv: 1, soften: 20, wallModes: ["even"] },
  // Needle faces whose outline Smooth dents: the centroid lies inside the
  // outline but an edge runs backwards seen from it, and the opening band,
  // laid out along rays from the centroid, folded ("degenerate triangle").
  // Those faces now stay closed.
  { base: "cuboctahedron", wallMm: 1.4, roundingMm: 1.5, truncate: 15, borderFraction: 0.6, filletMm: 4.5, seed: 2600, edgeDiv: 4, subdiv: 1, openingAxis: "normal", soften: 50, wallModes: ["scaled"] },
];

describe("Stage-2 rounding does not fold through itself", () => {
  for (const { wallModes = ["even", "scaled"], ...c } of CROSSING) {
    for (const wallMode of wallModes) {
      it(`${JSON.stringify(c)} (${wallMode})`, () => {
        const r = compile({ ...c, wallMode });
        assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
        // `mesh.positions` is the float32 copy an STL holds, not the
        // builder's doubles (`positions64`): some of these crossed only
        // once rounded, and this is the scan that sees it.
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

  it("stays quick and right when centres rise and then fall along the list", () => {
    // Centres at 0, 1, ... m ... 1, 0 along x, as round a ring. Halving a
    // list in this order by its middle triangle takes a pass per handful of
    // triangles, so the scan sorts what is left once that has cost enough.
    let seed = 2468;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const soup = (count, corner) => {
      const positions = [], indices = [];
      for (let t = 0; t < count; t++) {
        const tri = corner(t);
        const shift = Math.min(t, count - 1 - t) - (tri[0] + tri[3] + tri[6]) / 3;
        for (let v = 0; v < 3; v++) positions.push(tri[v * 3] + shift, tri[v * 3 + 1], tri[v * 3 + 2]);
        indices.push(t * 3, t * 3 + 1, t * 3 + 2);
      }
      return { positions, indices };
    };
    // Turned every way and larger than the step between them: neighbours cross.
    const crossing = soup(600, () => Array.from({ length: 9 }, () => (rnd() - 0.5) * 4));
    const want = everyPair(crossing);
    assert.ok(want.length > 100, `${want.length} pairs cross`);
    assert.deepEqual(selfIntersections(crossing), want);
    // Small and apart, the list's second half a row up: nothing crosses,
    // and halving the tree's nodes stays within its bound of 9 n log2 n
    // triangles passed over. Without the sort it passes over 90 times that
    // bound here.
    const n = 50000, tally = {};
    const apart = soup(n, (t) => [0, 0, 0, 0.5, 0, 0, 0, 0.5, 0].map((p, i) => (i % 3 === 1 && t >= n / 2 ? p + 2 : p)));
    assert.deepEqual(selfIntersections(apart, Infinity, tally), []);
    assert.ok(tally.halving < 9 * n * Math.log2(n), `halving passed over ${tally.halving} triangles`);
  });
});
