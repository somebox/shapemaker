#!/usr/bin/env node
/**
 * Sheet (laser) samples and test cuts, headless, before the app has a UI
 * for them. For each job: one cut SVG per board, a preview SVG per board,
 * pictures of the model put together (whole, cutaway, joint close-ups), and
 * an index.html that holds it all.
 *
 * Usage: node scripts/sheet-samples.mjs [--out=DIR] [--set=all|samples|tests]
 *          [--board=falcon-a1|WxH] [--sheet=3] [--kerf=0] [--clearance=0]
 *          [--ply-clearance=0] [--only=substring] [--no-pictures]
 *
 * Samples use --board and --sheet. Test cuts carry their own boards and
 * sheets (A4 paper; a 310 × 170 mm piece of 2 mm plywood whose fit strip is
 * its own file, cut first; rerun with --ply-clearance from what it shows).
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "../src/compile.js";
import { DEFAULT_STATE } from "../src/schema.js";
import { OPENING_GENERATORS } from "../src/solid/shell.js";
import { buildSheet, boardSvg, BOARD_PROFILES } from "../src/sheet/index.js";
import { packParts } from "../src/sheet/layout.js";
import { foldTestStrip } from "../src/sheet/fold.js";
import { sheetPictures } from "./lib/sheet-pictures.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const out = args.out ?? "test/out/sheet";
const set = args.set ?? "all";
const pictures = args["no-pictures"] === undefined;
const boardOf = (id) =>
  BOARD_PROFILES[id] ??
  (() => {
    const [w, h] = id.split("x").map(Number);
    if (!(w > 0 && h > 0)) throw new Error(`Unknown board ${id}`);
    return { label: `${w} × ${h} mm`, w, h };
  })();
const sampleBoard = boardOf(args.board ?? "falcon-a1");
const common = {
  sheetMm: Number(args.sheet ?? 3),
  kerfMm: Number(args.kerf ?? 0),
  clearanceMm: Number(args.clearance ?? 0),
};

const presetFile = JSON.parse(readFileSync(new URL("../presets.json", import.meta.url), "utf8"));
const presetList = presetFile.presets ?? presetFile;
const preset = (id) => {
  const p = (Array.isArray(presetList) ? presetList : Object.values(presetList)).find((x) => (x.id ?? x.name) === id);
  if (!p) throw new Error(`No preset ${id}`);
  return p.state;
};

const closed = { openings: false };
const SAMPLES = [
  // Cut: rigid sheet
  { slug: "icosidodeca-clips", state: { base: "icosidodeca", circumdiameterMm: 200 }, mode: "cut", join: "clips" },
  { slug: "icosidodeca-ties", state: { base: "icosidodeca", circumdiameterMm: 200 }, mode: "cut", join: "ties" },
  { slug: "dodecahedron-clips", state: { base: "dodecahedron", circumdiameterMm: 160, ...closed }, mode: "cut", join: "clips" },
  { slug: "cube-tabs", state: { base: "cube", circumdiameterMm: 140, ...closed }, mode: "cut", join: "tabs" },
  { slug: "octahedron-tabs", state: { base: "octahedron", circumdiameterMm: 160, ...closed }, mode: "cut", join: "tabs" },
  { slug: "rhombic-triaconta-clips", state: { base: "rhombictriaconta", circumdiameterMm: 200, openingStyle: "ellipse", borderFraction: 0.3 }, mode: "cut", join: "clips" },
  { slug: "stella-octangula-clips", state: { ...preset("stella-octangula"), circumdiameterMm: 200, ...closed }, mode: "cut", join: "clips" },
  { slug: "spiked-icosa-clips", state: { base: "icosahedron", spike: 1.5, circumdiameterMm: 220, ...closed }, mode: "cut", join: "clips" },
  { slug: "ring-lantern-ties", state: { ...preset("ring-lantern"), circumdiameterMm: 220 }, mode: "cut", join: "ties" },
  { slug: "geodesic-80-ties", state: { base: "icosahedron", subdiv: 1, soften: 1, circumdiameterMm: 220, ...closed }, mode: "cut", join: "ties" },
  // Fold: thin stock
  { slug: "icosahedron-net-flaps", state: { base: "icosahedron", circumdiameterMm: 180, ...closed }, mode: "fold", join: "flaps" },
  { slug: "icosidodeca-net-flaps", state: { base: "icosidodeca", circumdiameterMm: 200 }, mode: "fold", join: "flaps" },
  { slug: "dodecahedron-net-tape", state: { base: "dodecahedron", circumdiameterMm: 160, ...closed }, mode: "fold", join: "tape" },
  { slug: "spiked-icosa-net-flaps", state: { base: "icosahedron", spike: 1.5, circumdiameterMm: 200, ...closed }, mode: "fold", join: "flaps" },
  { slug: "geodesic-80-felt-sew", state: { base: "icosahedron", subdiv: 1, soften: 1, circumdiameterMm: 220, ...closed }, mode: "fold", join: "sew", foldStyle: "mark" },
  { slug: "globe-net-tape", state: { base: "globe", circumdiameterMm: 200, ...closed }, mode: "fold", join: "tape" },
].map((s) => ({ ...s, board: sampleBoard, ...common, coupon: s.mode === "cut" }));

const ply = { w: 310, h: 170, label: "2 mm plywood, 310 × 170 mm" };
const TESTS = [
  {
    slug: "test-paper-dodecahedron",
    note: "A4 sheet (landscape) on the Falcon bed. Cut the fold-test strip first, on a scrap, to tune the score power: V (valley, blue layer) and M (mountain, light blue layer) should fold cleanly without cutting through; P is a perforated line on the cut layer for comparison. Then cut the net: one dodecahedron with glue flaps, sized to the sheet. Run the mark layer (edge numbers) at low power or switch it off.",
    state: { base: "dodecahedron", ...closed },
    mode: "fold",
    join: "flaps",
    board: { ...BOARD_PROFILES.a4, label: "A4 paper, landscape" },
    separate: { name: "test-paper-fold-strip", parts: [foldTestStrip()], title: "fold test strip — cut first" },
    fit: { boards: 1, nets: 1 },
    marginMm: 6,
  },
  {
    slug: "test-ply-dodecahedron-clips",
    note: "2 mm plywood, 310 × 170 mm. Cut the fit strip file first: it sits in a corner the model leaves free, so the piece stays usable. Push the key into each slot; the label of the snuggest slot that still takes it by hand is your clearance in tenths. Rerun with --ply-clearance=<that>/10 (e.g. -0.1) if it isn't 0, then cut the model file without moving the piece: the layout stays the same.",
    state: { base: "dodecahedron", ...closed },
    mode: "cut",
    join: "clips",
    board: ply,
    sheetMm: 2,
    kerfMm: 0,
    clearanceMm: Number(args["ply-clearance"] ?? 0),
    couponFirst: true,
    fit: { boards: 1 },
    marginMm: 3,
    gapMm: 1.5,
  },
  {
    slug: "test-ply-octahedron-tabs",
    note: "Alternative for the same plywood piece: an octahedron with tab-and-slot joints (109.5°, about 0.7 mm of play at 2 mm). Same fit-strip procedure.",
    state: { base: "octahedron", ...closed },
    mode: "cut",
    join: "tabs",
    board: ply,
    sheetMm: 2,
    kerfMm: 0,
    clearanceMm: Number(args["ply-clearance"] ?? 0),
    couponFirst: true,
    fit: { boards: 1 },
    marginMm: 3,
    gapMm: 1.5,
  },
];

const jobs = [...(set === "samples" ? [] : TESTS), ...(set === "tests" ? [] : SAMPLES)];

function openingsFor(state) {
  return state.openings
    ? { generator: OPENING_GENERATORS[state.openingStyle], borderFraction: state.borderFraction ?? 0.36, filletMm: state.filletMm }
    : null;
}

function buildJob(job, diameter) {
  const state = { ...DEFAULT_STATE, ...job.state, depth: "hollow", roundingMm: 0, openingAxis: "center" };
  if (diameter) state.circumdiameterMm = diameter;
  const r = compile(state);
  if (!r.skeleton) return { error: JSON.stringify(r.validation?.errors?.[0]) };
  const openings = openingsFor(state);
  const build = () =>
    buildSheet(r.skeleton, {
      mode: job.mode,
      join: job.join,
      foldStyle: job.foldStyle,
      sheetMm: job.sheetMm ?? 3,
      kerfMm: job.kerfMm ?? 0,
      clearanceMm: job.clearanceMm ?? 0,
      board: job.board,
      marginMm: job.marginMm,
      gapMm: job.gapMm,
      openings,
      coupon: job.coupon || job.couponFirst,
      extraParts: job.extras,
    });
  let res = build();
  // Cut joints need a wider border than a print; raise it the way the
  // app's "fix" would, and say so.
  const need = res.stats.minBorderFraction;
  if (openings && need > openings.borderFraction) {
    const was = openings.borderFraction;
    openings.borderFraction = Math.min(0.85, Math.ceil(need * 100) / 100);
    res = build();
    res.warnings.unshift(`Border raised from ${Math.round(was * 100)}% to ${Math.round(openings.borderFraction * 100)}% to clear the joints`);
  }
  return { r, state, res, openings };
}

/** Largest size (whole mm) whose output still fits the job's limits. */
function fitSize(job) {
  const ok = (d) => {
    const b = buildJob(job, d);
    return !b.error && b.res.stats.boards <= job.fit.boards && (!job.fit.nets || b.res.stats.nets <= job.fit.nets) && !b.res.warnings.some((w) => /larger than the board|no room for a flap/.test(w));
  };
  // Scan down (flaps can fail at small sizes too, so fit isn't monotonic),
  // then step back up a millimetre at a time.
  for (let d = 400; d >= 30; d -= 5) {
    if (!ok(d)) continue;
    while (d + 1 < 400 && ok(d + 1)) d++;
    return d;
  }
  return 30;
}

