// The Cut library (manifold-3d WASM) loads on demand. Each test file runs in
// its own process, so this one starts with the library unloaded.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { DEFAULT_STATE } from "../src/schema.js";
import { csgLoadError, csgReady, loadCsg, needsCsg } from "../src/solid/csg.js";

const cut = { ...DEFAULT_STATE, base: "cube", openings: true, openingAxis: "through" };

describe("Cut library loading", () => {
  it("only Cut sides on an open hollow shell need it", () => {
    assert.equal(needsCsg(cut), true);
    assert.equal(needsCsg({ ...cut, openingAxis: "normal" }), false);
    assert.equal(needsCsg({ ...cut, openings: false }), false);
    assert.equal(needsCsg({ ...cut, depth: "solid" }), false);
  });

  it("is not loaded by importing compile, and other sides build without it", () => {
    assert.equal(csgReady(), false);
    const r = compile({ ...cut, openingAxis: "normal" });
    assert.equal(r.validation.ok, true);
    assert.equal(csgReady(), false);
  });

  it("reports Cut against Sides until loaded, with Straight as the fix", () => {
    const r = compile(cut);
    assert.equal(r.validation.ok, false);
    const e = r.validation.errors[0];
    assert.equal(e.key, "openingAxis");
    assert.equal(e.clampTo, "normal");
    assert.equal(csgLoadError(), null);
  });

  it("builds Cut once loaded; concurrent loads share one", async () => {
    const a = loadCsg(), b = loadCsg();
    assert.equal(a, b);
    await a;
    assert.equal(csgReady(), true);
    const r = compile(cut);
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
  });
});
