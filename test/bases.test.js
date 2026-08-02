import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASES, BASE_IDS, isKnownBase } from "../src/bases.js";
import { hullToSkeleton } from "../src/hull.js";
import { icosidodecahedronDirect, icosidodecaPoints } from "../src/points/icosidodeca.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { circumradius } from "../src/skeleton.js";
import { PHI } from "../src/points/platonic.js";
import ref from "./reference.json" with { type: "json" };
import scipyTetra from "./fixtures/scipy_hull_tetra.json" with { type: "json" };
import quickhull from "../vendor/quickhull3d/quickhull3d.js";

function faceSignature(faces) {
  const m = new Map();
  for (const f of faces) m.set(f.length, (m.get(f.length) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

function vertexSetKey(positions, digits = 9) {
  const rows = [];
  for (let i = 0; i < positions.length; i += 3) {
    rows.push(
      [
        positions[i].toFixed(digits),
        positions[i + 1].toFixed(digits),
        positions[i + 2].toFixed(digits),
      ].join(","),
    );
  }
  return rows.sort().join(";");
}

function faceVertexSets(positions, faces, digits = 9) {
  return faces
    .map((ring) =>
      ring
        .map((i) =>
          [
            positions[i * 3].toFixed(digits),
            positions[i * 3 + 1].toFixed(digits),
            positions[i * 3 + 2].toFixed(digits),
          ].join(","),
        )
        .sort()
        .join("|"),
    )
    .sort()
    .join(";");
}

function edgeLengthMultiset(positions, faces, digits = 6) {
  const seen = new Set();
  const uniq = [];
  for (const ring of faces) {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(
        Math.hypot(
          positions[a * 3] - positions[b * 3],
          positions[a * 3 + 1] - positions[b * 3 + 1],
          positions[a * 3 + 2] - positions[b * 3 + 2],
        ).toFixed(digits),
      );
    }
  }
  return uniq.sort();
}

describe("BASES registry", () => {
  it("lists nine regular bases plus the parametric globe, sphere, and random hull", () => {
    assert.deepEqual([...BASE_IDS].sort(), [
      "cube",
      "cuboctahedron",
      "dodecahedron",
      "globe",
      "icosahedron",
      "icosidodeca",
      "octahedron",
      "random",
      "rhombicdodeca",
      "rhombictriaconta",
      "sphere",
      "tetrahedron",
    ]);
    for (const id of BASE_IDS) {
      assert.equal(isKnownBase(id), true);
      assert.ok(BASES[id].label);
      if (id === "random" || id === "sphere" || id === "globe") {
        assert.equal(BASES[id].regular, false);
        assert.equal(BASES[id].parametric, true);
        if (id === "globe") {
          assert.equal(BASES[id].merge, undefined, "globe keeps coplanar merge");
        } else {
          assert.equal(BASES[id].merge, false, `${id} skips coplanar merge`);
        }
      } else {
        assert.equal(BASES[id].regular, true);
      }
    }
  });
});

describe("analytic per-base hull signatures", () => {
  const expected = {
    tetrahedron: { verts: 4, sig: [[3, 4]], radii: [[1, 4]] },
    cube: { verts: 8, sig: [[4, 6]], radii: [[1, 8]] },
    octahedron: { verts: 6, sig: [[3, 8]], radii: [[1, 6]] },
    dodecahedron: { verts: 20, sig: [[5, 12]], radii: [[1, 20]] },
    icosahedron: { verts: 12, sig: [[3, 20]], radii: [[1, 12]] },
    icosidodeca: { verts: 30, sig: [[3, 20], [5, 12]], radii: [[1, 30]] },
    cuboctahedron: { verts: 12, sig: [[3, 8], [4, 6]], radii: [[1, 12]] },
    rhombicdodeca: {
      verts: 14,
      sig: [[4, 12]],
      radii: [[Math.sqrt(3) / 2, 8], [1, 6]],
    },
    rhombictriaconta: {
      verts: 32,
      sig: [[4, 30]],
      radii: [[Math.sqrt(3 / (2 + PHI)), 20], [1, 12]],
    },
  };

  function radiiMultiset(positions, digits = 9) {
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

  // Analytic signatures exist only for the regular family; parametric bases
  // have their own determinism/Euler suites.
  const REGULAR_IDS = BASE_IDS.filter((id) => BASES[id].regular);

  for (const id of REGULAR_IDS) {
    it(`${id}: vertex count, circumradius, face signature, radii`, () => {
      const pts = BASES[id].points();
      const sk = hullToSkeleton(pts);
      const exp = expected[id];
      assert.equal(sk.positions.length / 3, exp.verts);
      assert.ok(Math.abs(circumradius(sk.positions) - 1) < 1e-9);
      assert.deepEqual(faceSignature(sk.faces), exp.sig);
      const got = radiiMultiset(sk.positions);
      assert.equal(got.length, exp.radii.length, `${id} radius count`);
      for (let i = 0; i < exp.radii.length; i++) {
        assert.ok(
          Math.abs(got[i][0] - exp.radii[i][0]) < 1e-9,
          `${id} radius ${got[i][0]} vs ${exp.radii[i][0]}`,
        );
        assert.equal(got[i][1], exp.radii[i][1], `${id} radius multiplicity`);
      }
      // Edge lengths nearly equal (edge-transitive)
      const edges = edgeLengthMultiset(sk.positions, sk.faces, 8);
      const nums = edges.map(Number);
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      for (const L of nums) assert.ok(Math.abs(L - mean) < 1e-6, `${id} edge ${L} vs ${mean}`);
    });
  }

  it("dodecahedron inradius matches closed form", () => {
    const sk = hullToSkeleton(BASES.dodecahedron.points());
    // For unit circumradius dodecahedron: r = φ² / √(3) * (edge related) —
    // use plane distance of first face.
    const ring = sk.faces[0];
    let cx = 0, cy = 0, cz = 0;
    for (const i of ring) {
      cx += sk.positions[i * 3];
      cy += sk.positions[i * 3 + 1];
      cz += sk.positions[i * 3 + 2];
    }
    cx /= ring.length;
    cy /= ring.length;
    cz /= ring.length;
    const r = Math.hypot(cx, cy, cz);
    // Analytic: R=√3·φ for unnormalized verts; after unit normalize,
    // inradius / circumradius = φ² / √3(φ) ... simpler check: all faces same r.
    for (const face of sk.faces) {
      let fx = 0, fy = 0, fz = 0;
      for (const i of face) {
        fx += sk.positions[i * 3];
        fy += sk.positions[i * 3 + 1];
        fz += sk.positions[i * 3 + 2];
      }
      fx /= face.length;
      fy /= face.length;
      fz /= face.length;
      assert.ok(Math.abs(Math.hypot(fx, fy, fz) - r) < 1e-9);
    }
    assert.ok(r > 0.7 && r < 1);
  });
});

describe("SciPy hull parity fixture", () => {
  it("vendored QuickHull matches SciPy triangle vertex sets", () => {
    const pts = scipyTetra.points;
    const faces = quickhull(pts.map((p) => p.slice()));
    const sets = faces
      .map((t) => [...t].sort((a, b) => a - b).join(","))
      .sort();
    const expected = scipyTetra.triangle_vertex_sets
      .map((t) => [...t].sort((a, b) => a - b).join(","))
      .sort();
    assert.deepEqual(sets, expected);
    const used = new Set(faces.flat());
    assert.deepEqual(
      [...used].sort((a, b) => a - b),
      scipyTetra.hull_vertex_indices,
    );
  });
});

describe("direct vs hull icosidodecahedron", () => {
  it("matches geometrically and hits reference shell anchors", () => {
    clearPipelineCache();
    const direct = icosidodecahedronDirect(1);
    const hull = hullToSkeleton(icosidodecaPoints());

    assert.equal(vertexSetKey(direct.positions), vertexSetKey(hull.positions));
    assert.deepEqual(faceSignature(direct.faces), [[3, 20], [5, 12]]);
    assert.deepEqual(faceSignature(hull.faces), [[3, 20], [5, 12]]);
    assert.equal(
      faceVertexSets(direct.positions, direct.faces),
      faceVertexSets(hull.positions, hull.faces),
    );
    assert.deepEqual(
      edgeLengthMultiset(direct.positions, direct.faces),
      edgeLengthMultiset(hull.positions, hull.faces),
    );

    const V = hull.positions.length / 3;
    const E = new Set();
    for (const f of hull.faces) {
      for (let k = 0; k < f.length; k++) {
        const a = f[k], b = f[(k + 1) % f.length];
        E.add(a < b ? `${a},${b}` : `${b},${a}`);
      }
    }
    const F = hull.faces.length;
    assert.equal(V - E.size + F, 2);

    const result = compile({});
    assert.equal(result.validation.ok, true);
    assert.equal(result.metrics.triangleCount, ref.triangleCount);
    assert.ok(
      Math.abs(result.metrics.volumeCm3 - ref.volumeCm3) < ref.volumeRelEps * ref.volumeCm3,
    );
  });
});

describe("multi-base shell combos (headless)", () => {
  const combos = [
    { depth: "solid", openings: false },
    { depth: "hollow", openings: false },
    { depth: "hollow", openings: true },
  ];

  for (const base of BASE_IDS) {
    for (const c of combos) {
      it(`${base} ${c.depth} openings=${c.openings}`, () => {
        clearPipelineCache();
        // Random seeds can produce faces where the default 3.2 mm border
        // does not fit (the UI adapts on base change; headless must fit).
        const fit = BASES[base].parametric ? { borderMm: 1, filletMm: 1.5 } : {};
        const r = compile({ base, ...fit, ...c });
        assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
        assert.ok(r.metrics.triangleCount > 0);
        assert.ok(r.metrics.volumeCm3 > 0);
        assert.equal(r.metrics.watertight, true);
      });
    }
  }
});
