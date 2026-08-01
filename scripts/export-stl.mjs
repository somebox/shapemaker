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
 */
import { writeFileSync } from "node:fs";
import { compile } from "../src/compile.js";
import { writeBinaryStl } from "../src/export/stl.js";
import { clearPipelineCache } from "../src/pipeline.js";
import { DEFAULT_STATE } from "../src/schema.js";

/**
 * flag → state key, derived from the canonical schema so every new state
 * key is immediately settable headlessly (a hand-maintained list here let
 * jitterMode/subdiv/soften ship unsettable). Casts come from the default's
 * type. Unknown flags are an error: a silent typo in the acceptance harness
 * would test the defaults and report a false pass.
 */
const kebab = (k) => k.replace(/([A-Z])/g, "-$1").toLowerCase();
const castFor = (dflt) =>
  typeof dflt === "boolean"
    ? (v) => v !== "0" && v !== "false"
    : typeof dflt === "number"
      ? Number
      : String;
const FLAGS = {};
for (const [key, dflt] of Object.entries(DEFAULT_STATE)) {
  FLAGS[kebab(key)] = [key, castFor(dflt)];
}
// Legacy short aliases (documented usage + existing callers).
Object.assign(FLAGS, {
  wall: FLAGS["wall-mm"],
  border: FLAGS["border-mm"],
  fillet: FLAGS["fillet-mm"],
  diameter: FLAGS["circumdiameter-mm"],
  face: FLAGS["face-index"],
});

const args = process.argv.slice(2);
let outfile = null;
const opts = {};
for (const a of args) {
  if (!a.startsWith("--")) {
    outfile = a;
    continue;
  }
  const [k, v] = a.slice(2).split("=");
  const spec = FLAGS[k];
  if (!spec) {
    console.error(`unknown flag --${k}; known: ${Object.keys(FLAGS).join(", ")}`);
    process.exit(2);
  }
  const [key, cast] = spec;
  opts[key] = cast(v);
}
if (!outfile) {
  console.error("usage: node scripts/export-stl.mjs <outfile> [--flag=value ...]");
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

const buf = writeBinaryStl(result.mesh, {
  header: `shapemaker_${result.state.circumdiameterMm}mm`,
  matrix: result.orientation.matrix,
});
writeFileSync(outfile, Buffer.from(buf));
const m = result.metrics;
console.log(`wrote ${outfile}  (${m.triangleCount} tris, ${m.volumeCm3.toFixed(3)} cm³)`);
