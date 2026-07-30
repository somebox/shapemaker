import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canSaveProject,
  classifyOpen,
  shouldEstablishCleanBaseline,
} from "../src/session.js";

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
