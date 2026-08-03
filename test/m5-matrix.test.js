/**
 * Cheap M5 compile matrix: bases × jitter × subdiv extremes.
 * Full meshcheck lives in scripts/acceptance.sh; this catches validation,
 * limits, and stranded-border regressions without STL export.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { clearPipelineCache, runPipeline } from "../src/pipeline.js";
import { computeLimits } from "../src/limits.js";
import { adaptStateForBase } from "../src/adapt-base.js";
import { BASE_IDS } from "../src/bases.js";
import { DEFAULT_STATE } from "../src/schema.js";

/** Minimum border ceiling that still supports a meaningful open shell. */
const OPEN_BORDER_FLOOR = 0.05;

function skeletonLimits(opts) {
  clearPipelineCache();
  const state = {
    ...DEFAULT_STATE,
    ...opts,
    depth: "hollow",
    openings: false,
  };
  const { skeleton } = runPipeline(state);
  return computeLimits(skeleton, { ...state, openings: true });
}

describe("M5 compile matrix", () => {
  for (const base of BASE_IDS) {
    for (const jitter of [0, 10]) {
      for (const subdiv of [0, 1]) {
        it(`${base} jitter=${jitter} subdiv=${subdiv}`, () => {
          const opts = { base, seed: 1337, jitter, subdiv, soften: 0 };
          const lim = skeletonLimits(opts);
          assert.ok(
            lim.borderMmMax == null ||
              (Number.isFinite(lim.borderMmMax) && lim.borderMmMax > 0),
            "border ceiling must be positive when reported",
          );

          clearPipelineCache();
          if (lim.borderMmMax != null && lim.borderMmMax >= OPEN_BORDER_FLOOR) {
            const borderMm = Math.max(
              OPEN_BORDER_FLOOR,
              Math.min(0.8, lim.borderMmMax * 0.85),
            );
            const result = compile({
              ...opts,
              depth: "hollow",
              openings: true,
              borderMm,
              filletMm: 2,
            });
            assert.equal(result.validation.ok, true, () =>
              JSON.stringify(result.validation.errors),
            );
            assert.ok(result.state.borderMm > 0);
          } else {
            // Tiny faces from jitter×subdiv — openings are not viable; closed
            // must still compile, and adaptation must not strand at 0.
            const closed = compile({
              ...opts,
              depth: "hollow",
              openings: false,
            });
            assert.equal(closed.validation.ok, true, () =>
              JSON.stringify(closed.validation.errors),
            );
          }

          const { patch } = adaptStateForBase({
            currentState: {
              base,
              wallMm: 1.4,
              borderMm: 3.2,
              openings: true,
              ...opts,
            },
            nextBase: base,
            nextLimits: lim,
          });
          if (patch.borderMm != null) {
            assert.ok(patch.borderMm > 0, `adapted border ${patch.borderMm}`);
          }
        });
      }
    }
  }

  it("cube subdiv=2 soften=100 compiles open with positive border ceiling", () => {
    const opts = { base: "cube", subdiv: 2, soften: 100 };
    const lim = skeletonLimits(opts);
    assert.ok(lim.borderMmMax > OPEN_BORDER_FLOOR);
    clearPipelineCache();
    const result = compile({
      ...opts,
      depth: "hollow",
      openings: true,
      borderMm: Math.min(0.8, lim.borderMmMax * 0.85),
      filletMm: 2,
    });
    assert.equal(result.validation.ok, true, () =>
      JSON.stringify(result.validation.errors),
    );
    assert.ok(result.state.borderMm > 0);
  });

  it("roundingMm=0.5 compiles on representative bases", () => {
    for (const opts of [
      { base: "cube" },
      { base: "icosidodeca" },
      { base: "sphere", points: 24, borderMm: 1, filletMm: 1.5 },
      { base: "random", seed: 1337, jitter: 10, borderMm: 1, filletMm: 1.5 },
      { base: "cube", subdiv: 1 },
    ]) {
      clearPipelineCache();
      const r = compile({
        depth: "hollow",
        openings: true,
        wallMm: 1.4,
        borderMm: 2,
        filletMm: 2,
        roundingMm: 0.5,
        ...opts,
      });
      assert.equal(r.validation.ok, true, () =>
        JSON.stringify({ opts, errors: r.validation.errors }),
      );
      assert.ok(r.mesh);
    }
  });
});
