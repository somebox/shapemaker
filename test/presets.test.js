import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePresetsEnvelope } from "../src/presets.js";
import { statesEqual } from "../src/schema.js";
import { compile } from "../src/compile.js";
import { countPlanes } from "../src/solid/spike.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envelope = JSON.parse(
  readFileSync(join(__dirname, "..", "presets.json"), "utf8"),
);

describe("presets.json", () => {
  it("validates the shipped star presets", () => {
    const r = parsePresetsEnvelope(envelope);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.presets.length, 7);
    const planes = {
      "stella-octangula": 8,
      "small-stellated-dodeca": 12,
      "small-triambic-icosa": 20,
      "great-stellated-dodeca": 12,
      "great-dodecahedron": 12,
    };
    for (const p of r.presets.filter((q) => q.id in planes)) {
      assert.ok(p.state.spike > 0, p.id);
      const c = compile(p.state);
      assert.equal(c.validation.ok, true, `${p.id}: ${c.validation.errors[0]?.message}`);
      assert.equal(countPlanes(c.skeleton), planes[p.id], p.id);
    }
  });

  it("ships ring-ball presets: dual cells with ellipse openings, printable as shipped", () => {
    const r = parsePresetsEnvelope(envelope);
    assert.equal(r.ok, true, r.error);
    const rings = r.presets.filter((p) => p.state.openingStyle === "ellipse");
    assert.deepEqual(rings.map((p) => p.id), ["ring-ball", "ring-lantern"]);
    for (const p of rings) {
      assert.equal(p.state.dual, true, p.id);
      const c = compile(p.state);
      assert.equal(c.validation.ok, true, `${p.id}: ${c.validation.errors[0]?.message}`);
      assert.deepEqual(c.validation.warnings, [], `${p.id} ships with a warning`);
      // Dual cells, not the parent's triangles.
      assert.ok(c.skeleton.faces.every((f) => f.length >= 5), p.id);
    }
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
