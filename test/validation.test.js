/**
 * compile() boundary tests.
 *
 * The contract: compile never throws for user-reachable input, and every
 * rejection names the parameter at fault. A message that leaks an
 * implementation invariant ("mesh is not closed", "signed volume is not
 * positive", "not star-shaped") is a validation bug, so these tests assert
 * against that vocabulary explicitly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";

/** Phrases that mean an internal invariant escaped instead of being validated. */
const LEAKED = /not closed|signed volume|star-shaped|boundary edge|undefined|NaN/i;

function compileFresh(state) {
  clearPipelineCache();
  return compile(state);
}

describe("compile() rejects invalid state without throwing", () => {
  const cases = [
    ["zero diameter", { circumdiameterMm: 0 }, "circumdiameterMm"],
    ["negative diameter", { circumdiameterMm: -50 }, "circumdiameterMm"],
    ["negative wall", { wallMm: -1 }, "wallMm"],
    ["zero wall", { wallMm: 0 }, "wallMm"],
    ["edgeDiv 0", { edgeDiv: 0 }, "edgeDiv"],
    ["edgeDiv fractional", { edgeDiv: 2.5 }, "edgeDiv"],
    ["negative fillet", { filletMm: -0.1 }, "filletMm"],
    ["negative rounding", { roundingMm: -0.1 }, "roundingMm"],
    ["negative border", { borderMm: -2 }, "borderMm"],
    ["unknown base", { base: "bogus" }, "base"],
    ["unknown depth", { depth: "squishy" }, "depth"],
    ["solid with openings", { depth: "solid", openings: true }, "openings"],
    // Globe reaches geometric-stage failures through ordinary sliders
    // (near-pole faces shrink fast) — its messages must stay clean too.
    [
      "globe: border too wide at max density",
      { base: "globe", points: 36, borderMm: 1, filletMm: 1.5 },
      "borderMm",
    ],
    [
      "globe: jittered pole faces reject the recipe border",
      { base: "globe", jitter: 3, seed: 1, borderMm: 1, filletMm: 1.5 },
      "borderMm",
    ],
  ];

  for (const [name, state, expectedKey] of cases) {
    it(`${name} → structured error on "${expectedKey}"`, () => {
      let result;
      assert.doesNotThrow(() => { result = compileFresh(state); }, `${name} threw`);
      assert.equal(result.validation.ok, false, `${name} should be invalid`);
      assert.equal(result.mesh, null, "no mesh on failure");

      const keys = result.validation.errors.map((e) => e.key);
      assert.ok(keys.includes(expectedKey), `expected key "${expectedKey}", got ${keys.join()}`);

      for (const e of result.validation.errors) {
        assert.ok(e.stage, "error names a stage");
        assert.ok(!LEAKED.test(e.message), `leaked internal invariant: "${e.message}"`);
      }
    });
  }
});

describe("compile() geometric constraints", () => {
  it("border wider than the smallest face is rejected, naming the faces", () => {
    const r = compileFresh({ borderMm: 999 });
    assert.equal(r.validation.ok, false);
    const e = r.validation.errors[0];
    assert.equal(e.key, "borderMm");
    assert.ok(e.clampTo > 0, "offers a clamp value");
    assert.ok(Array.isArray(e.faceIds) && e.faceIds.length, "points at the limiting face");
  });

  it("wall thicker than the shell is rejected, naming wallMm", () => {
    const r = compileFresh({ wallMm: 500 });
    assert.equal(r.validation.ok, false);
    assert.equal(r.validation.errors[0].key, "wallMm");
    assert.ok(!LEAKED.test(r.validation.errors[0].message));
  });
});

describe("compile() recovers from a stale resting face", () => {
  it("out-of-range faceIndex warns and falls back instead of failing", () => {
    const r = compileFresh({ faceIndex: 999 });
    assert.equal(r.validation.ok, true, "still builds — shared links must survive");
    assert.ok(r.mesh, "mesh is produced");
    const w = r.validation.warnings.find((x) => x.key === "faceIndex");
    assert.ok(w, "warns about the missing face");
    assert.equal(w.clampTo, r.orientation.faceIndex);
    assert.equal(r.skeleton.faces[r.orientation.faceIndex].length, 5, "falls back to a pentagon");
  });

  it("negative faceIndex is treated as 'auto', with no warning", () => {
    const r = compileFresh({ faceIndex: -1 });
    assert.equal(r.validation.ok, true);
    assert.equal(r.validation.warnings.length, 0);
  });
});

describe("border has exactly one authoritative spelling", () => {
  it("an explicit borderFraction displaces the default borderMm", () => {
    const mm = compileFresh({});
    const frac = compileFresh({ borderFraction: 0.28 });
    assert.equal(frac.validation.ok, true, frac.validation.errors[0]?.message);
    assert.notEqual(
      frac.metrics.volumeCm3, mm.metrics.volumeCm3,
      "fraction must change the shape, not be silently ignored",
    );
    // A constant fraction scales border with face size, so mm must vary.
    assert.ok(
      frac.metrics.borderMm.max - frac.metrics.borderMm.min > 1,
      `expected a spread of mm widths, got ${JSON.stringify(frac.metrics.borderMm)}`,
    );
    // A constant mm is uniform across every face.
    assert.ok(
      Math.abs(mm.metrics.borderMm.max - mm.metrics.borderMm.min) < 1e-9,
      "constant mm should be uniform",
    );
  });

  it("supplying both spellings is rejected, not silently resolved", () => {
    const r = compileFresh({ borderMm: 3.2, borderFraction: 0.28 });
    assert.equal(r.validation.ok, false);
    assert.ok(r.validation.errors.some((e) => /not both/i.test(e.message)));
  });
});

describe("per-face metrics survive irregular faces", () => {
  it("records one entry per face, not one per side-count", () => {
    const r = compileFresh({});
    const fm = r.metrics.faceMetrics;
    assert.equal(fm.length, r.skeleton.faces.length, "one metric per face");
    const seen = new Set(fm.map((f) => f.faceIndex));
    assert.equal(seen.size, fm.length, "face indices are unique");
    assert.ok(r.metrics.openingMinDiameterMm > 0, "reports a real min opening");
    assert.ok(
      r.metrics.filletMm.min <= 4.5 && r.metrics.filletMm.max <= 4.5,
      `requested fillet should clamp only where needed: ${JSON.stringify(r.metrics.filletMm)}`,
    );
  });

  it("clamps the same requested millimetre radius per face when necessary", () => {
    const r = compileFresh({ filletMm: 100 });
    assert.equal(r.validation.ok, true);
    const bySides = new Map();
    for (const f of r.metrics.faceMetrics) {
      bySides.set(f.sides, f.filletUsedMm);
    }
    assert.ok(bySides.get(3) > 0 && bySides.get(5) > 0);
    assert.ok(
      bySides.get(5) > bySides.get(3) * 1.5,
      `pentagon clamp ${bySides.get(5)} should exceed triangle ${bySides.get(3)}`,
    );
  });
});

describe("valid non-default combinations still build", () => {
  it("solid + closed faces produces a watertight body", () => {
    const r = compileFresh({ depth: "solid", openings: false });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.ok(r.metrics.triangleCount > 0);
    assert.equal(r.metrics.watertight, true);
    assert.equal(r.metrics.wallMm.min, null, "solid has no wall measurement");
  });

  it("hollow + closed faces produces a plain shell", () => {
    const r = compileFresh({ depth: "hollow", openings: false });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.ok(r.metrics.volumeCm3 > 0);
  });
});
