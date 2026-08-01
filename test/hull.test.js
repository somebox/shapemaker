import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hullToSkeleton, mergeCoplanar, applyFaceIdentity } from "../src/hull.js";
import { assertSkeleton } from "../src/skeleton.js";
import { BASES, BASE_IDS } from "../src/bases.js";

function cubePoints() {
  const pts = [];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) pts.push([x, y, z]);
    }
  }
  return pts;
}

function faceSignature(faces) {
  const counts = new Map();
  for (const f of faces) counts.set(f.length, (counts.get(f.length) || 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]);
}

describe("hullToSkeleton", () => {
  it("merges a cube to 6 quads with deterministic face identity", () => {
    const a = hullToSkeleton(cubePoints());
    const b = hullToSkeleton([...cubePoints()].reverse());
    assert.deepEqual(faceSignature(a.faces), [[4, 6]]);
    assert.equal(a.faces.length, 6);
    assert.deepEqual(
      a.faces.map((f) => f.length),
      b.faces.map((f) => f.length),
    );
    // Face rings (as vertex coordinate sets) match under reorder.
    const key = (sk) =>
      sk.faces
        .map((ring) =>
          ring
            .map((i) =>
              [
                sk.positions[i * 3],
                sk.positions[i * 3 + 1],
                sk.positions[i * 3 + 2],
              ].join(","),
            )
            .sort()
            .join("|"),
        )
        .sort()
        .join(";");
    assert.equal(key(a), key(b));
    assertSkeleton(a);
  });

  it("keeps parallel opposite faces separate", () => {
    const { faces, positions } = hullToSkeleton(cubePoints());
    // Two faces with normals ±X should both exist (not merged into one).
    const offsets = faces.map((ring) => {
      const c = [0, 0, 0];
      for (const i of ring) {
        c[0] += positions[i * 3];
        c[1] += positions[i * 3 + 1];
        c[2] += positions[i * 3 + 2];
      }
      c[0] /= ring.length;
      c[1] /= ring.length;
      c[2] /= ring.length;
      return c;
    });
    const xs = offsets.map((c) => c[0]).sort((a, b) => a - b);
    assert.ok(xs[0] < -0.5 && xs[xs.length - 1] > 0.5);
  });

  it("does not merge a slightly non-coplanar pair", () => {
    // Origin-centered cube with one vertex nudged off its face plane so the
    // two triangles of that face stay separate (over-merge would yield 6 quads).
    const pts = cubePoints();
    pts[7][0] += 0.02;
    pts[7][1] += 0.02;
    pts[7][2] += 0.02;
    const { faces } = hullToSkeleton(pts);
    const quads = faces.filter((f) => f.length === 4).length;
    const tris = faces.filter((f) => f.length === 3).length;
    assert.ok(
      quads < 6 && tris >= 2,
      `expected over-merge prevention, got signature ${faceSignature(faces)}`,
    );
  });
});

describe("applyFaceIdentity", () => {
  it("is stable under face list shuffle", () => {
    const { positions, faces } = hullToSkeleton(cubePoints());
    const shuffled = faces.slice().reverse();
    const a = applyFaceIdentity(positions, faces);
    const b = applyFaceIdentity(positions, shuffled);
    assert.deepEqual(a, b);
  });
});

describe("face identity is deterministic under input point order (all bases)", () => {
  // Deterministic permutation — no Math.random, so failures reproduce.
  function scramble(flat) {
    const n = flat.length / 3;
    const order = [...Array(n).keys()].sort(
      (a, b) => ((a * 7919 + 13) % n) - ((b * 7919 + 13) % n) || a - b,
    );
    const out = new Float64Array(flat.length);
    for (let i = 0; i < n; i++) {
      out[i * 3] = flat[order[i] * 3];
      out[i * 3 + 1] = flat[order[i] * 3 + 1];
      out[i * 3 + 2] = flat[order[i] * 3 + 2];
    }
    return out;
  }

  /** Quantized (sides, centroid) key for face k — position-based, not index-based. */
  function faceKey(skeleton, k) {
    const ring = skeleton.faces[k];
    let cx = 0, cy = 0, cz = 0;
    for (const vi of ring) {
      cx += skeleton.positions[vi * 3];
      cy += skeleton.positions[vi * 3 + 1];
      cz += skeleton.positions[vi * 3 + 2];
    }
    const q = (v) => Math.round((v / ring.length) * 1e6);
    return `${ring.length}:${q(cx)},${q(cy)},${q(cz)}`;
  }

  for (const id of BASE_IDS) {
    it(`${id}: same faceIndex → same geometric face after point shuffle`, () => {
      const params = BASES[id].parametric
        ? { points: 24, seed: 1337, separation: 0.5 }
        : undefined;
      const pts = BASES[id].points(params);
      const mergeOpts = BASES[id].merge === false ? { merge: false } : {};
      const a = hullToSkeleton(pts, mergeOpts);
      const b = hullToSkeleton(scramble(pts), mergeOpts);
      assert.equal(a.faces.length, b.faces.length);
      // Vertex indices may differ — the promise is per-INDEX face geometry.
      for (let k = 0; k < a.faces.length; k++) {
        assert.equal(faceKey(a, k), faceKey(b, k), `face ${k} of ${id} moved`);
      }
    });
  }
});

describe("mergeCoplanar export", () => {
  it("is available for targeted fixtures", () => {
    assert.equal(typeof mergeCoplanar, "function");
  });
});
