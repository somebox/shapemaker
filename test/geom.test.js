import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { edgeParams } from "../src/geom/edgesub.js";
import { filletPolygon } from "../src/geom/poly2.js";
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

describe("edgeParams", () => {
  for (const [k, expected] of Object.entries(fixtures.edge_params)) {
    it(`k=${k}`, () => {
      almostEqualArrays([...edgeParams(Number(k))], expected);
    });
  }

  it("is reversal-symmetric", () => {
    const ts = edgeParams(10);
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

describe("radialSample", () => {
  for (const c of fixtures.radial_sample) {
    it(c.name, () => {
      const radii = radialSample(c.polyline, c.angles);
      almostEqualArrays([...radii], c.radii, 1e-8);
    });
  }
});
