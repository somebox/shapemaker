import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { icosidodecahedronDirect, inradii } from "../src/points/icosidodeca.js";
import { buildShell, roundingSegmentsFor } from "../src/solid/shell.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { compile } from "../src/compile.js";
import { writeBinaryStl } from "../src/export/stl.js";
import { edgeList } from "../src/skeleton.js";
import { faceFrames, fromFaceFrame, projectToFrame } from "../src/faceframe.js";

const REF_TRIS = 7200;
const REF_VOLUME_CM3 = 16.14979675;
const VOLUME_EPS = 1e-4; // relative

describe("icosidodecahedron", () => {
  it("emits 30 verts and 20 triangles + 12 pentagons", () => {
    const { positions, faces } = icosidodecahedronDirect(50);
    assert.equal(positions.length, 30 * 3);
    const lengths = faces.map((f) => f.length).sort((a, b) => a - b);
    assert.deepEqual(lengths, [...Array(20).fill(3), ...Array(12).fill(5)]);
    // All verts on sphere of radius 50
    for (let i = 0; i < 30; i++) {
      const r = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      assert.ok(Math.abs(r - 50) < 1e-9, `vert ${i} r=${r}`);
    }
  });

  it("matches analytic inradii at Ø100", () => {
    const { r3, r5 } = inradii(50);
    assert.ok(Math.abs(r5 - 42.532540417602) < 1e-9);
    assert.ok(r3 > r5);
  });
});

describe("buildShell at prototype defaults", () => {
  const skel = icosidodecahedronDirect(50);
  const { mesh, info } = buildShell(skel, {
    wallMm: 1.4,
    borderMm: 3.2,
    filletMm: 4.5,
    edgeDiv: 10,
    openings: true,
    depth: "hollow",
  });

  it("emits exactly 7200 triangles", () => {
    assert.equal(info.triangleCount, REF_TRIS);
    assert.equal(mesh.indices.length / 3, REF_TRIS);
  });

  it("volume matches the Python reference within ε", () => {
    const cm3 = info.volume / 1000;
    const rel = Math.abs(cm3 - REF_VOLUME_CM3) / REF_VOLUME_CM3;
    assert.ok(rel < VOLUME_EPS, `volume ${cm3} vs ${REF_VOLUME_CM3} (rel ${rel})`);
  });

  it("passes mesh invariants", () => {
    const inv = assertMeshInvariants(mesh);
    assert.equal(inv.ok, true);
    assert.ok(inv.volume > 0);
  });

  it("assigns faceId for every triangle in range", () => {
    assert.equal(mesh.faceId.length, REF_TRIS);
    for (let i = 0; i < mesh.faceId.length; i++) {
      assert.ok(mesh.faceId[i] >= 0 && mesh.faceId[i] < 32);
    }
  });

  it("reports wall min ≈ 1.4 mm on pentagons", () => {
    assert.ok(Math.abs(info.wall.min - 1.4) < 1e-9);
    assert.ok(info.wall.max > info.wall.min); // triangles thicker
  });

  it("derives inradii generically, matching the analytic formula", () => {
    // The solidifier computes inradii from the skeleton (shape-agnostic).
    // Cross-check against the independent closed form for this solid.
    const { r3, r5 } = inradii(50);
    assert.ok(Math.abs(info.inradiusMm.min - r5) < 1e-9, "min = pentagon inradius");
    assert.ok(Math.abs(info.inradiusMm.max - r3) < 1e-9, "max = triangle inradius");
  });
});

