#!/usr/bin/env node
/**
 * Shapemaker from the command line: the same shape and production path the
 * app uses, so a design builds to the same files in both.
 *
 *   node scripts/shapemaker.mjs build [design.shapemaker.json] [flags]
 *   node scripts/shapemaker.mjs plan [design.shapemaker.json] [flags] [--json]
 *   node scripts/shapemaker.mjs settings [--process=cut]
 *
 * build writes every file the design makes, plus manifest.json, to --out
 * (default test/out/<stem>). plan only says what it would make. A design
 * file's own production block picks the process; flags override it and its
 * shape.
 *
 * Flags: --process=print|cut|fold, any state key (--base=cube --diameter=120),
 * any setting of the process (--sheet-mm=3 --join=sew --board=500x300),
 * --fix (take the app's offered fixes, such as a wider Border),
 * --split (print: two halves), --pictures (cut, fold: renders of the model),
 * --save=FILE (write the design back out as a project file).
 *
 * Exit codes: 0 done, 1 the design doesn't build, 2 usage.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseProject, serializeProjectV1 } from "../src/project-format.js";
import { normalizeState, patchState } from "../src/schema.js";
import { chooseSplit } from "../src/split.js";
import {
  runJob, normalizeJob, serializeJob, summarize, listArtifacts, exportNotes, designStem, PROCESSES,
} from "../src/production/index.js";
import { STATE_FLAGS, parseArgs, applyJobFlags, describeSettings, USAGE_PROCESSES } from "./lib/flags.mjs";
import { VERSION } from "../src/version.js";

const USAGE = "usage: node scripts/shapemaker.mjs build|plan [design.shapemaker.json] [--flag=value ...]\n       node scripts/shapemaker.mjs settings [--process=cut]";

function usage(message) {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command, designFile, ...extra] = positional;
if (!["build", "plan", "settings"].includes(command)) usage(command ? `unknown command ${command}` : "no command");
if (extra.length) usage(`unexpected ${extra[0]}`);

if (command === "settings") {
  for (const p of flags.process ? [flags.process] : PROCESSES.filter((x) => x !== "print")) {
    if (!PROCESSES.includes(p)) usage(`unknown process ${p}; one of ${USAGE_PROCESSES}`);
    console.log(`${p}:`);
    for (const line of describeSettings(p)) console.log(line);
  }
  process.exit(0);
}

// The design: a project file, then flags over it.
let name, stateIn = {}, production = null;
if (designFile) {
  let text;
  try {
    text = readFileSync(designFile, "utf8");
  } catch (err) {
    usage(`can't read ${designFile}: ${err.message}`);
  }
  const parsed = parseProject(text);
  if (!parsed.ok) {
    console.error(`error [project] ${parsed.error}`);
    process.exit(1);
  }
  ({ name, production } = parsed.project);
  stateIn = parsed.state;
}

const { process: processFlag, out, json, fix, split: splitFlag, pictures, save, ...rest } = flags;
const jobFlags = {};
for (const [flag, value] of Object.entries(rest)) {
  const spec = Object.hasOwn(STATE_FLAGS, flag) ? STATE_FLAGS[flag] : null;
  if (spec) stateIn = patchState(stateIn, { [spec[0]]: spec[1](value) });
  else jobFlags[flag] = value;
}
if (processFlag && !PROCESSES.includes(processFlag)) usage(`unknown process ${processFlag}; one of ${USAGE_PROCESSES}`);
const job = normalizeJob({ ...production, process: processFlag ?? production?.process ?? "print" });
const { unknown, invalid } = applyJobFlags(job, jobFlags);
if (unknown.length) usage(`unknown flag --${unknown[0]} for ${job.process}; see: node scripts/shapemaker.mjs settings`);
if (invalid.length) usage(`bad value --${invalid[0]}=${jobFlags[invalid[0]]}; see: node scripts/shapemaker.mjs settings --process=${job.process}`);

const prod = await runJob(normalizeState(stateIn), job, { applyFixes: fix !== undefined });
if (!prod.ok) {
  console.error(`error [${prod.process}] ${prod.error}`);
  process.exit(1);
}

const split = splitFlag !== undefined && prod.process === "print"
  ? chooseSplit(prod.compiled.mesh, prod.compiled.skeleton, prod.compiled.orientation.matrix)
  : null;
if (splitFlag !== undefined && prod.process === "print" && !split) {
  console.error("error [split] no clean cut found");
  process.exit(1);
}

const files = listArtifacts(prod, { split });
const report = {
  name, process: prod.process, createdWith: VERSION,
  summary: summarize(prod),
  warnings: prod.warnings,
  fixes: prod.fixes.map((f) => f.label),
  notes: exportNotes(prod),
  state: prod.state,
  production: serializeJob(prod.job),
  files: files.map(({ name: file, group, detail }) => ({ file, group, detail })),
};

if (save) {
  mkdirSync(dirname(save), { recursive: true });
  writeFileSync(save, serializeProjectV1({ name: name ?? designStem(prod.state), state: prod.state, production: report.production }));
}

if (command === "build") {
  const dir = out ?? join("test/out", designStem(prod.state));
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const data = f.bytes();
    writeFileSync(join(dir, f.name), typeof data === "string" ? data : Buffer.from(data));
  }
  if (pictures !== undefined && prod.sheet) {
    const { sheetPictures } = await import("./lib/sheet-pictures.mjs");
    sheetPictures(prod.skeleton, prod.sheet, { openings: prod.openings }).forEach((p, i) => {
      const file = `${designStem(prod.state)}-${i + 1}.png`;
      writeFileSync(join(dir, file), p.png);
      report.files.push({ file, group: "Picture", detail: p.label });
    });
  }
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
  report.out = dir;
}

if (json !== undefined) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const line of report.summary) console.log(line);
  for (const w of report.warnings) console.log(`warning: ${w}`);
  for (const f of report.fixes) console.log(`fix available (--fix): ${f}`);
  for (const f of report.files) console.log(`${command === "build" ? "wrote" : "would write"} ${f.file}  (${f.detail})`);
  for (const n of report.notes) console.log(`note: ${n}`);
  if (report.out) console.log(`in ${report.out}`);
}
