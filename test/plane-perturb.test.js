/**
 * Plane-perturbation jitter — regular bases keep planar polygonal faces
 * under jitter; vertices re-derived by re-intersecting perturbed planes
 * via the dual hull.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { perturbSkeletonPlanes } from "../src/plane-perturb.js";
import { hullSkeletonForBase, clearPipelineCache } from "../src/pipeline.js";
import { assertSkeleton } from "../src/skeleton.js";
import { compile } from "../src/compile.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { toFaceFrame } from "../src/faceframe.js";

/** Exact merged unit skeleton for a regular base. */
function exact(base) {
  clearPipelineCache();
  return hullSkeletonForBase(base, { jitter: 0 });
}

describe("perturbSkeletonPlanes", () => {
  it("jitter 0 returns the input untouched", () => {
    const cube = exact("cube");
    assert.equal(perturbSkeletonPlanes(cube, { seed: 1, jitter: 0 }), cube);
  });

  it("valence-3 bases keep their exact topology", () => {
    for (const [base, faces, verts, sides] of [
      ["tetrahedron", 4, 4, 3],
      ["cube", 6, 8, 4],
      ["dodecahedron", 12, 20, 5],
    ]) {
      const out = perturbSkeletonPlanes(exact(base), { seed: 7, jitter: 10 });
      assert.equal(out.faces.length, faces, `${base} face count`);
      assert.equal(out.positions.length / 3, verts, `${base} vertex count`);
      assert.ok(
        out.faces.every((f) => f.length === sides),
        `${base}: every face keeps ${sides} sides`,
      );
      assertSkeleton(out);
    }
  });

  it("valence-4+ vertices split but faces survive (icosidodeca 32 stays 32)", () => {
    const out = perturbSkeletonPlanes(exact("icosidodeca"), { seed: 7, jitter: 2 });
    assert.equal(out.faces.length, 32, "no 32→56 shatter");
    // Each valence-4 vertex splits into two valence-3 vertices.
    assert.equal(out.positions.length / 3, 60);
    assertSkeleton(out);
  });

  it("perturbed faces stay planar within the skeleton tolerance", () => {
    // assertSkeleton inside the call enforces planarity at 1e-7·R; run a
    // spread of seeds and amplitudes to shake out degenerate draws.
    for (const seed of [0, 1, 42, 1337, 0xffffffff]) {
      for (const jitter of [0.5, 5, 20]) {
        perturbSkeletonPlanes(exact("icosahedron"), { seed, jitter });
      }
    }
  });

  it("radial mode keeps face normals axis-aligned on a cube", () => {
    const base = exact("cube");
    const radial = perturbSkeletonPlanes(base, { seed: 3, jitter: 10, mode: "radial" });
    // Offset-only: the six axis-aligned normals survive exactly.
    for (let f = 0; f < radial.faces.length; f++) {
      const n = toFaceFrame(radial, f).normal.map(Math.abs).sort((a, b) => a - b);
      assert.ok(n[2] > 1 - 1e-9, "normal stays axis-aligned under radial jitter");
    }
    const surface = perturbSkeletonPlanes(base, { seed: 3, jitter: 10, mode: "surface" });
    assert.notDeepEqual(Array.from(surface.positions), Array.from(radial.positions));
  });

  it("is deterministic per seed and differs across seeds", () => {
    const base = exact("dodecahedron");
    const a = perturbSkeletonPlanes(base, { seed: 9, jitter: 5 });
    const b = perturbSkeletonPlanes(base, { seed: 9, jitter: 5 });
    const c = perturbSkeletonPlanes(base, { seed: 10, jitter: 5 });
    assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
    assert.notDeepEqual(Array.from(a.positions), Array.from(c.positions));
  });

  it("moves geometry away from the exact solid", () => {
    const base = exact("cube");
    const out = perturbSkeletonPlanes(base, { seed: 3, jitter: 5 });
    assert.notDeepEqual(Array.from(out.positions), Array.from(base.positions));
  });

  it("output is unit circumradius", () => {
    const out = perturbSkeletonPlanes(exact("octahedron"), { seed: 5, jitter: 20 });
    let max = 0;
    for (let i = 0; i < out.positions.length; i += 3) {
      max = Math.max(
        max,
        Math.hypot(out.positions[i], out.positions[i + 1], out.positions[i + 2]),
      );
    }
    assert.ok(Math.abs(max - 1) < 1e-12, `circumradius ${max}`);
  });
});

describe("plane perturbation through the pipeline", () => {
  it("every regular base compiles watertight across amplitudes", () => {
    for (const base of [
      "tetrahedron",
      "cube",
      "octahedron",
      "dodecahedron",
      "icosahedron",
      "icosidodeca",
    ]) {
      for (const jitter of [0.5, 5, 20]) {
        clearPipelineCache();
        const r = compile({ base, jitter, seed: 1337 });
        assert.equal(
          r.validation.ok,
          true,
          `${base} j${jitter}: ${r.validation.errors[0]?.message}`,
        );
        assertMeshInvariants(r.mesh);
      }
    }
  });

  it("fillet effect survives the first jitter step (micro edges swallowed)", () => {
    // Regression: split-vertex micro edges used to clamp a face's whole
    // fillet to ~1.5× their own length (0.01 mm at jitter 0.5) and drag the
    // slider ceiling with it. The opening path collapses micro edges and the
    // face frame uses the area centroid, so the requested radius holds.
    clearPipelineCache();
    const exact = compile({ base: "icosidodeca", jitter: 0, filletMm: 4.5 });
    clearPipelineCache();
    const j = compile({ base: "icosidodeca", jitter: 0.5, seed: 1337, filletMm: 4.5 });
    assert.equal(j.validation.ok, true, j.validation.errors[0]?.message);
    assert.ok(
      j.metrics.filletMm.min > 4.4,
      `applied fillet collapsed: ${j.metrics.filletMm.min}`,
    );
    const ceiling0 = exact.metrics.limits.filletMmMax;
    const ceiling = j.metrics.limits.filletMmMax;
    assert.ok(
      ceiling > ceiling0 * 0.95,
      `fillet ceiling cliff at first step: ${ceiling0} → ${ceiling}`,
    );
  });

  it("fillet holds across bases and mid amplitudes", () => {
    for (const base of ["octahedron", "icosahedron", "icosidodeca"]) {
      clearPipelineCache();
      const r = compile({ base, jitter: 2, seed: 1337, filletMm: 4.5 });
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
      assert.ok(
        r.metrics.filletMm.min > 4.4,
        `${base}: applied fillet ${r.metrics.filletMm.min}`,
      );
      assertMeshInvariants(r.mesh);
    }
  });

  it("random base still uses on-sphere point jitter (triangulated)", () => {
    clearPipelineCache();
    const r = compile({
      base: "random",
      jitter: 5,
      borderMm: 1,
      filletMm: 1.5,
    });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.ok(r.skeleton.faces.every((f) => f.length === 3), "hull triangles");
  });
});
