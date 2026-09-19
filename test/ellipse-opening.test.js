// Ellipse openings — inscribed moment ellipse + the second OpeningGenerator.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inscribedMomentEllipse, ellipsePolyline } from "../src/geom/ellipse.js";
import { radialSample } from "../src/geom/annulus.js";
import { insetEllipse, insetFillet, OPENING_GENERATORS } from "../src/solid/shell.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { assertMeshInvariants } from "../src/mesh.js";
import { BASE_IDS } from "../src/bases.js";
import { recipeForBase } from "../src/starts.js";
import { encodeHash, decodeHash } from "../src/hashcodec.js";
import { DEFAULT_STATE, CONTROL_DEFS } from "../src/schema.js";

/** Flat polygon re-centred on its area centroid (the face-frame convention). */
function centred(pts) {
  let A2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const cr = x0 * y1 - x1 * y0;
    A2 += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
  }
  cx /= 3 * A2; cy /= 3 * A2;
  return Float64Array.from(pts.flatMap(([x, y]) => [x - cx, y - cy]));
}
function regular(n, r = 1) {
  return Array.from({ length: n }, (_, i) => [
    r * Math.cos((2 * Math.PI * i) / n),
    r * Math.sin((2 * Math.PI * i) / n),
  ]);
}
/** 1 on the ellipse, < 1 inside. */
function level(e, x, y) {
  // Solve L·q = p / k, then |q|².
  const px = x / e.k, py = y / e.k;
  const qx = px / e.l11;
  const qy = (py - e.l21 * qx) / e.l22;
  return qx * qx + qy * qy;
}
function midpoints(flat) {
  const n = flat.length / 2, out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push([(flat[i * 2] + flat[j * 2]) / 2, (flat[i * 2 + 1] + flat[j * 2 + 1]) / 2]);
  }
  return out;
}

describe("inscribedMomentEllipse", () => {
  it("is the incircle of a regular polygon", () => {
    for (const n of [3, 4, 5, 6, 12]) {
      const e = inscribedMomentEllipse(centred(regular(n)));
      const apothem = Math.cos(Math.PI / n);
      assert.ok(Math.abs(e.l21) < 1e-12, `${n}-gon is not skewed`);
      assert.ok(Math.abs(e.k * e.l11 - apothem) < 1e-12, `${n}-gon radius`);
      assert.ok(Math.abs(e.k * e.l22 - apothem) < 1e-12, `${n}-gon radius`);
    }
  });

  it("is the Steiner inellipse of a scalene triangle: tangent at all three midpoints", () => {
    const tri = centred([[0, 0], [7, 1], [2, 5]]);
    const e = inscribedMomentEllipse(tri);
    for (const [x, y] of midpoints(tri)) {
      assert.ok(Math.abs(level(e, x, y) - 1) < 1e-12, "midpoint lies on the ellipse");
    }
  });

  it("touches a parallelogram at all four edge midpoints", () => {
    const para = centred([[0, 0], [6, 1], [8, 5], [2, 4]]);
    const e = inscribedMomentEllipse(para);
    for (const [x, y] of midpoints(para)) {
      assert.ok(Math.abs(level(e, x, y) - 1) < 1e-12);
    }
  });

  it("does not depend on winding", () => {
    const pts = [[0, 0], [7, 1], [9, 4], [3, 6]];
    const a = inscribedMomentEllipse(centred(pts));
    const b = inscribedMomentEllipse(centred([...pts].reverse()));
    const pa = ellipsePolyline(a, 1, 64), pb = ellipsePolyline(b, 1, 64);
    const ang = Float64Array.from({ length: 24 }, (_, i) => (2 * Math.PI * i) / 24 + 0.01);
    const ra = radialSample(pa, ang), rb = radialSample(pb, ang);
    for (let i = 0; i < ang.length; i++) assert.ok(Math.abs(ra[i] - rb[i]) < 1e-3);
  });

  it("stays inside an irregular convex polygon and touches it", () => {
    const poly = centred([[0, 0], [5, -1], [9, 2], [8, 6], [3, 7], [-1, 4]]);
    const e = inscribedMomentEllipse(poly);
    const n = poly.length / 2;
    let closest = Infinity;
    for (const [x, y] of (() => {
      const p = ellipsePolyline(e, 1, 720), out = [];
      for (let i = 0; i < p.length; i += 2) out.push([p[i], p[i + 1]]);
      return out;
    })()) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ex = poly[j * 2] - poly[i * 2], ey = poly[j * 2 + 1] - poly[i * 2 + 1];
        // CCW polygon: inside is to the left of every edge.
        const side = (ex * (y - poly[i * 2 + 1]) - ey * (x - poly[i * 2])) / Math.hypot(ex, ey);
        assert.ok(side > -1e-9, "ellipse point escaped the polygon");
        closest = Math.min(closest, side);
      }
    }
    assert.ok(closest < 1e-4, "ellipse is as large as it can be");
  });

  it("returns null on a degenerate polygon", () => {
    assert.equal(inscribedMomentEllipse(Float64Array.from([0, 0, 1, 0, 2, 0])), null);
    assert.equal(inscribedMomentEllipse(Float64Array.from([0, 0, 1, 1])), null);
  });
});

