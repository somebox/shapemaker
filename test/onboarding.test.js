import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_SEEN_KEY,
  hasSeenOnboarding,
  markOnboardingSeen,
  maybeShowFirstVisit,
} from "../src/onboarding.js";

function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem(k, v) {
      data[k] = String(v);
    },
    _data: data,
  };
}

describe("onboarding seen-flag", () => {
  it("reports unseen when the key is absent", () => {
    assert.equal(hasSeenOnboarding(memoryStore()), false);
  });

  it("markOnboardingSeen persists the flag", () => {
    const store = memoryStore();
    markOnboardingSeen(store);
    assert.equal(store.getItem(ONBOARDING_SEEN_KEY), "1");
    assert.equal(hasSeenOnboarding(store), true);
  });

  it("maybeShowFirstVisit opens only when unseen", () => {
    let opens = 0;
    const open = () => {
      opens += 1;
    };
    maybeShowFirstVisit(open, memoryStore());
    assert.equal(opens, 1);
    maybeShowFirstVisit(open, memoryStore({ [ONBOARDING_SEEN_KEY]: "1" }));
    assert.equal(opens, 1);
  });
});
