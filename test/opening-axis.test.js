// Opening axis — Centre (origin ray) vs Normal (straight through the face).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { quadToTris, straightRing, zipperBand } from "../src/geom/annulus.js";
import { compile } from "../src/compile.js";
import { faceFrames } from "../src/faceframe.js";
import { encodeHash, decodeHash } from "../src/hashcodec.js";
import { DEFAULT_STATE, CONTROL_DEFS } from "../src/schema.js";

function ring(n, r) {
  const x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = r * Math.cos((2 * Math.PI * i) / n);
    y[i] = r * Math.sin((2 * Math.PI * i) / n);
  }
  return { x, y };
}

/** Largest |triangle normal · face normal| over non-flat (wall) triangles. */
function worstWallTilt(result) {
  const { positions: P, indices: I, faceId } = result.mesh;
  const frames = faceFrames(result.skeleton);
  let worst = 0;
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    const fn = frames[faceId[t]].normal;
    const dot = Math.abs(nx * fn[0] + ny * fn[1] + nz * fn[2]) / l;
    if (dot < 0.99) worst = Math.max(worst, dot);
  }
  return worst;
}

/** Twice the signed area of a closed ring. */
function area2(x, y) {
  let a = 0;
  for (let i = 0; i < x.length; i++) {
    const j = (i + 1) % x.length;
    a += x[i] * y[j] - x[j] * y[i];
  }
  return a;
}

/** The Stella octangula preset (presets.json). */
const STELLA = { base: "octahedron", spike: Math.sqrt(3), filletMm: 1.5 };

describe("straightRing", () => {
  it("keeps every point where the opening clears the inner face", () => {
    const B = ring(8, 10);
    const P = ring(8, 5);
    const r = straightRing(B.x, B.y, P.x, P.y, 0.4);
    assert.deepEqual([...r.Qx], [...P.x]);
    assert.deepEqual([...r.Qy], [...P.y]);
    assert.deepEqual([r.ox, r.oy], [0, 0]);
  });

  it("moves only the points beside a tight edge, to the floor", () => {
    // Inner face shifted right: its left edge (x = −4) is 0.5 from the
    // opening's leftmost point, so only that side moves.
    const Bx = Float64Array.from([-4, 10, 10, -4]);
    const By = Float64Array.from([-10, -10, 10, 10]);
    const P = ring(16, 3.5);
    const floor = 0.8;
    const r = straightRing(Bx, By, P.x, P.y, floor);
    let moved = 0;
    for (let k = 0; k < 16; k++) {
      if (P.x[k] > -4 + floor) {
        assert.equal(r.Qx[k], P.x[k]);
        assert.equal(r.Qy[k], P.y[k]);
      } else {
        moved++;
        assert.ok(Math.abs(r.Qx[k] - (-4 + floor)) < 1e-12, "moved points sit on the inset");
      }
    }
    assert.ok(moved > 0 && moved < 8);
  });

  it("gives up when almost none of the opening fits", () => {
    const Bx = Float64Array.from([4.9, 10, 10, 4.9]);
    const By = Float64Array.from([-10, -10, 10, 10]);
    const P = ring(16, 5);
    assert.equal(straightRing(Bx, By, P.x, P.y, 0.4), null);
  });
});

describe("zipperBand", () => {
  it("matches index-paired quads when both rings share rays", () => {
    const A = ring(6, 10);
    const B = ring(6, 4);
    const tris = zipperBand(A.x, A.y, B.x, B.y, 0, 0);
    const quads = [];
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      quads.push(...quadToTris(k2, k, 6 + k, 6 + k2));
    }
    assert.deepEqual(tris, quads);
  });

  it("stitches rings with different samples and an off-centre hole", () => {
    const A = ring(12, 10);
    const B = ring(7, 3);
    for (let k = 0; k < 7; k++) B.x[k] += 4;
    const tris = zipperBand(A.x, A.y, B.x, B.y, 4, 0);
    assert.equal(tris.length / 3, 12 + 7);
    const X = (v) => (v < 12 ? A.x[v] : B.x[v - 12]);
    const Y = (v) => (v < 12 ? A.y[v] : B.y[v - 12]);
    let total = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const [p, q, r] = [tris[i], tris[i + 1], tris[i + 2]];
      const a = (X(q) - X(p)) * (Y(r) - Y(p)) - (X(r) - X(p)) * (Y(q) - Y(p));
      assert.ok(a < 0, "every triangle keeps the band's winding");
      total += a;
    }
    // No overlap: the triangles tile exactly the band between the rings.
    assert.ok(Math.abs(-total - (area2(A.x, A.y) - area2(B.x, B.y))) < 1e-9);
  });

  it("refuses rings that cross", () => {
    const A = ring(8, 10);
    const B = ring(8, 6);
    B.x[0] = 12;
    assert.equal(zipperBand(A.x, A.y, B.x, B.y, 0, 0), null);
  });
});

