// Through openings: closed shell minus one straight cutter per face.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { runPipeline } from "../src/pipeline.js";
import { DEFAULT_STATE } from "../src/schema.js";
import { fixPatch } from "../src/controls.js";
import { CONTROL_DEFS } from "../src/schema.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { throughCutter } from "../src/solid/through.js";

const build = (state) => compile({ ...DEFAULT_STATE, openingAxis: "through", ...state });

/** Genus and connected body count of a closed mesh. */
function topology(mesh) {
  const I = mesh.indices;
  const V = mesh.positions.length / 3;
  const F = I.length / 3;
  const edges = new Set();
  const parent = Array.from({ length: V }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let t = 0; t < F; t++) {
    const tri = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      edges.add(a < b ? a * V + b : b * V + a);
      parent[find(a)] = find(b);
    }
  }
  const bodies = new Set(Array.from({ length: V }, (_, i) => find(i))).size;
  return { genus: (2 * bodies - (V - edges.size + F)) / 2, bodies };
}

describe("Through openings", () => {
  for (const state of [
    { base: "cube" },
    { base: "icosidodeca", wallMm: 6 },
    { base: "random", wallMm: 8 },
    { base: "cube", roundingMm: 1.5, wallMm: 10 },
    { base: "icosidodeca", openingStyle: "ellipse" },
    { base: "cube", wallMode: "scaled", wallMm: 10 },
  ]) {
    it(`one body with a hole per face: ${JSON.stringify(state)}`, () => {
      const r = build(state);
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
      const { genus, bodies } = topology(r.mesh);
      assert.equal(bodies, 1);
      assert.equal(genus, r.skeleton.faces.length - 1);
    });
  }

  it("matches Normal on a thin wall, where nothing spills", () => {
    const through = build({ base: "icosidodeca" });
    const normal = build({ base: "icosidodeca", openingAxis: "normal" });
    const rel = Math.abs(through.metrics.volumeMm3 - normal.metrics.volumeMm3) / normal.metrics.volumeMm3;
    assert.ok(rel < 0.02, `volumes differ by ${(rel * 100).toFixed(2)}%`);
  });

  it("goes straight through where Normal leans back", () => {
    const state = { ...DEFAULT_STATE, base: "random", wallMm: 8 };
    const normal = runPipeline({ ...state, openingAxis: "normal" }).solid.info;
    const through = runPipeline({ ...state, openingAxis: "through" }).solid.info;
    assert.ok(normal.axisLeanFaces > 0);
    assert.ok(through.throughSpillFaces > 0, "some holes should reach a neighbour's inner face");
    assert.equal(through.axisLeanFaces, null);
  });

  it("overlapping holes merge and leave one connected frame", () => {
    const r = build({ base: "cube", wallMm: 10, borderMm: 3, borderFraction: null, filletMm: 2 });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.equal(topology(r.mesh).bodies, 1);
    // Six 52 mm holes through a 10 mm wall: far less than the closed shell.
    const closed = build({ base: "cube", wallMm: 10, openings: false });
    assert.ok(r.metrics.volumeMm3 < 0.1 * closed.metrics.volumeMm3);
  });

  it("collapses micro-edges without fusing neighbouring edges (twisted globe, rounding)", () => {
    const r = build({ base: "twistedglobe", roundingMm: 2 });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.equal(topology(r.mesh).bodies, 1);
  });

  it("rejects a hole that would cut out through a neighbouring face, with a fix", () => {
    const r = build({ base: "icosahedron", spike: 0.5, borderMm: 0.8, borderFraction: null, filletMm: 2 });
    assert.equal(r.validation.ok, false);
    const err = r.validation.errors[0];
    assert.equal(err.key, "openingAxis");
    assert.equal(err.faceIds.length, 2);
    assert.deepEqual(fixPatch(err, CONTROL_DEFS).patch, { openingAxis: "normal" });
  });
});

describe("Break out", () => {
  const pierce = { base: "icosahedron", spike: 0.5, borderMm: 0.8, borderFraction: null, filletMm: 2 };

  it("cuts through the neighbouring face instead of failing", () => {
    const r = build({ ...pierce, breakOut: true });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.equal(topology(r.mesh).bodies, 1);
    const info = runPipeline({ ...DEFAULT_STATE, openingAxis: "through", ...pierce, breakOut: true }).solid.info;
    assert.ok(info.throughBreakOutFaces > 0);
  });

  it("drops loose pieces and warns", () => {
    const state = { base: "icosahedron", spike: 0.6, wallMm: 8, breakOut: true };
    const r = build(state);
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    assert.equal(topology(r.mesh).bodies, 1);
    const info = runPipeline({ ...DEFAULT_STATE, openingAxis: "through", ...state }).solid.info;
    assert.ok(info.looseDropped > 0);
    assert.ok(r.validation.warnings.some((w) => w.key === "breakOut"));
  });

  it("is off by default and does not change builds that never break out", () => {
    assert.equal(DEFAULT_STATE.breakOut, false);
    const off = build({ base: "cube", wallMm: 10 });
    const on = build({ base: "cube", wallMm: 10, breakOut: true });
    assert.equal(on.metrics.volumeMm3, off.metrics.volumeMm3);
  });

  it("sits in Advanced and only acts under Through", () => {
    const def = CONTROL_DEFS.find((d) => d.key === "breakOut");
    assert.equal(def.advanced, true);
    assert.equal(def.inertWhen({ ...DEFAULT_STATE, openingAxis: "normal" }), true);
    assert.equal(def.inertWhen({ ...DEFAULT_STATE, openingAxis: "through" }), false);
    assert.equal(def.inertWhen({ ...DEFAULT_STATE, openingAxis: "through", openings: false }), true);
  });
});

describe("throughCutter", () => {
  const frame = { origin: [0, 0, 10], u: [1, 0, 0], w: [0, 1, 0], normal: [0, 0, 1] };
  const n = 24;
  const Px = Float64Array.from({ length: n }, (_, k) => 5 * Math.cos((2 * Math.PI * k) / n));
  const Py = Float64Array.from({ length: n }, (_, k) => 5 * Math.sin((2 * Math.PI * k) / n));

  for (const lipMm of [0, 1]) {
    it(`is a closed, outward mesh (lip ${lipMm} mm)`, () => {
      const c = throughCutter(frame, Px, Py, { lipMm, segments: 3, topMm: 0.5, depthMm: 4, faceId: 7 });
      const inv = assertMeshInvariants({
        positions: Float64Array.from(c.positions),
        indices: Uint32Array.from(c.indices),
        faceId: Uint32Array.from(c.faceIds),
      });
      // Prism of the 24-gon over 4.5 mm, plus the flare's extra ring.
      const prism = 0.5 * n * 25 * Math.sin((2 * Math.PI) / n) * 4.5;
      if (lipMm) assert.ok(inv.volume > prism);
      else assert.ok(Math.abs(inv.volume - prism) < 1e-6 * prism);
      assert.ok(c.faceIds.every((f) => f === 7));
    });
  }
});
