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

  it("soften fillets edges: corners round down while flats keep their planes", () => {
    const cube = exact("cube");
    const inradius = 1 / Math.sqrt(3);
    const cornerRadius = (soften) => {
      const s = subdivideSkeleton(cube, 2, soften);
      // Original corners keep indices 0–7 (applyFaceIdentity never renumbers).
      return Math.hypot(s.positions[0], s.positions[1], s.positions[2]);
    };
    const r0 = cornerRadius(0);
    const r05 = cornerRadius(0.5);
    const r1 = cornerRadius(1);
    assert.ok(r0 > r05 && r05 > r1, `corners must round inward: ${r0} > ${r05} > ${r1}`);
    assert.ok(Math.abs(r1 - inradius) < 1e-12, "soften 1 reaches the inscribed ball");

    // Face centers sit on the face planes and below every mid clip radius, so
    // the flats — and with them the overall dimensions — never move.
    const half = subdivideSkeleton(cube, 2, 0.5);
    let minR = Infinity;
    for (let i = 0; i < half.positions.length; i += 3) {
      minR = Math.min(
        minR,
        Math.hypot(half.positions[i], half.positions[i + 1], half.positions[i + 2]),
      );
    }
    assert.ok(Math.abs(minR - inradius) < 1e-9, `face centers hold the planes: ${minR}`);
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

  it("grid style ignores soften — the flat quads must stay planar", () => {
    const a = subdivideSkeleton(exact("cube"), 1, 0.7, "grid");
    const b = subdivideSkeleton(exact("cube"), 1, 0, "grid");
    assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
  });

  it("soften rounds edges from the first step, on every base", () => {
    // The old sphere clip left a cube's edges at the full 90° crease until
    // soften ≈ 0.69 (it only reached corner vertices), and on two-radius
    // Catalan solids it pulled outer corners past the inner ring, making
    // creases SHARPER. The rounding clip must strictly reduce the worst
    // crease at moderate soften for every base.
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

  it("soften keeps flat face interiors exactly in plane", () => {
    // Face-interior vertices are fixed points of the rounding clip: their
    // inset foot is R straight below, so they sit exactly on the rounded
    // solid already.
    const flat = subdivideSkeleton(exact("cube"), 2, 0.4);
    // Cube face-center region: vertices whose max |coord| axis value equals
    // the face-plane distance (1/√3) and other coords well inside.
    const d = 1 / Math.sqrt(3);
    let checked = 0;
    for (let i = 0; i < flat.positions.length; i += 3) {
      const c = [flat.positions[i], flat.positions[i + 1], flat.positions[i + 2]];
      const abs = c.map(Math.abs).sort((a, b) => b - a);
      if (abs[1] < d * 0.3) { // near a face centre
        assert.ok(Math.abs(abs[0] - d) < 1e-9, `face centre moved: ${abs[0]}`);
        checked++;
      }
    }
    assert.ok(checked >= 6, "sampled all six face centres");
  });

  it("clamps to SUBDIV_MAX and is deterministic", () => {
    const a = subdivideSkeleton(exact("cube"), 99);
    const b = subdivideSkeleton(exact("cube"), SUBDIV_MAX);
    assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
    assert.deepEqual(a.faces, b.faces);
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
    const r = compileFitted({ base: "cube", subdiv: 2, soften: 60, jitter: 15, seed: 7 });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.equal(r.skeleton.faces.length, 192);
    // The smooth clip caps every vertex below the circumradius: on the
    // 50 mm-radius solid no vertex may reach the sharp-corner radius.
    let maxR = 0;
    for (let i = 0; i < r.skeleton.positions.length; i += 3) {
      maxR = Math.max(
        maxR,
        Math.hypot(
          r.skeleton.positions[i],
          r.skeleton.positions[i + 1],
          r.skeleton.positions[i + 2],
        ),
      );
    }
    assert.ok(maxR < 50 * 0.95, `smoothing survived jitter: max radius ${maxR}`);
    assertMeshInvariants(r.mesh);
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