describe("openingAxis", () => {
  it("is canonical state with a Centre default and a Form control", () => {
    assert.equal(DEFAULT_STATE.openingAxis, "center");
    const def = CONTROL_DEFS.find((d) => d.key === "openingAxis");
    assert.equal(def.group, "form");
    assert.equal(def.inertWhen({ openings: false }), true);
    const back = decodeHash(encodeHash({ ...DEFAULT_STATE, openingAxis: "normal" }));
    assert.equal(back.state.openingAxis, "normal");
  });

  it("old hashes without the key decode to Centre", () => {
    const { openingAxis, ...legacy } = DEFAULT_STATE;
    assert.equal(decodeHash(encodeHash(legacy)).state.openingAxis, "center");
  });

  it("rejects unknown values with a structured error", () => {
    const r = compile({ openingAxis: "sideways" });
    assert.equal(r.validation.ok, false);
    assert.equal(r.validation.errors[0].key, "openingAxis");
  });

  it("Normal walls run along the face normal; Centre walls lean", () => {
    const centre = compile({ openingAxis: "center" });
    const normal = compile({ openingAxis: "normal" });
    assert.ok(worstWallTilt(centre) > 0.2, "centre walls follow the origin ray");
    assert.ok(worstWallTilt(normal) < 1e-4, "normal walls are perpendicular to the face");
    assert.equal(normal.metrics.watertight, true);
    assert.equal(normal.mesh.indices.length, centre.mesh.indices.length);
    // Straight walls remove the inward taper, so less material.
    assert.ok(normal.metrics.volumeCm3 < centre.metrics.volumeCm3);
  });

  it("stays watertight across distort operators, rounding and ellipse", () => {
    for (const extra of [
      { base: "cube", roundingMm: 1.5 },
      { base: "icosidodeca", spike: 1.5 },
      { base: "icosahedron", spike: 1.5, roundingMm: 1 },
      { base: "random", truncate: 30 },
      { base: "sphere", dual: true, openingStyle: "ellipse" },
      { base: "tetrahedron", wallMm: 4 },
    ]) {
      const r = compile({ ...extra, openingAxis: "normal" });
      assert.equal(r.validation.ok, true, JSON.stringify(extra));
      assert.equal(r.metrics.watertight, true, JSON.stringify(extra));
    }
  });

  it("stays straight on a star where the whole-face lean used to bend every wall", () => {
    // Stella octangula: each flank keeps over 2 mm of inner flat beside a
    // straight hole, so nothing may tilt.
    for (const wallMode of ["even", "scaled"]) {
      const r = compile({ ...STELLA, openingAxis: "normal", wallMode });
      assert.equal(r.validation.ok, true);
      assert.ok(worstWallTilt(r) < 1e-4, wallMode);
      assert.ok(!r.validation.warnings.some((w) => w.key === "openingAxis"), wallMode);
    }
  });

  it("tilts only beside tight edges and names the wall that straightens them", () => {
    const r = compile({ base: "tetrahedron", wallMm: 6, openingAxis: "normal" });
    const warn = r.validation.warnings.find((w) => w.key === "openingAxis");
    assert.ok(warn, "a tilted opening is reported");
    const fit = Number(/Wall of ([\d.]+) mm/.exec(warn.message)?.[1]);
    assert.ok(fit > 5 && fit < 6, warn.message);
    // Most of each wall still runs straight down the normal.
    const straight = compile({ base: "tetrahedron", wallMm: fit, openingAxis: "normal" });
    assert.ok(!straight.validation.warnings.some((w) => w.key === "openingAxis"));
    assert.ok(worstWallTilt(straight) < 1e-4);
  });

  it("keeps a thin border straight while some inner flat is left", () => {
    const r = compile({ base: "cube", borderFraction: 0.18, wallMm: 3, openingAxis: "normal" });
    assert.ok(worstWallTilt(r) < 1e-4);
    assert.ok(!r.validation.warnings.some((w) => w.key === "openingAxis"));
  });
});
