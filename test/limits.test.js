import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { filletRmax, filletPolygon, insetScale } from "../src/geom/poly2.js";
import { borderPrintabilityWarning, PRINTABLE_BORDER_MM } from "../src/limits.js";
import { clearPipelineCache } from "../src/pipeline.js";

describe("filletRmax", () => {
  it("matches the clamp used by filletPolygon", () => {
    const square = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const rmax = filletRmax(square);
    const { radius } = filletPolygon(square, 1e9, 8);
    assert.ok(Math.abs(radius - rmax * 0.999) < 1e-9);
  });
});

describe("metrics.limits", () => {
  it("returns proactive ceilings on a successful default compile", () => {
    const { metrics, validation } = compile({});
    assert.equal(validation.ok, true);
    const { wallMmMax, borderMmMax, filletMmMax } = metrics.limits;
    assert.ok(wallMmMax > 1.4 && wallMmMax < 50);
    assert.ok(borderMmMax > 3.2 && borderMmMax < 50);
    assert.ok(filletMmMax > 4.5 && filletMmMax < 50);
    assert.ok(1.4 <= wallMmMax);
    assert.ok(3.2 <= borderMmMax);
  });

  it("nulls wall/border/fillet limits for solid closed shells", () => {
    const { metrics, validation } = compile({
      depth: "solid",
      openings: false,
      wallMm: 1.4,
    });
    assert.equal(validation.ok, true);
    assert.equal(metrics.limits.wallMmMax, null);
    assert.equal(metrics.limits.borderMmMax, null);
    assert.equal(metrics.limits.filletMmMax, null);
  });

  it("filletRmax on inset is the geometric source", () => {
    const square = [[10, 10], [-10, 10], [-10, -10], [10, -10]];
    const inset = insetScale(square, 0.3);
    assert.ok(filletRmax(inset) < filletRmax(square));
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
