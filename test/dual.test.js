// Dual operator — polar reciprocation about the origin, re-hulled.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { clearPipelineCache, hullSkeletonForBase } from "../src/pipeline.js";
import { dualSkeleton } from "../src/dual.js";
import { truncateSkeleton } from "../src/truncate.js";
import { newell } from "../src/skeleton.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { encodeHash, decodeHash } from "../src/hashcodec.js";
import { DEFAULT_STATE, STATE_KEYS, CONTROL_DEFS } from "../src/schema.js";

const arities = (sk) => {
  const c = {};
  for (const f of sk.faces) c[f.length] = (c[f.length] || 0) + 1;
  return c;
};
const base = (id, state = {}) => hullSkeletonForBase(id, state);

function vertexSet(sk, digits = 9) {
  const rows = [];
  const used = new Set(sk.faces.flat());
  for (const i of used) {
    rows.push(
      [0, 1, 2].map((k) => (sk.positions[i * 3 + k] + 0).toFixed(digits).replace(/^-0\.0+$/, "0.000000000")).join(","),
    );
  }
  return rows.sort();
}

describe("dualSkeleton", () => {
  it("swaps the classic pairs", () => {
    assert.deepEqual(arities(dualSkeleton(base("cube"))), { 3: 8 });
    assert.deepEqual(arities(dualSkeleton(base("octahedron"))), { 4: 6 });
    assert.deepEqual(arities(dualSkeleton(base("dodecahedron"))), { 3: 20 });
    assert.deepEqual(arities(dualSkeleton(base("icosahedron"))), { 5: 12 });
    assert.deepEqual(arities(dualSkeleton(base("tetrahedron"))), { 3: 4 });
  });

  it("takes the quasi-regular solids to their rhombic Catalan duals", () => {
    assert.deepEqual(arities(dualSkeleton(base("cuboctahedron"))), { 4: 12 });
    const r30 = dualSkeleton(base("icosidodeca"));
    assert.deepEqual(arities(r30), { 4: 30 });
    // Same solid as the rhombic triacontahedron base: one edge length.
    const lens = r30.edges.map(([a, b]) =>
      Math.hypot(
        r30.positions[a * 3] - r30.positions[b * 3],
        r30.positions[a * 3 + 1] - r30.positions[b * 3 + 1],
        r30.positions[a * 3 + 2] - r30.positions[b * 3 + 2],
      ));
    assert.ok(Math.max(...lens) - Math.min(...lens) < 1e-9);
  });

  it("is an involution up to scale", () => {
    const cube = base("cube");
    const back = dualSkeleton(dualSkeleton(cube));
    assert.deepEqual(arities(back), { 4: 6 });
    assert.deepEqual(vertexSet(back), vertexSet(cube));
  });

  it("renormalizes to unit circumradius and is deterministic", () => {
    const a = dualSkeleton(base("rhombicosidodeca"));
    const b = dualSkeleton(base("rhombicosidodeca"));
    assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
    let rMax = 0;
    for (let i = 0; i < a.positions.length; i += 3) {
      rMax = Math.max(rMax, Math.hypot(a.positions[i], a.positions[i + 1], a.positions[i + 2]));
    }
    assert.ok(Math.abs(rMax - 1) < 1e-12, `unit circumradius, got ${rMax}`);
  });

  it("gives one planar k-gon per k-valent parent vertex on an unmerged triangulation", () => {
    const sphere = base("sphere", { points: 48 });
    const valence = new Array(sphere.positions.length / 3).fill(0);
    for (const f of sphere.faces) for (const v of f) valence[v]++;
    const parent = {};
    for (const v of valence) parent[v] = (parent[v] || 0) + 1;
    const dual = dualSkeleton(sphere);
    assert.equal(dual.faces.length, 48);
    assert.deepEqual(arities(dual), parent);
    for (const f of dual.faces) {
      const { normal, centroid } = newell(dual.positions, f);
      for (const i of f) {
        const d =
          normal[0] * (dual.positions[i * 3] - centroid[0]) +
          normal[1] * (dual.positions[i * 3 + 1] - centroid[1]) +
          normal[2] * (dual.positions[i * 3 + 2] - centroid[2]);
        assert.ok(Math.abs(d) < 1e-9, `dual face off-plane by ${d}`);
      }
    }
  });

  it("a triangulation's dual is three-valent, so Truncate cuts it exactly", () => {
    const dual = dualSkeleton(base("sphere", { points: 48 }));
    const V = dual.positions.length / 3;
    const touch = new Array(V).fill(0);
    for (const f of dual.faces) for (const v of f) touch[v]++;
    assert.ok(touch.every((n) => n === 3));
    const cut = truncateSkeleton(dual, 0.24);
    // One clean triangle per corner, every parent face kept with doubled sides.
    assert.equal(cut.faces.filter((f) => f.length === 3).length, V);
    assert.equal(cut.faces.length, V + dual.faces.length);
  });
});

