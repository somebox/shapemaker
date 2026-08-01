/**
 * On-sphere jitter: identity at zero, determinism under seed, merge-skip
 * for any jittered base, and full-pipeline validity.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  jitterPoints,
  JITTER_AMPLITUDE_SCALE,
} from "../src/points/jitter.js";
import { cubePoints } from "../src/points/platonic.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { nearestFaceByNormal } from "../src/orient.js";
import { toFaceFrame } from "../src/faceframe.js";

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

  it("radial mode moves radii, renormalized to unit circumradius", () => {
    const src = cubePoints();
    const out = jitterPoints(src, { seed: 42, jitter: 10, mode: "radial" });
    let maxR = 0, minR = Infinity;
    for (let i = 0; i < out.length; i += 3) {
      const r = Math.hypot(out[i], out[i + 1], out[i + 2]);
      maxR = Math.max(maxR, r);
      minR = Math.min(minR, r);
    }
    assert.ok(Math.abs(maxR - 1) < 1e-12, `circumradius ${maxR}`);
    assert.ok(minR < 1 - 1e-6, "some point moved inward");
  });

  it("modes rework the same randomness — deterministic per mode, distinct across", () => {
    const src = cubePoints();
    const surface = jitterPoints(src, { seed: 7, jitter: 8, mode: "surface" });
    const radial = jitterPoints(src, { seed: 7, jitter: 8, mode: "radial" });
    const both = jitterPoints(src, { seed: 7, jitter: 8, mode: "both" });
    assert.deepEqual(
      Array.from(jitterPoints(src, { seed: 7, jitter: 8, mode: "radial" })),
      Array.from(radial),
    );
    assert.notDeepEqual(Array.from(surface), Array.from(radial));
    assert.notDeepEqual(Array.from(surface), Array.from(both));
  });

  it("keeps every point on the sphere within the soft arc budget", () => {
    const src = cubePoints();
    const jitter = 15; // UI percent → max arc after experimental scale
    const out = jitterPoints(src, { seed: 42, jitter });
    const budget = (jitter / 100) * JITTER_AMPLITUDE_SCALE;
    for (let i = 0; i < out.length; i += 3) {
      const r = Math.hypot(out[i], out[i + 1], out[i + 2]);
      assert.ok(Math.abs(r - 1) < 1e-12, `radius drifted: ${r}`);
      const dot =
        out[i] * src[i] + out[i + 1] * src[i + 1] + out[i + 2] * src[i + 2];
      const arc = Math.acos(Math.max(-1, Math.min(1, dot)));
      assert.ok(arc <= budget + 1e-9, `arc ${arc} exceeds budget ${budget}`);
    }
  });
});

describe("jitter through the pipeline", () => {
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
    const r = compile({ ...FIT, jitter: 65 });
    assert.equal(r.validation.ok, false);
    assert.ok(r.validation.errors.some((e) => e.key === "jitter"));
  });

  it("jitter on a regular base keeps polygonal faces (plane perturbation)", () => {
    clearPipelineCache();
    const zero = compile({ base: "cube", jitter: 0 });
    clearPipelineCache();
    const j = compile({ base: "cube", jitter: 5 });
    assert.equal(j.validation.ok, true, j.validation.errors[0]?.message);
    assert.equal(
      j.skeleton.faces.length,
      zero.skeleton.faces.length,
      "face count survives jitter — no triangle shatter",
    );
    assert.ok(j.skeleton.faces.every((f) => f.length === 4), "quads stay quads");
    assertMeshInvariants(j.mesh);
  });

  it("adaptation leaves jitter when leaving random (start-from owns reset)", async () => {
    const { adaptStateForBase } = await import("../src/adapt-base.js");
    const { patch, warnings } = adaptStateForBase({
      currentState: {
        base: "random",
        jitter: 8,
        wallMm: 1.4,
        borderMm: 1,
        openings: true,
      },
      nextBase: "cube",
      nextLimits: { wallMmMax: 30, borderMmMax: 20, filletMmMax: null },
    });
    assert.equal(patch.jitter, undefined);
    assert.deepEqual(warnings, []);
  });

  it("nearestFaceByNormal keeps resting orientation under merge-skip jitter", () => {
    const fit = {
      base: "icosidodeca",
      openings: true,
      borderMm: 3.2,
      filletMm: 4.5,
      wallMm: 1.4,
      faceIndex: 20,
    };
    clearPipelineCache();
    const exact = compile({ ...fit, jitter: 0 });
    const n0 = toFaceFrame(exact.skeleton, exact.state.faceIndex).normal;
    clearPipelineCache();
    const jittered = compile({ ...fit, jitter: 2, faceIndex: exact.state.faceIndex });
    // Naive keep-by-index lands on a different geometric face after shatter.
    const naiveN = toFaceFrame(jittered.skeleton, exact.state.faceIndex).normal;
    assert.ok(
      naiveN[0] * n0[0] + naiveN[1] * n0[1] + naiveN[2] * n0[2] < 0.5,
      "precondition: index 20 is not the same underside after merge-skip",
    );
    const mapped = nearestFaceByNormal(jittered.skeleton, n0);
    const mappedN = toFaceFrame(jittered.skeleton, mapped).normal;
    const dot = mappedN[0] * n0[0] + mappedN[1] * n0[1] + mappedN[2] * n0[2];
    assert.ok(dot > 0.999, `remapped normal drift: dot=${dot}`);
  });
});
