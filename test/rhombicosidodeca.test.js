/**
 * Rhombicosidodecahedron — exact geometry lock (Archimedean 3.4.4.5).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rhombicosidodecaPoints } from "../src/points/rhombicosidodeca.js";
import { icosahedronVerts, PHI } from "../src/points/platonic.js";
import { icosidodecaPoints } from "../src/points/icosidodeca.js";
import { hullToSkeleton } from "../src/hull.js";
import { newell } from "../src/skeleton.js";

function unit(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function directions(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 3) {
    out.push(unit([flat[i], flat[i + 1], flat[i + 2]]));
  }
  return out;
}

/** Largest 1 − cos between each face normal (of `sides`) and its nearest axis. */
function worstAxisMiss(sk, sides, axes) {
  let worst = 0;
  for (const f of sk.faces) {
    if (f.length !== sides) continue;
    const { normal } = newell(sk.positions, f);
    let best = -Infinity;
    for (const a of axes) {
      const dot = a[0] * normal[0] + a[1] * normal[1] + a[2] * normal[2];
      if (dot > best) best = dot;
    }
    worst = Math.max(worst, 1 - best);
  }
  return worst;
}

describe("rhombicosidodecahedron", () => {
  const sk = hullToSkeleton(rhombicosidodecaPoints());

  it("20 triangles + 30 squares + 12 pentagons on 60 unit-radius verts", () => {
    assert.equal(sk.positions.length / 3, 60);
    const sig = new Map();
    for (const f of sk.faces) sig.set(f.length, (sig.get(f.length) || 0) + 1);
    assert.deepEqual(
      [...sig.entries()].sort((a, b) => a[0] - b[0]),
      [
        [3, 20],
        [4, 30],
        [5, 12],
      ],
    );
    for (let i = 0; i < sk.positions.length; i += 3) {
      const r = Math.hypot(sk.positions[i], sk.positions[i + 1], sk.positions[i + 2]);
      assert.ok(Math.abs(r - 1) < 1e-12, `vertex radius ${r}`);
    }
    // Euler: V − E + F = 2
    assert.equal(60 - sk.edges.length + sk.faces.length, 2);
  });

  it("120 equal edges of length 2/√(8φ+7)", () => {
    assert.equal(sk.edges.length, 120);
    const expected = 2 / Math.sqrt(8 * PHI + 7);
    for (const [a, b] of sk.edges) {
      const L = Math.hypot(
        sk.positions[a * 3] - sk.positions[b * 3],
        sk.positions[a * 3 + 1] - sk.positions[b * 3 + 1],
        sk.positions[a * 3 + 2] - sk.positions[b * 3 + 2],
      );
      assert.ok(Math.abs(L - expected) < 1e-12, `edge ${L}`);
    }
  });

  it("every vertex is one pentagon, two squares and one triangle", () => {
    const touch = Array.from({ length: 60 }, () => []);
    for (const f of sk.faces) for (const v of f) touch[v].push(f.length);
    for (const t of touch) {
      assert.deepEqual(t.sort((a, b) => a - b), [3, 4, 4, 5]);
    }
  });

  it("shares the φ-family axes: pentagons face icosahedron vertices, squares face icosidodecahedron vertices", () => {
    const fiveFold = icosahedronVerts().map(unit);
    const twoFold = directions(icosidodecaPoints());
    assert.ok(worstAxisMiss(sk, 5, fiveFold) < 1e-9, "pentagon axes");
    assert.ok(worstAxisMiss(sk, 4, twoFold) < 1e-9, "square axes");
  });
});
