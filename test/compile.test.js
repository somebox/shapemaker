import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { writeBinaryStl } from "../src/export/stl.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(__dirname, "reference.json"), "utf8"));

describe("compile", () => {
  clearPipelineCache();
  const result = compile();

  it("returns the contract shape", () => {
    assert.ok(result.skeleton);
    assert.ok(result.mesh);
    assert.ok(result.metrics);
    assert.ok(result.validation.ok);
    assert.ok(result.orientation);
    assert.equal(result.skeleton.faces.length, 32);
    assert.equal(result.skeleton.edges.length, 60);
  });

  it("defaults to a pentagon resting face", () => {
    const fi = result.orientation.faceIndex;
    assert.equal(result.skeleton.faces[fi].length, 5);
  });

  it("matches reference triangle count and volume", () => {
    assert.equal(result.metrics.triangleCount, ref.triangleCount);
    const rel = Math.abs(result.metrics.volumeCm3 - ref.volumeCm3) / ref.volumeCm3;
    assert.ok(rel < ref.volumeRelEps, `volume rel err ${rel}`);
  });

  it("pentagon-down height ≈ 2×r5", () => {
    assert.ok(
      Math.abs(result.metrics.heightMm - ref.pentagonDownHeightMm) < ref.heightEpsMm,
      `height ${result.metrics.heightMm} vs ${ref.pentagonDownHeightMm}`,
    );
    assert.ok(Math.abs(result.metrics.bboxMm.min[2]) < 1e-6, "z_min should be 0");
  });

  it("does not rebuild solid when only faceIndex changes", () => {
    const a = compile({ faceIndex: result.orientation.faceIndex });
    const otherPent = result.skeleton.faces.findIndex(
      (f, i) => f.length === 5 && i !== result.orientation.faceIndex,
    );
    const b = compile({ faceIndex: otherPent });
    assert.equal(a.mesh.positions64, b.mesh.positions64); // same cached buffer
    assert.notEqual(a.orientation.faceIndex, b.orientation.faceIndex);
  });

  it("headless STL export is 84 + 50*7200 bytes", () => {
    const buf = writeBinaryStl(result.mesh, {
      header: "shapemaker",
      matrix: result.orientation.matrix,
    });
    assert.equal(buf.byteLength, 84 + 50 * ref.triangleCount);
  });
});

describe("orientation places the chosen face on the plate", () => {
  clearPipelineCache();
  const result = compile();
  const { matrix, faceIndex } = result.orientation;

  it("maps the resting face normal to −Z", () => {
    const ring = result.skeleton.faces[faceIndex];
    const p = result.skeleton.positions;
    let cx = 0, cy = 0, cz = 0;
    for (const vi of ring) {
      cx += p[vi * 3]; cy += p[vi * 3 + 1]; cz += p[vi * 3 + 2];
    }
    const n = ring.length;
    const L = Math.hypot(cx / n, cy / n, cz / n);
    // Rotate the (radial) face normal by the matrix' rotation block.
    const nx = cx / n / L, ny = cy / n / L, nz = cz / n / L;
    const zOut = matrix[2] * nx + matrix[6] * ny + matrix[10] * nz;
    assert.ok(Math.abs(zOut + 1) < 1e-9, `face normal → ${zOut}, expected −1`);
  });

  it("puts every mesh vertex at or above the plate", () => {
    const pos = result.mesh.positions64;
    let zMin = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const z = matrix[2] * pos[i] + matrix[6] * pos[i + 1] + matrix[10] * pos[i + 2] + matrix[14];
      if (z < zMin) zMin = z;
    }
    assert.ok(Math.abs(zMin) < 1e-9, `lowest mesh vertex at z=${zMin}, expected 0`);
  });
});
