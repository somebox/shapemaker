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
  parseTyped,
  typedHint,
  createDragScheduler,
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
    assert.deepEqual(normalizePatch({ borderFraction: 0.4 }), {
      borderFraction: 0.4,
      borderMm: null,
    });
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

/** Deterministic timer harness for the drag scheduler. */
function fakeClock() {
  let t = 0;
  let id = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer(fn, ms) {
      const h = { id: ++id, at: t + ms, fn };
      timers.push(h);
      return h.id;
    },
    clearTimer(hid) {
      const i = timers.findIndex((x) => x.id === hid);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        t = next.at;
        timers.shift();
        next.fn();
      }
      t = end;
    },
    pending: () => timers.length,
  };
}

describe("typed values and drag scheduling", () => {
  it("parseTyped says why text is not committable", () => {
    assert.deepEqual(parseTyped("12", { min: 0, max: 50 }), { ok: true, value: 12 });
    assert.deepEqual(parseTyped(" 1.5 ", { min: 0, max: 50 }), { ok: true, value: 1.5 });
    assert.equal(parseTyped("", { min: 0, max: 50 }).reason, "empty");
    assert.equal(parseTyped("1.", { min: 0, max: 50 }).ok, true);
    assert.equal(parseTyped("abc", {}).reason, "nan");
    assert.equal(parseTyped("60", { min: 0, max: 50 }).reason, "range");
    assert.equal(parseTyped("-1", { min: 0, max: 50 }).reason, "range");
    assert.equal(parseTyped("2.5", { integer: true }).reason, "integer");
    assert.equal(parseTyped("500", { min: 10, max: null }).ok, true);
  });

  it("typedHint names the live bounds", () => {
    assert.equal(typedHint("range", { min: 0, max: 50, unit: "%" }), "Enter a value between 0–50 %");
    assert.equal(typedHint("range", { min: 10 }), "Enter a value at least 10");
    assert.equal(typedHint("integer", { min: 0, max: 9 }), "Enter a whole number (0–9)");
    assert.equal(typedHint("nan", {}), "Enter a number");
  });

  it("drag scheduler throttles live patches and merges ticks", () => {
    const clock = fakeClock();
    const live = [];
    const commits = [];
    const s = createDragScheduler({
      live: (p) => live.push(p),
      commit: (p) => commits.push(p),
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      minIntervalMs: 50,
      settleMs: 120,
    });
    s.move({ a: 1 });
    assert.deepEqual(live, [{ a: 1 }], "first tick compiles immediately");
    clock.advance(10);
    s.move({ a: 2 });
    clock.advance(10);
    s.move({ a: 3 });
    assert.equal(live.length, 1, "inside the interval nothing compiles");
    clock.advance(40);
    assert.deepEqual(live[1], { a: 3 }, "trailing tick carries the latest value");
    s.release({ a: 4 });
    assert.deepEqual(commits, [{ a: 4 }]);
    assert.equal(clock.pending(), 0, "release cancels every timer");
  });

  it("drag scheduler catches up when the pointer pauses", () => {
    const clock = fakeClock();
    const live = [];
    const s = createDragScheduler({
      live: (p) => live.push(p),
      commit: () => {},
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      minIntervalMs: 50,
      maxIntervalMs: 350,
      settleMs: 120,
    });
    s.setCompileMs(200);
    assert.equal(s.intervalMs, 300, "interval is 1.5× compile time");
    s.setCompileMs(5000);
    assert.equal(s.intervalMs, 350, "capped");
    s.setCompileMs(1);
    assert.equal(s.intervalMs, 50, "floored");
    s.setCompileMs(200);
    s.move({ a: 1 });
    clock.advance(10);
    s.move({ a: 2 });
    assert.equal(live.length, 1);
    clock.advance(150);
    assert.deepEqual(live[1], { a: 2 }, "pause flushes before the 300 ms throttle");
    assert.equal(clock.pending(), 0, "the pause flush cancels the throttle timer");
  });

  it("heavy mode compiles only on pause and commits on release", () => {
    const clock = fakeClock();
    const live = [];
    const commits = [];
    const s = createDragScheduler({
      live: (p) => live.push(p),
      commit: (p) => commits.push(p),
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      settleMs: 120,
    });
    s.setHeavy(true);
    s.move({ a: 1 });
    clock.advance(60);
    s.move({ a: 2 });
    clock.advance(60);
    assert.equal(live.length, 0, "no live compiles while the pointer keeps moving");
    clock.advance(100);
    assert.deepEqual(live, [{ a: 2 }], "one compile once it pauses");
    s.move({ a: 3 });
    s.release();
    assert.deepEqual(commits, [{ a: 3 }], "release commits the pending value");
    assert.equal(live.length, 1);
  });

  it("jitter cluster starts folded", () => {
    const store = { getItem: () => null, setItem() {} };
    assert.equal(loadGroupsOpen(store).jitter, false);
    assert.equal(loadGroupsOpen(store).shape, true);
  });
});
