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
import { loadCsg, subtractAll } from "../src/solid/csg.js";
import { selfIntersections } from "./self-intersect.js";

await loadCsg();

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
    // Rim exactly over the inner face's edge: rim rays graze the cavity.
    { base: "tetrahedron", wallMm: 6 },
    // Great dodecahedron preset: a 0.05 mm sliver of cavity under the rim.
    { base: "icosahedron", spike: 0.5627774222552397, filletMm: 1.5 },
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

  it("a ray that only grazes the cavity doesn't block the hole", () => {
    for (const state of [
      { base: "tetrahedron", wallMm: 6 },
      { base: "icosahedron", spike: 0.5627774222552397, filletMm: 1.5 },
    ]) {
      const r = build(state);
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
      assert.deepEqual(selfIntersections(r.mesh, 1), [], JSON.stringify(state));
    }
  });

  it("leaves no rods or loose bits inside rounded spikes", () => {
    // A copied cavity rounded its spike ridges and tips with the full
    // radius; the cutters trimmed that material into thin rods and, at
    // smaller radii, loose pieces.
    const spiky = {
      base: "icosahedron", spike: 2.383963416875298, borderFraction: 0.47,
      wallMm: 3, wallMode: "scaled", filletMm: 2.3,
    };
    for (const roundingMm of [0.6, 1.8]) {
      const r = build({ ...spiky, roundingMm });
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
      const { genus, bodies } = topology(r.mesh);
      assert.equal(bodies, 1, `rounding ${roundingMm}`);
      assert.equal(genus, r.skeleton.faces.length - 1, `rounding ${roundingMm}`);
      const exact = { positions: r.mesh.positions64, indices: r.mesh.indices };
      assert.deepEqual(selfIntersections(exact, 1), [], `rounding ${roundingMm}`);
    }
  });

  it("has no crossings once positions are rounded to float32 for the STL", () => {
    // Each of these had 1-2: a corner a fraction of a micrometre from the
    // opposite edge of a flat triangle crossed it in float32.
    for (const state of [
      { base: "tetrahedron", roundingMm: 1 },
      {
        base: "icosahedron", spike: 2.383963416875298, borderFraction: 0.47,
        wallMm: 3, wallMode: "scaled", filletMm: 2.3, roundingMm: 1.8,
      },
      { base: "icosidodeca", truncate: 30, roundingMm: 1, edgeDiv: 6 },
      { base: "cuboctahedron", spike: 0.5, wallMm: 4, roundingMm: 2, breakOut: true },
    ]) {
      const r = build(state);
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
      assert.deepEqual(selfIntersections(r.mesh, 1), [], JSON.stringify(state));
    }
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

  it("opens through each face's own wall rather than tunnelling out through a neighbour", () => {
    // Part of each opening reaches the cavity only through the next spike's
    // wall, 20+ mm down. Cutting that deep came out at the valleys: one
    // extra hole per valley. Those parts now keep a floor.
    const spiky = {
      base: "rhombictriaconta", spike: 1.33, borderFraction: 0.5, wallMm: 4.2,
      wallMode: "scaled", filletMm: 1.5, roundingMm: 3.1,
    };
    for (const breakOut of [true, false]) {
      const r = build({ ...spiky, breakOut });
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
      const { genus, bodies } = topology(r.mesh);
      assert.equal(bodies, 1);
      assert.equal(genus, r.skeleton.faces.length - 1, `breakOut ${breakOut}`);
      const info = runPipeline({ ...DEFAULT_STATE, openingAxis: "through", ...spiky, breakOut }).solid.info;
      assert.equal(info.throughBreakOutFaces, 0);
    }
  });

  it("drops loose pieces, keeping the largest", () => {
    // The hole depth no longer frees pieces on any shape we sweep, so the
    // safety net is tested on the boolean: a slab splits a 10 mm box 2:8.
    const box = (x0, y0, z0, x1, y1, z1) => ({
      positions: [
        x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
        x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
      ],
      indices: [
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
        1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
      ],
      faceIds: new Array(12).fill(0),
    });
    const out = subtractAll(box(0, 0, 0, 10, 10, 10), [box(2, -1, -1, 2.5, 11, 11)], { keepLargest: true });
    assert.equal(out.dropped, 1);
    assert.ok(Math.abs(out.droppedVolume - 200) < 1e-6, String(out.droppedVolume));
    assert.equal(topology({ positions: out.positions, indices: out.indices }).bodies, 1);
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