mkdirSync(join(out, "preview"), { recursive: true });
mkdirSync(join(out, "images"), { recursive: true });
const rows = [];
for (const job of jobs) {
  if (args.only && !job.slug.includes(args.only)) continue;
  const diameter = job.fit ? fitSize(job) : null;
  const built = buildJob(job, diameter);
  if (built.error) {
    rows.push({ slug: job.slug, error: built.error });
    continue;
  }
  const { r, state, res, openings } = built;
  const files = [];
  const write = (name, board, title) => {
    writeFileSync(join(out, `${name}.svg`), boardSvg(board, job.board, { title }));
    const preview = boardSvg(board, job.board, { title, preview: true });
    writeFileSync(join(out, "preview", `${name}.svg`), preview);
    files.push({ name, preview });
  };
  if (job.couponFirst) {
    // The fit strip shares the layout but is its own file, cut first;
    // the model file leaves its spot empty.
    const isCoupon = (it) => it.part.kind === "coupon";
    const only = (b, keep) => ({ items: b.items.filter((it) => keep(it)) });
    write(`${job.slug}-1-fit-strip`, only(res.boards[0], isCoupon), `fit strip — cut first (${job.board.label})`);
    res.boards.forEach((b, i) => write(`${job.slug}-2-model${res.boards.length > 1 ? `-b${i + 1}` : ""}`, only(b, (it) => !isCoupon(it)), `${job.slug} — model (${job.board.label})`));
  } else {
    if (job.separate) {
      const sep = packParts(job.separate.parts, job.board, { marginMm: job.marginMm, gapMm: job.gapMm });
      write(job.separate.name, sep.boards[0], `${job.separate.title} (${job.board.label})`);
    }
    res.boards.forEach((b, i) => write(`${job.slug}-b${i + 1}of${res.boards.length}`, b, `${job.slug} — board ${i + 1} of ${res.boards.length} (${job.board.label})`));
  }
  const pics = [];
  if (pictures) {
    sheetPictures(r.skeleton, res, { openings }).forEach((p, i) => {
      const file = `images/${job.slug}-${i + 1}.png`;
      writeFileSync(join(out, file), p.png);
      pics.push({ label: p.label, file, png: p.png });
    });
  }
  rows.push({ ...job, diameter: state.circumdiameterMm, stats: res.stats, warnings: res.warnings, files, pics });
  console.log(
    `${job.slug.padEnd(30)} ${job.mode} ${job.join.padEnd(6)} ⌀${state.circumdiameterMm} mm  boards ${res.stats.boards}  ` +
      (job.mode === "cut"
        ? `panels ${res.stats.panels} clips ${JSON.stringify(res.stats.clips)} ties ${res.stats.ties} tabs ${res.stats.tabs}`
        : `nets ${res.stats.nets} folds ${res.stats.folds} open ${res.stats.openEdges}`) +
      (res.warnings.length ? `\n    ! ${res.warnings.join("\n    ! ")}` : ""),
  );
}

