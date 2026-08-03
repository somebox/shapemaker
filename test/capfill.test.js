/**
 * Cap-fill triangulator — polygon-with-holes for planar mesh caps.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  nestLoops,
  bridgeHoles,
  earClip,
  triangulateRegions,
  shoelace,
} from "../src/geom/capfill.js";

/** Build a flat Float64Array from [x,y] pairs. */
function pts(...pairs) {
  const out = new Float64Array(pairs.length * 2);
  for (let i = 0; i < pairs.length; i++) {
    out[i * 2] = pairs[i][0];
    out[i * 2 + 1] = pairs[i][1];
  }
  return out;
}

/** Triangle signed area in 2d via shoelace on three verts. */
function triArea(points2d, a, b, c) {
  return shoelace(points2d, [a, b, c]);
}

function sumTriArea(points2d, tris) {
  let s = 0;
  for (let i = 0; i < tris.length; i += 3) {
    s += triArea(points2d, tris[i], tris[i + 1], tris[i + 2]);
  }
  return s;
}

/** Directed edges from triangle list → Map "u,v" → count. */
function directedEdges(tris) {
  const m = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = `${u},${v}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}

describe("earClip", () => {
  it("triangulates a square (2 tris, Σarea exact, all CCW)", () => {
    const p = pts([0, 0], [2, 0], [2, 2], [0, 2]);
    const tris = earClip(p, [0, 1, 2, 3]);
    assert.equal(tris.length, 6);
    for (let i = 0; i < tris.length; i += 3) {
      assert.ok(triArea(p, tris[i], tris[i + 1], tris[i + 2]) > 0);
    }
    assert.ok(Math.abs(sumTriArea(p, tris) - 4) < 1e-12);
  });

  it("triangulates a concave L", () => {
    // L-shape: outer boundary CCW.
    const p = pts(
      [0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3],
    );
    const tris = earClip(p, [0, 1, 2, 3, 4, 5]);
    assert.equal(tris.length / 3, 4); // n-2
    assert.ok(Math.abs(sumTriArea(p, tris) - 5) < 1e-9); // 3*1 + 2*1 = 5
    for (let i = 0; i < tris.length; i += 3) {
      assert.ok(triArea(p, tris[i], tris[i + 1], tris[i + 2]) > 0);
    }
  });
});

describe("nestLoops", () => {
  it("classifies annulus: outer even, hole odd under outer", () => {
    const p = pts(
      [0, 0], [4, 0], [4, 4], [0, 4], // outer 0..3
      [1, 1], [3, 1], [3, 3], [1, 3], // hole 4..7
    );
    const { regions } = nestLoops(p, [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
    assert.equal(regions.length, 1);
    assert.deepEqual(regions[0].outer, [0, 1, 2, 3]);
    assert.equal(regions[0].holes.length, 1);
    assert.deepEqual(regions[0].holes[0], [4, 5, 6, 7]);
  });

  it("keeps two disjoint regions separate", () => {
    const p = pts(
      [0, 0], [1, 0], [1, 1], [0, 1],
      [3, 0], [4, 0], [4, 1], [3, 1],
    );
    const { regions } = nestLoops(p, [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
    assert.equal(regions.length, 2);
    assert.equal(regions[0].holes.length, 0);
    assert.equal(regions[1].holes.length, 0);
  });

  it("nests a region with two holes", () => {
    const p = pts(
      [0, 0], [6, 0], [6, 4], [0, 4],           // outer
      [1, 1], [2, 1], [2, 2], [1, 2],           // hole A
      [4, 1], [5, 1], [5, 2], [4, 2],           // hole B
    );
    const { regions } = nestLoops(p, [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11],
    ]);
    assert.equal(regions.length, 1);
    assert.equal(regions[0].holes.length, 2);
  });
});

describe("bridgeHoles + triangulateRegions", () => {
  it("annulus: Σarea = outer − hole, all CCW, internal edges paired", () => {
    const p = pts(
      [0, 0], [4, 0], [4, 4], [0, 4],
      [1, 1], [3, 1], [3, 3], [1, 3],
    );
    const outer = [0, 1, 2, 3];
    const hole = [4, 5, 6, 7];
    const expected = Math.abs(shoelace(p, outer)) - Math.abs(shoelace(p, hole));
    const tris = triangulateRegions(p, [outer, hole]);
    assert.ok(tris.length >= 6);
    for (let i = 0; i < tris.length; i += 3) {
      assert.ok(triArea(p, tris[i], tris[i + 1], tris[i + 2]) > 0, "CCW");
    }
    assert.ok(Math.abs(sumTriArea(p, tris) - expected) < 1e-9);

    // Internal directed edges appear once each way; boundary once each way
    // after we consider the closed manifold of just the cap (boundary edges
    // appear once — that's expected for an open disc). Check no directed
    // edge is used twice in the same direction.
    const edges = directedEdges(tris);
    for (const [k, c] of edges) {
      assert.equal(c, 1, `directed edge ${k} used ${c} times`);
    }
  });

  it("region with two holes preserves area", () => {
    const p = pts(
      [0, 0], [6, 0], [6, 4], [0, 4],
      [1, 1], [2, 1], [2, 2], [1, 2],
      [4, 1], [5, 1], [5, 2], [4, 2],
    );
    const outer = [0, 1, 2, 3];
    const h1 = [4, 5, 6, 7];
    const h2 = [8, 9, 10, 11];
    const expected =
      Math.abs(shoelace(p, outer)) -
      Math.abs(shoelace(p, h1)) -
      Math.abs(shoelace(p, h2));
    const tris = triangulateRegions(p, [outer, h1, h2]);
    assert.ok(Math.abs(sumTriArea(p, tris) - expected) < 1e-9);
  });

  it("two disjoint regions both triangulate", () => {
    const p = pts(
      [0, 0], [1, 0], [1, 1], [0, 1],
      [3, 0], [4, 0], [4, 1], [3, 1],
    );
    const tris = triangulateRegions(p, [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
    assert.equal(tris.length / 3, 4); // 2 per square
    assert.ok(Math.abs(sumTriArea(p, tris) - 2) < 1e-12);
  });

  it("bridgeHoles doubles the bridge edge", () => {
    const p = pts(
      [0, 0], [4, 0], [4, 4], [0, 4],
      [1, 1], [3, 1], [3, 3], [1, 3],
    );
    const simple = bridgeHoles(p, [0, 1, 2, 3], [[4, 5, 6, 7]]);
    // Rightmost hole vert is 5 (x=3) or 6 (x=3); bridge target on outer is
    // typically 1 or 2 (x=4). The doubled pattern: bridge, hole…, hole tip, bridge.
    const tip = simple.find((v, i, a) =>
      v >= 4 && a[(i + a.length - 1) % a.length] < 4,
    );
    assert.ok(tip != null);
    // Count occurrences of the hole tip — appears at least twice (start + return).
    const tipCount = simple.filter((v) => v === tip).length;
    assert.ok(tipCount >= 2, `hole tip ${tip} appears ${tipCount} times`);
  });
});
