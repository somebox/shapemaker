/**
 * Rhombic enneacontahedron — exact geometry lock (zonohedron of the ten
 * icosahedral three-fold axes).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rhombicEnneacontaPoints } from "../src/points/rhombicenneaconta.js";
import { icosahedronVerts, PHI } from "../src/points/platonic.js";
import { hullToSkeleton } from "../src/hull.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { recipeForBase } from "../src/starts.js";

const vert = (sk, i) => [sk.positions[i * 3], sk.positions[i * 3 + 1], sk.positions[i * 3 + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };

describe("rhombic enneacontahedron", () => {
  const pts = rhombicEnneacontaPoints();
  const sk = hullToSkeleton(pts);

  it("emits exactly the 92 hull vertices — no interior or duplicate points", () => {
    assert.equal(pts.length / 3, 92);
    assert.equal(sk.positions.length / 3, 92);
    const used = new Set(sk.faces.flat());
    assert.equal(used.size, 92);
  });

  it("90 rhombi, 180 equal edges of length 1/φ², Euler 2", () => {
    assert.equal(sk.faces.length, 90);
    assert.ok(sk.faces.every((f) => f.length === 4));
    assert.equal(sk.edges.length, 180);
    assert.equal(92 - 180 + 90, 2);
    for (const [a, b] of sk.edges) {
      const L = len(sub(vert(sk, a), vert(sk, b)));
      assert.ok(Math.abs(L - 1 / (PHI * PHI)) < 1e-12, `edge ${L}`);
    }
  });

  it("60 broad rhombi (diagonals 1:√2) and 30 slim ones (1:φ²)", () => {
    let broad = 0, slim = 0;
    for (const f of sk.faces) {
      const d1 = len(sub(vert(sk, f[0]), vert(sk, f[2])));
      const d2 = len(sub(vert(sk, f[1]), vert(sk, f[3])));
      const ratio = Math.max(d1, d2) / Math.min(d1, d2);
      if (Math.abs(ratio - Math.SQRT2) < 1e-9) broad++;
      else if (Math.abs(ratio - PHI * PHI) < 1e-9) slim++;
      else assert.fail(`unexpected diagonal ratio ${ratio}`);
    }
    assert.deepEqual([broad, slim], [60, 30]);
  });

  it("is a zonohedron: ten edge directions, eighteen edges each", () => {
    /** @type {{ dir: number[], n: number }[]} */
    const zones = [];
    for (const [a, b] of sk.edges) {
      const d = unit(sub(vert(sk, a), vert(sk, b)));
      const z = zones.find((q) => Math.abs(q.dir[0] * d[0] + q.dir[1] * d[1] + q.dir[2] * d[2]) > 1 - 1e-9);
      if (z) z.n++;
      else zones.push({ dir: d, n: 1 });
    }
    assert.equal(zones.length, 10);
    assert.ok(zones.every((z) => z.n === 18));
  });

  it("three-fold tips are outermost; five-fold tips face the icosahedron's vertices", () => {
    const r5 =
      (5 * (Math.sqrt((5 + 2 * Math.sqrt(5)) / 15) +
        Math.sqrt((5 - 2 * Math.sqrt(5)) / 15))) / (2 * PHI * PHI);
    const fiveFold = icosahedronVerts().map(unit);
    let outer = 0, tips = 0;
    for (let i = 0; i < 92; i++) {
      const p = vert(sk, i);
      const r = len(p);
      if (Math.abs(r - 1) < 1e-12) outer++;
      if (Math.abs(r - r5) < 1e-12) {
        tips++;
        const u = unit(p);
        const best = Math.max(...fiveFold.map((a) => a[0] * u[0] + a[1] * u[1] + a[2] * u[2]));
        assert.ok(1 - best < 1e-12, "five-fold tip is off the icosahedron axis");
      }
    }
    assert.deepEqual([outer, tips], [20, 12]);
  });

  it("compiles from its start recipe, hollow and open", () => {
    clearPipelineCache();
    const r = compile(recipeForBase("rhombicenneaconta"));
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.equal(r.skeleton.faces.length, 90);
    assertMeshInvariants(r.mesh);
  });
});
