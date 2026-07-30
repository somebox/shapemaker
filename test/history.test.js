import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextHistoryAction } from "../src/history.js";

describe("nextHistoryAction", () => {
  it("first live preview tick pushes and enters live edit", () => {
    const r = nextHistoryAction({
      commit: false,
      liveEdit: false,
      hash: "v1.a",
      lastWrittenHash: "v1.0",
    });
    assert.deepEqual(r, { action: "push", liveEdit: true });
  });

  it("subsequent live ticks replace only when the hash changes", () => {
    assert.deepEqual(
      nextHistoryAction({
        commit: false,
        liveEdit: true,
        hash: "v1.b",
        lastWrittenHash: "v1.a",
      }),
      { action: "replace", liveEdit: true },
    );
    assert.deepEqual(
      nextHistoryAction({
        commit: false,
        liveEdit: true,
        hash: "v1.a",
        lastWrittenHash: "v1.a",
      }),
      { action: "none", liveEdit: true },
    );
  });

  it("commit after live edit finalizes the same entry", () => {
    assert.deepEqual(
      nextHistoryAction({
        commit: true,
        liveEdit: true,
        hash: "v1.b",
        lastWrittenHash: "v1.a",
      }),
      { action: "replace", liveEdit: false },
    );
    assert.deepEqual(
      nextHistoryAction({
        commit: true,
        liveEdit: true,
        hash: "v1.a",
        lastWrittenHash: "v1.a",
      }),
      { action: "none", liveEdit: false },
    );
  });

  it("discrete commit pushes once when state changes", () => {
    assert.deepEqual(
      nextHistoryAction({
        commit: true,
        liveEdit: false,
        hash: "v1.b",
        lastWrittenHash: "v1.a",
      }),
      { action: "push", liveEdit: false },
    );
  });

  it("no-op commit creates no history entry", () => {
    assert.deepEqual(
      nextHistoryAction({
        commit: true,
        liveEdit: false,
        hash: "v1.a",
        lastWrittenHash: "v1.a",
      }),
      { action: "none", liveEdit: false },
    );
  });
});
