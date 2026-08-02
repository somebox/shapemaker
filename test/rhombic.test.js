/**
 * Catalan rhombic solids — exact geometry locks.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rhombicDodecaPoints,
  rhombicTriacontaPoints,
} from "../src/points/rhombic.js";
import { PHI } from "../src/points/platonic.js";
import { hullToSkeleton } from "../src/hull.js";

function faceSignature(faces) {
  const m = new Map();
  for (const f of faces) m.set(f.length, (m.get(f.length) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

function edgeLength(positions, a, b) {
  return Math.hypot(
    positions[a * 3] - positions[b * 3],
    positions[a * 3 + 1] - positions[b * 3 + 1],
    positions[a * 3 + 2] - positions[b * 3 + 2],
  );
}

function radiiMultiset(positions, digits = 12) {
  const m = new Map();
  for (let i = 0; i < positions.length; i += 3) {
    const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
    const key = r.toFixed(digits);
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()]
    .map(([k, n]) => [Number(k), n])
    .sort((a, b) => a[0] - b[0]);
}

function planarity(positions, ring) {
  const p = ring.map((i) => [
    positions[i * 3],
    positions[i * 3 + 1],
    positions[i * 3 + 2],
  ]);
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const n = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const nn = Math.hypot(...n) || 1;
  const d = -(n[0] * p[0][0] + n[1] * p[0][1] + n[2] * p[0][2]) / nn;
  let max = 0;
  for (let i = 3; i < p.length; i++) {
    const dist = Math.abs(
      (n[0] * p[i][0] + n[1] * p[i][1] + n[2] * p[i][2]) / nn + d,
    );
    if (dist > max) max = dist;
  }
  return max;
}

function diagonals(positions, ring) {
  // Quad diagonals: 0–2 and 1–3
  return [
    edgeLength(positions, ring[0], ring[2]),
    edgeLength(positions, ring[1], ring[3]),
  ].sort((a, b) => a - b);
}

/** Degree histogram from the skeleton's own edges array. */
function vertexDegrees(edges, V) {
  const deg = new Array(V).fill(0);
  for (const [a, b] of edges) {
    deg[a]++;
    deg[b]++;
  }
  const m = new Map();
  for (const d of deg) m.set(d, (m.get(d) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

describe("rhombic dodecahedron", () => {
  it("12 planar rhombi, diagonal ratio √2, edges √3/2", () => {
    const sk = hullToSkeleton(rhombicDodecaPoints());
    assert.equal(sk.faces.length, 12);
    assert.deepEqual(faceSignature(sk.faces), [[4, 12]]);
    const edge = Math.sqrt(3) / 2;
    for (const [a, b] of sk.edges) {
      assert.ok(
        Math.abs(edgeLength(sk.positions, a, b) - edge) < 1e-12,
        `edge ${edgeLength(sk.positions, a, b)}`,
      );
    }
    for (const face of sk.faces) {
      assert.ok(planarity(sk.positions, face) < 1e-12);
      const [dShort, dLong] = diagonals(sk.positions, face);
      assert.ok(Math.abs(dLong / dShort - Math.SQRT2) < 1e-9);
    }
  });
});

describe("rhombic triacontahedron", () => {
  it("radii multiset, 30 planar golden rhombi, edge 1/φ, degrees", () => {
    const sk = hullToSkeleton(rhombicTriacontaPoints());
    assert.equal(sk.positions.length / 3, 32);
    assert.deepEqual(faceSignature(sk.faces), [[4, 30]]);
    assert.equal(sk.edges.length, 60);
    assert.equal(32 - 60 + 30, 2);

    const radii = radiiMultiset(sk.positions);
    assert.equal(radii.length, 2);
    assert.ok(Math.abs(radii[0][0] - Math.sqrt(3 / (2 + PHI))) < 1e-12);
    assert.equal(radii[0][1], 20);
    assert.ok(Math.abs(radii[1][0] - 1) < 1e-12);
    assert.equal(radii[1][1], 12);

    const edge = 1 / PHI;
    for (const [a, b] of sk.edges) {
      assert.ok(
        Math.abs(edgeLength(sk.positions, a, b) - edge) < 1e-12,
        `edge ${edgeLength(sk.positions, a, b)}`,
      );
    }

    for (const face of sk.faces) {
      assert.ok(planarity(sk.positions, face) < 1e-12);
      const [dShort, dLong] = diagonals(sk.positions, face);
      assert.ok(Math.abs(dLong / dShort - PHI) < 1e-9, "golden diagonal ratio");
      // Each rhombus has 2 icosa (outer) + 2 dodeca (inner) corners
      const rs = face.map((i) =>
        Math.hypot(
          sk.positions[i * 3],
          sk.positions[i * 3 + 1],
          sk.positions[i * 3 + 2],
        ),
      );
      const outer = rs.filter((r) => Math.abs(r - 1) < 1e-9).length;
      const inner = rs.filter(
        (r) => Math.abs(r - Math.sqrt(3 / (2 + PHI))) < 1e-9,
      ).length;
      assert.equal(outer, 2);
      assert.equal(inner, 2);
    }

    assert.deepEqual(vertexDegrees(sk.edges, 32), [
      [3, 20],
      [5, 12],
    ]);
  });
});
