import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { computePrintRisk, FLAT_TILT_RAD, OVERHANG_NZ } from "../src/metrics.js";
import { transformPoint } from "../src/orient.js";

describe("print risk (metrics.printRisk)", () => {
  it("resting cube: bed geometry is supported, not risk", () => {
    clearPipelineCache();
    const result = compile({ base: "cube", faceIndex: 0 });
    assert.equal(result.validation.ok, true);
    const risk = result.metrics.printRisk;
    // Bottom rests on the plate, sides are vertical, top faces up — nothing
    // overhangs. (The old scan flagged the bed face itself.)
    assert.deepEqual(risk.overhangFaceIndices, []);
    // Flat-bridge edges: the four top edges only; the four bed-contact
    // edges are first-layer geometry, not bridges.
    assert.equal(risk.flatEdgeIndices.length, 4);
    const { positions, edges } = result.skeleton;
    const M = result.orientation.matrix;
    for (const ei of risk.flatEdgeIndices) {
      for (const vi of edges[ei]) {
        const [, , z] = transformPoint(
          M,
          positions[vi * 3],
          positions[vi * 3 + 1],
          positions[vi * 3 + 2],
        );
        assert.ok(z > 1, `flagged edge touches the bed (z=${z})`);
      }
    }
  });

  it("resting tetrahedron: no risk at all", () => {
    clearPipelineCache();
    const result = compile({ base: "tetrahedron", faceIndex: 0 });
    const risk = result.metrics.printRisk;
    // Bed face excluded; the three sides lean inward-up (nz > 0); the three
    // rising edges are steep, the three bed edges are supported.
    assert.deepEqual(risk.overhangFaceIndices, []);
    assert.deepEqual(risk.flatEdgeIndices, []);
  });

  it("icosahedron: flags leaning lower faces but never the resting face", () => {
    clearPipelineCache();
    const result = compile({ base: "icosahedron" });
    const risk = result.metrics.printRisk;
    assert.ok(risk.overhangFaceIndices.length >= 1, "lower faces overhang");
    assert.ok(
      !risk.overhangFaceIndices.includes(result.state.faceIndex),
      "resting face is supported by the plate",
    );
  });

  it("standalone computePrintRisk matches the compiled metrics", () => {
    clearPipelineCache();
    const result = compile({ base: "icosahedron" });
    const again = computePrintRisk(result.skeleton, result.orientation.matrix);
    assert.deepEqual(again, result.metrics.printRisk);
  });

  it("shared thresholds are exported from metrics", () => {
    assert.ok(FLAT_TILT_RAD > 0);
    assert.ok(OVERHANG_NZ < 0);
  });
});
