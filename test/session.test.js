import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canSaveProject,
  classifyOpen,
  shouldEstablishCleanBaseline,
  sessionHistoryPayload,
  restoreSessionFromPopstate,
  depthAfterPopstate,
} from "../src/session.js";
import { normalizeState } from "../src/schema.js";

describe("canSaveProject", () => {
  it("requires a valid current draft and last.state", () => {
    assert.equal(
      canSaveProject({ draftValid: true, last: { state: { wallMm: 1 } } }),
      true,
    );
    assert.equal(
      canSaveProject({ draftValid: false, last: { state: { wallMm: 1 } } }),
      false,
    );
    assert.equal(canSaveProject({ draftValid: true, last: null }), false);
    assert.equal(canSaveProject({ draftValid: true, last: {} }), false);
  });
});

describe("classifyOpen", () => {
  it("rejects parse or compile failures before accept", () => {
    assert.equal(
      classifyOpen({ parseOk: false, compileOk: false }),
      "reject-parse",
    );
    assert.equal(
      classifyOpen({ parseOk: true, compileOk: false }),
      "reject-compile",
    );
    assert.equal(classifyOpen({ parseOk: true, compileOk: true }), "accept");
  });
});

describe("shouldEstablishCleanBaseline", () => {
  it("requires both accept and successful regenerate", () => {
    assert.equal(
      shouldEstablishCleanBaseline({
        openAccepted: true,
        regenerateOk: true,
      }),
      true,
    );
    assert.equal(
      shouldEstablishCleanBaseline({
        openAccepted: true,
        regenerateOk: false,
      }),
      false,
    );
    assert.equal(
      shouldEstablishCleanBaseline({
        openAccepted: false,
        regenerateOk: true,
      }),
      false,
    );
  });
});

describe("sessionHistoryPayload / restoreSessionFromPopstate", () => {
  const clean = normalizeState({ base: "cube", wallMm: 2 });
  const draft = normalizeState({ base: "tetrahedron", wallMm: 1.4 });

  it("payload carries name, clean baseline, and push depth", () => {
    const p = sessionHistoryPayload({
      projectName: "Die",
      cleanName: "Cube",
      cleanState: clean,
      depth: 2,
    });
    assert.equal(p.shapemaker, true);
    assert.equal(p.projectName, "Die");
    assert.equal(p.cleanName, "Cube");
    assert.deepEqual(p.cleanState, clean);
    assert.equal(p.depth, 2);
  });

  it("restores draft from hash and name/baseline from history.state", () => {
    const restored = restoreSessionFromPopstate({
      decoded: { ok: true, state: draft },
      historyState: sessionHistoryPayload({
        projectName: "Die",
        cleanName: "Cube",
        cleanState: clean,
      }),
    });
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.draft, draft);
    assert.equal(restored.projectName, "Die");
    assert.equal(restored.cleanName, "Cube");
    assert.deepEqual(restored.cleanState, clean);
  });

  it("restores draft only when history.state lacks session fields", () => {
    const restored = restoreSessionFromPopstate({
      decoded: { ok: true, state: draft },
      historyState: { shapemaker: true },
    });
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.draft, draft);
    assert.equal(restored.projectName, undefined);
  });

  it("rejects a bad hash decode", () => {
    assert.deepEqual(
      restoreSessionFromPopstate({
        decoded: { ok: false },
        historyState: null,
      }),
      { ok: false },
    );
  });
});

describe("depthAfterPopstate", () => {
  it("restores the entry's recorded depth for Back AND Forward", () => {
    const entry = { shapemaker: true, depth: 3 };
    // Back from depth 4 or Forward from depth 2 both land exactly on 3.
    assert.equal(depthAfterPopstate({ historyState: entry, previousDepth: 4 }), 3);
    assert.equal(depthAfterPopstate({ historyState: entry, previousDepth: 2 }), 3);
  });

  it("falls back to one step back on entries without a depth", () => {
    assert.equal(depthAfterPopstate({ historyState: {}, previousDepth: 2 }), 1);
    assert.equal(depthAfterPopstate({ historyState: null, previousDepth: 0 }), 0);
  });

  it("ignores foreign or malformed depths", () => {
    assert.equal(
      depthAfterPopstate({
        historyState: { shapemaker: true, depth: -1 },
        previousDepth: 2,
      }),
      1,
    );
    assert.equal(
      depthAfterPopstate({ historyState: { depth: 5 }, previousDepth: 2 }),
      1,
    );
  });
});
