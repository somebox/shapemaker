/**
 * Surface subdivision — flat splits (triangles 4:1, polygons midpoint-fan;
 * mixed-face solids stay closed) plus the Smooth sphere-clip edge fillet.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { subdivideSkeleton, SUBDIV_MAX } from "../src/subdivide.js";
import {
  hullSkeletonForBase,
  scaleSkeleton,
  clearPipelineCache,
} from "../src/pipeline.js";
import { computeLimits } from "../src/limits.js";
import { compile } from "../src/compile.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { separationForPoints } from "../src/schema.js";
import { encodeHash, decodeHash } from "../src/hashcodec.js";
import { toFaceFrame } from "../src/faceframe.js";

function exact(base) {
  clearPipelineCache();
  return hullSkeletonForBase(base, { jitter: 0 });
}

/** Distinct face-plane normals (rounded) must match the parent count. */
function assertSkeletonHasOnlyParentPlanes(skeleton, expected) {
  const normals = new Set();
  for (let f = 0; f < skeleton.faces.length; f++) {
    const n = toFaceFrame(skeleton, f).normal.map((v) => Math.round(v * 1e6) / 1e6);
    normals.add(n.join(","));
  }
  assert.equal(normals.size, expected);
}

describe("subdivideSkeleton", () => {
  it("level 0 returns the input untouched", () => {
    const cube = exact("cube");
    assert.equal(subdivideSkeleton(cube, 0), cube);
  });

  it("expected face counts per base and level", () => {
    // cube: 6 quads → 8 fan triangles each; icosa: 4:1 geodesic;
    // icosidodeca: 20×4 + 12×10 (mixed faces share midpoint-split edges).
    for (const [base, l1, l2] of [
      ["cube", 48, 192],
      ["icosahedron", 80, 320],
      ["icosidodeca", 200, 800],
    ]) {
      const s1 = subdivideSkeleton(exact(base), 1);
      const s2 = subdivideSkeleton(exact(base), 2);
      assert.equal(s1.faces.length, l1, `${base} level 1`);
      assert.equal(s2.faces.length, l2, `${base} level 2`);
      assert.ok(s1.faces.every((f) => f.length === 3), "all triangles");
    }
  });

  it("soften 0 is an exact flat split — parent planes and dimensions hold", () => {
    const cube = exact("cube");
    const flat = subdivideSkeleton(cube, 1, 0);
    // Original corner vertices are untouched (indices 0–7, radius 1).
    for (let i = 0; i < 8 * 3; i += 3) {
      const r = Math.hypot(flat.positions[i], flat.positions[i + 1], flat.positions[i + 2]);
      assert.ok(Math.abs(r - 1) < 1e-12, `corner moved: ${r}`);
    }
    // Six distinct face normals survive: sub-faces of one parent are coplanar.
    assertSkeletonHasOnlyParentPlanes(flat, 6);
  });

  it("soften fairs convex solids toward a sphere while keeping unit circumradius", () => {
    const cube = exact("cube");
    const minRadius = (soften) => {
      const s = subdivideSkeleton(cube, 2, soften);
      let rMin = Infinity, rMax = 0;
      for (let i = 0; i < s.positions.length; i += 3) {
        const r = Math.hypot(s.positions[i], s.positions[i + 1], s.positions[i + 2]);
        rMin = Math.min(rMin, r);
        rMax = Math.max(rMax, r);
      }
      assert.ok(Math.abs(rMax - 1) < 1e-12, `circumradius holds: ${rMax}`);
      return rMin;
    };
    const r0 = minRadius(0);
    const r05 = minRadius(0.5);
    const r1 = minRadius(1);
    assert.ok(
      r0 < r05 && r05 < r1,
      `face centres lift toward the sphere as corners round: ${r0} < ${r05} < ${r1}`,
    );
    assert.ok(r1 > 0.96, `soften 1 approaches a sphere: rMin=${r1}`);
  });

  it("grid style: corner quads per n-gon, 4:1 triangles, planar faces", () => {
    // cube: 6 quads → 4 corner quads each (4 openings per side, not 8);
    // icosa: triangles ignore style (4:1 both ways);
    // icosidodeca: 12×5 quads + 20×4 triangles.
    for (const [base, l1, l2] of [
      ["cube", 24, 96],
      ["icosahedron", 80, 320],
      ["icosidodeca", 140, 560],
    ]) {
      const s1 = subdivideSkeleton(exact(base), 1, 0, "grid");
      const s2 = subdivideSkeleton(exact(base), 2, 0, "grid");
      assert.equal(s1.faces.length, l1, `${base} grid level 1`);
      assert.equal(s2.faces.length, l2, `${base} grid level 2`);
    }
    const g = subdivideSkeleton(exact("cube"), 1, 0, "grid");
    assert.ok(g.faces.every((f) => f.length === 4), "cube grid is all quads");
    assertSkeletonHasOnlyParentPlanes(g, 6);
  });

  it("grid style with soften > 0 splits quads symmetrically into planar triangles", () => {
    const a = subdivideSkeleton(exact("cube"), 1, 0.7, "grid");
    assert.equal(a.faces.length, 48);
    assert.ok(a.faces.every((f) => f.length === 3));
  });

  it("soften rounds edges from the first step, on every base", () => {
    const maxCrease = (sk) => {
      const { positions: pos, faces, edges } = sk;
      const normals = faces.map((ring) => {
        let nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i] * 3, b = ring[(i + 1) % ring.length] * 3;
          nx += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2]);
          ny += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b]);
          nz += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1]);
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        return [nx / l, ny / l, nz / l];
      });
      const owner = new Map();
      for (let f = 0; f < faces.length; f++) {
        const ring = faces[f];
        for (let i = 0; i < ring.length; i++) {
          owner.set(ring[i] * 0x100000 + ring[(i + 1) % ring.length], f);
        }
      }
      let worst = 0;
      for (const [a, b] of edges) {
        const f1 = owner.get(a * 0x100000 + b), f2 = owner.get(b * 0x100000 + a);
        if (f1 == null || f2 == null) continue;
        const [x1, y1, z1] = normals[f1], [x2, y2, z2] = normals[f2];
        worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1,
          x1 * x2 + y1 * y2 + z1 * z2))));
      }
      return (worst * 180) / Math.PI;
    };
    for (const base of ["cube", "tetrahedron", "rhombicdodeca", "rhombictriaconta"]) {
      const sharp = maxCrease(subdivideSkeleton(exact(base), 2, 0));
      const soft = maxCrease(subdivideSkeleton(exact(base), 2, 0.3));
      assert.ok(soft < sharp - 1e-6,
        `${base}: soften 0.3 must reduce the worst crease (${sharp.toFixed(1)}° → ${soft.toFixed(1)}°)`);
    }
  });

  it("soften fairs mixed-face solids monotonically toward a sphere", () => {
    const ico = exact("icosidodeca");
    const minRadius = (soften) => {
      const s = subdivideSkeleton(ico, 2, soften);
      let rMin = Infinity;
      for (let i = 0; i < s.positions.length; i += 3) {
        rMin = Math.min(rMin, Math.hypot(s.positions[i], s.positions[i + 1], s.positions[i + 2]));
      }
      return rMin;
    };
    const r0 = minRadius(0);
    const r05 = minRadius(0.5);
    const r1 = minRadius(1);
    assert.ok(r0 < r05 && r05 < r1, `icosidodeca rMin rises: ${r0} < ${r05} < ${r1}`);
    assert.ok(r1 > 0.95, `icosidodeca approaches sphere at soften 1: ${r1}`);
  });

  it("clamps to SUBDIV_MAX and is deterministic", () => {
    const a = subdivideSkeleton(exact("cube"), 99);
    const b = subdivideSkeleton(exact("cube"), SUBDIV_MAX);
    assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
    assert.deepEqual(a.faces, b.faces);
  });

  it("tags child faces with the root parent index through both levels", () => {
    const cube = exact("cube");
    const s1 = subdivideSkeleton(cube, 1);
    assert.equal(s1.macroFaceId.length, s1.faces.length);
    const c1 = new Map();
    for (const id of s1.macroFaceId) c1.set(id, (c1.get(id) ?? 0) + 1);
    assert.equal(c1.size, 6);
    for (const n of c1.values()) assert.equal(n, 8);

    const s2 = subdivideSkeleton(cube, 2);
    const c2 = new Map();
    for (const id of s2.macroFaceId) c2.set(id, (c2.get(id) ?? 0) + 1);
    assert.equal(c2.size, 6);
    for (const n of c2.values()) assert.equal(n, 32);

    const ico = subdivideSkeleton(exact("icosahedron"), 1);
    const ci = new Map();
    for (const id of ico.macroFaceId) ci.set(id, (ci.get(id) ?? 0) + 1);
    assert.equal(ci.size, 20);
    for (const n of ci.values()) assert.equal(n, 4);
  });
});

