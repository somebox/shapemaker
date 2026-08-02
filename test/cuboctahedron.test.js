/**
 * Cuboctahedron — exact geometry lock (Archimedean; edge = circumradius).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cuboctahedronPoints } from "../src/points/cuboctahedron.js";
import { hullToSkeleton } from "../src/hull.js";

describe("cuboctahedron", () => {
  it("8 triangles + 6 squares, every edge equals the circumradius", () => {
    const sk = hullToSkeleton(cuboctahedronPoints());
    const sig = new Map();
    for (const f of sk.faces) sig.set(f.length, (sig.get(f.length) || 0) + 1);
    assert.deepEqual(
      [...sig.entries()].sort((a, b) => a[0] - b[0]),
      [
        [3, 8],
        [4, 6],
      ],
    );
    assert.equal(sk.edges.length, 24);
    for (const [a, b] of sk.edges) {
      const L = Math.hypot(
        sk.positions[a * 3] - sk.positions[b * 3],
        sk.positions[a * 3 + 1] - sk.positions[b * 3 + 1],
        sk.positions[a * 3 + 2] - sk.positions[b * 3 + 2],
      );
      assert.ok(Math.abs(L - 1) < 1e-12, `edge ${L}`);
    }
  });
});
