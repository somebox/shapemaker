// Truncation operator — vertex cuts by edge-point re-hull.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { clearPipelineCache, hullSkeletonForBase } from "../src/pipeline.js";
import { truncateSkeleton } from "../src/truncate.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { encodeHash, decodeHash } from "../src/hashcodec.js";

const arities = (sk) => {
  const c = {};
  for (const f of sk.faces) c[f.length] = (c[f.length] || 0) + 1;
  return c;
};

describe("truncateSkeleton", () => {
  it("t = 0 returns the input untouched", () => {
    const cube = hullSkeletonForBase("cube", {});
    assert.equal(truncateSkeleton(cube, 0), cube);
  });

  it("classic truncations produce the classic solids", () => {
    const cube = hullSkeletonForBase("cube", {});
    // t = ½: rectification → cuboctahedron (8 triangles + 6 squares).
    assert.deepEqual(arities(truncateSkeleton(cube, 0.5)), { 3: 8, 4: 6 });
    // partial: truncated cube (8 triangles + 6 octagons).
    assert.deepEqual(arities(truncateSkeleton(cube, 0.25)), { 3: 8, 8: 6 });
    // icosahedron at ⅓ → the soccer ball (12 pentagons + 20 hexagons).
    const icosa = hullSkeletonForBase("icosahedron", {});
    assert.deepEqual(arities(truncateSkeleton(icosa, 1 / 3)), { 5: 12, 6: 20 });
    // dodecahedron at ½ → icosidodecahedron.
    const dodeca = hullSkeletonForBase("dodecahedron", {});
    assert.deepEqual(arities(truncateSkeleton(dodeca, 0.5)), { 3: 20, 5: 12 });
  });

  it("renormalizes to unit circumradius", () => {
    const sk = truncateSkeleton(hullSkeletonForBase("cube", {}), 0.3);
    let rMax = 0;
    for (let i = 0; i < sk.positions.length; i += 3) {
      rMax = Math.max(rMax, Math.hypot(
        sk.positions[i], sk.positions[i + 1], sk.positions[i + 2]));
    }
    assert.ok(Math.abs(rMax - 1) < 1e-9, `unit circumradius, got ${rMax}`);
  });

  it("is deterministic", () => {
    const a = truncateSkeleton(hullSkeletonForBase("icosahedron", {}), 1 / 3);
    const b = truncateSkeleton(hullSkeletonForBase("icosahedron", {}), 1 / 3);
    assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
  });
});

describe("truncate through compile", () => {
  it("state truncate=0 is canonical and absent from the pipeline", () => {
    clearPipelineCache();
    const r = compile({ base: "cube" });
    assert.equal(r.state.truncate, 0);
    assert.equal(r.skeleton.faces.length, 6);
  });

  it("legacy hashes decode with truncate 0", () => {
    const legacy = decodeHash(encodeHash({ base: "cube" }));
    assert.equal(legacy.state.truncate, 0);
  });

  it("rejects out-of-range truncate", () => {
    clearPipelineCache();
    const r = compile({ base: "cube", truncate: 60 });
    assert.equal(r.validation.ok, false);
    assert.ok(r.validation.errors.some((e) => e.key === "truncate"));
  });

  it("composes with subdivide, smooth, rounding, and jitter", () => {
    for (const st of [
      { base: "icosahedron", truncate: 33, roundingMm: 1.5 },
      { base: "cube", truncate: 25, subdiv: 1, subdivStyle: "grid" },
      { base: "cube", truncate: 30, subdiv: 2, soften: 50 },
      { base: "dodecahedron", truncate: 20, jitter: 12, seed: 42 },
      { base: "random", points: 24, seed: 1337, truncate: 25, jitter: 10 },
    ]) {
      clearPipelineCache();
      const r = compile({ depth: "hollow", wallMm: 1.4, openings: true, ...st });
      assert.equal(r.validation.ok, true, JSON.stringify({ st, errors: r.validation.errors }));
      assertMeshInvariants(r.mesh);
    }
  });

  it("soccer ball: icosahedron truncate 33 solidifies hollow open", () => {
    clearPipelineCache();
    const r = compile({ base: "icosahedron", truncate: 33,
      depth: "hollow", wallMm: 1.4, openings: true });
    assert.equal(r.validation.ok, true);
    assert.deepEqual(arities(r.skeleton), { 5: 12, 6: 20 });
    assertMeshInvariants(r.mesh);
  });
});