describe("subdivision through the pipeline", () => {
  it("compiles watertight across bases and levels (fitted border)", () => {
    for (const base of ["cube", "icosidodeca", "sphere"]) {
      for (const subdiv of [1, 2]) {
        clearPipelineCache();
        const r = compile({ base, subdiv, borderMm: 0.6, filletMm: 0.5 });
        assert.equal(
          r.validation.ok,
          true,
          `${base} sub${subdiv}: ${r.validation.errors[0]?.message}`,
        );
        assertMeshInvariants(r.mesh);
      }
    }
  });

  /** Compile with a border fitted from the real limits — what the app's
   * adaptation does on every reshape edit. Perturbed flat sub-faces can get
   * arbitrarily small, so a fixed test border would be seed-dependent. */
  function compileFitted(state) {
    clearPipelineCache();
    const unit = hullSkeletonForBase(state.base, state);
    const sk = scaleSkeleton(unit, (state.circumdiameterMm ?? 100) / 2);
    const limits = computeLimits(sk, { ...state, openings: true });
    const borderMm = Math.max(0.02, Math.floor(limits.borderMmMax * 80) / 100);
    return compile({ ...state, borderMm, filletMm: 0.2 });
  }

  it("jitter preserves subdivision — order is jitter → subdivide", () => {
    // Regression: perturbing AFTER subdivision made most sub-face planes
    // non-binding, silently discarding subdivision (and smoothing with it).
    const r = compileFitted({ base: "cube", subdiv: 1, jitter: 25, seed: 7 });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.equal(
      r.skeleton.faces.length,
      48,
      "jittered cube keeps its full subdivision",
    );
    assertMeshInvariants(r.mesh);
  });

  it("jitter preserves smoothing — corners stay rounded", () => {
    const sharp = compileFitted({ base: "cube", subdiv: 2, soften: 0, jitter: 15, seed: 7 });
    const r = compileFitted({ base: "cube", subdiv: 2, soften: 60, jitter: 15, seed: 7 });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.equal(r.skeleton.faces.length, 192);
    const minRadius = (sk) => {
      let minR = Infinity, maxR = 0;
      for (let i = 0; i < sk.positions.length; i += 3) {
        const d = Math.hypot(sk.positions[i], sk.positions[i + 1], sk.positions[i + 2]);
        minR = Math.min(minR, d);
        maxR = Math.max(maxR, d);
      }
      assert.ok(Math.abs(maxR - 50) < 1e-9, `circumradius holds at 50 mm: ${maxR}`);
      return minR;
    };
    const rSharp = minRadius(sharp.skeleton);
    const rSoft = minRadius(r.skeleton);
    assert.ok(rSoft > rSharp * 1.25, `smoothing faired jittered cube: minR ${rSharp} → ${rSoft}`);
    assertMeshInvariants(r.mesh);
  });

  it("auto-refines when subdiv=0 and soften>0 (coarse bases 2 levels, medium/dense 1 level)", () => {
    clearPipelineCache();
    const cubeSoft = compile({ base: "cube", subdiv: 0, soften: 50, openings: false, depth: "solid" });
    assert.equal(cubeSoft.validation.ok, true, cubeSoft.validation.errors[0]?.message);
    assert.equal(cubeSoft.skeleton.faces.length, 192, "cube auto-refines 2 levels");
    assertMeshInvariants(cubeSoft.mesh);

    clearPipelineCache();
    const icoSoft = compile({ base: "icosidodeca", subdiv: 0, soften: 50 });
    assert.equal(icoSoft.validation.ok, true, icoSoft.validation.errors[0]?.message);
    assert.equal(icoSoft.skeleton.faces.length, 200, "icosidodeca (>12 faces) auto-refines 1 level");
    assertMeshInvariants(icoSoft.mesh);
    assert.ok(
      icoSoft.validation.warnings.some((w) => w.key === "borderFraction" && /printable floor/i.test(w.message)),
      "surfaces borderPrintabilityWarning when auto-refined openings shrink below 2.5 mm",
    );
    const hash = encodeHash(cubeSoft.state);
    const restored = decodeHash(hash);
    assert.equal(restored.ok, true);
    assert.equal(restored.state.subdiv, 0);
    assert.equal(restored.state.soften, 50);
    const recompiled = compile(restored.state);
    assert.equal(recompiled.skeleton.faces.length, 192);
  });

  it("subdiv round-trips through the hash codec; old hashes default to 0", () => {
    clearPipelineCache();
    const state = compile({ base: "cube", subdiv: 1, borderMm: 0.6, filletMm: 0.5 }).state;
    const decoded = decodeHash(encodeHash(state));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.state.subdiv, 1);
    const legacy = decodeHash(encodeHash({ base: "cube" }));
    assert.equal(legacy.state.subdiv, 0);
  });

  it("rejects out-of-range subdiv", () => {
    clearPipelineCache();
    const r = compile({ base: "cube", subdiv: 3 });
    assert.equal(r.validation.ok, false);
    assert.ok(r.validation.errors.some((e) => e.key === "subdiv"));
  });

  it("rejects an unknown subdivStyle; legacy states default to radial", () => {
    clearPipelineCache();
    const bad = compile({ base: "cube", subdiv: 1, subdivStyle: "spiral" });
    assert.equal(bad.validation.ok, false);
    assert.ok(bad.validation.errors.some((e) => e.key === "subdivStyle"));
    const legacy = decodeHash(encodeHash({ base: "cube", subdiv: 1 }));
    assert.equal(legacy.state.subdivStyle, "radial");
  });

  it("grid through compile: 4 openings per cube side at Once, 16 at Twice", () => {
    for (const [subdiv, faces] of [[1, 24], [2, 96]]) {
      clearPipelineCache();
      const r = compile({
        base: "cube", subdiv, subdivStyle: "grid",
        depth: "hollow", wallMm: 1.4, openings: true, borderMm: 2, filletMm: 2,
      });
      assert.equal(r.validation.ok, true, JSON.stringify(r.validation.errors));
      assert.equal(r.skeleton.faces.length, faces);
      assert.ok(r.skeleton.faces.every((f) => f.length === 4));
    }
  });
});

describe("separationForPoints (density slider coupling)", () => {
  it("matches the retired level anchors and clamps the band", () => {
    assert.equal(separationForPoints(12), 0.6);
    assert.equal(separationForPoints(24), 0.5);
    assert.equal(separationForPoints(48), 0.4);
    assert.equal(separationForPoints(4), 0.7);
    assert.ok(separationForPoints(60) >= 0.3);
  });
});
