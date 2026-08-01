/**
 * Quality lever (M4): one tessellation knob. Fillet arc segments derive from
 * edgeDiv; Quality levels are UI vocabulary over canonical edgeDiv only.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filletSegmentsFor } from "../src/solid/shell.js";
import { QUALITY_LEVELS, qualityLevelFor, STATE_KEYS } from "../src/schema.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { assertMeshInvariants } from "../src/mesh.js";

describe("filletSegmentsFor", () => {
  it("Normal (edgeDiv 10) derives exactly the historical 64", () => {
    assert.equal(filletSegmentsFor(10), 64);
  });

  it("Draft and Fine derive 26 and 128", () => {
    assert.equal(filletSegmentsFor(4), 26);
    assert.equal(filletSegmentsFor(20), 128);
  });

  it("never drops below the degenerate-arc floor", () => {
    assert.ok(filletSegmentsFor(1) >= 4);
  });
});

describe("quality levels are vocabulary, not state", () => {
  it("no new canonical key exists for quality", () => {
    assert.ok(!STATE_KEYS.includes("quality"), "quality must not be canonical");
  });

  it("levels map to edgeDiv 4 / 10 / 20 with Normal as default", () => {
    assert.deepEqual(
      QUALITY_LEVELS.map((q) => [q.id, q.edgeDiv]),
      [["draft", 4], ["normal", 10], ["fine", 20]],
    );
    assert.equal(qualityLevelFor(10), "normal");
    assert.equal(qualityLevelFor(12), null, "non-level values are custom");
  });
});

describe("quality levels compile to valid meshes with expected density", () => {
  // Hollow+open annulus: 3 quads × 2 tris × (Σ sides × edgeDiv)
  // icosidodeca Σ sides = 20×3 + 12×5 = 120 → 720 × edgeDiv triangles.
  const EXPECTED_TRIS = { 4: 2880, 10: 7200, 20: 14400 };

  for (const q of QUALITY_LEVELS) {
    it(`${q.id} (edgeDiv ${q.edgeDiv}) is watertight at expected density`, () => {
      clearPipelineCache();
      const r = compile({ edgeDiv: q.edgeDiv });
      assert.equal(r.validation.ok, true);
      assert.equal(r.metrics.triangleCount, EXPECTED_TRIS[q.edgeDiv]);
      assertMeshInvariants(r.mesh);
    });
  }

  it("Normal keeps the parity anchors untouched (identity-preserving)", () => {
    clearPipelineCache();
    const r = compile({});
    assert.equal(r.state.edgeDiv, 10, "default is Normal");
    assert.equal(r.metrics.triangleCount, 7200);
    const rel = Math.abs(r.metrics.volumeCm3 - 16.14979675) / 16.14979675;
    assert.ok(rel < 1e-4, `volume moved: ${r.metrics.volumeCm3}`);
  });

  it("finer tessellation converges the fillet volume upward", () => {
    // Chorded arcs under-approximate the rounded opening: more segments ⇒
    // opening area grows toward the true curve ⇒ frame volume shrinks
    // monotonically. Draft > Normal > Fine, all within a small band.
    clearPipelineCache();
    const draft = compile({ edgeDiv: 4 }).metrics.volumeCm3;
    clearPipelineCache();
    const normal = compile({ edgeDiv: 10 }).metrics.volumeCm3;
    clearPipelineCache();
    const fine = compile({ edgeDiv: 20 }).metrics.volumeCm3;
    assert.ok(draft > normal && normal > fine, `${draft} > ${normal} > ${fine} failed`);
    assert.ok((draft - fine) / normal < 0.05, "levels differ by more than 5%");
  });
});

describe("Unit 4 policy helpers", () => {
  it("edge input is read-only exactly when the bijection breaks", async () => {
    const { edgeInputReadOnly, densityLevelFor, DENSITY_LEVELS } = await import(
      "../src/schema.js"
    );
    assert.equal(edgeInputReadOnly({ base: "cube", jitter: 0 }), false);
    assert.equal(edgeInputReadOnly({ base: "random", jitter: 0 }), true);
    assert.equal(edgeInputReadOnly({ base: "cube", jitter: 5 }), true);

    // Density levels resolve exactly and only on the locked pairs.
    for (const d of DENSITY_LEVELS) {
      assert.equal(densityLevelFor(d.points, d.separation), d.id);
    }
    assert.equal(densityLevelFor(24, 0.4), null);
  });
});