describe("insetEllipse generator", () => {
  it("is registered beside the polygon generator", () => {
    assert.deepEqual(Object.keys(OPENING_GENERATORS), ["polygon", "ellipse"]);
    assert.equal(OPENING_GENERATORS.polygon, insetFillet);
    assert.equal(OPENING_GENERATORS.ellipse, insetEllipse);
  });

  it("scales by (1 − border), reports no fillet, and is star-shaped about the centroid", () => {
    const hex = centred(regular(6, 10));
    const { opening, radiusUsed } = insetEllipse.generate(hex, 0.25, 4.5, 26);
    assert.equal(radiusUsed, 0);
    const ang = Float64Array.from({ length: 36 }, (_, i) => (2 * Math.PI * i) / 36);
    for (const r of radialSample(opening, ang)) {
      assert.ok(Math.abs(r - 0.75 * 10 * Math.cos(Math.PI / 6)) < 1e-2, `radius ${r}`);
    }
  });

  it("never reaches past the polygon inset it replaces", () => {
    const poly = centred([[0, 0], [5, -1], [9, 2], [8, 6], [3, 7], [-1, 4]]);
    const ang = Float64Array.from({ length: 90 }, (_, i) => (2 * Math.PI * i) / 90);
    const oval = radialSample(insetEllipse.generate(poly, 0.3, 0, 64).opening, ang);
    const inset = radialSample(insetFillet.generate(poly, 0.3, 0, 1).opening, ang);
    for (let i = 0; i < ang.length; i++) assert.ok(oval[i] <= inset[i] + 1e-9);
  });

  it("falls back to the bare inset on a degenerate face", () => {
    const sliver = Float64Array.from([0, 0, 1, 0, 2, 0]);
    const { opening, radiusUsed } = insetEllipse.generate(sliver, 0.5, 0, 8);
    assert.equal(radiusUsed, 0);
    assert.deepEqual(Array.from(opening), [0, 0, 0.5, 0, 1, 0]);
  });
});

