// Walls — Even (face planes offset along their normals) vs Scaled
// (uniform scale about the origin, the construction before Even).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { faceFrames } from "../src/faceframe.js";
import { encodeHash, decodeHash } from "../src/hashcodec.js";
import { parseProject, serializeProjectV1 } from "../src/project-format.js";
import { DEFAULT_STATE, CONTROL_DEFS } from "../src/schema.js";
import { fitCorner, meanValueWeights } from "../src/solid/offset.js";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

/** Per inner vertex: distance to the nearest outer face plane. */
function innerWallDistances(result) {
  const frames = faceFrames(result.skeleton);
  const P = result.mesh.positions;
  const out = [];
  for (let i = 0; i < P.length / 3; i++) {
    let d = Infinity;
    for (const f of frames) {
      const n = f.normal, o = f.origin;
      d = Math.min(d, (o[0] - P[i * 3]) * n[0] + (o[1] - P[i * 3 + 1]) * n[1] + (o[2] - P[i * 3 + 2]) * n[2]);
    }
    if (d > 0.1) out.push(d);
  }
  return out.sort((a, b) => a - b);
}

describe("fitCorner", () => {
  it("is exact where three planes meet", () => {
    const N = [[-1, 0, 0], [0, -1, 0], unit([-1, -1, -1])];
    const d = fitCorner(N);
    for (const a of N) assert.ok(Math.abs(dot(a, d) - 1) < 1e-9);
  });

  it("never puts a plane closer than the wall when four do not meet", () => {
    const N = [unit([-1, 0, -0.2]), unit([0, -1, -0.5]), unit([1, 0, -0.9]), unit([0, 1, -0.3])];
    const d = fitCorner(N);
    for (const a of N) assert.ok(dot(a, d) >= 1 - 1e-9);
    assert.ok(N.some((a) => Math.abs(dot(a, d) - 1) < 1e-9), "at least one plane sits at the wall");
  });

  it("moves straight in on a flat or creased region", () => {
    assert.deepEqual(fitCorner([[0, 0, -1]]), [0, 0, -1]);
    const N = [unit([0, -0.1, -1]), unit([0, 0.1, -1])];
    const d = fitCorner(N);
    assert.ok(Math.abs(d[0]) < 1e-6);
    for (const a of N) assert.ok(Math.abs(dot(a, d) - 1) < 1e-6);
  });
});

describe("meanValueWeights", () => {
  const poly = new Float64Array([0, 0, 4, 0, 5, 3, 1, 4]);
  it("reproduces linear functions inside the polygon", () => {
    const w = meanValueWeights(poly, 2, 1.5);
    let x = 0, y = 0, s = 0;
    for (let i = 0; i < 4; i++) { x += w[i] * poly[i * 2]; y += w[i] * poly[i * 2 + 1]; s += w[i]; }
    assert.ok(Math.abs(s - 1) < 1e-12 && Math.abs(x - 2) < 1e-9 && Math.abs(y - 1.5) < 1e-9);
  });
  it("is linear along an edge and one-hot at a corner", () => {
    const w = meanValueWeights(poly, 1, 0);
    assert.ok(Math.abs(w[0] - 0.75) < 1e-9 && Math.abs(w[1] - 0.25) < 1e-9);
    assert.deepEqual([...meanValueWeights(poly, 5, 3)], [0, 0, 1, 0]);
  });
});

describe("wallMode", () => {
  it("is canonical state with an Even default and a Form control", () => {
    assert.equal(DEFAULT_STATE.wallMode, "even");
    const def = CONTROL_DEFS.find((d) => d.key === "wallMode");
    assert.equal(def.group, "form");
    assert.equal(def.inertWhen({ depth: "solid" }), true);
    assert.equal(decodeHash(encodeHash(DEFAULT_STATE)).state.wallMode, "even");
  });

  it("links and projects saved before the key load as Scaled", () => {
    const { wallMode, ...legacy } = DEFAULT_STATE;
    assert.equal(decodeHash(encodeHash(legacy)).state.wallMode, "scaled");
    const project = JSON.parse(serializeProjectV1({ state: DEFAULT_STATE }));
    delete project.state.wallMode;
    assert.equal(parseProject(JSON.stringify(project)).project.state.wallMode, "scaled");
    const kept = parseProject(serializeProjectV1({ state: DEFAULT_STATE }));
    assert.equal(kept.project.state.wallMode, "even");
  });

  it("rejects unknown values with a structured error", () => {
    const r = compile({ wallMode: "thick" });
    assert.equal(r.validation.ok, false);
    assert.equal(r.validation.errors[0].key, "wallMode");
  });

  it("matches Scaled on a regular solid", () => {
    const even = compile({ base: "cube", wallMode: "even" });
    const scaled = compile({ base: "cube", wallMode: "scaled" });
    assert.ok(Math.abs(even.metrics.volumeMm3 - scaled.metrics.volumeMm3) < 1e-6 * scaled.metrics.volumeMm3);
  });

  it("keeps the wall at the set value on an irregular hull", () => {
    const opts = { base: "random", seed: 1337, openings: false, wallMm: 1.4 };
    const even = innerWallDistances(compile({ ...opts, wallMode: "even" }));
    const scaled = innerWallDistances(compile({ ...opts, wallMode: "scaled" }));
    const median = (a) => a[Math.floor(a.length / 2)];
    // Hull faces are planar to ~1e-6 mm, hence the tolerance.
    assert.ok(even[0] >= 1.4 - 1e-5, "never thinner than the wall");
    assert.ok(median(even) < 1.4 * 1.01, "most inner vertices sit at the wall");
    assert.ok(median(scaled) > 1.4 * 1.1, "Scaled leaves outer faces thicker");
  });

  it("builds watertight across openings, rounding, spikes and distort", () => {
    for (const extra of [
      { base: "random", seed: 1337 },
      { base: "random", seed: 1337, openingAxis: "normal" },
      { base: "icosidodeca", spike: 1.5 },
      { base: "icosahedron", spike: 1.5, roundingMm: 1 },
      { roundingMm: 1.5, openings: false },
      { jitter: 12.5 },
      { base: "sphere", dual: true, openingStyle: "ellipse" },
      { base: "sphere", roundingMm: 0.4, points: 24, borderMm: 1, filletMm: 1.5 },
    ]) {
      const r = compile({ ...extra, wallMode: "even" });
      assert.equal(r.validation.ok, true, JSON.stringify(extra));
      assert.equal(r.metrics.watertight, true, JSON.stringify(extra));
      assert.ok(r.metrics.wallMm.min >= 1.4 - 1e-9, JSON.stringify(extra));
    }
  });

  it("short Distort edges do not cap the Wall slider", () => {
    const r = compile({ jitter: 12.5, wallMode: "even" });
    assert.ok(r.metrics.limits.wallMmMax > 2);
  });

  it("rejects a wall that folds the inner surface, offering a fit", () => {
    const r = compile({ base: "cube", wallMm: 40, wallMode: "even" });
    assert.equal(r.validation.ok, false);
    const e = r.validation.errors[0];
    assert.equal(e.key, "wallMm");
    assert.ok(compile({ base: "cube", wallMm: e.clampTo, wallMode: "even" }).validation.ok);
  });
});
