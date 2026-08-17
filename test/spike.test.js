/**
 * Spike operator — pyramids on every face, origin-star-convex, no re-hull.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  spikeSkeleton,
  firstStellationT,
  greatStellatedDodecaT,
  greatDodecahedronT,
  countPlanes,
} from "../src/solid/spike.js";
import { assertSkeleton, assertStarShaped, starCover, newell } from "../src/skeleton.js";
import { hullSkeletonForBase, clearPipelineCache } from "../src/pipeline.js";
import { compile } from "../src/compile.js";
import { decodeHash } from "../src/hashcodec.js";
import { serializeState } from "../src/schema.js";

function parent(base) {
  clearPipelineCache();
  return hullSkeletonForBase(base, {});
}

describe("spikeSkeleton", () => {
  it("t = 0 is identity (same object)", () => {
    const cube = parent("cube");
    assert.equal(spikeSkeleton(cube, 0), cube);
    assert.equal(spikeSkeleton(cube, undefined), cube);
  });

  it("stella octangula: octahedron first stellation → 24 tris, 8 planes", () => {
    const octa = parent("octahedron");
    const t = firstStellationT(octa);
    assert.ok(Math.abs(t - Math.sqrt(3)) < 1e-12, t);
    const sk = spikeSkeleton(octa, t);
    assert.equal(sk.faces.length, 24);
    assert.equal(sk.positions.length / 3, 14);
    assert.equal(countPlanes(sk), 8);
    assertSkeleton(sk);
    assertStarShaped(sk);
    assert.ok(Math.abs(starCover(sk) - 1) < 1e-8);
  });

  it("small stellated dodecahedron: dodeca first stellation → 60 tris, 12 planes", () => {
    const dodeca = parent("dodecahedron");
    const t = firstStellationT(dodeca);
    const sk = spikeSkeleton(dodeca, t);
    assert.equal(sk.faces.length, 60);
    assert.equal(countPlanes(sk), 12);
    assertStarShaped(sk);
  });

  it("small triambic icosahedron: icosa first stellation → 60 tris, 20 planes", () => {
    const icosa = parent("icosahedron");
    const t = firstStellationT(icosa);
    const sk = spikeSkeleton(icosa, t);
    assert.equal(sk.faces.length, 60);
    assert.equal(countPlanes(sk), 20);
    assertStarShaped(sk);
  });

  it("great stellated dodecahedron: t = 3 × inradius → 12 planes", () => {
    const icosa = parent("icosahedron");
    const t = greatStellatedDodecaT(icosa);
    const sk = spikeSkeleton(icosa, t);
    assert.equal(sk.faces.length, 60);
    assert.equal(countPlanes(sk), 12);
    assertStarShaped(sk);
  });

  it("great dodecahedron dimple: t = 1/(√5 × inradius) → 12 planes", () => {
    const icosa = parent("icosahedron");
    const t = greatDodecahedronT(icosa);
    assert.ok(t < firstStellationT(icosa));
    const sk = spikeSkeleton(icosa, t);
    assert.equal(sk.faces.length, 60);
    assert.equal(countPlanes(sk), 12);
    assertStarShaped(sk);
  });

  it("a non-stellation height keeps 60 distinct planes on the icosahedron", () => {
    const sk = spikeSkeleton(parent("icosahedron"), 1.5);
    assert.equal(countPlanes(sk), 60);
    assertStarShaped(sk);
  });

  it("cube has no first-stellation t (adjacent planes miss the face ray)", () => {
    assert.ok(Number.isNaN(firstStellationT(parent("cube"))));
    const sk = spikeSkeleton(parent("cube"), 1.2);
    assert.equal(sk.faces.length, 24);
    assertStarShaped(sk);
  });

  it("a height that lands in a face plane is a named spike error", () => {
    const octa = parent("octahedron");
    const { centroid } = newell(octa.positions, octa.faces[0]);
    const inradius = Math.hypot(centroid[0], centroid[1], centroid[2]);
    assert.throws(() => spikeSkeleton(octa, inradius), (err) => {
      assert.equal(err.validation?.key, "spike");
      assert.ok(!/star-shaped|not closed/i.test(err.message), err.message);
      return true;
    });
  });
});

describe("spike through compile", () => {
  it("state spike=0 is the default; hashes without spike still compile", () => {
    clearPipelineCache();
    const r = compile({ base: "cube" });
    assert.equal(r.validation.ok, true);
    assert.equal(r.state.spike, 0);
    const canonical = serializeState(r.state);
    delete canonical.spike;
    const oldHash = "v1." + Buffer.from(JSON.stringify(canonical), "utf8").toString("base64url");
    const legacy = decodeHash(oldHash);
    assert.equal(legacy.ok, true, legacy.error);
    assert.equal(legacy.state.spike, 0);
  });

  it("rejects out-of-range spike", () => {
    const r = compile({ base: "cube", spike: 9 });
    assert.equal(r.validation.ok, false);
    assert.ok(r.validation.errors.some((e) => e.key === "spike"));
  });

  it("stella octangula hollow-open and solid-closed compile", () => {
    clearPipelineCache();
    const open = compile({
      base: "octahedron",
      spike: Math.sqrt(3),
      filletMm: 1.5,
    });
    assert.equal(open.validation.ok, true, open.validation.errors[0]?.message);
    assert.equal(open.skeleton.faces.length, 24);
    const closed = compile({
      base: "octahedron",
      spike: Math.sqrt(3),
      depth: "solid",
      openings: false,
    });
    assert.equal(closed.validation.ok, true, closed.validation.errors[0]?.message);
  });

  it("cuboctahedron (mixed faces) + spike hollow-open compiles", () => {
    clearPipelineCache();
    const r = compile({
      base: "cuboctahedron",
      spike: 1.4,
      filletMm: 1.5,
    });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.equal(r.skeleton.faces.length, 48);
  });

  it("truncate then spike: soccer-ball pyramids", () => {
    clearPipelineCache();
    const r = compile({
      base: "icosahedron",
      truncate: 33,
      spike: 1.4,
      filletMm: 1.5,
    });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.ok(r.skeleton.faces.length > 60);
  });

  it("spike + subdiv 1 stays star-convex", () => {
    clearPipelineCache();
    const r = compile({
      base: "octahedron",
      spike: Math.sqrt(3),
      subdiv: 1,
      filletMm: 1.5,
    });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.equal(r.skeleton.faces.length, 96);
    assertStarShaped(r.skeleton);
  });

  it("rounding on a spike rounds ridges only (points, not valleys)", () => {
    clearPipelineCache();
    const a = compile({
      base: "octahedron",
      spike: Math.sqrt(3),
      depth: "solid",
      openings: false,
      roundingMm: 0,
    });
    const b = compile({
      base: "octahedron",
      spike: Math.sqrt(3),
      depth: "solid",
      openings: false,
      roundingMm: 1.5,
    });
    assert.equal(a.validation.ok, true);
    assert.equal(b.validation.ok, true, b.validation.errors[0]?.message);
    assert.ok(b.metrics.triangleCount > a.metrics.triangleCount);
    assert.ok(b.metrics.roundingMm.max > 0);
  });
});

describe("assertStarShaped on convex parents", () => {
  it("covers the origin once on a cube", () => {
    assertStarShaped(parent("cube"));
    assert.ok(Math.abs(starCover(parent("cube")) - 1) < 1e-8);
  });

  it("rejects a mesh translated off the origin", () => {
    const cube = parent("cube");
    const shifted = {
      positions: Float64Array.from(cube.positions, (v, i) => (i % 3 === 0 ? v + 3 : v)),
      faces: cube.faces,
    };
    assert.throws(() => assertStarShaped(shifted));
    assert.ok(Math.abs(starCover(shifted)) < 1e-5, starCover(shifted));
  });
});
