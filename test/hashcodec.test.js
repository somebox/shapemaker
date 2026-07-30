import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeHash, decodeHash } from "../src/hashcodec.js";
import { normalizeState, statesEqual } from "../src/schema.js";
import { compile } from "../src/compile.js";

describe("hashcodec", () => {
  it("round-trips canonical state", () => {
    const state = normalizeState({ wallMm: 2, faceIndex: 5 });
    const hash = encodeHash(state);
    assert.match(hash, /^v1\./);
    const decoded = decodeHash(hash);
    assert.equal(decoded.ok, true);
    assert.equal(statesEqual(decoded.state, state), true);
  });

  it("equal state → equal hash", () => {
    const a = normalizeState({ circumdiameterMm: 100 });
    const b = normalizeState({ circumdiameterMm: 100 });
    assert.equal(encodeHash(a), encodeHash(b));
  });

  it("accepts leading #", () => {
    const state = normalizeState({});
    const h = encodeHash(state);
    assert.equal(decodeHash("#" + h).ok, true);
  });

  it("stale faceIndex still compiles after hash round-trip", () => {
    const state = normalizeState({ faceIndex: 999 });
    const decoded = decodeHash(encodeHash(state));
    assert.equal(decoded.ok, true);
    const result = compile(decoded.state);
    assert.equal(result.validation.ok, true);
    assert.ok(result.validation.warnings.length >= 1);
  });

  it("rejects garbage", () => {
    assert.equal(decodeHash("v1.!!!").ok, false);
    assert.equal(decodeHash("v9.abc").ok, false);
  });
});