const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const b64 = (buf) => Buffer.from(buf).toString("base64");
const summary = (r) =>
  r.mode === "cut"
    ? `${r.stats.panels} panels · ${Object.entries(r.stats.clips).map(([k, n]) => `${n} clips ${k}`).join(", ") || ""}${r.stats.ties ? `${r.stats.ties} ties` : ""}${r.stats.tabs ? `${r.stats.tabs} tabs` : ""} · ${r.stats.boards} board(s) · edges ${r.stats.dihedralDeg.map((d) => d.toFixed(1)).join("–")}°`
    : `${r.stats.panels} faces · ${r.stats.nets} net(s) · ${r.stats.folds} folds · ${r.stats.openEdges} open edges · ${r.stats.boards} sheet(s)`;
const section = (r) =>
  r.error
    ? `<h2>${esc(r.slug)}</h2><p class="warn">Did not build: ${esc(r.error)}</p>`
    : `<h2 id="${r.slug}">${esc(r.slug)}</h2>
<div class="meta">${r.mode} · ${r.join} · ⌀ ${r.diameter} mm · ${esc(r.board.label)} · ${r.mode === "cut" ? `${r.sheetMm ?? 3} mm sheet · ` : ""}${esc(summary(r))}</div>
${r.note ? `<p class="note">${esc(r.note)}</p>` : ""}${r.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("")}
<div class="pics">${r.pics.map((p) => `<figure><img src="data:image/png;base64,${b64(p.png)}" alt="${esc(p.label)}"><figcaption>${esc(p.label)}</figcaption></figure>`).join("")}</div>
<div class="boards">${r.files.map((f) => `<figure><a href="${f.name}.svg"><img src="data:image/svg+xml;base64,${b64(f.preview)}" alt="${f.name}"></a><figcaption>${f.name}.svg</figcaption></figure>`).join("")}</div>`;
const tests = rows.filter((r) => r.slug.startsWith("test-")), samples = rows.filter((r) => !r.slug.startsWith("test-"));
const html = `<!doctype html><meta charset="utf-8"><title>Shapemaker sheet samples</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;max-width:1240px;color:#222;background:#fff}
h1{font-size:22px}h2{font-size:17px;margin:34px 0 4px;border-top:1px solid #ddd;padding-top:18px}
.meta{color:#555}.warn{color:#8a4b00}.note{background:#f4f1e8;padding:8px 12px;border-radius:6px;max-width:900px}
.pics,.boards{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}figure{margin:0}figcaption{font-size:12px;color:#666}
.pics img{height:230px;border:1px solid #e5e5e5}.boards img{width:380px;border:1px solid #ddd;background:#fff}
nav a{margin-right:10px}</style>
<h1>Shapemaker sheet output — samples and test cuts</h1>
<p class="meta">Cut-file colours: red cut · black engrave (labels, on the model's inside) · blue valley fold · light blue mountain fold (as seen on the sheet).
Panels are drawn as seen from inside. Click a board for its cut file. Previews add a board outline and thicker lines; cut files have neither.</p>
<nav>${rows.map((r) => `<a href="#${r.slug}">${esc(r.slug)}</a>`).join("")}</nav>
${tests.length ? `<h1 style="margin-top:28px">Test cuts</h1>${tests.map(section).join("\n")}` : ""}
${samples.length ? `<h1 style="margin-top:28px">Samples (${esc(sampleBoard.label)}, ${common.sheetMm} mm sheet)</h1>${samples.map(section).join("\n")}` : ""}`;
writeFileSync(join(out, "index.html"), html);
writeFileSync(join(out, "summary.json"), JSON.stringify(rows.map((r) => ({ ...r, files: r.files?.map((f) => f.name), pics: r.pics?.map((p) => p.file), extras: undefined, board: r.board })), null, 2));
console.log(`\nWrote ${out}/index.html`);
