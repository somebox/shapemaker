// Walls — Even (face planes offset along their normals) vs Scaled
// (uniform scale about the origin, the construction before Even).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile, compileShape, limitsForState, unfitWarning } from "../src/compile.js";
import { faceFrames } from "../src/faceframe.js";
import { computeLimits } from "../src/limits.js";
import { loadCsg } from "../src/solid/csg.js";
import { encodeHash, decodeHash } from "../src/hashcodec.js";
import { parseProject, serializeProjectV1 } from "../src/project-format.js";
import { DEFAULT_STATE, CONTROL_DEFS } from "../src/schema.js";
import {
  cornerOffsets, cornerOffsetsForWall, evenWallCeiling, evenWallFit, fitCorner,
  meanValueWeights, offsetFaceLimit, offsetWallLimit, offsetWallRange, thinnedFaces,
} from "../src/solid/offset.js";
import { radialSample } from "../src/geom/annulus.js";
import { edgeInteriorFractions } from "../src/geom/edgesub.js";
import {
  bandFaults, buildShell, fanPoint, filletSegmentsFor, insetFillet, rimClearance,
} from "../src/solid/shell.js";
import { selfIntersections } from "./self-intersect.js";

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

/**
 * A 60 mm box with a shallow gable roof and a thin triangle (face 7) planed
 * off its front top edge from end to end. The triangle's base corners lie
 * on the two end faces, whose planes face each other.
 */
