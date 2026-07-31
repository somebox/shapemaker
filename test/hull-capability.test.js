/**
 * Capability harness for the vendored QuickHull library.
 * Determinism of face identity is the wrapper's job — not asserted here.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import quickhull from "../vendor/quickhull3d/quickhull3d.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const vendorRoot = join(__dirname, "..", "vendor", "quickhull3d");

describe("quickhull3d capability harness", () => {
  it("ships MIT licence and pinned version", () => {
    const license = readFileSync(join(vendorRoot, "LICENSE"), "utf8");
    assert.match(license, /MIT/i);
    const version = readFileSync(join(vendorRoot, "VERSION"), "utf8").trim();
    assert.match(version, /^\d+\.\d+\.\d+$/);
  });

  it("is ESM-importable and returns triangle index triples", () => {
    const pts = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const faces = quickhull(pts);
    assert.ok(Array.isArray(faces));
    assert.ok(faces.length >= 4);
    for (const f of faces) {
      assert.equal(f.length, 3);
      for (const i of f) {
        assert.ok(Number.isInteger(i) && i >= 0 && i < pts.length);
      }
    }
  });

  it("does not mutate the input point array", () => {
    const pts = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.2, 0.2, 0.2],
    ];
    const before = JSON.stringify(pts);
    quickhull(pts);
    assert.equal(JSON.stringify(pts), before);
  });

  it("handles a regular cube point set (12 triangles before merge)", () => {
    const cube = [];
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const z of [-1, 1]) cube.push([x, y, z]);
      }
    }
    const faces = quickhull(cube);
    assert.equal(faces.length, 12);
  });

  it("produces a usable hull under input reordering", () => {
    const pts = [
      [1, 1, 1],
      [-1, -1, 1],
      [-1, 1, -1],
      [1, -1, -1],
    ];
    const a = quickhull(pts);
    const b = quickhull([pts[3], pts[1], pts[0], pts[2]]);
    assert.equal(a.length, b.length);
    assert.ok(a.length >= 4);
  });
});

describe("vendored bundle hygiene", () => {
  it("does not probe global localStorage (shapemaker patch intact)", async () => {
    // The bundled `debug` dependency upstream returns the localStorage global,
    // which triggers Node's ExperimentalWarning in every test/acceptance run.
    // The vendored bundle stubs it — see vendor/quickhull3d/README.md. This
    // regression fails if a rebundle drops the patch.
    const src = readFileSync(join(vendorRoot, "quickhull3d.js"), "utf8");
    assert.ok(
      src.includes("[shapemaker patch]"),
      "localStorage stub patch missing from bundle",
    );
    assert.ok(
      !/return localStorage;/.test(src),
      "bundle returns global localStorage — reapply the stub after rebundling",
    );

    const { execFile } = await import("node:child_process");
    const stderr = await new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        ["--input-type=module", "-e", "await import('./src/hull.js');"],
        { cwd: join(__dirname, "..") },
        (err, _out, errText) => (err ? reject(err) : resolve(errText)),
      );
    });
    assert.ok(
      !stderr.includes("localStorage"),
      `importing hull.js warned about localStorage:\n${stderr}`,
    );
  });
});
