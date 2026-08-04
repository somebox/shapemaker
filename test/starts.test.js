/**
 * Start-from recipes — hard-reset packs for bases and named presets.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recipeForBase,
  startFromRecipe,
  isCleanBaseRecipe,
  startStatuses,
} from "../src/starts.js";
import { DEFAULT_STATE, normalizeState, statesEqual } from "../src/schema.js";
import { BASE_IDS } from "../src/bases.js";
import { compile } from "../src/compile.js";
import { clearPipelineCache } from "../src/pipeline.js";

describe("recipeForBase", () => {
  for (const base of BASE_IDS) {
    it(`${base} is a full default pack that compiles`, () => {
      clearPipelineCache();
      const state = recipeForBase(base);
      assert.equal(state.base, base);
      assert.equal(state.faceIndex, -1);
      assert.equal(state.jitter, DEFAULT_STATE.jitter);
      const r = compile(state);
      assert.equal(r.validation.ok, true, r.validation.errors[0]?.message);
    });
  }

  it("resets Form intent — not a preserve patch", () => {
    const cube = recipeForBase("cube");
    assert.equal(cube.depth, DEFAULT_STATE.depth);
    assert.equal(cube.openings, DEFAULT_STATE.openings);
    assert.equal(cube.filletMm, DEFAULT_STATE.filletMm);
  });
});

describe("isCleanBaseRecipe", () => {
  it("matches recipe ignoring resolved faceIndex", () => {
    clearPipelineCache();
    const recipe = recipeForBase("cube");
    const compiled = compile(recipe);
    assert.ok(compiled.validation.ok);
    assert.notEqual(compiled.state.faceIndex, -1);
    assert.equal(isCleanBaseRecipe(compiled.state, "cube"), true);
    assert.equal(isCleanBaseRecipe(compiled.state, "tetrahedron"), false);
  });

  it("is false after a Form tweak", () => {
    const tweaked = { ...recipeForBase("cube"), wallMm: 2 };
    assert.equal(isCleanBaseRecipe(tweaked, "cube"), false);
  });
});

describe("startStatuses", () => {
  it("marks the matching base active when browsing a clean recipe", () => {
    clearPipelineCache();
    const draft = compile(recipeForBase("octahedron")).state;
    const statuses = startStatuses({
      draft,
      projectName: "Octahedron",
      presets: [],
    });
    const octa = statuses.find((s) => s.id === "octahedron");
    assert.deepEqual(octa, {
      id: "octahedron",
      kind: "base",
      active: true,
      edited: false,
    });
    assert.ok(statuses.filter((s) => s.kind === "base" && s.active).length === 1);
  });

  it("marks base edited when draft is modified from that pack", () => {
    const draft = { ...recipeForBase("cube"), borderFraction: 0.5, faceIndex: 0 };
    const statuses = startStatuses({
      draft,
      projectName: "Cube",
      presets: [],
    });
    const cube = statuses.find((s) => s.id === "cube");
    assert.equal(cube.active, false);
    assert.equal(cube.edited, true);
  });

  it("lets a matching preset claim the strip over the base", () => {
    const resolved = normalizeState({
      base: "dodecahedron",
      depth: "solid",
      openings: false,
      faceIndex: 0,
    });
    const statuses = startStatuses({
      draft: resolved,
      projectName: "Solid Dodecahedron",
      presets: [
        {
          id: "solid-dodeca",
          name: "Solid Dodecahedron",
          resolved,
        },
      ],
    });
    const preset = statuses.find((s) => s.id === "solid-dodeca");
    const base = statuses.find((s) => s.id === "dodecahedron");
    assert.equal(preset.active, true);
    assert.equal(base.active, false);
    assert.equal(base.edited, false);
  });

  it("does not mark a preset active when the name does not match", () => {
    // Prototype TPU shares the default icosidodeca recipe.
    clearPipelineCache();
    const draft = compile(recipeForBase("icosidodeca")).state;
    const statuses = startStatuses({
      draft,
      projectName: "Untitled",
      presets: [
        {
          id: "prototype-tpu",
          name: "Prototype TPU",
          resolved: draft,
        },
      ],
    });
    assert.equal(statuses.find((s) => s.id === "prototype-tpu").active, false);
    assert.equal(statuses.find((s) => s.id === "icosidodeca").active, true);
  });
});

describe("startFromRecipe", () => {
  it("resolves base ids", () => {
    const start = startFromRecipe("dodecahedron");
    assert.ok(start);
    assert.equal(start.name, "Dodecahedron");
    assert.equal(start.state.base, "dodecahedron");
    assert.ok(statesEqual(normalizeState(start.state), recipeForBase("dodecahedron")));
  });

  it("resolves preset ids with the preset name and state", () => {
    const presets = [
      {
        id: "solid-dodeca",
        name: "Solid Dodecahedron",
        state: {
          base: "dodecahedron",
          depth: "solid",
          openings: false,
          faceIndex: -1,
        },
        resolved: {
          base: "dodecahedron",
          depth: "solid",
          openings: false,
          faceIndex: -1,
        },
      },
    ];
    const start = startFromRecipe("solid-dodeca", presets);
    assert.ok(start);
    assert.equal(start.name, "Solid Dodecahedron");
    assert.equal(start.state.base, "dodecahedron");
    assert.equal(start.state.depth, "solid");
    assert.equal(start.state.openings, false);
  });

  it("returns null for unknown ids", () => {
    assert.equal(startFromRecipe("nope"), null);
  });
});
