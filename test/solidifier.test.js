import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { icosidodecahedronDirect, inradii } from "../src/points/icosidodeca.js";
import { buildShell, roundingSegmentsFor, lipArc } from "../src/solid/shell.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { compile } from "../src/compile.js";
import { writeBinaryStl } from "../src/export/stl.js";
import { edgeList } from "../src/skeleton.js";
import { faceFrames, fromFaceFrame, projectToFrame } from "../src/faceframe.js";
import { buildMacroTopology } from "../src/solid/macro-topo.js";
import { hullSkeletonForBase, scaleSkeleton } from "../src/pipeline.js";

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

describe("rim lip fillet (lipArc)", () => {
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

  it("is the quarter circle when the wall is perpendicular to the face", () => {
    const p = [3, -2, 5], a = [1, 0, 0], b = [0, 0, -1], r = 0.7, J = 6;
    const pts = lipArc(p, a, b, r, J);
    for (let j = 0; j <= J; j++) {
      const th = (j / J) * (Math.PI / 2);
      const q = [
        p[0] + r * (1 - Math.sin(th)) * a[0] + r * (1 - Math.cos(th)) * b[0],
        p[1] + r * (1 - Math.sin(th)) * a[1] + r * (1 - Math.cos(th)) * b[1],
        p[2] + r * (1 - Math.sin(th)) * a[2] + r * (1 - Math.cos(th)) * b[2],
      ];
      assert.ok(dist(pts[j], q) < 1e-12, `j=${j}`);
    }
  });

  it("stays a true radius-r arc tangent to both rays on a tilted wall", () => {
    // Off-axis micro-face: the wall (toward the origin) leans 12° off the
    // face normal. The old skewed quarter-circle was neither radius r nor
    // tangent to the wall.
    const tilt = (12 * Math.PI) / 180;
    const p = [0, 0, 0], a = [1, 0, 0];
    const b = [Math.sin(tilt), 0, -Math.cos(tilt)]; // wall direction
    const r = 0.5, J = 4;
    const pts = lipArc(p, a, b, r, J);
    const cosw = dot(a, b), sinw = Math.sqrt(1 - cosw * cosw);
    const w = (r * (1 + cosw)) / sinw; // r·cot(ω/2)
    const c = [p[0] + (r / sinw) * (a[0] + b[0]), 0, p[2] + (r / sinw) * (a[2] + b[2])];
    assert.ok(dist(pts[0], [w, 0, 0]) < 1e-12, "starts on the face at r·cot(ω/2)");
    assert.ok(dist(pts[J], [w * b[0], 0, w * b[2]]) < 1e-12, "ends on the wall at r·cot(ω/2)");
    for (const q of pts) assert.ok(Math.abs(dist(q, c) - r) < 1e-12, "every sample at radius r");
    // Tangency: the radius at each end is perpendicular to that ray.
    assert.ok(Math.abs(dot([pts[0][0] - c[0], 0, pts[0][2] - c[2]], a)) < 1e-12);
    assert.ok(Math.abs(dot([pts[J][0] - c[0], 0, pts[J][2] - c[2]], b)) < 1e-12);
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

describe("edge rounding with subdivision", () => {
  function parentEdgeMidpoints(base) {
    clearPipelineCache();
    const { skeleton } = compile({ base, subdiv: 0, openings: false, depth: "solid" });
    const mids = [];
    const pos = skeleton.positions;
    const seen = new Set();
    for (const ring of skeleton.faces) {
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mids.push([
          (pos[a * 3] + pos[b * 3]) / 2,
          (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2,
          (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2,
        ]);
      }
    }
    return mids;
  }

  function meshHasPoint(mesh, x, y, z, tol = 1e-6) {
    const p = mesh.positions64;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.hypot(p[i] - x, p[i + 1] - y, p[i + 2] - z) < tol) return true;
    }
    return false;
  }

  for (const base of ["tetrahedron", "octahedron", "icosahedron"]) {
    for (const subdiv of [1, 2]) {
      for (const style of ["radial", "grid"]) {
        it(`${base} subdiv=${subdiv} ${style} rounds watertight`, () => {
          clearPipelineCache();
          const r = compile({
            base, subdiv, subdivStyle: style, roundingMm: 0.5, edgeDiv: 4,
          });
          assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
          assertMeshInvariants(r.mesh);
          assert.ok(r.metrics.roundingMm.min > 0.4, JSON.stringify(r.metrics.roundingMm));
          assert.ok(Math.abs(r.metrics.roundingMm.max - 0.5) < 1e-6);
        });
      }
    }
  }

  it("icosahedron subdiv=1 removes parent-edge midpoints and lowers solid volume", () => {
    clearPipelineCache();
    const sharp = compile({
      base: "icosahedron", subdiv: 1, depth: "solid", openings: false, edgeDiv: 4,
    });
    clearPipelineCache();
    const rounded = compile({
      base: "icosahedron", subdiv: 1, roundingMm: 0.5,
      depth: "solid", openings: false, edgeDiv: 4,
    });
    assert.equal(rounded.validation.ok, true, rounded.validation.errors[0]?.message);
    assertMeshInvariants(rounded.mesh);
    assert.ok(rounded.metrics.volumeMm3 < sharp.metrics.volumeMm3);
    for (const [x, y, z] of parentEdgeMidpoints("icosahedron")) {
      assert.equal(
        meshHasPoint(rounded.mesh, x, y, z),
        false,
        `parent-edge midpoint still sharp at ${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`,
      );
    }
  });

  it("closed shells round too (solid and hollow)", () => {
    for (const extra of [
      { depth: "solid", openings: false },
      { depth: "hollow", openings: false },
    ]) {
      clearPipelineCache();
      const r = compile({
        base: "icosahedron", subdiv: 1, roundingMm: 0.5, edgeDiv: 4, ...extra,
      });
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
      assertMeshInvariants(r.mesh);
      assert.ok(r.metrics.roundingMm.max > 0);
    }
  });

  it("tiny rounding is a no-op; 0.1 mm applies without overshoot", () => {
    clearPipelineCache();
    const z = compile({ base: "cube", roundingMm: 1e-8, edgeDiv: 4 });
    assert.equal(z.validation.ok, true);
    assert.equal(z.metrics.roundingMm.max, 0);
    clearPipelineCache();
    const r = compile({ base: "cube", roundingMm: 0.1, edgeDiv: 4 });
    assert.equal(r.validation.ok, true);
    assert.ok(Math.abs(r.metrics.roundingMm.max - 0.1) < 1e-9);
    assert.ok(r.metrics.roundingMm.min <= 0.1 + 1e-12);
  });

  it("keeps the opening outline on subdivided faces (rings sample the seams)", () => {
    // Before the seam fix a subdiv-2 face with three internal seams had a
    // 3-point boundary ring, so its fillet was radially sampled on 3 rays
    // — a bare triangle — and volume ROSE with rounding.
    // Normal quality: at Draft the opening is sampled on so few rays that
    // the ray placement alone moves the polygon area by ~1%.
    for (const [base, subdiv] of [
      ["icosahedron", 1], ["icosahedron", 2], ["cube", 2], ["dodecahedron", 1],
    ]) {
      clearPipelineCache();
      const sharp = compile({ base, subdiv });
      clearPipelineCache();
      const round = compile({ base, subdiv, roundingMm: 1 });
      assert.equal(round.validation.ok, true, round.validation.errors[0]?.message);
      assertMeshInvariants(round.mesh);
      const d0 = sharp.metrics.openingMinDiameterMm;
      const d1 = round.metrics.openingMinDiameterMm;
      assert.ok(
        Math.abs(d1 - d0) < 0.05 * d0,
        `${base} subdiv=${subdiv}: opening ${d0.toFixed(3)} → ${d1.toFixed(3)} mm`,
      );
      const v0 = sharp.metrics.volumeMm3, v1 = round.metrics.volumeMm3;
      assert.ok(v1 < v0 && v1 > 0.9 * v0, `${base} subdiv=${subdiv}: volume ${v0} → ${v1}`);
    }
  });

  it("congruent microfaces get identical openings under rounding", () => {
    clearPipelineCache();
    const r = compile({ base: "dodecahedron", subdiv: 1, roundingMm: 1, edgeDiv: 4 });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    const d = r.metrics.faceMetrics.map((f) => f.openingMinDiameterMm);
    assert.equal(d.length, 120);
    assert.ok(Math.max(...d) - Math.min(...d) < 1e-6, `spread ${Math.max(...d) - Math.min(...d)}`);
  });

  it("shallow smooth creases round without float32-degenerate triangles", () => {
    // Smooth 2 % leaves 0.1–0.3° creases between sub-facets; their
    // micrometre-wide strips and caps used to collapse to zero area once
    // positions downcast to float32 (assertMeshInvariants checks that
    // buffer). Those creases now stay sharp below the width floor.
    // Both quality levels: the knee/cap topology depends on the arc
    // segment count, and the edgeDiv-10 case regressed while 4 passed.
    for (const base of ["dodecahedron", "icosahedron"]) {
      for (const subdiv of [1, 2]) {
        for (const [soften, edgeDiv] of [[2, 4], [10, 4], [2, 10]]) {
          clearPipelineCache();
          const r = compile({ base, subdiv, soften, roundingMm: 0.5, edgeDiv });
          assert.equal(
            r.validation.ok, true,
            `${base} subdiv=${subdiv} soften=${soften}: ${r.validation.errors[0]?.message}`,
          );
          assertMeshInvariants(r.mesh);
          assert.ok(Math.abs(r.metrics.roundingMm.max - 0.5) < 1e-6);
        }
      }
    }
  });

  it("Smooth keeps subdivision siblings in one macro face (parent graph)", () => {
    // Under Smooth the sub-facets of a pentagon are no longer coplanar,
    // but they must still be ONE macro: 12 faces, 30 parent edges split
    // into 60 bent halves, 20 true corners — never 120 facets / 62 corners.
    for (const soften of [0, 20, 100]) {
      clearPipelineCache();
      const state = { base: "dodecahedron", subdiv: 1, soften, circumdiameterMm: 100 };
      const sk = scaleSkeleton(hullSkeletonForBase("dodecahedron", state), 50);
      const topo = buildMacroTopology(sk, faceFrames(sk));
      assert.equal(new Set(topo.macroFaceId).size, 12, `soften ${soften}: macros`);
      assert.equal(topo.cornerVerts.size, 20, `soften ${soften}: corners`);
      assert.equal(topo.edges.length, soften === 0 ? 30 : 60, `soften ${soften}: edges`);
      assert.equal(topo.internalKeys.size, 120, `soften ${soften}: seams`);
    }
    // And the rounded mesh under Smooth carries caps only at true corners:
    // its triangle count stays within 1.3× of the unsmoothed rounded mesh.
    clearPipelineCache();
    const flat = compile({ base: "dodecahedron", subdiv: 1, roundingMm: 1 });
    clearPipelineCache();
    const bent = compile({ base: "dodecahedron", subdiv: 1, soften: 50, roundingMm: 1 });
    assert.equal(bent.validation.ok, true, bent.validation.errors[0]?.message);
    assertMeshInvariants(bent.mesh);
    assert.ok(
      bent.metrics.triangleCount < 1.3 * flat.metrics.triangleCount,
      `${bent.metrics.triangleCount} vs ${flat.metrics.triangleCount}`,
    );
    assert.ok(Math.abs(bent.metrics.roundingMm.max - 1) < 1e-6);
  });

  it("bent macro edges (smooth 50) round on mixed-face solids", () => {
    // A subdivision midpoint on a parent edge becomes a knee where two
    // collinear strips meet; on mixed-face solids the split is on one
    // side only, so the other macro's inset corner sat on the shared
    // tangency line and minted zero-area cap triangles.
    for (const base of ["icosidodeca", "cuboctahedron"]) {
      clearPipelineCache();
      const r = compile({ base, subdiv: 2, soften: 50, roundingMm: 1 });
      assert.equal(r.validation.ok, true, `${base}: ${r.validation.errors[0]?.message}`);
      assertMeshInvariants(r.mesh);
    }
  });

  it("smooth-bent icosahedron still rounds watertight", () => {
    clearPipelineCache();
    const r = compile({
      base: "icosahedron", subdiv: 1, soften: 40, roundingMm: 0.5, edgeDiv: 4,
    });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assertMeshInvariants(r.mesh);
  });
});
