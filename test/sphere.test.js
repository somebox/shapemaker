/**
 * Sphere base — fibonacci-lattice points, deterministic, evenly spread.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fibonacciSpherePoints } from "../src/points/sphere.js";
import { idealSeparationRad } from "../src/points/random.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { recipeForBase } from "../src/starts.js";

describe("fibonacciSpherePoints", () => {
  it("is deterministic and unit-radius", () => {
    const a = fibonacciSpherePoints({ points: 24 });
    const b = fibonacciSpherePoints({ points: 24 });
    assert.deepEqual(Array.from(a), Array.from(b));
    for (let i = 0; i < a.length; i += 3) {
      const r = Math.hypot(a[i], a[i + 1], a[i + 2]);
      assert.ok(Math.abs(r - 1) < 1e-12, `radius drifted: ${r}`);
    }
  });

  it("clamps count to the supported 4–60 range and defaults to 24", () => {
    assert.equal(fibonacciSpherePoints({ points: 2 }).length / 3, 4);
    assert.equal(fibonacciSpherePoints({ points: 999 }).length / 3, 60);
    assert.equal(fibonacciSpherePoints().length / 3, 24);
  });

  it("spreads points evenly — min pairwise angle near the ideal cap angle", () => {
    for (const n of [12, 24, 48, 60]) {
      const pts = fibonacciSpherePoints({ points: n });
      let minAngle = Infinity;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dot =
            pts[i * 3] * pts[j * 3] +
            pts[i * 3 + 1] * pts[j * 3 + 1] +
            pts[i * 3 + 2] * pts[j * 3 + 2];
          const a = Math.acos(Math.max(-1, Math.min(1, dot)));
          if (a < minAngle) minAngle = a;
        }
      }
      // The lattice is not optimal packing, but stays a healthy fraction of
      // the ideal one-cap-per-point separation at every supported count.
      assert.ok(
        minAngle > 0.55 * idealSeparationRad(n),
        `n=${n}: min angle ${minAngle} too clustered`,
      );
    }
  });

  it("avoids exact poles (no degenerate hull fans)", () => {
    const pts = fibonacciSpherePoints({ points: 24 });
    for (let i = 0; i < pts.length; i += 3) {
      assert.ok(Math.abs(pts[i + 2]) < 1, "z strictly inside (−1, 1)");
    }
  });
});

describe("sphere through the pipeline", () => {
  it("start recipe compiles clean at every density level", () => {
    for (const points of [12, 24, 48]) {
      clearPipelineCache();
      const r = compile({ ...recipeForBase("sphere"), points });
      assert.equal(
        r.validation.ok,
        true,
        `points=${points}: ${r.validation.errors[0]?.message}`,
      );
      assert.ok(r.skeleton.faces.every((f) => f.length === 3), "hull triangles");
      assertMeshInvariants(r.mesh);
    }
  });

  it("point count changes facet count; seed does not (deterministic lattice)", () => {
    clearPipelineCache();
    const sparse = compile({ ...recipeForBase("sphere"), points: 12 });
    clearPipelineCache();
    const dense = compile({ ...recipeForBase("sphere"), points: 48 });
    assert.ok(dense.skeleton.faces.length > sparse.skeleton.faces.length);
    clearPipelineCache();
    const a = compile({ ...recipeForBase("sphere"), seed: 1 });
    clearPipelineCache();
    const b = compile({ ...recipeForBase("sphere"), seed: 2 });
    assert.deepEqual(
      Array.from(a.skeleton.positions),
      Array.from(b.skeleton.positions),
    );
  });

  it("jitter breaks the lattice symmetry (on-sphere point jitter, seeded)", () => {
    clearPipelineCache();
    const a = compile({ ...recipeForBase("sphere"), jitter: 5, seed: 1 });
    clearPipelineCache();
    const b = compile({ ...recipeForBase("sphere"), jitter: 5, seed: 2 });
    assert.equal(a.validation.ok, true);
    assert.equal(b.validation.ok, true);
    assert.notDeepEqual(
      Array.from(a.skeleton.positions),
      Array.from(b.skeleton.positions),
    );
    assertMeshInvariants(a.mesh);
  });
});
