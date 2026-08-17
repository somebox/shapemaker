import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { filletRMax, filletPolygon, insetScale } from "../src/geom/poly2.js";
import { borderPrintabilityWarning, PRINTABLE_BORDER_MM } from "../src/limits.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { SPIKE_T_MAX } from "../src/schema.js";

describe("filletRMax", () => {
  it("matches the clamp used by filletPolygon", () => {
    const square = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const rmax = filletRMax(square);
    const { radius } = filletPolygon(square, 1e9, 8);
    assert.ok(Math.abs(radius - rmax * 0.999) < 1e-9);
  });
});

describe("metrics.limits", () => {
  it("returns proactive ceilings on a successful default compile", () => {
    const { metrics, validation } = compile({});
    assert.equal(validation.ok, true);
    const {
      wallMmMax,
      borderMmMax,
      borderFractionMax,
      filletMmMax,
      roundingMmMax,
    } = metrics.limits;
    assert.ok(wallMmMax > 1.4 && wallMmMax < 50);
    assert.ok(borderMmMax > 3 && borderMmMax < 50);
    assert.equal(borderFractionMax, 0.9);
    assert.ok(filletMmMax > 1 && filletMmMax < 50);
    assert.ok(roundingMmMax > 1);
    assert.equal(metrics.limits.spikeMin, 0);
    assert.equal(metrics.limits.spikeMax, SPIKE_T_MAX);
    assert.ok(1.4 <= wallMmMax);
    // Relative border: applied mm spreads across face sizes.
    assert.ok(metrics.borderMm.min > 0);
    assert.ok(metrics.borderMm.max >= metrics.borderMm.min);
  });

  it("nulls wall/border/fillet limits for solid closed shells; rounding stays live", () => {
    const { metrics, validation } = compile({
      depth: "solid",
      openings: false,
      wallMm: 1.4,
    });
    assert.equal(validation.ok, true);
    assert.equal(metrics.limits.wallMmMax, null);
    assert.equal(metrics.limits.borderMmMax, null);
    assert.equal(metrics.limits.filletMmMax, null);
    // Dihedral rounding applies to solid/closed models too.
    assert.ok(metrics.limits.roundingMmMax > 1);
  });

  it("filletRMax on inset is the geometric source", () => {
    const square = [[10, 10], [-10, 10], [-10, -10], [10, -10]];
    const inset = insetScale(square, 0.3);
    assert.ok(filletRMax(inset) < filletRMax(square));
  });

  it("filletMmMax shrinks when border widens", () => {
    const thin = compile({ borderMm: 2 });
    const wide = compile({ borderMm: 8 });
    assert.equal(thin.validation.ok, true);
    assert.equal(wide.validation.ok, true);
    assert.ok(wide.metrics.limits.filletMmMax < thin.metrics.limits.filletMmMax);
  });

  it("requested fillet above the limit still compiles with applied clamp", () => {
    const { metrics, validation } = compile({ filletMm: 100 });
    assert.equal(validation.ok, true);
    assert.ok(metrics.limits.filletMmMax < 100);
    // Proactive ceiling is the tightest face; larger faces may apply more.
    assert.ok(
      Math.abs(metrics.filletMm.min - metrics.limits.filletMmMax) < 1e-6,
    );
    assert.ok(metrics.filletMm.max > metrics.limits.filletMmMax);
    assert.ok(metrics.filletMm.max < 100);
  });

  it("filletMmMax stays usable after subdivision (uses pre-subdiv ceiling)", () => {
    const plain = compile({ base: "sphere", points: 24, subdiv: 0 });
    const once = compile({ base: "sphere", points: 24, subdiv: 1 });
    assert.equal(plain.validation.ok, true);
    assert.equal(once.validation.ok, true);
    assert.ok(once.metrics.limits.filletMmMax > 1,
      `subdiv fillet ceiling too tight: ${once.metrics.limits.filletMmMax}`);
    // Ceiling should track the unsubdivided authoring solid, not collapse.
    assert.ok(
      once.metrics.limits.filletMmMax >= plain.metrics.limits.filletMmMax * 0.9,
    );
  });

  it("roundingMmMax stays usable after subdivision (uses pre-subdiv ceiling)", () => {
    const plain = compile({ base: "cube", subdiv: 0 });
    const once = compile({ base: "cube", subdiv: 1 });
    assert.equal(plain.validation.ok, true);
    assert.equal(once.validation.ok, true);
    assert.ok(once.metrics.limits.roundingMmMax > 0.5,
      `subdiv rounding ceiling too tight: ${once.metrics.limits.roundingMmMax}`);
    assert.ok(
      once.metrics.limits.roundingMmMax >= plain.metrics.limits.roundingMmMax * 0.9,
    );
  });

  it("grid subdiv shrinks borderMmMax vs radial (style is a reshape)", () => {
    // Pattern switch changes face size → border ceiling. Without treating
    // subdivStyle as a skeleton reshape, a wide border can go invalid.
    const radial = compile({ base: "cube", subdiv: 1, subdivStyle: "radial", borderMm: 0.6 });
    const grid = compile({ base: "cube", subdiv: 1, subdivStyle: "grid", borderMm: 0.6 });
    assert.equal(radial.validation.ok, true);
    assert.equal(grid.validation.ok, true);
    assert.ok(
      grid.metrics.limits.borderMmMax > radial.metrics.limits.borderMmMax,
      `grid (${grid.metrics.limits.borderMmMax}) should allow wider borders than radial (${radial.metrics.limits.borderMmMax})`,
    );
  });
});

describe("borderPrintabilityWarning", () => {
  it("warns when the shape's border ceiling is below the printable floor", () => {
    const w = borderPrintabilityWarning(
      { openings: true },
      { borderMmMax: 1.2 },
    );
    assert.ok(w);
    assert.equal(w.key, "borderMm");
    assert.match(w.message, /printable floor/i);
    assert.match(w.message, /scale up or reduce density/i);
  });

  it("stays silent with closed faces, roomy ceilings, or no ceiling", () => {
    assert.equal(
      borderPrintabilityWarning({ openings: false }, { borderMmMax: 1.2 }),
      null,
    );
    assert.equal(
      borderPrintabilityWarning({ openings: true }, { borderMmMax: PRINTABLE_BORDER_MM }),
      null,
    );
    assert.equal(
      borderPrintabilityWarning({ openings: true }, { borderMmMax: null }),
      null,
    );
  });

  it("fires on a plain compile of a dense shape — load paths see it too", () => {
    clearPipelineCache();
    const result = compile({
      base: "sphere",
      points: 60,
      circumdiameterMm: 30,
      borderMm: 0.8,
      filletMm: 1,
    });
    assert.equal(result.validation.ok, true);
    assert.ok(result.metrics.limits.borderMmMax < PRINTABLE_BORDER_MM,
      "test premise: dense sphere's ceiling is below the floor");
    assert.ok(
      result.validation.warnings.some(
        (w) => w.key === "borderMm" && /printable floor/i.test(w.message),
      ),
      "compile carries the guidance warning",
    );
  });
});
