/**
 * Start chooser thumbnails — SVG wireframe projection of unit skeletons.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startThumbSvg, skeletonThumbSvg } from "../src/start-thumbs.js";
import { recipeForBase } from "../src/starts.js";
import { BASE_IDS } from "../src/bases.js";
import { edgeList } from "../src/skeleton.js";
import { hullSkeletonForBase, clearPipelineCache } from "../src/pipeline.js";

describe("startThumbSvg", () => {
  for (const base of BASE_IDS) {
    it(`${base} renders a finite wireframe`, () => {
      clearPipelineCache();
      const svg = startThumbSvg(recipeForBase(base));
      assert.match(svg, /^<svg viewBox="/);
      assert.match(svg, /class="thumb-front"/);
      assert.ok(!svg.includes("NaN"), "no NaN coordinates");
      assert.ok(!svg.includes("Infinity"), "no Infinity coordinates");
    });
  }

  it("is deterministic for the same start", () => {
    clearPipelineCache();
    const a = startThumbSvg(recipeForBase("dodecahedron"));
    clearPipelineCache();
    const b = startThumbSvg(recipeForBase("dodecahedron"));
    assert.equal(a, b);
  });

  it("distinguishes different point packs (random vs cube)", () => {
    clearPipelineCache();
    const cube = startThumbSvg(recipeForBase("cube"));
    const random = startThumbSvg(recipeForBase("random"));
    assert.notEqual(cube, random);
  });
});

describe("skeletonThumbSvg", () => {
  it("splits edges into front and back — every edge drawn exactly once", () => {
    clearPipelineCache();
    const skeleton = hullSkeletonForBase("cube", recipeForBase("cube"));
    const svg = skeletonThumbSvg(skeleton);
    const segments = (svg.match(/M-?\d/g) || []).length;
    assert.equal(segments, edgeList(skeleton.faces).length);
    assert.match(svg, /class="thumb-back"/);
    assert.match(svg, /class="thumb-front"/);
  });

  it("a generic view hides some cube edges but never a majority", () => {
    clearPipelineCache();
    const skeleton = hullSkeletonForBase("cube", recipeForBase("cube"));
    const svg = skeletonThumbSvg(skeleton);
    const back = svg.match(/class="thumb-back" d="([^"]*)"/)?.[1] ?? "";
    const front = svg.match(/class="thumb-front" d="([^"]*)"/)?.[1] ?? "";
    const count = (d) => (d.match(/M/g) || []).length;
    // A convex solid seen from a generic angle: 3 hidden edges on a cube
    // (those bounding only back faces), 9 visible.
    assert.equal(count(back), 3);
    assert.equal(count(front), 9);
  });
});
