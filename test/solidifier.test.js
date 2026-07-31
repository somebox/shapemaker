import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { icosidodecahedron, inradii } from "../src/points/icosidodeca.js";
import { buildShell } from "../src/solid/shell.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { edgeList } from "../src/skeleton.js";
import { faceFrames, fromFaceFrame, projectToFrame } from "../src/faceframe.js";

const REF_TRIS = 7200;
const REF_VOLUME_CM3 = 16.14979675;
const VOLUME_EPS = 1e-4; // relative

describe("icosidodecahedron", () => {
  it("emits 30 verts and 20 triangles + 12 pentagons", () => {
    const { positions, faces } = icosidodecahedron(50);
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
  const skel = icosidodecahedron(50);
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
  const skel = icosidodecahedron(50);

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
