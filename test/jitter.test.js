/**
 * On-sphere jitter (M5): identity at zero, determinism under seed, merge-skip
 * for any jittered base, and full-pipeline validity.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jitterPoints } from "../src/points/jitter.js";
import { cubePoints } from "../src/points/platonic.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { assertMeshInvariants } from "../src/mesh.js";

describe("jitterPoints", () => {
  it("jitter 0 is a bit-identical copy (exact bases stay exact)", () => {
    const src = cubePoints();
    const out = jitterPoints(src, { seed: 1337, jitter: 0 });
    assert.notEqual(out, src, "returns a new array");
    assert.deepEqual(Array.from(out), Array.from(src));
  });

  it("is deterministic per seed and differs across seeds", () => {
    const src = cubePoints();
    const a = jitterPoints(src, { seed: 7, jitter: 10 });
    const b = jitterPoints(src, { seed: 7, jitter: 10 });
    const c = jitterPoints(src, { seed: 8, jitter: 10 });
    assert.deepEqual(Array.from(a), Array.from(b));
    assert.notDeepEqual(Array.from(a), Array.from(c));
  });

  it("keeps every point on the sphere within the arc budget", () => {
    const src = cubePoints();
    const jitter = 15; // percent → max arc 0.15 rad on the unit sphere
    const out = jitterPoints(src, { seed: 42, jitter });
    for (let i = 0; i < out.length; i += 3) {
      const r = Math.hypot(out[i], out[i + 1], out[i + 2]);
      assert.ok(Math.abs(r - 1) < 1e-12, `radius drifted: ${r}`);
      const dot =
        out[i] * src[i] + out[i + 1] * src[i + 1] + out[i + 2] * src[i + 2];
      const arc = Math.acos(Math.max(-1, Math.min(1, dot)));
      assert.ok(arc <= jitter / 100 + 1e-9, `arc ${arc} exceeds budget`);
    }
  });
});

describe("jitter through the pipeline (random base — v0.4 scope)", () => {
  const FIT = { base: "random", borderMm: 1, filletMm: 1.5 };

  it("jitter 0 compiles identically to the unjittered random hull", () => {
    clearPipelineCache();
    const exact = compile({ ...FIT });
    clearPipelineCache();
    const zero = compile({ ...FIT, jitter: 0 });
    assert.equal(exact.metrics.triangleCount, zero.metrics.triangleCount);
    assert.equal(exact.metrics.volumeCm3, zero.metrics.volumeCm3);
  });

  it("jitter is gradual on random hulls: same face count, small volume drift", () => {
    // Random hulls are already triangulated, so there is no merge cliff —
    // the first slider step changes the shape slightly, not structurally.
    clearPipelineCache();
    const zero = compile({ ...FIT });
    clearPipelineCache();
    const tiny = compile({ ...FIT, jitter: 0.5 });
    assert.equal(tiny.validation.ok, true, tiny.validation.errors[0]?.message);
    assert.equal(tiny.skeleton.faces.length, zero.skeleton.faces.length);
    const rel =
      Math.abs(tiny.metrics.volumeCm3 - zero.metrics.volumeCm3) /
      zero.metrics.volumeCm3;
    assert.ok(rel < 0.02, `0.5% jitter moved volume by ${(rel * 100).toFixed(2)}%`);
    assertMeshInvariants(tiny.mesh);
  });

  it("jittered random hulls pass all three shell combos", () => {
    for (const combo of [
      { depth: "solid", openings: false },
      { depth: "hollow", openings: false },
      { depth: "hollow", openings: true },
    ]) {
      clearPipelineCache();
      const r = compile({ ...FIT, jitter: 10, ...combo });
      assert.equal(
        r.validation.ok,
        true,
        `${combo.depth}/${combo.openings}: ${r.validation.errors[0]?.message}`,
      );
      assert.ok(r.metrics.watertight);
    }
  });

  it("jitter validates its range", () => {
    clearPipelineCache();
    const r = compile({ ...FIT, jitter: 35 });
    assert.equal(r.validation.ok, false);
    assert.ok(r.validation.errors.some((e) => e.key === "jitter"));
  });

  it("jitter on a regular base is refused with a clampTo (v0.4 scope)", () => {
    clearPipelineCache();
    const r = compile({ base: "cube", jitter: 5 });
    assert.equal(r.validation.ok, false);
    const e = r.validation.errors.find((x) => x.key === "jitter");
    assert.ok(e, "names the jitter key");
    assert.equal(e.clampTo, 0);
  });

  it("switching to a regular base zeroes jitter via adaptation", async () => {
    const { adaptStateForBase } = await import("../src/adapt-base.js");
    const { patch, warnings } = adaptStateForBase({
      currentState: { base: "random", jitter: 8, wallMm: 1.4, borderMm: 1, openings: true },
      nextBase: "cube",
      nextLimits: { wallMmMax: 30, borderMmMax: 20, filletMmMax: null },
    });
    assert.equal(patch.jitter, 0);
    assert.ok(warnings.length >= 1);
  });
});
