/**
 * Twisted globe base — antiprism bands, coplanar merge off.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  twistedGlobePoints,
  twistedGlobeMeridians,
  TWISTED_GLOBE_MERIDIAN_MIN,
  TWISTED_GLOBE_MERIDIAN_MAX,
} from "../src/points/twistedglobe.js";
import { BASES } from "../src/bases.js";
import { hullToSkeleton } from "../src/hull.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache, hullSkeletonForBase } from "../src/pipeline.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { recipeForBase, isCleanBaseRecipe } from "../src/starts.js";
import { normalizeState, separationForPoints } from "../src/schema.js";

function expectedTopology(m) {
  const rings = Math.round(m / 2) - 1;
  const V = m * rings + 2;
  const F = 2 * m * rings;
  return { V, F, E: V + F - 2 };
}

describe("twistedGlobePoints", () => {
  it("is deterministic and unit-radius", () => {
    const a = twistedGlobePoints({ points: 16 });
    const b = twistedGlobePoints({ points: 16 });
    assert.deepEqual(Array.from(a), Array.from(b));
    for (let i = 0; i < a.length; i += 3) {
      const r = Math.hypot(a[i], a[i + 1], a[i + 2]);
      assert.ok(Math.abs(r - 1) < 1e-12, `radius drifted: ${r}`);
    }
  });

  it("clamps meridians to 6–24 and defaults to 16 → 114 verts", () => {
    assert.equal(twistedGlobePoints({ points: 4 }).length / 3, 14); // m=6
    assert.equal(twistedGlobePoints({ points: 999 }).length / 3, 266); // m=24
    assert.equal(twistedGlobePoints().length / 3, 114);
    assert.equal(twistedGlobeMeridians(60), TWISTED_GLOBE_MERIDIAN_MAX);
  });

  it("advertises the clamp as pointsRange, and normalizeState honours it", () => {
    assert.deepEqual(BASES.twistedglobe.pointsRange, {
      min: TWISTED_GLOBE_MERIDIAN_MIN,
      max: TWISTED_GLOBE_MERIDIAN_MAX,
    });
    assert.equal(normalizeState({ base: "twistedglobe", points: 4 }).points, 6);
    assert.equal(normalizeState({ base: "twistedglobe", points: 60 }).points, 24);
  });

  it("keeps exact poles and twists odd rings by half a meridian step", () => {
    const m = 12;
    const pts = twistedGlobePoints({ points: m });
    assert.deepEqual([pts[0], pts[1], pts[2]], [0, 0, 1]);
    assert.deepEqual([pts[3], pts[4], pts[5]], [0, 0, -1]);
    const angleOfFirst = (ring) => {
      const i = 2 + (ring - 1) * m;
      return Math.atan2(pts[i * 3 + 1], pts[i * 3]);
    };
    assert.ok(Math.abs(angleOfFirst(1) - Math.PI / m) < 1e-12);
    assert.ok(Math.abs(angleOfFirst(2)) < 1e-12);
    assert.ok(Math.abs(angleOfFirst(3) - Math.PI / m) < 1e-12);
  });
});

describe("twisted globe hull (merge off)", () => {
  it("is all triangles with V = m·rings+2, F = 2·m·rings at 6 / 16 / 24", () => {
    for (const points of [6, 16, 24]) {
      const { V, F, E } = expectedTopology(points);
      const sk = hullToSkeleton(twistedGlobePoints({ points }), { merge: false });
      assert.equal(sk.positions.length / 3, V);
      assert.equal(sk.faces.length, F);
      assert.equal(sk.edges.length, E);
      assert.ok(sk.faces.every((f) => f.length === 3));
    }
  });

  it("every triangle spans exactly two neighbouring latitudes", () => {
    const sk = hullToSkeleton(twistedGlobePoints({ points: 16 }), { merge: false });
    for (const f of sk.faces) {
      const zs = new Set(f.map((i) => sk.positions[i * 3 + 2].toFixed(12)));
      assert.equal(zs.size, 2);
    }
  });

  it("band vertices are six-valent; the poles carry m triangles", () => {
    const m = 16;
    const sk = hullToSkeleton(twistedGlobePoints({ points: m }), { merge: false });
    const valence = new Array(sk.positions.length / 3).fill(0);
    for (const f of sk.faces) for (const v of f) valence[v]++;
    const counts = {};
    for (const v of valence) counts[v] = (counts[v] || 0) + 1;
    // Rings next to a pole touch it once fewer times: 2 poles at m, the two
    // polar rings at 5, everything else at 6.
    assert.deepEqual(counts, { 5: 2 * m, 6: m * (Math.round(m / 2) - 3), [m]: 2 });
  });
});

describe("twisted globe through the pipeline", () => {
  it("registry entry skips coplanar merge", () => {
    clearPipelineCache();
    const sk = hullSkeletonForBase("twistedglobe", { points: 12 });
    assert.equal(sk.faces.length, 120);
  });

  it("start pack opens at 16 meridians with the coupled separation", () => {
    const recipe = recipeForBase("twistedglobe");
    assert.equal(recipe.points, 16);
    assert.equal(recipe.separation, separationForPoints(16));
    assert.equal(isCleanBaseRecipe(recipe, "twistedglobe"), true);
  });

  it("compiles at densities 6 / 16 / 24", () => {
    for (const [points, fit] of [
      [6, {}],
      [16, {}],
      [24, { filletMm: 0.5 }],
    ]) {
      clearPipelineCache();
      const r = compile({ ...recipeForBase("twistedglobe"), points, ...fit });
      assert.equal(r.validation.ok, true, `points=${points}: ${r.validation.errors[0]?.message}`);
      assertMeshInvariants(r.mesh);
    }
  });

  it("dual is the ring-ball cell pattern: two m-gons, pentagons, hexagons", () => {
    clearPipelineCache();
    const m = 12;
    const sk = hullSkeletonForBase("twistedglobe", { points: m, dual: true });
    const counts = {};
    for (const f of sk.faces) counts[f.length] = (counts[f.length] || 0) + 1;
    assert.deepEqual(counts, { 5: 2 * m, 6: m * (Math.round(m / 2) - 3), [m]: 2 });
  });
});
