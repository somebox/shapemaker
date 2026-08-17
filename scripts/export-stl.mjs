#!/usr/bin/env node
/**
 * Headless STL export — the same compile() + export/stl.js path the browser
 * uses, which is what lets acceptance run without a WebGL context.
 *
 * Usage: node scripts/export-stl.mjs <outfile> [--wall=1.4] [--border=3.2]
 *          [--fillet=4.5] [--edge-div=10] [--diameter=100] [--face=N]
 *          [--openings=true|false] [--depth=hollow|solid] [--base=icosidodeca]
 *          [--seed=N] [--jitter=N] [--jitter-mode=surface|radial|both]
 *          [--subdiv=0|1|2] [--soften=0..100] [--points=N] [--separation=N]
 *          [--rounding-mm=0] [--spike=0..4] [--split]
 *
 * `--split` is a script flag (not a state key): writes two half-STLs next to
 * the outfile stem (`stem_half-a.stl`, `stem_half-b.stl`).
 */
import { writeFileSync } from "node:fs";
import { compile } from "../src/compile.js";
import { writeBinaryStl } from "../src/export/stl.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { DEFAULT_STATE } from "../src/schema.js";
import {
  chooseSplit,
  halfExportMatrices,
} from "../src/split.js";

const kebab = (k) => k.replace(/([A-Z])/g, "-$1").toLowerCase();
const castFor = (dflt) =>
  typeof dflt === "boolean"
    ? (v) => v !== "0" && v !== "false"
    : typeof dflt === "number"
    ? Number
    : String;
const FLAGS = {};
for (const [key, dflt] of Object.entries(DEFAULT_STATE)) {
  if (dflt === null || dflt === undefined) continue;
  FLAGS[kebab(key)] = [key, castFor(dflt)];
}
// Constant-mm border is optional (legacy / acceptance fits) — not in defaults.
FLAGS["border-mm"] = ["borderMm", Number];
FLAGS["border-fraction"] = ["borderFraction", Number];
Object.assign(FLAGS, {
  wall: FLAGS["wall-mm"],
  // `--border=N` keeps meaning millimetres for acceptance / scripts.
  border: FLAGS["border-mm"],
  fillet: FLAGS["fillet-mm"],
  diameter: FLAGS["circumdiameter-mm"],
  face: FLAGS["face-index"],
});

const args = process.argv.slice(2);
let outfile = null;
let doSplit = false;
const opts = {};
for (const a of args) {
  if (!a.startsWith("--")) {
    outfile = a;
    continue;
  }
  // Script flags (not schema state keys) — handle before FLAGS lookup.
  // Accept both the bare and the house-style --split=true forms.
  if (a === "--split" || a.startsWith("--split=")) {
    const v = a.includes("=") ? a.split("=")[1] : "true";
    doSplit = v !== "0" && v !== "false";
    continue;
  }
  const [k, v] = a.slice(2).split("=");
  const spec = FLAGS[k];
  if (!spec) {
    console.error(`unknown flag --${k}; known: ${Object.keys(FLAGS).join(", ")}, split`);
    process.exit(2);
  }
  const [key, cast] = spec;
  opts[key] = cast(v);
}
if (!outfile) {
  console.error("usage: node scripts/export-stl.mjs <outfile> [--flag=value ...] [--split]");
  process.exit(2);
}

clearPipelineCache();
const result = compile(opts);

for (const w of result.validation.warnings) {
  console.warn(`warning [${w.stage}.${w.key}] ${w.message}`);
}
if (!result.validation.ok) {
  for (const e of result.validation.errors) {
    console.error(`error [${e.stage}${e.key ? "." + e.key : ""}] ${e.message}`);
  }
  process.exit(1);
}

if (!doSplit) {
  const buf = writeBinaryStl(result.mesh, {
    header: `shapemaker_${result.state.circumdiameterMm}mm`,
    matrix: result.orientation.matrix,
  });
  writeFileSync(outfile, Buffer.from(buf));
  const m = result.metrics;
  console.log(`wrote ${outfile}  (${m.triangleCount} tris, ${m.volumeCm3.toFixed(3)} cm³)`);
  process.exit(0);
}

const chosen = chooseSplit(
  result.mesh,
  result.skeleton,
  result.orientation.matrix,
);
if (!chosen) {
  console.error("error [split] no clean cut found");
  process.exit(1);
}
const { a, b, planeZ, volumeMm3A, volumeMm3B } = chosen;
const { matrixA, matrixB } = halfExportMatrices(planeZ);

const stem = outfile.replace(/\.stl$/i, "");
const pathA = `${stem}_half-a.stl`;
const pathB = `${stem}_half-b.stl`;

writeFileSync(
  pathA,
  Buffer.from(writeBinaryStl(a, {
    header: `shapemaker_${stem}_half-a`,
    matrix: matrixA,
  })),
);
writeFileSync(
  pathB,
  Buffer.from(writeBinaryStl(b, {
    header: `shapemaker_${stem}_half-b`,
    matrix: matrixB,
  })),
);
console.log(
  `wrote ${pathA} + ${pathB}  (plane z=${planeZ.toFixed(4)} mm; ` +
  `A ${a.indices.length / 3} tris ${(volumeMm3A / 1000).toFixed(3)} cm³; ` +
  `B ${b.indices.length / 3} tris ${(volumeMm3B / 1000).toFixed(3)} cm³)`,
);