describe("openingStyle through compile", () => {
  it("is canonical, polygon by default, and a Form control that idles Fillet", () => {
    assert.equal(DEFAULT_STATE.openingStyle, "polygon");
    const def = CONTROL_DEFS.find((d) => d.key === "openingStyle");
    assert.equal(def.group, "form");
    assert.equal(def.inertWhen({ openings: false }), true);
    assert.equal(def.inertWhen({ openings: true }), false);
    const fillet = CONTROL_DEFS.find((d) => d.key === "filletMm");
    assert.equal(fillet.inertWhen({ openings: true, openingStyle: "ellipse" }), true);
    assert.equal(fillet.inertWhen({ openings: true, openingStyle: "polygon" }), false);
  });

  it("legacy hashes decode as polygon, and ellipse survives a round trip", () => {
    const legacy = JSON.parse(Buffer.from(encodeHash({ base: "cube" }).slice(3), "base64url").toString());
    delete legacy.openingStyle;
    const rehash = "v1." + Buffer.from(JSON.stringify(legacy)).toString("base64url");
    assert.equal(decodeHash(rehash).state.openingStyle, "polygon");
    assert.equal(
      decodeHash(encodeHash({ base: "cube", openingStyle: "ellipse" })).state.openingStyle,
      "ellipse",
    );
  });

  it("rejects an unknown style, even behind closed faces", () => {
    clearPipelineCache();
    const r = compile({ base: "cube", openingStyle: "star", openings: false });
    assert.equal(r.validation.ok, false);
    assert.ok(r.validation.errors.some((e) => e.key === "openingStyle"));
  });

  it("the default polygon path is byte-identical to before the option existed", () => {
    clearPipelineCache();
    const a = compile({ base: "icosidodeca" });
    clearPipelineCache();
    const b = compile({ base: "icosidodeca", openingStyle: "polygon" });
    assert.deepEqual(Array.from(a.mesh.positions), Array.from(b.mesh.positions));
    assert.equal(a.mesh.indices.length / 3, 7200);
  });

  it("keeps more material than the polygon at the same border, with the same thinnest strut", () => {
    clearPipelineCache();
    const poly = compile({ base: "icosidodeca", filletMm: 0 });
    clearPipelineCache();
    const oval = compile({ base: "icosidodeca", openingStyle: "ellipse" });
    assert.equal(oval.validation.ok, true);
    assert.ok(oval.metrics.volumeMm3 > poly.metrics.volumeMm3);
    assert.equal(oval.metrics.borderMm.min, poly.metrics.borderMm.min);
    assert.equal(oval.metrics.filletMm.max, 0);
  });

  it("ignores Fillet entirely", () => {
    clearPipelineCache();
    const a = compile({ base: "dodecahedron", openingStyle: "ellipse", filletMm: 0 });
    clearPipelineCache();
    const b = compile({ base: "dodecahedron", openingStyle: "ellipse", filletMm: 6 });
    assert.deepEqual(Array.from(a.mesh.positions), Array.from(b.mesh.positions));
  });

  for (const base of BASE_IDS) {
    it(`${base}: start recipe compiles with ellipse openings`, () => {
      clearPipelineCache();
      const r = compile({ ...recipeForBase(base), openingStyle: "ellipse" });
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
      assertMeshInvariants(r.mesh);
    });
  }

  it("composes with dual, truncate, spike, subdivide, jitter, and both rounding stages", () => {
    for (const st of [
      { base: "sphere", points: 40, dual: true, borderFraction: 0.2, wallMm: 2 },
      { base: "sphere", points: 40, dual: true, truncate: 24, borderFraction: 0.2 },
      { base: "twistedglobe", points: 12, dual: true, roundingMm: 0.8, wallMm: 2.4 },
      { base: "icosahedron", truncate: 33, roundingMm: 1.5 },
      { base: "octahedron", spike: Math.sqrt(3) },
      { base: "cube", subdiv: 1, subdivStyle: "grid" },
      { base: "cube", subdiv: 2, soften: 60 },
      { base: "random", points: 24, seed: 1337, jitter: 10, dual: true },
      { base: "rhombicenneaconta", dual: true, roundingMm: 0.5 },
    ]) {
      clearPipelineCache();
      const r = compile({ ...st, openingStyle: "ellipse" });
      assert.equal(r.validation.ok, true, `${JSON.stringify(st)}: ${r.validation.errors[0]?.message}`);
      assertMeshInvariants(r.mesh);
    }
  });
});
