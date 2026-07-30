/**
 * The version is stated in two places because there is no build step to inject
 * it. This test is what makes that safe.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("version", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(VERSION, pkg.version, "bump src/version.js and package.json together");
  });

  it("is a plain semver triple", () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  });

  it("has a changelog entry", () => {
    const log = readFileSync(join(root, "docs", "CHANGELOG.md"), "utf8");
    assert.ok(
      log.includes(`[${VERSION}]`),
      `docs/CHANGELOG.md has no entry for ${VERSION}`,
    );
  });
});
