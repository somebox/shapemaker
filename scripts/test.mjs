#!/usr/bin/env node
/**
 * `npm test`: runs test/*.test.js with `node --test`, four files at a time.
 * TEST_JOBS sets another number. Node's own default is one file per core,
 * which keeps most of a large machine busy for the length of a run.
 *
 * The number and the file list are worked out here, not by the shell, so the
 * command is the same under every shell npm may use. Arguments are passed on
 * after the files.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const jobs = process.env.TEST_JOBS || "4";
if (!/^[1-9]\d*$/.test(jobs)) {
  console.error(`TEST_JOBS must be a whole number, 1 or more (got "${jobs}")`);
  process.exit(2);
}

const root = new URL("../", import.meta.url);
const files = readdirSync(new URL("test/", root))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => `test/${name}`);

const run = spawnSync(
  process.execPath,
  ["--test", `--test-concurrency=${jobs}`, ...files, ...process.argv.slice(2)],
  { cwd: fileURLToPath(root), stdio: "inherit" },
);
if (run.error) throw run.error;
process.exit(run.status ?? 1);
