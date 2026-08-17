/**
 * Model split — horizontal cut into two watertight print halves.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { writeBinaryStl } from "../src/export/stl.js";
import { transformPoint } from "../src/orient.js";
import {
  placeMesh,
  findSplitPlane,
  rankSplitPlanes,
  rankSplitOrientations,
  skeletonSeamLevels,
  splitMeshAtPlane,
  splitAtOrientation,
  chooseSplit,
  halfExportMatrices,
  assembleLoops,
  snapPlaneZ,
} from "../src/split.js";

function compileFresh(partial) {
  clearPipelineCache();
  return compile(partial);
}

function placedOf(result) {
  assert.ok(result.validation.ok, JSON.stringify(result.validation.errors));
  assert.ok(result.mesh);
  return placeMesh(result.mesh, result.orientation.matrix);
}

function heightOf(placed) {
  const p = placed.positions64;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const z = p[i + 2];
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  return { lo, hi, heightMm: hi - lo };
}

function volumeOf(mesh) {
  return assertMeshInvariants(mesh).volume;
}

function minZ(mesh, matrix = null) {
  const p = mesh.positions64 ?? mesh.positions;
  let m = Infinity;
  for (let i = 0; i < p.length / 3; i++) {
    let x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    if (matrix) [x, y, z] = transformPoint(matrix, x, y, z);
    if (z < m) m = z;
  }
  return m;
}

describe("assembleLoops", () => {
  it("chains a single square loop", () => {
    const loops = assembleLoops([0, 1, 1, 2, 2, 3, 3, 0]);
    assert.equal(loops.length, 1);
    assert.equal(loops[0].length, 4);
  });

  it("chains two disjoint loops", () => {
    const loops = assembleLoops([
      0, 1, 1, 2, 2, 0,
      10, 11, 11, 12, 12, 10,
    ]);
    assert.equal(loops.length, 2);
  });
});

describe("splitMeshAtPlane", () => {
  it("solid cube: plane near mid, Va+Vb≈V, each ~V/2, invariants", () => {
    const r = compileFresh({
      base: "cube",
      depth: "solid",
      openings: false,
      circumdiameterMm: 100,
    });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const { planeZ: z } = findSplitPlane(placed, { heightMm });
    assert.ok(Math.abs(z - heightMm / 2) < heightMm * 0.2, `z=${z} mid=${heightMm / 2}`);

    // Plane never lands on a vertex z.
    const pos = placed.positions64;
    for (let i = 0; i < pos.length; i += 3) {
      assert.ok(Math.abs(pos[i + 2] - z) > 1e-9);
    }

    const { a, b } = splitMeshAtPlane(placed, z);
    const Va = volumeOf(a);
    const Vb = volumeOf(b);
    const V = volumeOf(placed);
    assert.ok(Math.abs(Va + Vb - V) / V < 1e-4, `Va+Vb=${Va + Vb} V=${V}`);
    assert.ok(Math.abs(Va - V / 2) / V < 0.15);
    assert.ok(Math.abs(Vb - V / 2) / V < 0.15);
  });

  it("icosidodeca hollow open (multi-region strut caps)", () => {
    const r = compileFresh({
      base: "icosidodeca",
      depth: "hollow",
      openings: true,
      wallMm: 1.4,
      borderMm: 3.2,
      filletMm: 4.5,
    });
    const split = splitAtOrientation(r.mesh, r.skeleton, r.orientation.matrix);
    assert.ok(split, "a ranked plane seals");
    assert.ok(volumeOf(split.a) > 0);
    assert.ok(volumeOf(split.b) > 0);
  });

  it("icosidodeca hollow closed (annulus caps)", () => {
    const r = compileFresh({
      base: "icosidodeca",
      depth: "hollow",
      openings: false,
      wallMm: 1.4,
    });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const { planeZ: z } = findSplitPlane(placed, { heightMm });
    const { a, b } = splitMeshAtPlane(placed, z);
    assert.ok(volumeOf(a) > 0);
    assert.ok(volumeOf(b) > 0);
  });

  it("jittered random s1337 still splits watertight", () => {
    const r = compileFresh({
      base: "random",
      seed: 1337,
      jitter: 10,
      depth: "hollow",
      openings: true,
      borderMm: 1,
      filletMm: 1.5,
      wallMm: 1.4,
    });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const { planeZ: z } = findSplitPlane(placed, { heightMm });
    const { a, b } = splitMeshAtPlane(placed, z);
    assert.ok(volumeOf(a) > 0);
    assert.ok(volumeOf(b) > 0);
  });

  it("export flip: half B min z ≈ 0 and volume stays positive", () => {
    const r = compileFresh({
      base: "cube",
      depth: "solid",
      openings: false,
    });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const { planeZ: z } = findSplitPlane(placed, { heightMm });
    const { a, b } = splitMeshAtPlane(placed, z);
    const { matrixA, matrixB } = halfExportMatrices(z);

    assert.ok(Math.abs(minZ(a, matrixA)) < 1e-6, `A minz=${minZ(a, matrixA)}`);
    assert.ok(Math.abs(minZ(b, matrixB)) < 1e-6, `B minz=${minZ(b, matrixB)}`);

    // Transformed B still has positive volume under the rigid map.
    const p = b.positions64;
    const flipped = new Float64Array(p.length);
    for (let i = 0; i < p.length / 3; i++) {
      const [x, y, z2] = transformPoint(matrixB, p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      flipped[i * 3] = x;
      flipped[i * 3 + 1] = y;
      flipped[i * 3 + 2] = z2;
    }
    const meshB = {
      positions: new Float32Array(flipped),
      positions64: flipped,
      indices: b.indices,
      faceId: b.faceId,
    };
    assert.ok(volumeOf(meshB) > 0);
  });

  it("STL buffers are byte-identical across two split runs", () => {
    const r = compileFresh({
      base: "cube",
      depth: "solid",
      openings: false,
    });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const { planeZ: z } = findSplitPlane(placed, { heightMm });
    const { matrixA, matrixB } = halfExportMatrices(z);

    const run = () => {
      const { a, b } = splitMeshAtPlane(placed, z);
      return {
        a: new Uint8Array(writeBinaryStl(a, { matrix: matrixA, header: "a" })),
        b: new Uint8Array(writeBinaryStl(b, { matrix: matrixB, header: "b" })),
      };
    };
    const u = run();
    const v = run();
    assert.deepEqual(u.a, v.a);
    assert.deepEqual(u.b, v.b);
  });

  it("rounded hollow open: split succeeds or throws cleanly", () => {
    // Rounded open frames can produce cut loops earcut cannot seal at some
    // heights; findSplitPlane skips self-intersecting candidates, but a
    // remaining seal failure must still throw (UI reverts the toggle).
    const r = compileFresh({
      base: "icosidodeca",
      depth: "hollow",
      openings: true,
      wallMm: 1.4,
      borderMm: 3.2,
      filletMm: 4.5,
      roundingMm: 0.5,
    });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    try {
      const { planeZ: z } = findSplitPlane(placed, { heightMm });
      const { a, b } = splitMeshAtPlane(placed, z);
      assert.ok(volumeOf(a) > 0);
      assert.ok(volumeOf(b) > 0);
    } catch (e) {
      assert.ok(
        /split:|manifold|boundary|directed edge|degenerate|cap fill|no valid plane/i.test(
          e.message,
        ),
        `unexpected: ${e.message}`,
      );
    }
  });

  it("natural seams win: cubocta triangle-down splits at its girdle", () => {
    // Resting on a triangle face, the cuboctahedron has a hexagonal edge
    // ring exactly at mid-height. The girdle is a large cut (bed contact)
    // and a seam; ranking by overhang then area must still hug it.
    const probe = compileFresh({ base: "cuboctahedron", depth: "hollow",
      wallMm: 1.4, openings: true, borderMm: 3.2, filletMm: 4.5 });
    const faceIndex = probe.skeleton.faces.findIndex((f) => f.length === 3);
    const r = compileFresh({ base: "cuboctahedron", depth: "hollow",
      wallMm: 1.4, openings: true, borderMm: 3.2, filletMm: 4.5, faceIndex });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const seams = skeletonSeamLevels(r.skeleton, r.orientation.matrix);
    assert.ok(seams.some((z) => Math.abs(z - heightMm / 2) < 1e-6), "girdle seam detected");
    const ranked = rankSplitPlanes(placed, { heightMm, seamZs: seams });
    // Walk the ranking the way enableSplit does — first plane that seals.
    let chosen = null;
    for (const c of ranked) {
      try {
        const { a, b } = splitMeshAtPlane(placed, c.planeZ);
        assertMeshInvariants(a);
        assertMeshInvariants(b);
        chosen = c;
        break;
      } catch { /* next candidate */ }
    }
    assert.ok(chosen, "some candidate seals");
    assert.equal(chosen.seam, true);
    assert.ok(Math.abs(chosen.planeZ - heightMm / 2) < 0.1,
      `plane ${chosen.planeZ} hugs the mid girdle of H=${heightMm}`);
  });

  it("rhombic dodecahedron face-down splits at its equator ring", () => {
    const r = compileFresh({ base: "rhombicdodeca", depth: "hollow",
      wallMm: 1.4, openings: true, borderMm: 3.2, filletMm: 4.5 });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const seams = skeletonSeamLevels(r.skeleton, r.orientation.matrix);
    const ranked = rankSplitPlanes(placed, { heightMm, seamZs: seams });
    let chosen = null;
    for (const c of ranked) {
      try { splitMeshAtPlane(placed, c.planeZ); chosen = c; break; } catch {}
    }
    assert.equal(chosen.seam, true);
    assert.ok(Math.abs(chosen.planeZ - heightMm / 2) < 0.1);
  });

  it("no seams (jittered hull) still finds an in-band plane", () => {
    const r = compileFresh({ base: "random", seed: 1337, jitter: 10,
      depth: "hollow", wallMm: 1.4, openings: true, borderMm: 1, filletMm: 1.5 });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const seams = skeletonSeamLevels(r.skeleton, r.orientation.matrix);
    const withS = findSplitPlane(placed, { heightMm, seamZs: seams });
    const without = findSplitPlane(placed, { heightMm });
    const frac = withS.planeZ / heightMm;
    assert.ok(frac >= 0.35 && frac <= 0.65);
    assert.ok(without.planeZ > 0);
  });

  it("cut area is material only: hollow closed cavity subtracts", () => {
    // At any plane, the cut cross-section of a hollow shell must be less
    // than the outer outline area — an |abs|-per-loop sum would report
    // outer + cavity summed instead.
    const r = compileFresh({ base: "icosidodeca", depth: "hollow",
      wallMm: 1.4, openings: false });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const { cutArea, a, b } = splitMeshAtPlane(
      placed, findSplitPlane(placed, { heightMm }).planeZ);
    assertMeshInvariants(a);
    assertMeshInvariants(b);
    // Outer circumdiameter 100 → outline area < π·50²; the shell wall is
    // 1.4mm, so the true material ring is a small fraction of that.
    assert.ok(cutArea < 1500, `material ring, got ${cutArea}`);
  });

  it("reorient ranking: globe's pole axis first, exposing a latitude ring", () => {
    const r = compileFresh({ base: "globe", points: 24, depth: "hollow",
      wallMm: 1.4, openings: true, borderMm: 1, filletMm: 1 });
    assert.ok(r.validation.ok);
    const ranked = rankSplitOrientations(r.skeleton);
    assert.equal(ranked[0].kind, "axis");
    // A lat/long globe with 24 meridians has full 24-vertex latitude rings.
    assert.ok(ranked[0].ringSize >= 12, `ring ${ranked[0].ringSize}`);
    // The pole alignment must actually split on a seam.
    const placed = placeMesh(r.mesh, ranked[0].matrix);
    const { heightMm } = heightOf(placed);
    const planes = rankSplitPlanes(placed, {
      heightMm,
      seamZs: skeletonSeamLevels(r.skeleton, ranked[0].matrix),
    });
    let chosen = null;
    for (const c of planes) {
      try { splitMeshAtPlane(placed, c.planeZ); chosen = c; break; } catch {}
    }
    assert.equal(chosen.seam, true);
  });

  it("reorient ranking: ring-less sphere still puts its lattice axis first", () => {
    const r = compileFresh({ base: "sphere", points: 24, depth: "hollow",
      wallMm: 1.4, openings: true, borderMm: 1, filletMm: 1.5 });
    assert.ok(r.validation.ok);
    const ranked = rankSplitOrientations(r.skeleton);
    // Fibonacci lattice: no vertex rings anywhere, so kind priority decides
    // — the construction axis (the perceived pole) leads the cycle.
    assert.equal(ranked[0].kind, "axis");
    assert.equal(ranked[0].ringSize, 0);
  });

  it("dense tilted meshes still find an in-band plane (subdivided globe)", () => {
    // A subdivided globe resting on a face packs vertex z-levels so tightly
    // that no mid-band gap clears the default vertex clearance; the old
    // nearest-gap snap then escaped to a plane near the top of the model
    // (z/H ≈ 0.96). Banded snapping + tighter clearance tiers must keep the
    // cut in the band.
    const r = compileFresh({ base: "globe", points: 24, subdiv: 1,
      depth: "hollow", wallMm: 1.4, openings: true });
    assert.ok(r.validation.ok, JSON.stringify(r.validation.errors));
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const ranked = rankSplitPlanes(placed, {
      heightMm,
      seamZs: skeletonSeamLevels(r.skeleton, r.orientation.matrix),
    });
    let chosen = null;
    for (const c of ranked) {
      try { splitMeshAtPlane(placed, c.planeZ); chosen = c; break; } catch {}
    }
    assert.ok(chosen, "a candidate seals");
    const frac = chosen.planeZ / heightMm;
    assert.ok(frac >= 0.35 && frac <= 0.65, `plane stays in band: ${frac.toFixed(3)}`);
  });

  it("stella split prefers a low-overhang orientation, not the resting flank", () => {
    const r = compileFresh({
      base: "octahedron",
      spike: Math.sqrt(3),
      filletMm: 1.5,
      depth: "hollow",
      openings: true,
    });
    assert.ok(r.validation.ok, JSON.stringify(r.validation.errors));
    const canonical = splitAtOrientation(r.mesh, r.skeleton, r.orientation.matrix);
    assert.ok(canonical, "canonical rest still seals");
    const chosen = chooseSplit(r.mesh, r.skeleton, r.orientation.matrix);
    assert.ok(chosen, "chooseSplit seals");
    const canonSupport = canonical.overhang.a.support + canonical.overhang.b.support;
    const pickSupport = chosen.overhang.a.support + chosen.overhang.b.support;
    assert.ok(
      pickSupport < canonSupport * 0.25,
      `picked ${pickSupport.toFixed(0)} vs canonical ${canonSupport.toFixed(0)}`,
    );
  });

  it("larger cut wins when overhang is similar", () => {
    const r = compileFresh({ base: "cube", depth: "solid", openings: false });
    const placed = placedOf(r);
    const { heightMm } = heightOf(placed);
    const ranked = rankSplitPlanes(placed, { heightMm });
    const maxArea = Math.max(...ranked.map((c) => c.cutArea));
    assert.ok(ranked[0].cutArea >= maxArea * 0.95, ranked[0].cutArea);
  });

  it("snapPlaneZ never returns a vertex z", () => {
    const r = compileFresh({ base: "cube", depth: "solid", openings: false });
    const placed = placedOf(r);
    const pos = placed.positions64;
    const { heightMm, lo } = heightOf(placed);
    for (let i = 0; i < 11; i++) {
      const target = lo + (heightMm * i) / 10;
      const z = snapPlaneZ(pos, target);
      if (z == null) continue;
      for (let j = 0; j < pos.length; j += 3) {
        assert.ok(Math.abs(pos[j + 2] - z) > 1e-12);
      }
    }
  });
});
