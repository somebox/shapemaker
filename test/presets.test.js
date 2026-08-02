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
  it("validates an empty preset list (bases-only chooser)", () => {
    const r = parsePresetsEnvelope(envelope);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.presets.length, 0);
  });

  it("still validates and compiles non-empty envelopes", () => {
    const sample = {
      format: "shapemaker-presets",
      formatVersion: 1,
      presets: [
        {
          id: "demo-cube",
          name: "Demo Cube",
          state: { base: "cube", faceIndex: -1 },
        },
      ],
    };
    const r = parsePresetsEnvelope(sample);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.presets.length, 1);
    assert.equal(r.presets[0].id, "demo-cube");
    const c = compile(r.presets[0].state);
    assert.equal(c.validation.ok, true);
    assert.equal(statesEqual(c.state, r.presets[0].resolved), true);
  });

  it("rejects duplicate ids", () => {
    const bad = {
      format: "shapemaker-presets",
      formatVersion: 1,
      presets: [
        { id: "x", name: "A", state: { base: "cube" } },
        { id: "x", name: "B", state: { base: "cube" } },
      ],
    };
    const r = parsePresetsEnvelope(bad);
    assert.equal(r.ok, false);
    assert.match(r.error, /Duplicate/);
  });
});
