#!/usr/bin/env node
/**
 * Builds every design in docs/examples/ the way the CLI does, and writes one
 * page to look at them: pictures of the model put together, then each board.
 *
 * Usage: node scripts/build-examples.mjs [--out=DIR] [--only=substring] [--no-pictures]
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProject } from "../src/project-format.js";
import { runJob, summarize, listArtifacts, exportNotes } from "../src/production/index.js";
import { sheetPictures } from "./lib/sheet-pictures.mjs";
import { parseArgs } from "./lib/flags.mjs";

const { flags } = parseArgs(process.argv.slice(2));
const out = flags.out ?? "test/out/examples";
const root = fileURLToPath(new URL("../docs/examples/", import.meta.url));
const designs = readdirSync(root, { recursive: true })
  .filter((f) => f.endsWith(".shapemaker.json") && (!flags.only || f.includes(flags.only)))
  .sort();

const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const b64 = (data) => Buffer.from(data).toString("base64");
const sections = [];
let failed = 0;

for (const file of designs) {
  const slug = basename(file, ".shapemaker.json");
  const parsed = parseProject(readFileSync(join(root, file), "utf8"));
  const prod = parsed.ok ? await runJob(parsed.state, parsed.project.production, { applyFixes: true }) : { ok: false, error: parsed.error };
  if (!prod.ok) {
    failed++;
    console.error(`${slug}: ${prod.error}`);
    sections.push(`<h2>${esc(slug)}</h2><p class="warn">Did not build: ${esc(prod.error)}</p>`);
    continue;
  }
  const dir = join(out, slug);
  mkdirSync(dir, { recursive: true });
  const files = listArtifacts(prod);
  for (const f of files) {
    const data = f.bytes();
    writeFileSync(join(dir, f.name), typeof data === "string" ? data : Buffer.from(data));
  }
  const pics = prod.sheet && flags["no-pictures"] === undefined ? sheetPictures(prod.skeleton, prod.sheet, { openings: prod.openings }) : [];
  pics.forEach((p, i) => writeFileSync(join(dir, `${i + 1}.png`), p.png));
  console.log(`${slug.padEnd(34)} ${summarize(prod)[0]}${prod.warnings.length ? `\n    ! ${prod.warnings.join("\n    ! ")}` : ""}`);
  const stats = summarize(prod).map(esc).join("<br>");
  sections.push(`<h2 id="${slug}">${esc(parsed.project.name)}</h2>
<p class="meta">${stats}</p>
${[...prod.warnings.map((w) => `<div class="warn">${esc(w)}</div>`), ...exportNotes(prod).map((n) => `<p class="note">${esc(n)}</p>`)].join("")}
<div class="pics">${pics.map((p) => `<figure><img src="data:image/png;base64,${b64(p.png)}" alt="${esc(p.label)}"><figcaption>${esc(p.label)}</figcaption></figure>`).join("")}</div>
<div class="boards">${files.filter((f) => f.preview).map((f) => `<figure><a href="${slug}/${f.name}"><img src="data:image/svg+xml;base64,${b64(f.preview())}" alt="${esc(f.name)}"></a><figcaption>${esc(f.name)}</figcaption></figure>`).join("")}</div>`);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Shapemaker examples</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;max-width:1240px;color:#222;background:#fff}
h1{font-size:22px}h2{font-size:17px;margin:34px 0 4px;border-top:1px solid #ddd;padding-top:18px}
.meta{color:#555;margin:0}.warn{color:#8a4b00}.note{background:#f4f1e8;padding:8px 12px;border-radius:6px;max-width:900px}
.pics,.boards{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}figure{margin:0}figcaption{font-size:12px;color:#666}
.pics img{height:230px;border:1px solid #e5e5e5}.boards img{width:380px;border:1px solid #ddd;background:#fff}</style>
<h1>Shapemaker examples</h1>
<p class="meta">Cut-file colours: red cut · black engrave · blue valley fold · light blue mountain fold. Parts are drawn as seen from inside. Click a board for its cut file.</p>
${sections.join("\n")}`);
console.log(`\nWrote ${out}/index.html`);
process.exit(failed ? 1 : 0);