function planedBox(h = 1) {
  const pts = [
    [-30, -30, -30], [30, -30, -30], [30, 30, -30], [-30, 30, -30],
    [-30, -30, 30], [-30, 0, 30 + h], [-30, 30, 30],
    [30, -30, 30], [30, 30, 30], [30 - h, 0, 30 + h],
  ];
  const faces = [
    [0, 3, 2, 1], [0, 4, 5, 6, 3], [1, 2, 8, 7], [0, 1, 7, 4],
    [3, 6, 8, 2], [4, 7, 9, 5], [5, 9, 8, 6], [7, 8, 9],
  ];
  return { positions: new Float64Array(pts.flat()), faces };
}

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

  it("never fits inside a wall when planes nearly oppose", () => {
    // Two planes facing almost opposite ways put the fit tens of thousands
    // of walls deep, where rounding in the scaled frame left it ~1e-7 of a
    // wall inside the nearest plane (raised in review). It is now scaled
    // out to clear them all.
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const cost = (N, d) => N.reduce((s, a) => s + (dot(a, d) - 1) ** 2, 0);
    for (let trial = 0; trial < 300; trial++) {
      const e = 10 ** (-1 - rnd() * 4);
      const N = [unit([1, 0, -e]), unit([-1, (rnd() - 0.5) * e, -e])];
      for (let i = 0; i < 9 + rnd() * 20; i++) N.push(unit([(rnd() - 0.5) * 2, (rnd() - 0.5) * 2, -e - rnd()]));
      const exact = fitCorner(N, { enumerateMax: Infinity });
      if (!N.every((a) => dot(a, exact) >= 1 - 1e-9)) continue;
      const fast = fitCorner(N);
      for (const a of N) assert.ok(dot(a, fast) >= 1 - 1e-9, `trial ${trial}: a plane is inside the wall`);
      assert.ok(cost(N, fast) <= cost(N, exact) * (1 + 1e-6) + 1e-12, `trial ${trial}: thicker than enumeration`);
    }
  });

  it("never skips a nearly opposite plane as if it were in the working set's span", () => {
    // Planes 1e-9 off the span were skipped as if exactly in it; on a fit
    // 3e8 walls deep that small angle moves a plane by a third of a wall per
    // step, so a nearly opposite one could be stepped through (clearance −1,
    // raised in review). Only exact repeats facing the same way are skipped.
    for (const [e, ring] of [[3e-9, 298], [3e-8, 298], [3e-9, 50]]) {
      const N = [unit([1, 0, -e]), unit([-1, 0, -e]), ...Array.from({ length: ring }, (_, i) => {
        const t = (2 * Math.PI * i) / ring;
        return unit([0.2 * Math.cos(t), 0.2 * Math.sin(t), -1]);
      })];
      const d = fitCorner(N);
      const depth = Math.max(1, Math.hypot(...d));
      for (const a of N) assert.ok(dot(a, d) >= 1 - 1e-12 * depth, `e = ${e}, ${ring}: a plane is inside the wall`);
      assert.ok(depth > 0.9 / e, `e = ${e}, ${ring}: the fit is only ${depth.toExponential(2)} deep`);
    }
  });

  it("finds a fit for a tight cone with a few planes barely leaning on it", () => {
    // Hundreds of planes; most hug −z, a few lean on it by a hair. The
    // scaled frame shrank this margin below the floor, so the start search
    // gave up and the plain fit came back inside the wall (raised in
    // review). The search now also runs on the unit normals.
    let seed = 31337;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let tried = 0;
    for (let trial = 0; trial < 120; trial++) {
      const eps = 10 ** (-6 - rnd() * 1.5);
      let i = 0;
      const N = Array.from({ length: 100 + Math.floor(rnd() * 300) }, () => unit((i++ % 10 === 0)
        ? [2 * rnd() - 1, 2 * rnd() - 1, -eps * (0.1 + rnd())]
        : [(rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2, -1]));
      if (!(Math.min(...N.map((a) => -a[2])) > 1e-8)) continue;   // −z clears them all
      tried++;
      const d = fitCorner(N);
      const depth = Math.max(1, Math.hypot(...d));
      for (const a of N) assert.ok(dot(a, d) >= 1 - 1e-12 * depth, `trial ${trial}: a plane is inside the wall`);
    }
    assert.ok(tried > 50, `only ${tried} corners had a fit`);
  });

  it("clears a nearly opposite pair held together at the wall", () => {
    // Two planes facing almost opposite ways, both at the wall, made the
    // working-set solve singular to Gaussian elimination; dropping one then
    // left the fit on the wrong side of it (clearance −1, raised in
    // review). The null-space solve holds both.
    const cost = (N, d) => N.reduce((s, a) => s + (dot(a, d) - 1) ** 2, 0);
    for (const e of [1e-3, 3e-5, 3e-7, 1e-8]) {
      const N = [unit([1, 0, -e]), unit([-1, 0, -e]), ...Array.from({ length: 9 }, (_, i) => {
        const t = (2 * Math.PI * i) / 9;
        return unit([0.2 * Math.cos(t), 0.2 * Math.sin(t), -1]);
      })];
      const fast = fitCorner(N);
      const depth = Math.max(1, Math.hypot(...fast));
      for (const a of N) assert.ok(dot(a, fast) >= 1 - 1e-12 * depth, `e = ${e}: a plane is inside the wall`);
      const exact = fitCorner(N, { enumerateMax: Infinity });
      if (N.every((a) => dot(a, exact) >= 1 - 1e-9)) {
        assert.ok(cost(N, fast) <= cost(N, exact) * (1 + 1e-6), `e = ${e}: thicker than enumeration`);
      }
    }
  });

  it("finds the same fit when planes nearly repeat", () => {
    // Two planes a hair apart in the working set make its solve singular
    // to float64; the descent stopped there, up to half again as thick
    // (raised in review). It now drops the newer one and goes on.
    let seed = 909;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const cost = (N, d) => N.reduce((s, a) => s + (dot(a, d) - 1) ** 2, 0);
    const jiggle = (a, s) => unit(a.map((x) => x + (rnd() - 0.5) * s));
    for (let trial = 0; trial < 400; trial++) {
      const s = 10 ** (-3 - rnd() * 12);
      const base = Array.from({ length: 4 + Math.floor(rnd() * 5) }, () =>
        unit([(rnd() - 0.5) * 1.5, (rnd() - 0.5) * 1.5, -1]));
      const N = [...base, ...base.map((a) => jiggle(a, s)), ...base.slice(0, 3).map((a) => jiggle(a, s))];
      const exact = fitCorner(N, { enumerateMax: Infinity });
      if (!N.every((a) => dot(a, exact) >= 1 - 1e-9)) continue;
      const fast = fitCorner(N);
      for (const a of N) assert.ok(dot(a, fast) >= 1 - 1e-9, `trial ${trial}: a plane is inside the wall`);
      assert.ok(cost(N, fast) <= cost(N, exact) * (1 + 1e-6) + 1e-12, `trial ${trial}: descent is thicker`);
    }
  });

  it("finds the same fit when planes repeat", () => {
    // A repeated plane once looked like it blocked a step by rounding; the
    // working set then held both copies, went singular, and the descent
    // stopped up to twice as thick as it needed (found in review).
    let seed = 77;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const cost = (N, d) => N.reduce((s, a) => s + (dot(a, d) - 1) ** 2, 0);
    for (let trial = 0; trial < 300; trial++) {
      const base = Array.from({ length: 4 + Math.floor(rnd() * 4) }, () =>
        unit([(rnd() - 0.5) * 1.5, (rnd() - 0.5) * 1.5, -1]));
      const N = [...base, ...base, ...base.slice(0, 2)];
      const exact = fitCorner(N, { enumerateMax: Infinity });
      const fast = fitCorner(N, { enumerateMax: 0 });
      for (const a of N) assert.ok(dot(a, fast) >= 1 - 1e-9, `trial ${trial}: a plane is inside the wall`);
      assert.ok(cost(N, fast) <= cost(N, exact) * (1 + 1e-9) + 1e-12, `trial ${trial}: descent is thicker`);
    }
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

  it("keeps a sliver face's inner band clear of its opening wall", () => {
    // Truncate leaves a 6 mm × 0.6 mm hexagon here whose inner face is a
    // different, dented shape. The opening carried to it by corner weights
    // lay across its own band (no Rounding involved).
    const r = compile({
      base: "globe", jitter: 8, jitterMode: "radial", truncate: 40, seed: 360,
      wallMm: 4, filletMm: 1.5, edgeDiv: 4, wallMode: "even",
    });
    assert.equal(r.validation.ok, true);
    assert.deepEqual(selfIntersections(r.mesh, 5), []);
  });

  it("keeps an opening too narrow to be one closed, and says so", () => {
    // Subdivide on a distorted octahedron leaves needle triangles 37 mm long
    // and 0.16 mm wide. Their openings were microns across at the tips, and
    // the two walls, each leaning its own way, crossed.
    const state = {
      base: "octahedron", jitter: 20, jitterMode: "surface", seed: 102, subdiv: 1, points: 12,
      wallMm: 1.4, borderFraction: 0.2, filletMm: 0, edgeDiv: 4, wallMode: "even",
    };
    const r = compile(state);
    assert.equal(r.validation.ok, true);
    assert.deepEqual(selfIntersections(r.mesh, 5), []);
    const closed = r.metrics.faceMetrics.filter((f) => f.openingMinDiameterMm === 0).length;
    assert.ok(closed > 0 && closed < r.skeleton.faces.length);
    assert.ok(r.metrics.openingMinDiameterMm > 0, "the smallest opening is an open face's");
    // So are the border and fillet ranges: a closed face's were not built.
    const all = r.metrics.faceMetrics;
    const open = all.filter((f) => f.openingMinDiameterMm > 0);
    assert.equal(r.metrics.borderMm.min, Math.min(...open.map((f) => f.borderMinMm)));
    assert.ok(r.metrics.borderMm.min > Math.min(...all.map((f) => f.borderMinMm)));
    assert.equal(r.metrics.filletMm.max, Math.max(...open.map((f) => f.filletUsedMm)));
    const note = r.validation.warnings.find((w) => /stay closed/.test(w.message));
    assert.ok(note, "warns about the closed faces");
    assert.ok(note.message.startsWith(`${closed} of ${r.skeleton.faces.length} faces`), note.message);
    // The same faces close under Scaled walls: the rule is about the
    // opening, not the wall.
    const scaled = compile({ ...state, wallMode: "scaled" });
    assert.equal(
      scaled.metrics.faceMetrics.filter((f) => f.openingMinDiameterMm === 0).length, closed,
    );
    // A shape without such faces has no closed ones and no warning.
    const plain = compile({ wallMode: "even" });
    assert.ok(plain.metrics.faceMetrics.every((f) => f.openingMinDiameterMm > 0));
    assert.ok(!plain.validation.warnings.some((w) => /stay closed/.test(w.message)));
  });

  it("says why faces stay closed: too thin, or no room inside their rounded edges", () => {
    const closed = (state) =>
      compile(state).validation.warnings.find((w) => /stay closed/.test(w.message)).message;
    const thin = {
      base: "octahedron", jitter: 20, jitterMode: "surface", seed: 102, subdiv: 1, points: 12,
      wallMm: 1.4, borderFraction: 0.2, filletMm: 0, wallMode: "even",
    };
    assert.equal(closed(thin), "8 of 70 faces are too thin for an opening and stay closed");
    // Rounding closes 11 more: their rounded outline leaves no room. The
    // eight thin ones are still counted as thin.
    assert.equal(
      closed({ ...thin, roundingMm: 1.5 }),
      "19 of 70 faces stay closed: 8 too thin for an opening, " +
        "11 with no room for one inside their rounded edges",
    );
    assert.equal(
      closed({
        base: "tetrahedron", seed: 4503, truncate: 15, subdiv: 1, roundingMm: 3, wallMm: 2.4,
        borderFraction: 0.36, filletMm: 0, wallMode: "even",
      }),
      "24 of 64 faces have no room for an opening inside their rounded edges and stay closed",
    );
  });

  it("gives Through's closed faces their cause too", async () => {
    // Smooth dents two needle outlines so that the centroid cannot see
    // all of them. Through called them "too small to cut through".
    await loadCsg();
    const r = compile({
      base: "random", seed: 1259, subdiv: 1, soften: 80, roundingMm: 1.5, wallMm: 1.4,
      borderFraction: 0.6, filletMm: 0, edgeDiv: 4, openingAxis: "through",
    });
    assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    const note = r.validation.warnings.find((w) => /stay closed/.test(w.message));
    assert.equal(note.key, "openingAxis");
    assert.equal(
      note.message,
      "2 of 176 faces have no room for an opening inside their rounded edges and stay closed",
    );
  });

  it("drops a fillet that draws the opening's rim onto the centroid", () => {
    // One sliver face of this shape passes the 0.2 mm floor unfilleted
    // (its opening is 2.15 mm across the centroid). Its 0.38 mm fillet,
    // near the largest that fits, shifted the opening until the rim passed
    // 0.08 mm from the centroid it is laid out around. The fillet already
    // went where it put the centroid outside; this is the step before.
    const r = compile({
      base: "random", seed: 2300, truncate: 40, wallMm: 1.4, borderFraction: 0.36,
      filletMm: 4.5, edgeDiv: 4, wallMode: "even",
    });
    assert.equal(r.validation.ok, true);
    const open = r.metrics.faceMetrics.filter((f) => f.openingMinDiameterMm > 0);
    assert.equal(open.length, 128);
    assert.ok(open.every((f) => f.openingMinDiameterMm >= 0.2));
    assert.ok(r.metrics.openingMinDiameterMm >= 0.2);
    const sharp = open.filter((f) => f.filletUsedMm === 0);
    assert.deepEqual(sharp.map((f) => f.faceIndex), [125]);
    assert.ok(sharp[0].openingMinDiameterMm > 2);
    assert.deepEqual(selfIntersections(r.mesh, 5), []);
  });

  it("measures a filleted opening's clearance on the rim as it is emitted", async () => {
    // A 10 mm sliver, tapering from 0.4 to 0.2 mm, about its centroid. The
    // rim is sampled along rays to the face's boundary points, and none of
    // them leaves the centroid across the sliver: the nearest sample is
    // 0.32 mm out while the segment between two of them passes at 0.09 mm.
    const raw = [[-5, -0.2], [5, -0.1], [5, 0.1], [-5, 0.2]];
    const face = raw.map(([x, y]) => [x + 5 / 9, y]);
    const fractions = [0, ...edgeInteriorFractions(4)];
    const ang = face.flatMap(([x, y], k) => {
      const [qx, qy] = face[(k + 1) % face.length];
      return fractions.map((t) => Math.atan2(y + (qy - y) * t, x + (qx - x) * t));
    });
    const rim = (filletMm) => {
      const { opening } = insetFillet.generate(
        new Float64Array(face.flat()), 0.2, filletMm, filletSegmentsFor(4),
      );
      return radialSample(opening, ang);
    };
    const filleted = rim(1.5);
    assert.ok(Math.min(...filleted) > 0.3, `nearest sample ${Math.min(...filleted)}`);
    assert.ok(rimClearance(filleted, ang) < 0.1, `clearance ${rimClearance(filleted, ang)}`);
    assert.ok(rimClearance(rim(0), ang) > 0.12);

    // On a shape: face 109 is such a face, and face 127 one whose nearest
    // sample is already too near. Both keep their unfilleted opening, and
    // Through sides, which measure their cutter, no longer close one.
    await loadCsg();
    const state = {
      base: "random", seed: 4056, jitter: 8, jitterMode: "radial", truncate: 40, wallMm: 1.4,
      roundingMm: 1.5, borderFraction: 0.2, filletMm: 1.5, edgeDiv: 4, wallMode: "even",
    };
    for (const openingAxis of ["center", "through"]) {
      const r = compile({ ...state, openingAxis });
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
      const open = r.metrics.faceMetrics.filter((f) => f.openingMinDiameterMm > 0);
      assert.equal(open.length, 128, openingAxis);
      assert.deepEqual(
        open.filter((f) => f.filletUsedMm === 0).map((f) => f.faceIndex), [109, 127], openingAxis,
      );
    }
  });

  it("gives no border guidance when no opening was built", () => {
    // A 3 mm cube: all six openings would be under 0.2 mm and stay closed.
    // The guidance used to fall back on the 0.8 mm border asked for.
    const r = compile({ base: "cube", circumdiameterMm: 3, wallMm: 0.4, borderFraction: 0.9 });
    assert.equal(r.validation.ok, true);
    assert.equal(r.metrics.openingMinDiameterMm, 0);
    assert.deepEqual(r.metrics.borderMm, { min: null, max: null });
    assert.ok(r.validation.warnings.some((w) => /^6 of 6 faces .* stay closed/.test(w.message)));
    assert.ok(!r.validation.warnings.some((w) => /Thinnest borders/.test(w.message)));
    // With openings built, a thin border is still called out.
    const open = compile({ base: "cube", circumdiameterMm: 30, wallMm: 0.4, borderFraction: 0.1 });
    assert.ok(open.metrics.openingMinDiameterMm > 0);
    assert.ok(open.validation.warnings.some((w) => /Thinnest borders/.test(w.message)));
  });

  it("moves a sliver face the wall would turn inside out as one piece", () => {
    // A 10 mm × 0.2 mm hexagon on a truncated globe: the planes either side
    // close over it within a fraction of the 2.4 mm wall, and its inner
    // copy flipped while every edge kept its direction.
    const r = compile({
      base: "twistedglobe", jitter: 20, jitterMode: "radial", truncate: 40, seed: 2190,
      wallMm: 2.4, borderFraction: 0.36, filletMm: 0, edgeDiv: 2, wallMode: "even",
    });
    assert.equal(r.validation.ok, true);
    assert.deepEqual(selfIntersections(r.mesh, 5), []);
    // Fitted corners sit within a micron of the wall; the piece moved as
    // one is a little thicker, not thinner.
    assert.ok(r.metrics.wallMm.min >= 2.4 - 1e-5, "never thinner than the wall");
  });

  it("finds the sliver faces a wall leaves too thin, and none once they move as one", () => {
    const { skeleton } = compile({
      base: "twistedglobe", jitter: 20, jitterMode: "radial", truncate: 40, seed: 2190,
      wallMm: 2.4, borderFraction: 0.36, filletMm: 0, edgeDiv: 2, wallMode: "even",
    });
    const frames = faceFrames(skeleton);
    const plain = cornerOffsets(skeleton, frames);
    assert.deepEqual(thinnedFaces(skeleton, frames, plain, 0.01), []);
    assert.ok(thinnedFaces(skeleton, frames, plain, 2.4).length > 0);
    const fitted = cornerOffsetsForWall(skeleton, frames, 2.4, plain);
    assert.notEqual(fitted, plain);
    assert.deepEqual(thinnedFaces(skeleton, frames, fitted, 2.4), []);
  });

  it("leaves a sliver its own corners when no single move clears every face", () => {
    // At 3 mm the planed triangle keeps under a tenth of its width. Moved
    // as one it would have to clear both end faces at once; the nearest
    // fit cleared neither, and the wall there was 0 mm.
    const skeleton = planedBox();
    const frames = faceFrames(skeleton);
    const plain = cornerOffsets(skeleton, frames);
    assert.deepEqual(thinnedFaces(skeleton, frames, plain, 3), [7]);
    assert.equal(cornerOffsetsForWall(skeleton, frames, 3, plain), plain);
    const opts = { wallMode: "even", openings: false };
    const { info } = buildShell(skeleton, { ...opts, wallMm: 3 });
    assert.ok(info.wall.min >= 3 - 1e-6, `thinnest wall ${info.wall.min}`);
    assert.ok(offsetWallRange(skeleton, frames, plain).min >= 1 - 1e-6);
    // The wall that turns the triangle inside out is refused instead.
    assert.throws(() => buildShell(skeleton, { ...opts, wallMm: 5 }), (e) => {
      assert.match(e.message, /turns inside out/);
      assert.deepEqual(e.validation.faceIds, [7]);
      assert.ok(buildShell(skeleton, { ...opts, wallMm: e.validation.clampTo }).info.wall.min > 0);
      return true;
    });
  });

  it("stops the Wall slider at 90% of the first refusal when a sliver cannot move as one", () => {
    // The planed triangle, moved 0.03 mm from the front face, flips at
    // 26.64 mm, just short of the edge limit (27.00 mm). 90% of the edge
    // limit builds, but leaves under 9% to the first refusal.
    const skeleton = planedBox();
    skeleton.positions.set([29.97, 0, 31], 9 * 3);
    const frames = faceFrames(skeleton);
    const plain = cornerOffsets(skeleton, frames);
    const edge = offsetWallLimit(skeleton, plain);
    const flip = offsetFaceLimit(skeleton, frames, plain);
    assert.equal(flip.face, 7);
    assert.ok(flip.limit < edge && flip.limit > 0.95 * edge, `${flip.limit} vs ${edge}`);
    const top = evenWallCeiling(skeleton, frames, plain);
    assert.ok(Math.abs(top - 0.9 * flip.limit) < 1e-6 * top, `${top} vs ${0.9 * flip.limit}`);
    assert.equal(evenWallFit(skeleton, frames, top, plain).ok, true);
    assert.equal(evenWallFit(skeleton, frames, flip.limit * (1 - 1e-6), plain).ok, true);
    assert.equal(evenWallFit(skeleton, frames, flip.limit, plain).cause, "face");
  });

  it("does not move as one a cluster of corners that touches too many planes", () => {
    // On a subdivided shape slivers chain through the fan centres. Just
    // under the edge limit four of them go thin, and their corners touch
    // 50 planes; three passes on it was 72 faces and 294 planes. No
    // single move clears a patch that size: moved as one, the edges
    // around it folded and the wall was refused.
    const { skeleton } = compileShape({
      base: "rhombicenneaconta", seed: 2056, truncate: 40, points: 12, subdiv: 1, soften: 50,
    });
    const frames = faceFrames(skeleton);
    const plain = cornerOffsets(skeleton, frames);
    const wall = 0.999 * offsetWallLimit(skeleton, plain);
    assert.equal(thinnedFaces(skeleton, frames, plain, wall).length, 4);
    assert.equal(cornerOffsetsForWall(skeleton, frames, wall, plain), plain);
    // The slivers keep their corners' own moves, which hold to the limit.
    assert.equal(evenWallFit(skeleton, frames, wall, plain).ok, true);
  });

  it("keeps the wall ceiling per shape, by content", () => {
    // Every rebuild asks for it, on a new skeleton object each time.
    const state = { wallMode: "even", depth: "hollow", openings: false };
    const got = (skeleton) => computeLimits(skeleton, state).wallMmMax;
    const want = (skeleton) => evenWallCeiling(skeleton, faceFrames(skeleton));
    const moved = planedBox();
    moved.positions.set([29.97, 0, 31], 9 * 3);
    assert.notEqual(want(moved), want(planedBox()));
    for (const skeleton of [planedBox(), moved, planedBox(), moved]) {
      assert.equal(got(skeleton), want(skeleton));
    }
    // A skeleton changed in place is another shape.
    const box = planedBox();
    assert.equal(got(box), want(planedBox()));
    box.positions.set([29.97, 0, 31], 9 * 3);
    assert.equal(got(box), want(moved));
    // More shapes than are kept, then the first again.
    for (const h of [0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.5]) {
      assert.equal(got(planedBox(h)), want(planedBox(h)), `h = ${h}`);
    }
  });

  it("puts the face limit at the edge limit where a face shrinks evenly", () => {
    const { skeleton } = compile({ base: "cube", wallMode: "even" });
    const frames = faceFrames(skeleton);
    const dHat = cornerOffsets(skeleton, frames);
    const edge = offsetWallLimit(skeleton, dHat);
    const { limit, face } = offsetFaceLimit(skeleton, frames, dHat);
    assert.ok(Math.abs(limit - edge) < 1e-9 * edge, `${limit} vs ${edge}`);
    assert.ok(face >= 0);
  });

  it("rejects a wall that turns a face inside out, offering one that builds", () => {
    // A 10 mm triangle Truncate leaves between steep neighbours: at 90% of
    // the edge limit its inner copy has flipped while each edge still
    // points its own way. No rounding fits a face like that.
    const state = {
      base: "random", seed: 1700, truncate: 15, points: 12, wallMm: 2.4, roundingMm: 1.5,
      borderFraction: 0.6, filletMm: 0, openingStyle: "ellipse", edgeDiv: 4, wallMode: "even",
    };
    const r = compile(state);
    assert.equal(r.validation.ok, false);
    const e = r.validation.errors[0];
    assert.equal(e.key, "wallMm");
    assert.match(e.message, /turns inside out/);
    assert.ok(e.clampTo < 2.4);
    assert.equal(e.faceIds.length, 1);
    const fit = compile({ ...state, wallMm: e.clampTo });
    assert.equal(fit.validation.ok, true);
    // The Wall slider stops at the same wall.
    assert.ok(Math.abs(fit.metrics.limits.wallMmMax - e.clampTo) < 1e-9);
    // A wall above both limits runs into the edge limit first (2.65 mm).
    // The message names the wall from which walls are refused and why,
    // the same as at 2.4 mm, and the offer is the same.
    assert.match(e.message, /a face turns inside out beyond 2\.29 mm/);
    const far = compile({ ...state, wallMm: 20 }).validation.errors[0];
    assert.equal(far.message, e.message.replace("Wall 2.4 mm", "Wall 20 mm"));
    assert.deepEqual(far.faceIds, e.faceIds);
    assert.ok(Math.abs(far.clampTo - e.clampTo) < 1e-9, `offered ${far.clampTo}`);
  });

  it("stops the Wall slider at a wall that builds where slivers move as one", () => {
    // The plain offsets hold to 12.2 mm. From about 8 mm the wall is
    // built with other offsets (sliver faces move as one) and refused; at
    // 90% of 12.2 mm an inner edge folds from 5.85 mm.
    const state = {
      base: "globe", seed: 360, truncate: 40, jitter: 20, jitterMode: "radial", points: 12,
      wallMode: "even",
    };
    const max = limitsForState(state).wallMmMax;
    assert.ok(max > 5.85 && max < 10.9, `stops at ${max}`);
    for (const k of [1, 0.75, 0.5]) {
      const r = compile({ ...state, wallMm: max * k });
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    }
    // It is 90% of the first wall refused (found to 0.1%), no lower.
    assert.equal(compile({ ...state, wallMm: (max / 0.9) * 1.01 }).validation.ok, false);
    // A refused wall is told that first refusal, not the limit it ran
    // into: at 10.96 mm that was 5.85 mm, well under walls that build.
    const e = compile({ ...state, wallMm: 10.96 }).validation.errors[0];
    const quoted = Number(e.message.match(/beyond ([\d.]+) mm/)[1]);
    assert.ok(Math.abs(quoted - max / 0.9) < 0.006, `${e.message} vs ${max / 0.9}`);
    assert.ok(Math.abs(e.clampTo - max) < 1e-9);
    assert.equal(compile({ ...state, wallMm: quoted * 0.99 }).validation.ok, true);
  });

  it("says so when the inside of a face could not be fitted", () => {
    // Needle faces 17 mm long and 0.01 mm wide on a spiked, distorted
    // shape: their inner outlines keep a spur at the tip that no amount of
    // drawing the rounding in removes.
    const r = compile({
      base: "rhombicenneaconta", seed: 3482, jitter: 8, jitterMode: "surface", spike: 1,
      points: 12, wallMm: 2.4, roundingMm: 3, borderFraction: 0.6, filletMm: 1.5,
      openings: false, wallMode: "even",
    });
    assert.equal(r.validation.ok, true);
    const fitted = (w) => /could not be fitted/.test(w.message);
    const note = r.validation.warnings.find(fitted);
    assert.ok(note, "warns about the faces");
    assert.equal(note.key, "wallMm");
    assert.match(note.message, new RegExp(`^\\d+ of ${r.skeleton.faces.length} faces`));
    assert.match(note.message, /a thinner wall usually helps/);
    assert.ok(!compile({ roundingMm: 1.5, wallMode: "even" }).validation.warnings.some(fitted));
  });

  it("does not count a face whose inner opening was laid out again", () => {
    // Two inner bands of this shape still fold against the Centre opening
    // after the last halving. Laid out along the inner ring's own rays
    // they hold, and the faces were counted as unfitted all the same.
    const r = compile({
      base: "rhombicdodeca", seed: 1861, jitter: 8, jitterMode: "surface", truncate: 15,
      points: 12, wallMm: 4, roundingMm: 3, borderFraction: 0.2, filletMm: 4.5, edgeDiv: 4,
      wallMode: "even",
    });
    assert.equal(r.validation.ok, true);
    assert.ok(!r.validation.warnings.some((w) => /could not be fitted/.test(w.message)));
    assert.deepEqual(selfIntersections(r.mesh, 5), []);
    const exact = { positions: r.mesh.positions64, indices: r.mesh.indices };
    assert.deepEqual(selfIntersections(exact, 5), []);
  });

  it("advises only what the state has on", () => {
    const on = { depth: "hollow", wallMode: "even", roundingMm: 1.5, soften: 20 };
    const note = (state) => unfitWarning(3, 40, { ...on, ...state });
    const lead = "3 of 40 faces could not be fitted and may pass through their neighbours";
    assert.equal(note({}).message, `${lead}; a thinner wall usually helps, less rounding sometimes`);
    assert.equal(note({ roundingMm: 0 }).message, `${lead}; a thinner wall usually helps, less Smooth sometimes`);
    // Neither Rounding nor Smooth on: a sliver face's inner opening can
    // still fail to fit, and there is no Smooth to turn down.
    assert.equal(note({ roundingMm: 0, soften: 0 }).message, `${lead}; a thinner wall usually helps`);
    assert.equal(note({ roundingMm: 0, soften: 0 }).key, "wallMm");
    assert.equal(note({ wallMode: "scaled" }).message, `${lead}; less rounding can help`);
    assert.equal(note({ wallMode: "scaled", roundingMm: 0 }).key, "soften");
    assert.equal(note({ depth: "solid", roundingMm: 0 }).message, `${lead}; less Smooth can help`);
    assert.equal(note({ depth: "solid", roundingMm: 0, soften: 0 }).message, lead);
  });

  it("does not advise a thinner wall under Scaled walls", () => {
    // A Scaled inner surface is a copy of the outer one: the outlines are
    // at fault, and the wall does not change them.
    const state = {
      base: "octahedron", seed: 2419, jitter: 8, jitterMode: "surface", truncate: 40,
      subdiv: 1, soften: 80, roundingMm: 0.5, openings: false, wallMm: 2.4, wallMode: "scaled",
    };
    const fitted = (r) => r.validation.warnings.find((w) => /could not be fitted/.test(w.message));
    const note = fitted(compile(state));
    assert.ok(note, "warns about the faces");
    assert.equal(note.key, "roundingMm");
    assert.doesNotMatch(note.message, /wall/);
    assert.match(note.message, /^19 of 192 faces/);
    assert.match(fitted(compile({ ...state, wallMm: 1.2 })).message, /^19 of 192 faces/);
  });

  it("points a solid shape's unfitted faces at Rounding, not at the wall", () => {
    // Smooth dents two needle outlines so that no point fans them. A solid
    // shape has no inner surface and no wall to thin.
    const r = compile({
      base: "random", seed: 1259, subdiv: 1, soften: 80, roundingMm: 1.5, edgeDiv: 4,
      openings: false, depth: "solid",
    });
    assert.equal(r.validation.ok, true);
    const note = r.validation.warnings.find((w) => /could not be fitted/.test(w.message));
    assert.ok(note, "warns about the faces");
    assert.equal(note.key, "roundingMm");
    assert.doesNotMatch(note.message, /wall|inside/);
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

/** A square of half-width r about (cx, 0), counter-clockwise. */
const square = (r, cx = 0) => [[cx - r, -r], [cx + r, -r], [cx + r, r], [cx - r, r]];
const mirrored = (ring) => ring.map(([x, y]) => [-x, y]);

describe("bandFaults", () => {
  it("passes a ring with its opening inside, whichever way both wind", () => {
    assert.deepEqual(bandFaults(square(2), square(1)), []);
    assert.deepEqual(bandFaults(mirrored(square(2)), mirrored(square(1))), []);
  });

  it("flags the quad whose triangle an opening point outside the ring turns over", () => {
    const opening = square(1);
    opening[1] = [3, -1];
    assert.deepEqual(bandFaults(square(2), opening), [1]);
  });

  it("holds a ring to the winding it is given", () => {
    // A ring that has turned over passes against itself, and fails all
    // the way round against the winding its outer ring has.
    const ring = mirrored(square(2)), opening = mirrored(square(1));
    assert.deepEqual(bandFaults(ring, opening, false, 0), []);
    assert.deepEqual(bandFaults(ring, opening, false, 1), [0, 1, 2, 3]);
    assert.deepEqual(bandFaults(square(2), square(1), false, 1), []);
  });

  it("checks a fan from one point", () => {
    assert.deepEqual(bandFaults(square(2), [0, 0], true), []);
    assert.deepEqual(bandFaults(square(2), [5, 0], true), [1]);
  });
});

describe("fanPoint", () => {
  it("is the centroid when that sees the whole ring", () => {
    assert.deepEqual(fanPoint(square(2)), [0, 0]);
  });

  it("is the ring's mean point when the ring has moved off the centroid", () => {
    assert.deepEqual(fanPoint(square(1, 5)), [5, 0]);
  });

  it("does not take a centroid that is inside the ring but behind a corner", () => {
    // A square with a thin tail reaching back over the centroid: the
    // centroid is inside the tail and cannot see the square's near side.
    const ring = [
      [-1, -0.25], [3, -0.25], [3, -4], [11, -4], [11, 4], [3, 4], [3, 0.25], [-1, 0.25],
    ];
    assert.deepEqual(fanPoint(ring), [4, 0]);
  });

  it("is null when neither point sees the whole ring", () => {
    // An L: the centroid sits in one arm and the mean point in the notch.
    const ring = [[-1, -1], [9, -1], [9, 9], [7, 9], [7, 1], [-1, 1]];
    assert.equal(fanPoint(ring), null);
  });

  it("refuses a ring that winds the wrong way", () => {
    assert.equal(fanPoint(mirrored(square(2)), 1), null);
    assert.deepEqual(fanPoint(mirrored(square(2)), -1), [0, 0]);
  });
});
