import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { exportSvg } from "../src/export/svg.js";

const CAMERA = {
  position: { x: 120, y: -90, z: 80 },
  target: { x: 0, y: 0, z: 40 },
  up: { x: 0, y: 0, z: 1 },
};

describe("exportSvg", () => {
  it("emits a clean line drawing: outlines and occlusion fills, no annotations", () => {
    clearPipelineCache();
    const result = compile({ base: "cube", circumdiameterMm: 100 });
    assert.equal(result.validation.ok, true);
    const svg = exportSvg({
      mesh: result.mesh,
      orientation: result.orientation,
      camera: CAMERA,
      label: "cube_100mm",
    });
    assert.match(svg, /^<\?xml/);
    assert.match(svg, /<title>cube_100mm<\/title>/);
    assert.match(svg, /stroke="#1a1a1a"/); // outline strokes
    assert.doesNotMatch(svg, /fill="#fff"/); // no white occlusion masks
    assert.doesNotMatch(svg, /<text/); // no scale bar / annotations
    assert.doesNotMatch(svg, /"[\d.]+mm"/); // no physical-unit sizing
  });

  it("removes hidden lines: a solid cube draws its 9 visible edges, not all 12", () => {
    clearPipelineCache();
    const result = compile({ base: "cube", depth: "solid", openings: false });
    const svg = exportSvg({
      mesh: result.mesh,
      orientation: result.orientation,
      camera: CAMERA,
    });
    // From a generic ¾ view a cube shows a hexagonal silhouette plus three
    // interior edges meeting at the near corner. Only alternate hexagon
    // corners receive an interior edge, so ≥3-way junctions = 3 hexagon
    // corners + the near corner = 4. If the three hidden back edges leaked
    // through, the far corner and the other three hexagon corners would
    // become junctions too (8 total).
    const segs = [...svg.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)];
    assert.ok(segs.length >= 9, `only ${segs.length} segments drawn`);
    // Cluster endpoints by proximity; junction corners are far apart so a
    // greedy 2.5px merge is unambiguous.
    const reps = []; // [x, y, count]
    for (const [, x0, y0, x1, y1] of segs) {
      for (const [x, y] of [[Number(x0), Number(y0)], [Number(x1), Number(y1)]]) {
        const rep = reps.find((r) => Math.hypot(r[0] - x, r[1] - y) < 2.5);
        if (rep) rep[2] += 1;
        else reps.push([x, y, 1]);
      }
    }
    const junctions = reps.filter((r) => r[2] >= 3).length;
    assert.equal(junctions, 4);
  });

  it("survives a straight-down camera (forward parallel to up)", () => {
    clearPipelineCache();
    const result = compile({ base: "tetrahedron" });
    const svg = exportSvg({
      mesh: result.mesh,
      orientation: result.orientation,
      camera: {
        position: { x: 0, y: 0, z: 300 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 },
      },
    });
    const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? [];
    assert.ok(Number(w) > 100, `viewBox width ${w} collapsed`);
    assert.ok(Number(h) > 100, `viewBox height ${h} collapsed`);
  });

  it("falls back to an orthographic view without a camera", () => {
    clearPipelineCache();
    const result = compile({ base: "tetrahedron" });
    const svg = exportSvg({
      mesh: result.mesh,
      orientation: result.orientation,
    });
    assert.match(svg, /<svg /);
    assert.ok(svg.length > 200);
  });
});
