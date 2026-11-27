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

  it("finds the same fit by descent as by trying every active set", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const cost = (N, d) => N.reduce((s, a) => s + (dot(a, d) - 1) ** 2, 0);
    for (let trial = 0; trial < 500; trial++) {
      const k = 3 + Math.floor(rnd() * 9);
      const spread = 0.2 + rnd() * 1.6;
      const N = Array.from({ length: k }, () =>
        unit([(rnd() - 0.5) * spread, (rnd() - 0.5) * spread, -1]));
      const exact = fitCorner(N, { enumerateMax: Infinity });
      const fast = fitCorner(N, { enumerateMax: 0 });
      for (const a of N) assert.ok(dot(a, fast) >= 1 - 1e-9, `trial ${trial}: a plane is inside the wall`);
      assert.ok(cost(N, fast) <= cost(N, exact) * (1 + 1e-9) + 1e-12, `trial ${trial}: descent is thicker`);
    }
  });

  it("finds the same fit on wide and flat corners, and none where enumeration finds none", () => {
    // Normals over most of a hemisphere, straddling its rim, or nearly in
    // one plane (a fit thousands to millions of walls deep). The plain fit
    // and the normals' sum can both miss every feasible point here, and the
    // flat ones defeated a Gram-matrix hull search with absolute
    // tolerances; descent then fell back to a fit inside the wall.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const cost = (N, d) => N.reduce((s, a) => s + (dot(a, d) - 1) ** 2, 0);
    const wide = () => () => unit([2 * rnd() - 1, 2 * rnd() - 1, -(0.001 + rnd() * 0.3)]);
    const rim = () => () => unit([2 * rnd() - 1, 2 * rnd() - 1, 0.005 - rnd() * 0.02]);
    const flatter = (lo, span) => () => {
      const eps = 10 ** (-lo - rnd() * span);
      return () => unit([2 * rnd() - 1, 2 * rnd() - 1, -eps * (0.1 + rnd())]);
    };
    for (const [name, makeGen, trials, count, fresh] of [
      ["wide", wide, 300, () => 11 + Math.floor(rnd() * 10)],
      ["rim", rim, 300, () => 11 + Math.floor(rnd() * 10)],
      // Flat trial 314 (seed 7) and crease trial 26 (seed 31) are the cases
      // found in review: a start inside the wall, and a singular plain fit
      // that skipped enumeration for a fit 1.7% thicker.
      ["flat", flatter(3, 3), 400, () => 11, 7],
      ["crease", flatter(1, 6), 200, () => 11, 31],
    ]) {
      if (fresh) seed = fresh;
      for (let trial = 0; trial < trials; trial++) {
        const gen = makeGen();
        const N = Array.from({ length: count() }, gen);
        const exact = fitCorner(N, { enumerateMax: Infinity });
        const fast = fitCorner(N, { enumerateMax: 0 });
        const at = `${name} ${trial}`;
        if (N.every((a) => dot(a, exact) >= 1 - 1e-9)) {
          for (const a of N) assert.ok(dot(a, fast) >= 1 - 1e-9, `${at}: a plane is inside the wall`);
          assert.ok(cost(N, fast) <= cost(N, exact) * (1 + 1e-9) + 1e-12, `${at}: descent is thicker`);
        } else {
          const gap = Math.hypot(...exact.map((x, i) => x - fast[i]));
          assert.ok(gap <= 1e-6 * Math.hypot(...exact), `${at}: a different fallback`);
        }
      }
    }
  });

  it("fits a corner of hundreds of planes quickly", () => {
    // Smooth on a dense globe gathers a pole into one corner like this.
    // Trying every set of three took 2.5 s here (minutes over a whole
    // globe); descent takes well under a millisecond. The bound leaves
    // room for slow machines and still fails the cubic search.
    const N = Array.from({ length: 300 }, (_, i) => {
      const t = (i / 300) * 2 * Math.PI;
      const r = 0.05 + 0.4 * (((i * 7919) % 300) / 300);
      return unit([r * Math.cos(t), r * Math.sin(t), -1]);
    });
    const t0 = performance.now();
    const d = fitCorner(N);
    const ms = performance.now() - t0;
    assert.ok(ms < 250, `took ${ms.toFixed(0)} ms`);
    for (const a of N) assert.ok(dot(a, d) >= 1 - 1e-9);
    assert.ok(N.some((a) => Math.abs(dot(a, d) - 1) < 1e-9), "at least one plane sits at the wall");
  });

  it("fits a crease of hundreds of planes quickly, moving none along it", () => {
    // Every normal is perpendicular to y, so the plain fit is singular.
    // This used to fall back to trying 4.5 million active sets (found in
    // review); the scaled frame drops the free axis instead.
    const N = Array.from({ length: 300 }, (_, i) => [Math.sin(i / 1000), 0, -Math.cos(i / 1000)]);
    const t0 = performance.now();
    const d = fitCorner(N);
    const ms = performance.now() - t0;
    assert.ok(ms < 250, `took ${ms.toFixed(0)} ms`);
    for (const a of N) assert.ok(dot(a, d) >= 1 - 1e-9);
    assert.equal(d[1], 0, "no move along the crease");
    // Every tenth plane: few enough to check against enumeration.
    const cost = (M, x) => M.reduce((s, a) => s + (dot(a, x) - 1) ** 2, 0);
    const M = N.filter((_, i) => i % 10 === 0);
    const fast = fitCorner(M), exact = fitCorner(M, { enumerateMax: Infinity });
    assert.ok(cost(M, fast) <= cost(M, exact) * (1 + 1e-9) + 1e-12);
  });

  it("clears every plane on nearly flat corners at any orientation", () => {
    // Rotated, a nearly flat corner no longer lines its free axis up with
    // x, y or z, and enumeration itself misses some fits at these depths
    // (up to 1e9 walls), so this checks clearance directly. Every corner
    // here has a fit: all normals lean on the rotated −z. Float64 resolves
    // a·d only to ~1e-12 of the fit's depth.
    let seed = 2024;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let trial = 0; trial < 300; trial++) {
      const [qa, qb, qc, qd] = unit([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
      const R = [
        [qa * qa + qb * qb - qc * qc - qd * qd, 2 * (qb * qc - qa * qd), 2 * (qb * qd + qa * qc)],
        [2 * (qb * qc + qa * qd), qa * qa - qb * qb + qc * qc - qd * qd, 2 * (qc * qd - qa * qb)],
        [2 * (qb * qd - qa * qc), 2 * (qc * qd + qa * qb), qa * qa - qb * qb - qc * qc + qd * qd],
      ];
      const eps = 10 ** (-1 - rnd() * 7);
      const N = Array.from({ length: 11 + Math.floor(rnd() * 25) }, () => {
        const v = [2 * rnd() - 1, 2 * rnd() - 1, -eps * (0.1 + rnd())];
        return unit(R.map((row) => dot(row, v)));
      });
      const d = fitCorner(N);
      const depth = Math.max(1, Math.hypot(...d));
      for (const a of N) assert.ok(dot(a, d) >= 1 - 1e-12 * depth, `trial ${trial}: a plane is inside the wall`);
    }
  });
});

describe("Even walls on smoothed dense globes", () => {
  it("build in seconds, not minutes", () => {
    // Under 1 s here; before descent this ran for minutes with the app
    // frozen. A test timeout can't interrupt synchronous work, so the
    // bound is checked after the build.
    const t0 = performance.now();
    const r = compile({ ...DEFAULT_STATE, base: "globe", points: 36, subdiv: 1, soften: 30, wallMode: "even" });
    const ms = performance.now() - t0;
    assert.ok(ms < 20000, `took ${ms.toFixed(0)} ms`);
    assert.ok(r.validation.ok, r.validation.errors?.[0]?.message);
    assert.ok(r.mesh.indices.length > 0);
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
    assert.equal(def.group, "build");
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
