import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { edgeInteriorFractions } from "../src/geom/edgesub.js";
import { filletPolygon, collapseMicroEdges } from "../src/geom/poly2.js";
import { radialSample } from "../src/geom/annulus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(__dirname, "fixtures/geom.json"), "utf8"));

const EPS = 1e-9;

function almostEqualArrays(a, b, eps = EPS) {
  assert.equal(a.length, b.length, `length ${a.length} !== ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    const av = typeof a[i] === "number" ? a[i] : a[i];
    const bv = typeof b[i] === "number" ? b[i] : b[i];
    if (Array.isArray(av)) {
      assert.equal(av.length, bv.length);
      for (let j = 0; j < av.length; j++) {
        assert.ok(Math.abs(av[j] - bv[j]) < eps, `idx ${i},${j}: ${av[j]} vs ${bv[j]}`);
      }
    } else {
      assert.ok(Math.abs(av - bv) < eps, `idx ${i}: ${av} vs ${bv}`);
    }
  }
}

describe("edgeInteriorFractions", () => {
  for (const [k, expected] of Object.entries(fixtures.edge_params)) {
    it(`k=${k}`, () => {
      almostEqualArrays([...edgeInteriorFractions(Number(k))], expected);
    });
  }

  it("is reversal-symmetric", () => {
    const ts = edgeInteriorFractions(10);
    for (let i = 0; i < ts.length; i++) {
      assert.ok(Math.abs(ts[i] - (1 - ts[ts.length - 1 - i])) < 1e-12);
    }
  });
});

describe("filletPolygon", () => {
  for (const c of fixtures.fillet_polygon) {
    it(c.name, () => {
      const { polyline, radius } = filletPolygon(c.poly, c.radius, c.segments);
      assert.ok(Math.abs(radius - c.r_used) < 1e-9, `r_used ${radius} vs ${c.r_used}`);
      // result in fixture is list of [x,y]
      const flatExpected = c.result.flat();
      almostEqualArrays([...polyline], flatExpected, 1e-8);
    });
  }
});

describe("collapseMicroEdges", () => {
  it("is a no-op on clean polygons", () => {
    const square = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    assert.deepEqual(collapseMicroEdges(square), square);
    const tri = [[0, 1], [-1, -1], [1, -1]];
    assert.deepEqual(collapseMicroEdges(tri), tri);
  });

  it("collapses a split corner to its midpoint", () => {
    // Square with one corner split by a micro edge.
    const e = 0.01;
    const poly = [[1, 1 - e], [1 - e, 1], [-1, 1], [-1, -1], [1, -1]];
    const out = collapseMicroEdges(poly);
    assert.equal(out.length, 4);
    const mid = out.find((p) => Math.abs(p[0] - (1 - e / 2)) < 1e-12);
    assert.ok(mid, "midpoint vertex present");
    assert.ok(Math.abs(mid[1] - (1 - e / 2)) < 1e-12);
  });

  it("collapses chains of adjacent micro edges (valence-5 splits)", () => {
    // Triangle-ish polygon where one corner split into three vertices.
    const e = 0.02;
    const poly = [
      [0, 1],
      [-1, -1],
      [1 - 2 * e, -1],
      [1 - e, -1 + e / 2],
      [1, -1 + e],
    ];
    const out = collapseMicroEdges(poly);
    assert.equal(out.length, 3, "chain collapsed to a single corner");
  });

  it("restores the full fillet on a polygon with a micro edge", () => {
    const e = 0.01;
    const clean = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const split = [[1, 1 - e], [1 - e, 1], [-1, 1], [-1, -1], [1, -1]];
    const rClean = filletPolygon(clean, 0.5, 8).radius;
    const rSplit = filletPolygon(split, 0.5, 8).radius;
    assert.ok(Math.abs(rClean - 0.5) < 1e-9);
    assert.ok(Math.abs(rSplit - 0.5) < 1e-9, `micro edge clamped radius to ${rSplit}`);
  });
});

describe("radialSample", () => {
  for (const c of fixtures.radial_sample) {
    it(c.name, () => {
      const radii = radialSample(c.polyline, c.angles);
      almostEqualArrays([...radii], c.radii, 1e-8);
    });
  }
});
