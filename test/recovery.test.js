// Recovering from a failed build: limits survive the failure, and every
// error that names a value that fits can be applied in one click.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile, limitsForState } from "../src/compile.js";
import { adaptStateForBase } from "../src/adapt-base.js";
import { fixPatch } from "../src/controls.js";
import { CONTROL_DEFS } from "../src/schema.js";

describe("failed compiles keep the shape's limits", () => {
  it("a wall error still reports the wall ceiling", () => {
    const r = compile({ base: "cube", wallMm: 40 });
    assert.equal(r.validation.ok, false);
    assert.ok(r.limits.wallMmMax > 1 && r.limits.wallMmMax < 40);
  });

  it("a state whose skeleton cannot build has no limits, and does not throw", () => {
    assert.equal(limitsForState({ base: "nope" }), null);
    assert.equal(compile({ base: "nope" }).limits, null);
  });
});

describe("fixPatch", () => {
  it("rounds a range fix down to the control step", () => {
    const fix = fixPatch({ key: "wallMm", clampTo: 1.2345 }, CONTROL_DEFS);
    assert.deepEqual(fix.patch, { wallMm: 1.2 });
    assert.equal(fix.label, "1.2 mm");
  });

  it("converts through the control's UI units", () => {
    const fix = fixPatch({ key: "borderFraction", clampTo: 0.9 }, CONTROL_DEFS);
    assert.equal(fix.patch.borderFraction, 0.9);
    assert.match(fix.label, /^90/);
  });

  it("maps segment values to their option, booleans included", () => {
    assert.deepEqual(fixPatch({ key: "openings", clampTo: false }, CONTROL_DEFS),
      { patch: { openings: false }, label: "Closed" });
    assert.equal(fixPatch({ key: "wallMode", clampTo: "even" }, CONTROL_DEFS).label, "Even");
  });

  it("keeps a deliberate zero and covers the legacy mm border", () => {
    assert.deepEqual(fixPatch({ key: "spike", clampTo: 0 }, CONTROL_DEFS).patch, { spike: 0 });
    assert.deepEqual(fixPatch({ key: "borderMm", clampTo: 2.37 }, CONTROL_DEFS).patch, { borderMm: 2.3 });
  });

  it("offers nothing without a control or a value", () => {
    assert.equal(fixPatch({ key: "compile", clampTo: 1 }, CONTROL_DEFS), null);
    assert.equal(fixPatch({ key: "wallMm" }, CONTROL_DEFS), null);
  });

  for (const state of [
    { base: "cube", wallMm: 40 },
    { base: "cube", wallMm: 40, wallMode: "scaled" },
    { base: "globe", spike: 0.6 },
    { base: "cube", borderMm: 40 },
  ]) {
    it(`applying the fix builds: ${JSON.stringify(state)}`, () => {
      const r = compile(state);
      assert.equal(r.validation.ok, false);
      const fix = fixPatch(r.validation.errors[0], CONTROL_DEFS);
      assert.ok(fix, r.validation.errors[0].message);
      const fixed = compile({ ...state, ...fix.patch });
      assert.equal(fixed.validation.ok, true, fixed.validation.errors[0]?.message);
    });
  }
});

describe("Size edits adapt the wall", () => {
  it("shrinking the shape reduces a wall that no longer fits", () => {
    const state = { base: "cube", wallMm: 12 };
    assert.equal(compile(state).validation.ok, true);
    const small = { ...state, circumdiameterMm: 30 };
    assert.equal(compile(small).validation.ok, false);
    const { patch, warnings } = adaptStateForBase({
      currentState: small, nextBase: "cube", nextLimits: limitsForState(small),
    });
    assert.ok(patch.wallMm < 12 && warnings.length === 1);
    assert.equal(compile({ ...small, ...patch }).validation.ok, true);
  });
});
