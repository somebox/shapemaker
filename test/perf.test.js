/**
 * Interactive-performance policy — threshold and compile-time prediction.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HEAVY_COMPILE_MS, predictedCompileMs } from "../src/perf.js";

describe("predictedCompileMs", () => {
  it("passes the last measurement through when subdiv is unchanged", () => {
    assert.equal(predictedCompileMs(80, { subdiv: 0 }, { subdiv: 0 }), 80);
    assert.equal(predictedCompileMs(80, { subdiv: 2 }, { subdiv: 2 }), 80);
  });

  it("quadruples per added subdivision level", () => {
    assert.equal(predictedCompileMs(50, { subdiv: 0 }, { subdiv: 1 }), 200);
    assert.equal(predictedCompileMs(50, { subdiv: 0 }, { subdiv: 2 }), 800);
  });

  it("shrinks when subdivision decreases, so heavy mode releases promptly", () => {
    assert.equal(predictedCompileMs(400, { subdiv: 2 }, { subdiv: 0 }), 25);
  });

  it("predicts heavy for the first subdiv-2 click from a fast state", () => {
    // A typical light compile (~15 ms) must predict past the threshold when
    // two levels land at once — the case with no prior heavy measurement.
    assert.ok(predictedCompileMs(15, { subdiv: 0 }, { subdiv: 2 }) > HEAVY_COMPILE_MS);
  });

  it("per-face floor catches overhead-dominated fast measurements", () => {
    // Clean dodecahedron: ~5 ms measured, 12 faces. 5×16 = 80 would slip
    // under the threshold; the projected 192-face floor must not.
    const est = predictedCompileMs(5, { subdiv: 0 }, { subdiv: 2 }, 12);
    assert.ok(est > HEAVY_COMPILE_MS, `est ${est}`);
    // A tiny solid stays light: tetrahedron 4 faces → 64 projected.
    const tetra = predictedCompileMs(5, { subdiv: 0 }, { subdiv: 2 }, 4);
    assert.ok(tetra < HEAVY_COMPILE_MS, `est ${tetra}`);
  });

  it("handles missing states and zero history", () => {
    assert.equal(predictedCompileMs(0, null, { subdiv: 2 }), 0);
    assert.equal(predictedCompileMs(60, undefined, undefined), 60);
  });

  it("quadruples when spike turns on (n-gons become n triangles)", () => {
    assert.equal(predictedCompileMs(50, { spike: 0 }, { spike: 1.7 }), 200);
    assert.equal(predictedCompileMs(400, { spike: 1.7 }, { spike: 0 }), 100);
  });

  it("changing spike height is topology-neutral", () => {
    assert.equal(predictedCompileMs(80, { spike: 1.2 }, { spike: 2.4 }), 80);
  });

  it("composes spike and subdiv scales", () => {
    assert.equal(
      predictedCompileMs(50, { subdiv: 0, spike: 0 }, { subdiv: 1, spike: 1.7 }),
      800,
    );
  });
});
