import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fmt,
  fmt2,
  fmtInput,
  round1,
  clampUi,
  limitRangeBounds,
  limitTitle,
  uiToState,
  stateToUi,
} from "../src/controls.js";
import {
  normalizePatch,
  shouldLivePatchDuringDrag,
  loadGroupsOpen,
  saveGroupsOpen,
  GROUPS_OPEN_KEY,
  estimateMassG,
  MATERIAL_PRESETS,
} from "../src/ui.js";
import { HEAVY_COMPILE_MS, predictedCompileMs } from "../src/perf.js";
import {
  canSaveProject,
  classifyOpen,
  shouldEstablishCleanBaseline,
} from "../src/session.js";
import { nextHistoryAction } from "../src/history.js";

describe("controls pure helpers", () => {
  it("formats display and input values", () => {
    assert.equal(fmt(12.34), "12.3");
    assert.equal(fmt(12), "12");
    assert.equal(fmt(NaN), "—");
    assert.equal(fmt2(0.05), "0.05");
    assert.equal(fmtInput(1.234), "1.23");
    assert.equal(round1(1.24), 1.2);
  });

  it("clamps UI values into finite bounds", () => {
    assert.equal(clampUi(5, 0, 10), 5);
    assert.equal(clampUi(-1, 0, 10), 0);
    assert.equal(clampUi(99, 0, 10), 10);
  });

  it("derives limit floor/ceil for tiny ceilings", () => {
    const big = limitRangeBounds(4.2, 0.2);
    assert.equal(big.floor, 0.2);
    assert.equal(big.ceil, 4.2);
    const tiny = limitRangeBounds(0.08, 0.2);
    assert.ok(tiny.ceil <= 0.08 + 1e-9);
    assert.ok(tiny.floor < tiny.ceil);
  });

  it("builds a limit title string", () => {
    assert.equal(limitTitle("Wall", 0.2, 3.5, "mm"), "Wall: 0.2–3.5 mm");
  });

  it("honours ControlDef toState/fromState hooks", () => {
    const def = {
      toState: (v) => v / 100,
      fromState: (v) => v * 100,
    };
    assert.equal(uiToState(def, 50), 0.5);
    assert.equal(stateToUi(def, 0.5), 50);
    assert.equal(uiToState({}, 7), 7);
  });
});

describe("panel policy helpers", () => {
  it("normalizePatch couples solid/openings and density", () => {
    assert.deepEqual(normalizePatch({ depth: "solid" }), {
      depth: "solid",
      openings: false,
    });
    assert.deepEqual(normalizePatch({ openings: true }), {
      openings: true,
      depth: "hollow",
    });
    const dens = normalizePatch({ points: 24 });
    assert.equal(dens.points, 24);
    assert.equal(typeof dens.separation, "number");
  });

  it("heavy mode suppresses live drag patches", () => {
    assert.equal(shouldLivePatchDuringDrag({ heavyMode: false }), true);
    assert.equal(shouldLivePatchDuringDrag({ heavyMode: true }), false);
  });

  it("group open state round-trips through storage", () => {
    const store = {
      data: {},
      getItem(k) {
        return this.data[k] ?? null;
      },
      setItem(k, v) {
        this.data[k] = String(v);
      },
    };
    saveGroupsOpen({ shape: false, form: true }, store);
    assert.ok(store.data[GROUPS_OPEN_KEY]);
    const loaded = loadGroupsOpen(store);
    assert.equal(loaded.shape, false);
    assert.equal(loaded.form, true);
    assert.equal(loaded.make, true);
  });

  it("estimates mass from volume × density", () => {
    assert.equal(estimateMassG(10, 1.24), 12.4);
    assert.equal(estimateMassG(NaN, 1.24), null);
    assert.ok(MATERIAL_PRESETS.some((m) => m.id === "pla"));
  });
});

describe("heavy-compile + session/history policies (B coverage)", () => {
  it("predictedCompileMs scales with subdivision", () => {
    const ms = predictedCompileMs(20, { subdiv: 0 }, { subdiv: 1 }, 100);
    assert.ok(ms >= HEAVY_COMPILE_MS || ms >= 20 * 4);
  });

  it("save eligibility requires a valid draft and last state", () => {
    assert.equal(canSaveProject({ draftValid: true, last: { state: {} } }), true);
    assert.equal(canSaveProject({ draftValid: false, last: { state: {} } }), false);
    assert.equal(canSaveProject({ draftValid: true, last: null }), false);
  });

  it("open classify and clean baseline stay pure", () => {
    assert.equal(classifyOpen({ parseOk: false, compileOk: false }), "reject-parse");
    assert.equal(classifyOpen({ parseOk: true, compileOk: false }), "reject-compile");
    assert.equal(classifyOpen({ parseOk: true, compileOk: true }), "accept");
    assert.equal(
      shouldEstablishCleanBaseline({ openAccepted: true, regenerateOk: true }),
      true,
    );
  });

  it("live drag history pushes then replaces until commit", () => {
    const first = nextHistoryAction({
      commit: false,
      liveEdit: false,
      hash: "a",
      lastWrittenHash: "",
    });
    assert.equal(first.action, "push");
    const mid = nextHistoryAction({
      commit: false,
      liveEdit: true,
      hash: "b",
      lastWrittenHash: "a",
    });
    assert.equal(mid.action, "replace");
    const end = nextHistoryAction({
      commit: true,
      liveEdit: true,
      hash: "c",
      lastWrittenHash: "b",
    });
    assert.equal(end.action, "replace");
    assert.equal(end.liveEdit, false);
  });
});