describe("shell stays base-agnostic (locked decision 8)", () => {
  it("solid/shell.js contains no base-specific branches or imports", () => {
    const src = readFileSync(
      new URL("../src/solid/shell.js", import.meta.url),
      "utf8",
    );
    // Everything shell knows about the polyhedron arrives via skeleton.js /
    // faceframe.js. A base name or registry import here means the M3 seam
    // failed and irregular hulls (M5) will break it.
    assert.ok(!/from\s+"\.\.\/bases/.test(src), "shell imports the base registry");
    assert.ok(!/from\s+"\.\.\/points\//.test(src), "shell imports a point generator");
    assert.ok(
      !/\bbase\s*===|===\s*"(tetrahedron|cube|octahedron|dodecahedron|icosahedron|icosidodeca)"/.test(src),
      "shell branches on a base id",
    );
  });
});

describe("skeleton/faceframe (shape-agnostic layer)", () => {
  const skel = icosidodecahedronDirect(50);

  it("edgeList finds 60 unique edges", () => {
    assert.equal(edgeList(skel.faces).length, 60);
  });

  it("face frames are orthonormal and outward-facing", () => {
    for (const f of faceFrames(skel)) {
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      assert.ok(Math.abs(dot(f.u, f.u) - 1) < 1e-12, "u unit");
      assert.ok(Math.abs(dot(f.w, f.w) - 1) < 1e-12, "w unit");
      assert.ok(Math.abs(dot(f.u, f.w)) < 1e-12, "u ⟂ w");
      assert.ok(Math.abs(dot(f.normal, f.normal) - 1) < 1e-12, "normal unit");
      // Outward: normal points away from the origin (convex, origin inside)
      assert.ok(dot(f.normal, f.origin) > 0, "normal outward");
    }
  });

  it("round-trips face-local 2D through world coordinates", () => {
    const f = faceFrames(skel)[0];
    const [x, y] = [3.7, -2.1];
    const [X, Y, Z] = fromFaceFrame(f, x, y);
    const [x2, y2] = projectToFrame(f, X, Y, Z);
    assert.ok(Math.abs(x - x2) < 1e-9 && Math.abs(y - y2) < 1e-9);
  });
});

describe("rim rounding (Stage 1)", () => {
  const skel = icosidodecahedronDirect(50);
  const baseOpts = {
    wallMm: 1.4,
    borderMm: 3.2,
    filletMm: 4.5,
    edgeDiv: 10,
    openings: true,
    depth: "hollow",
  };

  it("roundingSegmentsFor matches Draft/Normal/Fine", () => {
    assert.equal(roundingSegmentsFor(4), 2);
    assert.equal(roundingSegmentsFor(10), 3);
    assert.equal(roundingSegmentsFor(20), 6);
  });

  it("roundingMm=0 is byte-identical to omitting the opt", () => {
    const a = buildShell(skel, baseOpts);
    const b = buildShell(skel, { ...baseOpts, roundingMm: 0 });
    const bufA = new Uint8Array(writeBinaryStl(a.mesh));
    const bufB = new Uint8Array(writeBinaryStl(b.mesh));
    assert.deepEqual(bufA, bufB);
  });

  it("roundingMm=0.6 at Normal rounds rims AND dihedral edges, lower volume", () => {
    const hard = buildShell(skel, baseOpts);
    const soft = buildShell(skel, { ...baseOpts, roundingMm: 0.6 });
    // Stage-1 rim rings (21600) + Stage-2 edge strips and corner fans.
    assert.equal(soft.info.triangleCount, 35760);
    assertMeshInvariants(soft.mesh);
    assert.ok(soft.info.volume < hard.info.volume);
    assert.ok(soft.info.roundingMm.max <= 0.6 + 1e-12);
    assert.ok(soft.info.roundingMm.min > 0);
  });

  it("extreme roundingMm still clamps to a watertight mesh", () => {
    const r = buildShell(skel, { ...baseOpts, roundingMm: 50 });
    assertMeshInvariants(r.mesh);
    assert.ok(r.info.roundingMm.max < 50);
  });
});

describe("edge rounding (Stage 2)", () => {
  it("rounds a solid cube's dihedral edges and corners", () => {
    clearPipelineCache();
    const r = compile({ base: "cube", depth: "solid", openings: false, roundingMm: 2 });
    assert.equal(r.validation.ok, true);
    assertMeshInvariants(r.mesh);
    clearPipelineCache();
    const sharp = compile({ base: "cube", depth: "solid", openings: false });
    // Material is removed along all 12 edges + 8 corners …
    assert.ok(r.metrics.volumeMm3 < sharp.metrics.volumeMm3);
    assert.ok(sharp.metrics.volumeMm3 - r.metrics.volumeMm3 < 1500, "removal stays local");
    // … and no vertex reaches the original sharp corners any more.
    const pos = r.mesh.positions64;
    let maxR = 0;
    for (let i = 0; i < pos.length; i += 3) {
      maxR = Math.max(maxR, Math.hypot(pos[i], pos[i + 1], pos[i + 2]));
    }
    assert.ok(maxR < 49, `corner still sharp: max vertex radius ${maxR}`);
  });

  it("clamps per feature: tight faces give less, the rest gets the full radius", () => {
    clearPipelineCache();
    const r = compile({ base: "icosidodeca", roundingMm: 1.2 });
    assert.equal(r.validation.ok, true);
    assertMeshInvariants(r.mesh);
    // Triangle faces afford less than pentagons — proportional, not global.
    assert.ok(r.metrics.roundingMm.min < r.metrics.roundingMm.max);
    assert.ok(Math.abs(r.metrics.roundingMm.max - 1.2) < 1e-9);
  });

  for (const state of [
    { base: "tetrahedron", roundingMm: 1 },
    { base: "cube", depth: "hollow", openings: false, roundingMm: 1 },
    { base: "rhombictriaconta", roundingMm: 0.8 },
    { base: "globe", borderMm: 0.6, filletMm: 0.8, roundingMm: 0.3 },
    { base: "sphere", borderMm: 1, filletMm: 1.5, roundingMm: 0.5 },
  ]) {
    it(`${state.base} (${state.depth ?? "hollow"}/${state.openings === false ? "closed" : "open"}) survives rounding`, () => {
      clearPipelineCache();
      const r = compile(state);
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
      assertMeshInvariants(r.mesh);
    });
  }
});
