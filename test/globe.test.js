/**
 * Globe base — lat/long meridians, coplanar-merge band quads.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  globePoints,
  globeMeridians,
  GLOBE_MERIDIAN_MIN,
  GLOBE_MERIDIAN_MAX,
} from "../src/points/globe.js";
import { BASES } from "../src/bases.js";
import { hullToSkeleton } from "../src/hull.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { recipeForBase } from "../src/starts.js";

function faceSignature(faces) {
  const m = new Map();
  for (const f of faces) m.set(f.length, (m.get(f.length) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

function expectedTopology(m) {
  const rings = Math.round(m / 2) - 1;
  const V = m * rings + 2;
  const F = m * (rings + 1);
  return { V, F, E: V + F - 2 };
}

describe("globePoints", () => {
  it("is deterministic and unit-radius", () => {
    const a = globePoints({ points: 24 });
    const b = globePoints({ points: 24 });
    assert.deepEqual(Array.from(a), Array.from(b));
    for (let i = 0; i < a.length; i += 3) {
      const r = Math.hypot(a[i], a[i + 1], a[i + 2]);
      assert.ok(Math.abs(r - 1) < 1e-12, `radius drifted: ${r}`);
    }
  });

  it("clamps meridians to 6–36 and defaults to 24 → 266 verts", () => {
    assert.equal(globePoints({ points: 4 }).length / 3, 14); // m=6
    assert.equal(globePoints({ points: 999 }).length / 3, 614); // m=36
    assert.equal(globePoints().length / 3, 266);
  });

  it("advertises the meridian clamp to the UI as pointsRange", () => {
    assert.deepEqual(BASES.globe.pointsRange, {
      min: GLOBE_MERIDIAN_MIN,
      max: GLOBE_MERIDIAN_MAX,
    });
    assert.equal(BASES.sphere.pointsRange, undefined);
  });

  it("normalizeState clamps Density into the globe pointsRange", async () => {
    const { normalizeState } = await import("../src/schema.js");
    assert.equal(normalizeState({ base: "globe", points: 4 }).points, 6);
    assert.equal(normalizeState({ base: "globe", points: 99 }).points, 36);
    assert.equal(normalizeState({ base: "globe", points: 24 }).points, 24);
    // Sphere keeps the full 4–60 band (no pointsRange).
    assert.equal(normalizeState({ base: "sphere", points: 4 }).points, 4);
    assert.equal(normalizeState({ base: "sphere", points: 60 }).points, 60);
  });

  it("places exact poles at (0,0,±1)", () => {
    const pts = globePoints({ points: 24 });
    assert.deepEqual([pts[0], pts[1], pts[2]], [0, 0, 1]);
    assert.deepEqual([pts[3], pts[4], pts[5]], [0, 0, -1]);
  });
});

describe("globe hull (merge on)", () => {
  it("default density merges to [[3,48],[4,240]] with Euler 2", () => {
    const sk = hullToSkeleton(globePoints({ points: 24 }));
    const V = sk.positions.length / 3;
    const F = sk.faces.length;
    const E = sk.edges.length;
    assert.equal(V, 266);
    assert.deepEqual(faceSignature(sk.faces), [
      [3, 48],
      [4, 240],
    ]);
    assert.equal(V - E + F, 2);
  });

  it("band quads are planar and have exactly two z-values", () => {
    const sk = hullToSkeleton(globePoints({ points: 24 }));
    const R = 1;
    for (const face of sk.faces) {
      if (face.length !== 4) continue;
      const p = face.map((i) => [
        sk.positions[i * 3],
        sk.positions[i * 3 + 1],
        sk.positions[i * 3 + 2],
      ]);
      const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const nn = Math.hypot(...n) || 1;
      const d = -(n[0] * p[0][0] + n[1] * p[0][1] + n[2] * p[0][2]) / nn;
      const dist = Math.abs(
        (n[0] * p[3][0] + n[1] * p[3][1] + n[2] * p[3][2]) / nn + d,
      );
      assert.ok(dist < 1e-9 * R, `quad planarity ${dist}`);
      const zs = new Set(p.map((q) => q[2].toFixed(12)));
      assert.equal(zs.size, 2, "lat band quad spans exactly two latitudes");
    }
  });

  it("topology formulae hold at meridians 8 / 24 / 36", () => {
    for (const points of [8, 24, 36]) {
      const m = globeMeridians(points);
      const { V, F, E } = expectedTopology(m);
      const sk = hullToSkeleton(globePoints({ points }));
      assert.equal(sk.positions.length / 3, V);
      assert.equal(sk.faces.length, F);
      assert.equal(sk.edges.length, E);
    }
  });
});

describe("globe through the pipeline", () => {
  it("compiles at densities 8 / 24 / 36", () => {
    for (const [points, fit] of [
      [8, {}],
      [24, {}],
      [36, { filletMm: 0.8 }],
    ]) {
      clearPipelineCache();
      const r = compile({ ...recipeForBase("globe"), points, ...fit });
      assert.equal(
        r.validation.ok,
        true,
        `points=${points}: ${r.validation.errors[0]?.message}`,
      );
      assertMeshInvariants(r.mesh);
    }
  });

  it("jitter 5 merge-skips to all triangles and still compiles", () => {
    clearPipelineCache();
    const r = compile({
      ...recipeForBase("globe"),
      jitter: 5,
      seed: 1,
      depth: "solid",
      openings: false,
    });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.ok(r.skeleton.faces.every((f) => f.length === 3));
    assertMeshInvariants(r.mesh);
  });
});