describe("dual through compile", () => {
  it("is canonical, off by default, and a Shape control", () => {
    assert.equal(DEFAULT_STATE.dual, false);
    assert.ok(STATE_KEYS.indexOf("dual") > STATE_KEYS.indexOf("jitterMode"));
    assert.ok(STATE_KEYS.indexOf("dual") < STATE_KEYS.indexOf("truncate"));
    const def = CONTROL_DEFS.find((d) => d.key === "dual");
    assert.equal(def.group, "shape");
    assert.equal(def.boolean, true);
    clearPipelineCache();
    const r = compile({ base: "cube" });
    assert.equal(r.state.dual, false);
    assert.equal(r.skeleton.faces.length, 6);
  });

  it("legacy hashes decode with dual off, and dual survives a round trip", () => {
    const legacy = JSON.parse(Buffer.from(encodeHash({ base: "cube" }).slice(3), "base64url").toString());
    delete legacy.dual;
    const rehash = "v1." + Buffer.from(JSON.stringify(legacy)).toString("base64url");
    assert.equal(decodeHash(rehash).state.dual, false);
    assert.equal(decodeHash(encodeHash({ base: "cube", dual: true })).state.dual, true);
  });

  it("rejects a non-boolean dual", () => {
    clearPipelineCache();
    const r = compile({ base: "cube", dual: "yes" });
    assert.equal(r.validation.ok, false);
    assert.ok(r.validation.errors.some((e) => e.key === "dual"));
  });

  it("runs before Truncate", () => {
    clearPipelineCache();
    // dual(cube) = octahedron, then cut: squares + hexagons. The other order
    // (truncated cube, then dual) would be a 24-triangle triakis octahedron.
    const sk = hullSkeletonForBase("cube", { dual: true, truncate: 25 });
    assert.deepEqual(arities(sk), { 4: 6, 6: 8 });
  });

  it("composes with jitter, truncate, spike, subdivide, smooth, and rounding", () => {
    for (const st of [
      { base: "icosidodeca", dual: true, roundingMm: 1 },
      { base: "cube", dual: true, truncate: 25, subdiv: 1, subdivStyle: "grid" },
      { base: "dodecahedron", dual: true, subdiv: 2, soften: 50 },
      { base: "icosahedron", dual: true, spike: 1.6, filletMm: 1.5 },
      { base: "cuboctahedron", dual: true, jitter: 12, seed: 42 },
      { base: "sphere", points: 40, dual: true, truncate: 24, filletMm: 0.5 },
      { base: "twistedglobe", points: 12, dual: true, filletMm: 1 },
      { base: "globe", points: 12, dual: true, filletMm: 1 },
      { base: "rhombicenneaconta", dual: true, filletMm: 1 },
    ]) {
      clearPipelineCache();
      const r = compile(st);
      assert.equal(r.validation.ok, true, `${JSON.stringify(st)}: ${r.validation.errors[0]?.message}`);
      assertMeshInvariants(r.mesh);
    }
  });

  it("never throws on irregular parents: compiles or reports a validation error", () => {
    for (const b of ["random", "sphere", "globe", "twistedglobe"]) {
      for (const seed of [1, 7, 42, 1337, 90210]) {
        for (const jitter of [0, 10, 30]) {
          clearPipelineCache();
          const st = {
            base: b, points: 16, separation: 0.56, seed, jitter, dual: true,
            depth: "solid", openings: false,
          };
          const r = compile(st);
          if (r.validation.ok) assertMeshInvariants(r.mesh);
          else assert.ok(r.validation.errors.length > 0, JSON.stringify(st));
        }
      }
    }
  });
});
