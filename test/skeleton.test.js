/**
 * assertSkeleton() guards the contract the solidifier relies on. Today one
 * hardcoded generator satisfies it by construction; from M3 skeletons arrive
 * from quickhull, coplanar merge, subdivision and jitter, where a malformed
 * result would otherwise surface as a baffling mesh failure downstream.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSkeleton, edgeList, circumradius } from "../src/skeleton.js";
import { icosidodecahedron } from "../src/points/icosidodeca.js";

/** Deep copy so each mutation test starts from a valid skeleton. */
function freshSkeleton() {
  const { positions, faces } = icosidodecahedron(50);
  return { positions: Float64Array.from(positions), faces: faces.map((f) => [...f]) };
}

describe("assertSkeleton accepts the M1 solid", () => {
  it("passes on the icosidodecahedron", () => {
    assert.equal(assertSkeleton(freshSkeleton()), true);
  });

  it("agrees with edgeList and circumradius", () => {
    const s = freshSkeleton();
    assert.equal(edgeList(s.faces).length, 60);
    assert.ok(Math.abs(circumradius(s.positions) - 50) < 1e-9);
  });
});

describe("assertSkeleton rejects malformed skeletons", () => {
  const cases = [
    ["out-of-range vertex index", (s) => { s.faces[0][0] = 999; }, /out of \[0/],
    ["repeated vertex in a face", (s) => { s.faces[0][1] = s.faces[0][0]; }, /repeats a vertex/],
    ["non-finite position", (s) => { s.positions[0] = NaN; }, /non-finite/],
    ["too few faces", (s) => { s.faces = s.faces.slice(0, 3); }, /≥ 4 faces/],
    ["degenerate face ring", (s) => { s.faces[0] = [0, 1]; }, /needs ≥ 3/],
    [
      "non-planar face",
      (s) => { const v = s.faces[0][0]; s.positions[v * 3] += 5; },
      /not planar|not closed|inward/,
    ],
    [
      "reversed winding",
      (s) => { s.faces = s.faces.map((f) => [...f].reverse()); },
      /wound inward/,
    ],
    [
      "hole in the surface",
      (s) => { s.faces.splice(0, 1); },
      /not closed/,
    ],
  ];

  for (const [name, mutate, pattern] of cases) {
    it(`rejects ${name}`, () => {
      const s = freshSkeleton();
      mutate(s);
      assert.throws(() => assertSkeleton(s), pattern, `${name} should be rejected`);
    });
  }
});
