import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePresetsEnvelope } from "../src/presets.js";
import { statesEqual } from "../src/schema.js";
import { compile } from "../src/compile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envelope = JSON.parse(
  readFileSync(join(__dirname, "..", "presets.json"), "utf8"),
);

describe("presets.json", () => {
  it("validates, compiles, and exposes resolved comparison state", () => {
    const r = parsePresetsEnvelope(envelope);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.presets.length, 2);
    assert.equal(r.presets[0].id, "prototype-tpu");
    assert.equal(r.presets[1].id, "solid-dodeca");

    for (const p of r.presets) {
      const c = compile(p.state);
      assert.equal(c.validation.ok, true);
      assert.equal(statesEqual(c.state, p.resolved), true);
    }
  });

  it("rejects duplicate ids", () => {
    const bad = structuredClone(envelope);
    bad.presets.push({ ...bad.presets[0], name: "Dup" });
    const r = parsePresetsEnvelope(bad);
    assert.equal(r.ok, false);
    assert.match(r.error, /Duplicate/);
  });
});
