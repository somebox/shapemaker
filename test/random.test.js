/**
 * Random-on-sphere base (M5): deterministic seeded sampling, merge-skip
 * skeletons, and full-pipeline integration.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  randomSpherePoints,
  idealSeparationRad,
  sfc32,
} from "../src/points/random.js";
import { hullToSkeleton } from "../src/hull.js";
import { assertSkeleton } from "../src/skeleton.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";

const PARAMS = { points: 24, seed: 1337, separation: 0.5 };

describe("sfc32", () => {
  it("is deterministic and uniform-ish", () => {
    const a = sfc32(42), b = sfc32(42), c = sfc32(43);
    const seqA = Array.from({ length: 8 }, a);
    const seqB = Array.from({ length: 8 }, b);
    const seqC = Array.from({ length: 8 }, c);
    assert.deepEqual(seqA, seqB, "same seed, same sequence");
    assert.notDeepEqual(seqA, seqC, "different seed differs");
    for (const v of seqA) assert.ok(v >= 0 && v < 1);
  });
});

describe("randomSpherePoints", () => {
  it("same params → bit-identical cloud", () => {
    const a = randomSpherePoints(PARAMS);
    const b = randomSpherePoints(PARAMS);
    assert.deepEqual(Array.from(a), Array.from(b));
  });

  it("different seeds differ", () => {
    const a = randomSpherePoints(PARAMS);
    const b = randomSpherePoints({ ...PARAMS, seed: 1338 });
    assert.notDeepEqual(Array.from(a), Array.from(b));
  });

  it("emits n unit vectors", () => {
    const pts = randomSpherePoints(PARAMS);
    assert.equal(pts.length, 24 * 3);
    for (let i = 0; i < 24; i++) {
      const r = Math.hypot(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      assert.ok(Math.abs(r - 1) < 1e-12, `point ${i} radius ${r}`);
    }
  });

  it("respects the separation constraint at moderate density", () => {
    const pts = randomSpherePoints(PARAMS);
    const minAngle = 0.5 * idealSeparationRad(24);
    for (let i = 0; i < 24; i++) {
      for (let j = i + 1; j < 24; j++) {
        const dot =
          pts[i * 3] * pts[j * 3] +
          pts[i * 3 + 1] * pts[j * 3 + 1] +
          pts[i * 3 + 2] * pts[j * 3 + 2];
        const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
        assert.ok(ang >= minAngle - 1e-9, `pair ${i},${j} at ${ang} < ${minAngle}`);
      }
    }
  });

  it("terminates at the hard cases (N=60, high separation)", () => {
    // The relaxation rule guarantees termination even when the constraint is
    // infeasible as stated; this must return 60 points, not hang.
    const pts = randomSpherePoints({ points: 60, seed: 7, separation: 1 });
    assert.equal(pts.length, 60 * 3);
  });
});

describe("random skeletons (merge-skip)", () => {
  it("produces an all-triangle skeleton passing assertSkeleton", () => {
    const sk = hullToSkeleton(randomSpherePoints(PARAMS), { merge: false });
    assertSkeleton(sk);
    assert.ok(sk.faces.every((f) => f.length === 3), "all faces triangles");
    // Euler: V − E + F = 2 for a triangulated convex hull
    const V = sk.positions.length / 3;
    assert.equal(V - sk.edges.length + sk.faces.length, 2);
  });

  it("same seed → identical canonical skeleton", () => {
    const a = hullToSkeleton(randomSpherePoints(PARAMS), { merge: false });
    const b = hullToSkeleton(randomSpherePoints(PARAMS), { merge: false });
    assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
    assert.deepEqual(a.faces, b.faces);
  });
});

describe("random base through compile()", () => {
  // Direct compile() must supply a border that fits the seed's smallest face
  // (the UI path adapts automatically on base change; tests bypass that).
  // Seed 1337's smallest face allows only ~3.04 mm at Ø100 — real evidence
  // for the border memo (Unit 5).
  const FIT = { base: "random", borderMm: 2, filletMm: 2 };

  it("compiles hollow+open with per-face metrics varying", () => {
    clearPipelineCache();
    const r = compile({ ...FIT });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.ok(r.metrics.watertight);
    // Constant-mm border on irregular faces = guaranteed MINIMUM at each
    // face's narrowest edge; the widest point varies per face. This spread
    // is the raw data for the Unit 5 border memo.
    assert.ok(Math.abs(r.metrics.borderMm.min - 2) < 1e-9, "min is the authored value");
    assert.ok(r.metrics.borderMm.max > r.metrics.borderMm.min + 0.5, "irregular spread");
    // Fillet clamps differently per non-congruent face.
    assert.ok(r.metrics.filletMm.max > r.metrics.filletMm.min, "fillet range spreads");
    assert.ok(r.metrics.openingMinDiameterMm > 0);
  });

  it("seed changes the shape; same seed round-trips through the hash", async () => {
    // Seed 1's smallest face caps the border at 1.82 mm (Ø100, N 24) — the
    // narrow border keeps both seeds compiling. More memo evidence.
    clearPipelineCache();
    const a = compile({ ...FIT, borderMm: 1.5, seed: 1 });
    clearPipelineCache();
    const b = compile({ ...FIT, borderMm: 1.5, seed: 2 });
    assert.notEqual(a.metrics.volumeCm3, b.metrics.volumeCm3);

    const { encodeHash, decodeHash } = await import("../src/hashcodec.js");
    const decoded = decodeHash(encodeHash(a.state));
    assert.equal(decoded.ok, true);
    clearPipelineCache();
    const again = compile(decoded.state);
    assert.equal(again.metrics.volumeCm3, a.metrics.volumeCm3);
    assert.equal(again.metrics.triangleCount, a.metrics.triangleCount);
  });

  it("rejects out-of-range random params with named keys", () => {
    for (const [bad, key] of [
      [{ base: "random", points: 3 }, "points"],
      [{ base: "random", points: 61 }, "points"],
      [{ base: "random", seed: -1 }, "seed"],
      [{ base: "random", separation: 2 }, "separation"],
    ]) {
      clearPipelineCache();
      const r = compile(bad);
      assert.equal(r.validation.ok, false);
      assert.ok(
        r.validation.errors.some((e) => e.key === key),
        `expected error on ${key}`,
      );
    }
  });
});
