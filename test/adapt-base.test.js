import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adaptStateForBase } from "../src/adapt-base.js";
import { hullSkeletonForBase, scaleSkeleton, clearPipelineCache } from "../src/pipeline.js";
import { computeLimits } from "../src/limits.js";
import { compile } from "../src/compile.js";
import { encodeHash, decodeHash } from "../src/hashcodec.js";
import { BASE_IDS } from "../src/bases.js";
import { serializeProjectV1, parseProject } from "../src/project-format.js";
import { defaultRestingFace } from "../src/orient.js";

describe("adaptStateForBase", () => {
  it("resets faceIndex and preserves size", () => {
    const { patch, warnings } = adaptStateForBase({
      currentState: {
        base: "icosidodeca",
        circumdiameterMm: 120,
        wallMm: 1.4,
        borderMm: 3.2,
        openings: true,
        faceIndex: 7,
      },
      nextBase: "cube",
      nextLimits: { wallMmMax: 20, borderMmMax: 25, filletMmMax: 10 },
    });
    assert.equal(patch.base, "cube");
    assert.equal(patch.faceIndex, -1);
    assert.equal(patch.circumdiameterMm, undefined);
    assert.deepEqual(warnings, []);
  });

  it("clamps wall and border but never fillet", () => {
    const { patch, warnings } = adaptStateForBase({
      currentState: {
        base: "icosidodeca",
        wallMm: 30,
        borderMm: 20,
        filletMm: 50,
        openings: true,
        faceIndex: 0,
      },
      nextBase: "tetrahedron",
      nextLimits: { wallMmMax: 10, borderMmMax: 8, filletMmMax: 5 },
    });
    assert.equal(patch.wallMm, 10);
    assert.equal(patch.borderMm, 8);
    assert.equal(patch.filletMm, undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /reduced to fit/i);
  });

  it("live limits from tetrahedron clamp an oversized icosidodeca border", () => {
    clearPipelineCache();
    const unit = hullSkeletonForBase("tetrahedron");
    const sk = scaleSkeleton(unit, 50);
    const current = {
      base: "icosidodeca",
      circumdiameterMm: 100,
      wallMm: 1.4,
      borderMm: 8,
      openings: true,
      depth: "hollow",
      filletMm: 4.5,
      faceIndex: 3,
    };
    // Force a tiny border ceiling by pretending — use real limits; 8 mm may
    // still fit tetra. Use a huge border instead.
    current.borderMm = 40;
    const limits = computeLimits(sk, current);
    const { patch } = adaptStateForBase({
      currentState: current,
      nextBase: "tetrahedron",
      nextLimits: limits,
    });
    assert.ok(patch.borderMm <= limits.borderMmMax + 1e-9);
    assert.equal(patch.faceIndex, -1);
  });
});

describe("defaultRestingFace max-area", () => {
  // Expected side count of the max-area face per base. On the two mixed
  // solids the larger family must win; uniform solids may rest on any face.
  const EXPECTED_SIDES = {
    tetrahedron: 3,
    cube: 4,
    octahedron: 3,
    dodecahedron: 5,
    icosahedron: 3,
    icosidodeca: 5,
    random: 3, // merge-skip skeleton: every face is a triangle
  };

  for (const base of BASE_IDS) {
    it(`${base}: rests on a ${EXPECTED_SIDES[base]}-sided face`, () => {
      clearPipelineCache();
      const fit = base === "random" ? { borderMm: 1.5, filletMm: 2 } : {};
      const { skeleton, validation } = compile({ base, ...fit });
      assert.equal(validation.ok, true);
      const i = defaultRestingFace(skeleton);
      assert.ok(i >= 0 && i < skeleton.faces.length);
      assert.equal(skeleton.faces[i].length, EXPECTED_SIDES[base]);
    });
  }

  it("is deterministic across repeated compiles", () => {
    clearPipelineCache();
    const a = defaultRestingFace(compile({ base: "icosidodeca" }).skeleton);
    clearPipelineCache();
    const b = defaultRestingFace(compile({ base: "icosidodeca" }).skeleton);
    assert.equal(a, b);
  });
});

describe("project/hash round-trips across bases", () => {
  for (const base of BASE_IDS) {
    it(`${base} survives hash and project codec`, () => {
      clearPipelineCache();
      const fit = base === "random" ? { borderMm: 1.5, filletMm: 2 } : {};
      const { state, validation } = compile({ base, ...fit, faceIndex: 0 });
      assert.equal(validation.ok, true);
      const hash = encodeHash(state);
      const decoded = decodeHash(hash);
      assert.equal(decoded.ok, true);
      assert.equal(decoded.state.base, base);

      const text = serializeProjectV1({ name: base, state });
      const parsed = parseProject(text);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.state.base, base);
      const again = compile(parsed.state);
      assert.equal(again.validation.ok, true);
    });
  }
});
