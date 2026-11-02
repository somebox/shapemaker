import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, compileShape } from "../src/compile.js";
import { DEFAULT_STATE, PRINT_KEYS } from "../src/schema.js";
import { parseProject, serializeProjectV1 } from "../src/project-format.js";
import { boardSvg } from "../src/sheet/index.js";
import { pointInPoly } from "../src/sheet/geom2.js";
import {
  JOB_DEFS, PROCESSES, normalizeJob, serializeJob, settingApplies, produce, finishProduction, runJob,
  listArtifacts, pinnedArtifacts, sheetViews, summarize, headline, exportNotes, designStem, sheetOptions, validSetting,
} from "../src/production/index.js";
import { restoreSessionFromPopstate, sessionHistoryPayload } from "../src/session.js";
import { boundingSphere } from "../scripts/lib/render3d.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const closed = { openings: false };
const dodeca = { base: "dodecahedron", circumdiameterMm: 160, ...closed };

describe("compileShape", () => {
  const states = [
    {},
    { base: "cube", circumdiameterMm: 80 },
    { base: "icosahedron", subdiv: 1, soften: 1 },
    { base: "octahedron", spike: 1.2 },
    { base: "globe", jitter: 3 },
    { base: "random", seed: 7, dual: true },
  ];

  it("builds the skeleton compile() builds", () => {
    for (const s of states) {
      const a = compile(s), b = compileShape(s);
      assert.deepEqual(b.skeleton.positions, a.skeleton.positions);
      assert.deepEqual(b.skeleton.faces, a.skeleton.faces);
      assert.equal(b.state.faceIndex, a.state.faceIndex);
    }
  });

  it("ignores what only the printed shell reads", () => {
    const shell = { wallMm: 0, roundingMm: 500, depth: "nonsense", edgeDiv: 0, openingAxis: "through" };
    assert.deepEqual(Object.keys(shell).filter((k) => !PRINT_KEYS.includes(k)), []);
    assert.equal(compile({ ...dodeca, ...shell }).validation.ok, false);
    const r = compileShape({ ...dodeca, ...shell });
    assert.equal(r.validation.ok, true);
    assert.equal(r.skeleton.faces.length, 12);
  });

  it("reports bad shapes as validation, not a throw", () => {
    const r = compileShape({ base: "nothing" });
    assert.equal(r.validation.ok, false);
    assert.equal(r.skeleton, null);
    assert.ok(compileShape({ base: "cube", circumdiameterMm: -1 }).validation.errors.length);
  });
});

describe("jobs", () => {
  it("every default is a value its own definition accepts", () => {
    for (const p of PROCESSES) for (const def of JOB_DEFS[p]) assert.ok(validSetting(def, def.default), `${p}.${def.key}`);
  });

  it("fills in anything missing or invalid", () => {
    const job = normalizeJob({
      process: "cut",
      cut: { sheetMm: 99, join: "staples", clipsPerEdge: 2, board: "nope", boardSize: { w: 1, h: 2 } },
      fold: "garbage",
    });
    assert.equal(job.process, "cut");
    assert.equal(job.cut.sheetMm, 3);
    assert.equal(job.cut.join, "clips");
    assert.equal(job.cut.clipsPerEdge, 2);
    assert.equal(job.cut.board, "falcon-a1");
    assert.deepEqual(job.cut.boardSize, { w: 300, h: 200 });
    assert.equal(job.fold.join, "tape");
    assert.equal(normalizeJob(undefined).process, "print");
    assert.equal(normalizeJob({ process: "laser" }).process, "print");
    assert.equal(normalizeJob({ cut: { board: "constructor" } }).cut.board, "falcon-a1");
  });

  it("writes its own process in full and the others' differences, and reads back the same", () => {
    assert.deepEqual(serializeJob(normalizeJob({ process: "print" })), { process: "print" });
    const job = normalizeJob({ process: "fold", cut: { sheetMm: 4 }, fold: { join: "sew", seamMm: 8, board: "custom", boardSize: { w: 500, h: 300 } } });
    const saved = serializeJob(job);
    assert.deepEqual(saved.cut, { sheetMm: 4 });
    assert.deepEqual(Object.keys(saved.fold).sort(), JOB_DEFS.fold.map((d) => d.key).sort());
    assert.equal(saved.fold.seamMm, 8);
    assert.deepEqual(normalizeJob(saved), job);
  });

  it("keeps a saved design's settings when a default later changes", () => {
    const saved = serializeJob(normalizeJob({ process: "cut", cut: { clipsBy: "print", clipPlace: "corners" } }));
    assert.equal(saved.cut.weld, false);
  });

  it("gives every setting with a panel row a group, and hides rows that don't apply", () => {
    const of = (p, key) => JOB_DEFS[p].find((d) => d.key === key);
    assert.equal(settingApplies(of("fold", "seamMm"), { join: "tape" }), false);
    assert.equal(settingApplies(of("fold", "seamMm"), { join: "sew" }), true);
    assert.equal(settingApplies(of("fold", "foldStyle"), { join: "sew" }), false);
    assert.equal(settingApplies(of("cut", "clipSize"), { join: "ties" }), false);
    assert.equal(settingApplies(of("cut", "weld"), { join: "clips", clipsBy: "print", clipPlace: "middle" }), false);
    assert.equal(settingApplies(of("cut", "weld"), { join: "clips", clipsBy: "print", clipPlace: "corners" }), true);
  });

  it("offers Fit in the fit strip's own numbers", () => {
    const fit = JOB_DEFS.cut.find((d) => d.key === "clearanceMm");
    assert.deepEqual(fit.options.map(([v]) => v), [-0.2, -0.1, 0, 0.1, 0.2]);
  });

  it("passes every setting of a process through to the engine", () => {
    const shape = compileShape(dodeca);
    for (const process of ["cut", "fold"]) {
      const opts = sheetOptions(normalizeJob({ process }), shape.state);
      for (const def of JOB_DEFS[process]) assert.ok(def.key in opts, def.key);
    }
  });

  it("travels in a project file without touching the shape", () => {
    const production = serializeJob(normalizeJob({ process: "cut", cut: { join: "ties" } }));
    const parsed = parseProject(serializeProjectV1({ name: "x", state: { ...DEFAULT_STATE }, production }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.project.production, production);
    const plain = parseProject(serializeProjectV1({ name: "x", state: { ...DEFAULT_STATE } }));
    assert.equal(plain.project.production, undefined);
    assert.deepEqual(parsed.state, plain.state);
  });

  it("survives Undo: each history entry remembers its project's job", () => {
    const production = { process: "cut" };
    const historyState = sessionHistoryPayload({ projectName: "A", cleanName: "A", cleanState: {}, depth: 1, production });
    const restored = restoreSessionFromPopstate({ decoded: { ok: true, state: {} }, historyState });
    assert.deepEqual(restored.production, production);
    const older = sessionHistoryPayload({ projectName: "B", cleanName: "B", cleanState: {}, depth: 0 });
    assert.equal(restoreSessionFromPopstate({ decoded: { ok: true, state: {} }, historyState: older }).production, null);
  });
});

describe("saved settings", () => {
  it("fall back from a board or bed that isn't a name, rather than throw", () => {
    const job = normalizeJob({ cut: { board: { toString: null }, printBed: { toString: null } } });
    assert.equal(job.cut.board, normalizeJob({}).cut.board);
    assert.equal(job.cut.printBed, normalizeJob({}).cut.printBed);
  });
});

describe("produce", () => {
  it("plans cut and fold from the shape alone", () => {
    const shape = compileShape(dodeca);
    const cut = produce(shape, { process: "cut" }), fold = produce(shape, { process: "fold", fold: { join: "sew" } });
    assert.equal(cut.ok && fold.ok, true);
    assert.equal(cut.sheet.stats.panels, 12);
    assert.equal(fold.sheet.stats.seams + fold.sheet.stats.darts + fold.sheet.stats.folds, 30);
  });

  it("never throws: no skeleton, or print without a shell, come back as errors", () => {
    assert.equal(produce({ skeleton: null, state: {} }, { process: "cut" }).ok, false);
    assert.equal(produce({}, { process: "cut" }).ok, false);
    assert.match(produce(compileShape(dodeca), { process: "print" }).error, /shell/);
  });

  it("says so when a border in mm can't apply to sheet openings", () => {
    const prod = produce(compileShape({ base: "dodecahedron", circumdiameterMm: 200, borderMm: 12 }), { process: "fold" });
    assert.match(prod.warnings[0], /millimetres/);
    assert.equal(prod.problems[0].key, "borderMm");
  });

  it("keys each warning to what it's about", () => {
    const prod = produce(compileShape(dodeca), { process: "cut", cut: { board: "custom", boardSize: { w: 50, h: 50 } } });
    const oversize = prod.problems.find((p) => /larger than the board/.test(p.message));
    assert.equal(oversize.key, "sheet");
    assert.deepEqual(prod.warnings, prod.problems.map((p) => p.message));
  });

  it("passes on the shape's own warnings, but not the shell's", () => {
    const prod = produce(compileShape({ ...dodeca, faceIndex: 99 }), { process: "fold" });
    assert.match(prod.warnings[0], /Resting face 99/);
    const thin = compile({ base: "icosahedron", subdiv: 2, circumdiameterMm: 40 });
    assert.ok(thin.validation.warnings.length);
    assert.equal(produce(thin, { process: "fold" }).warnings.some((w) => /print|Border/i.test(w) && thin.validation.warnings.some((x) => x.message === w)), false);
  });

  it("marks sewn stock instead of scoring it", () => {
    const prod = produce(compileShape(dodeca), { process: "fold", fold: { join: "sew", foldStyle: "score" } });
    const layers = new Set(prod.sheet.parts.flatMap((p) => p.paths.map((x) => x.layer)));
    assert.equal(layers.has("valley") || layers.has("mountain"), false);
  });

  it("offers the Border that opens closed faces, and runJob can take it", async () => {
    const state = { base: "icosidodeca", circumdiameterMm: 200 };
    const plain = produce(compileShape(state), { process: "cut" });
    assert.equal(plain.fixes.length, 1);
    assert.ok(plain.sheet.stats.filledPanels > 0);
    const fixed = await runJob(state, { process: "cut" }, { applyFixes: true });
    assert.equal(fixed.sheet.stats.filledPanels, 0);
    assert.equal(fixed.fixes.length, 0);
  });

  it("closes faces whose whip-stitch holes would fall in their openings", async () => {
    const state = { base: "cube", circumdiameterMm: 100, borderFraction: 0.05, filletMm: 0 };
    const job = { process: "fold", fold: { join: "sew", board: "custom", boardSize: { w: 68, h: 68 }, marginMm: 5 } };
    const prod = produce(compileShape(state), job);
    assert.equal(prod.sheet.stats.whipStitched, 12);
    assert.equal(prod.sheet.filledFaces.length, 6);
    assert.match(prod.warnings[0], /6 faces stay closed/);
    assert.equal(prod.fixes.length, 1);
    const openings = (p) => p.sheet.parts.flatMap((part) => part.paths).filter((x) => x.layer === "cut" && x.closed && x.pts.length !== 16);
    assert.equal(openings(prod).length, 0);
    const fixed = await runJob(state, job, { applyFixes: true });
    assert.deepEqual(fixed.sheet.filledFaces, []);
    assert.equal(openings(fixed).length, 6);
    assert.deepEqual(fixed.fixes, []);
  });

  it("offers no fix when no Border can open the faces", () => {
    const prod = produce(compileShape({}), { process: "cut" });
    assert.ok(prod.sheet.stats.filledPanels > 0);
    assert.deepEqual(prod.fixes, []);
  });

  it("warns on the status when welding fails and the clips stay loose", async (t) => {
    t.mock.method(console, "error", () => {});
    const shape = compileShape({ base: "octahedron", spike: 1, circumdiameterMm: 200, ...closed });
    const cut = { clipsBy: "print", clipPlace: "corners", clipSize: "large", clipWidthMm: 6, weld: true };
    const prod = { ...produce(shape, { process: "cut", cut }), skeleton: null };
    const done = await finishProduction(prod);
    assert.ok(done.weld.error);
    assert.match(done.warnings.at(-1), /loose clips/);
    assert.equal(done.problems.at(-1).key, "sheet");
    assert.equal(prod.warnings.some((w) => /loose clips/.test(w)), false);
  });

  it("welds printed corner clips as a later step, on a new production", async () => {
    const shape = compileShape({ base: "octahedron", spike: 1, circumdiameterMm: 200, ...closed });
    const cut = { clipsBy: "print", clipPlace: "corners", clipSize: "large", clipWidthMm: 6 };
    assert.equal(produce(shape, { process: "cut", cut }).weld, null, "Weld is off until asked for");
    const prod = produce(shape, { process: "cut", cut: { ...cut, weld: true } });
    assert.equal(prod.weld.pending, true);
    assert.match(summarize(prod)[1], /welding corners/);
    assert.equal(listArtifacts(prod).some((f) => f.name.endsWith(".stl")), false);
    const done = await finishProduction(prod);
    assert.notEqual(done, prod);
    assert.ok(done.weld.pieces > 0);
    assert.equal(prod.weld.pending, true);
    assert.ok(sheetViews(done).some((v) => v.id === "corners"));
    assert.ok(listArtifacts(done).some((f) => f.name.endsWith("_corners.stl")));
    assert.equal(await finishProduction(done), done);
  });
});

describe("artifacts", () => {
  it("names every file uniquely and gives each one bytes", async () => {
    for (const job of [{ process: "cut" }, { process: "fold", fold: { join: "flaps" } }, { process: "print" }, { process: "cut", cut: { clipsBy: "print" } }]) {
      const prod = await runJob({ base: "icosidodeca", circumdiameterMm: 200 }, job);
      const files = listArtifacts(prod);
      assert.ok(files.length >= 2);
      assert.equal(new Set(files.map((f) => f.name)).size, files.length);
      for (const f of files) {
        const data = f.bytes();
        assert.ok((data.length ?? data.byteLength) > 100, f.name);
        assert.match(f.name, new RegExp(`^${designStem(prod.state)}`));
      }
    }
  });

  it("pins files to one cut, and takes the view only at download", async () => {
    const prod = await runJob(dodeca, { process: "print" });
    const { mesh } = prod.compiled;
    let views = 0;
    const view = () => {
      views++;
      return { position: { x: 300, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, near: 1 };
    };
    const files = pinnedArtifacts(prod, { split: { a: mesh, b: mesh, planeZ: 10 }, view });
    assert.deepEqual(files.map((f) => f.id), ["half-a", "half-b", "drawing"]);
    assert.equal(views, 0);
    const half = files[1].atDownload();
    assert.equal(half.id, "half-b");
    assert.equal(views, 1);
    assert.equal(half.bytes().byteLength, files[1].bytes().byteLength);
    assert.match(files[2].atDownload().bytes(), /<svg/);
  });

  it("gives the score strip a scrap when the board can't hold it", () => {
    const prod = produce(compileShape({ base: "cube", circumdiameterMm: 40, ...closed }), { process: "fold", fold: { board: "custom", boardSize: { w: 50, h: 50 }, foldStyle: "score" } });
    const strip = listArtifacts(prod).find((f) => f.id === "fold-strip");
    const [, w, h] = strip.thumb().match(/viewBox="0 0 (\S+) (\S+)"/).map(Number);
    assert.deepEqual([w, h], [100, 50]);
    const top = strip.thumb().match(/ d="([^"]*)"/)[1].match(/-?[\d.]+/g).map(Number);
    assert.ok(top.every((n) => n >= 0 && n <= 100));
  });

  it("sizes the fit strip for a printed clip's tab, and has it stand in for the key", async () => {
    const { state, project } = parseProject(readFileSync(join(root, "docs/examples/cut-spiked-octahedron-printed-corners.shapemaker.json"), "utf8"));
    const prod = await runJob(state, project.production, { applyFixes: true });
    const { w, c, tw } = prod.sheet.dims;
    const strip = prod.sheet.parts.find((p) => p.kind === "coupon");
    const rects = strip.paths.filter((p) => p.closed && p.layer === "cut" && p.pts.length === 4).slice(1);
    assert.equal(rects.length, 5, "five slots, no key");
    for (const r of rects) assert.ok(Math.abs(r.pts[2][1] - r.pts[0][1]) >= w + c - 1e-6);
    assert.ok(Math.abs(rects[2].pts[1][0] - rects[2].pts[0][0] - tw) < 0.5);
    assert.match(exportNotes(prod)[0], /printed clip's tab/);
    assert.match(listArtifacts(prod)[0].detail, /printed clip's tab/);
  });

  it("keeps the key for sheet clips", () => {
    const prod = produce(compileShape(dodeca), { process: "cut" });
    const strip = prod.sheet.parts.find((p) => p.kind === "coupon");
    assert.equal(strip.paths.filter((p) => p.closed && p.layer === "cut" && p.pts.length === 4).length, 7);
    assert.match(exportNotes(prod)[0], /push the key/);
  });

  it("draws a fold net's open outline in its thumbnail", () => {
    const prod = produce(compileShape(dodeca), { process: "fold" });
    const drawn = listArtifacts(prod).filter((f) => f.id.startsWith("board")).map((f) => f.thumb().match(/ d="([^"]*)"/)[1]).join("");
    const opens = prod.sheet.parts.flatMap((p) => p.paths).filter((p) => p.layer === "cut" && !p.closed).length;
    assert.ok(opens > 0);
    assert.equal(drawn.split("M").length - 1, opens);
  });

  it("makes the fit strip its own first file, and leaves its spot empty on the board", async () => {
    const prod = await runJob(dodeca, { process: "cut" });
    const [strip, ...boards] = listArtifacts(prod);
    assert.equal(strip.id, "fit-strip");
    assert.match(strip.detail, /first/);
    assert.ok(boards.length);
    const items = prod.sheet.boards.flatMap((b) => b.items);
    const coupons = items.filter((it) => it.part.kind === "coupon");
    assert.equal(coupons.length, 1);
    const all = items.flatMap((it) => it.part.paths).length;
    const paths = (svg) => (svg.match(/<path /g) ?? []).length;
    assert.equal(boards.reduce((n, f) => n + paths(f.bytes()), 0) + paths(strip.bytes()), all);
    // The strip sits exactly where it sits on the combined board.
    assert.ok(boardSvg({ items: coupons }, prod.board, { title: `${designStem(prod.state)}_cut_clips_3mm_fit-strip` }) === strip.bytes());
  });

  it("keeps the fit strip's slots and key together, on any layout", async () => {
    for (const [state, board] of [[{ base: "globe", circumdiameterMm: 100 }, "a4"], [{ base: "rhombicenneaconta", circumdiameterMm: 100, ...closed }, "falcon-a1"]]) {
      const prod = await runJob(state, { process: "cut", cut: { board } });
      const strip = prod.sheet.boards.flatMap((b) => b.items).filter((it) => it.part.kind === "coupon");
      assert.equal(strip.length, 1);
      const [slots, ...rest] = strip[0].part.paths.filter((p) => p.layer === "cut" && p.closed);
      const key = rest.at(-1).pts;
      const inside = (q, poly) => pointInPoly(q, poly);
      assert.equal(key.some((q) => inside(q, slots.pts)), false, "the key sits clear of the strip");
    }
  });

  it("adds a score test strip where scoring is used, and only there", async () => {
    const has = async (fold) => listArtifacts(await runJob(dodeca, { process: "fold", fold })).some((f) => f.id === "fold-strip");
    assert.equal(await has({ join: "flaps" }), true);
    assert.equal(await has({ join: "flaps", foldStyle: "mark" }), false);
    assert.equal(await has({ join: "sew" }), false);
  });

  it("says what to do with the files", async () => {
    assert.match(exportNotes(await runJob(dodeca, { process: "cut" }))[0], /fit strip/);
    assert.match(exportNotes(await runJob(dodeca, { process: "fold", fold: { join: "sew" } }))[0], /ladder stitch/);
    assert.deepEqual(exportNotes(await runJob(dodeca, { process: "print" })), []);
  });

  it("lists print's shell and drawing, or the two halves of a split", async () => {
    const prod = await runJob({}, { process: "print" });
    assert.deepEqual(listArtifacts(prod).map((f) => f.id), ["shell", "drawing"]);
    const fake = { a: prod.compiled.mesh, b: prod.compiled.mesh, planeZ: 40 };
    assert.deepEqual(listArtifacts(prod, { split: fake }).map((f) => f.id), ["half-a", "half-b", "drawing"]);
  });

  it("is empty when nothing was made", () => {
    assert.deepEqual(listArtifacts({ ok: false }), []);
    assert.deepEqual(sheetViews({ ok: false }), []);
  });
});

describe("layers", () => {
  const sources = (dir) => readdirSync(join(root, dir), { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => [`${dir}/${f}`, readFileSync(join(root, dir, f), "utf8")]);

  it("keeps the engine and production free of the DOM and the viewer", () => {
    for (const [file, text] of [...sources("src/sheet"), ...sources("src/production")]) {
      assert.doesNotMatch(text.replace(/^\s*(\*|\/\/).*$/gm, ""), /\b(document|window|localStorage|location)\./, file);
      assert.doesNotMatch(text, /from ".*(viewer|main|ui|controls|sheet-mockup|flat-view)\.js"/, file);
      assert.doesNotMatch(text, /from "three"/, file);
    }
  });

  it("keeps adapters on the production API", () => {
    for (const file of ["src/sheet-mockup.js", "src/flat-view.js", "src/main.js", "scripts/shapemaker.mjs", "scripts/lib/flags.mjs", "scripts/build-examples.mjs"]) {
      assert.doesNotMatch(readFileSync(join(root, file), "utf8"), /from "[^"]*\/sheet\//, file);
    }
  });

  it("keeps the sheet engine below production", () => {
    for (const [file, text] of sources("src/sheet")) assert.doesNotMatch(text, /from ".*production\//, file);
  });

  it("keeps the shape pipeline free of production", () => {
    for (const [file, text] of [["src/compile.js", readFileSync(join(root, "src/compile.js"), "utf8")], ["src/pipeline.js", readFileSync(join(root, "src/pipeline.js"), "utf8")], ...sources("src/solid")]) {
      assert.doesNotMatch(text, /from ".*(production|sheet)\//, file);
    }
  });
});

describe("examples", () => {
  const dir = join(root, "docs/examples");
  const designs = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".shapemaker.json"));
  const open = (f) => parseProject(readFileSync(join(dir, f), "utf8"));

  it("all build, with no warning they don't expect", async () => {
    assert.ok(designs.length >= 11);
    for (const f of designs) {
      const { ok, state, project } = open(f);
      assert.equal(ok, true, f);
      const prod = await runJob(state, project.production, { applyFixes: true });
      assert.equal(prod.ok, true, f);
      assert.deepEqual(prod.warnings.filter((w) => !/glue them|ties will hinge/.test(w)), [], f);
    }
  });

  it("test cuts fit their stock", async () => {
    for (const [f, nets] of [["test-cuts/paper-dodecahedron-a4", 1], ["test-cuts/ply-dodecahedron-clips", 0], ["test-cuts/ply-octahedron-fingers", 0]]) {
      const { state, project } = open(`${f}.shapemaker.json`);
      const prod = await runJob(state, project.production);
      assert.equal(prod.sheet.stats.boards, 1, f);
      if (nets) assert.equal(prod.sheet.stats.nets, nets, f);
    }
  });

  // CI runs this on other Node versions and another CPU. A symmetric shape ties
  // everywhere, so a sort left to rounding noise shows up here as a new hash.
  // After an intended change to the output, update the hash.
  it("make the same bytes on every machine", async () => {
    const sha = createHash("sha256");
    for (const f of [...designs].sort()) {
      const { state, project } = open(f);
      const prod = await runJob(state, project.production, { applyFixes: true });
      for (const a of listArtifacts(prod)) {
        const data = a.bytes();
        sha.update(a.name).update(typeof data === "string" ? data : Buffer.from(data));
      }
    }
    assert.equal(sha.digest("hex").slice(0, 16), "03009ec8495dd259");
  });

  it("felt examples have no whip stitches", async () => {
    for (const f of designs.filter((x) => x.includes("felt"))) {
      const { state, project } = open(f);
      const prod = await runJob(state, project.production);
      assert.equal(prod.sheet.stats.whipStitched, 0, f);
    }
  });
});

describe("pictures", () => {
  it("bound more points than a call can take as arguments", () => {
    const points = Array.from({ length: 300_000 }, (_, i) => [i % 2 ? 1 : -1, 0, 0]);
    assert.equal(boundingSphere(points).radius, 1);
  });
});

describe("command line", () => {
  const cli = (...args) => spawnSync(process.execPath, [join(root, "scripts/shapemaker.mjs"), ...args], { cwd: root, encoding: "utf8" });

  it("plans without writing, in words or JSON", () => {
    const r = cli("plan", "--base=cube", "--diameter=140", "--openings=false", "--process=cut", "--join=fingers", "--json");
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.process, "cut");
    assert.equal(report.production.cut.join, "fingers");
    assert.equal(report.state.circumdiameterMm, 140);
    assert.deepEqual(report.files.map((f) => f.file), ["cube_140mm_cut_fingers_3mm_fit-strip.svg", "cube_140mm_cut_fingers_3mm.svg"]);
  });

  it("plans the pictures a build writes", () => {
    const args = ["--base=cube", "--diameter=140", "--openings=false", "--process=cut", "--join=fingers", "--pictures", "--json"];
    const planned = JSON.parse(cli("plan", ...args).stdout).files;
    assert.ok(planned.some((f) => f.group === "Picture"));
    const out = mkdtempSync(join(tmpdir(), "shapemaker-"));
    const built = JSON.parse(cli("build", ...args, `--out=${out}`).stdout).files;
    assert.deepEqual(built, planned);
    for (const f of built) assert.ok(readdirSync(out).includes(f.file), f.file);
  });

  it("builds the same bytes as the library, with a manifest", async () => {
    const out = mkdtempSync(join(tmpdir(), "shapemaker-"));
    const design = "docs/examples/fold-dodecahedron-felt-seams.shapemaker.json";
    execFileSync(process.execPath, ["scripts/shapemaker.mjs", "build", design, `--out=${out}`], { cwd: root, encoding: "utf8" });
    const { state, project } = parseProject(readFileSync(join(root, design), "utf8"));
    const files = listArtifacts(await runJob(state, project.production));
    assert.ok(files.length);
    for (const f of files) assert.equal(readFileSync(join(out, f.name), "utf8"), f.bytes());
    assert.deepEqual(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")).files.map((f) => f.file), files.map((f) => f.name));
  });

  it("lets flags override a design file", () => {
    const r = cli("plan", "docs/examples/cut-cube-fingers.shapemaker.json", "--process=fold", "--join=sew", "--diameter=100", "--json");
    const report = JSON.parse(r.stdout);
    assert.equal(report.process, "fold");
    assert.equal(report.state.circumdiameterMm, 100);
    assert.equal(report.state.base, "cube");
  });

  it("takes either border spelling, over a design or a fix", () => {
    const over = cli("plan", "docs/examples/cut-icosidodecahedron-ties.shapemaker.json", "--border-mm=3", "--json");
    assert.equal(over.status, 0, over.stderr);
    assert.equal(JSON.parse(over.stdout).state.borderMm, 3);
    const fixed = cli("plan", "--process=cut", "--base=cube", "--border=2", "--fix", "--json");
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.equal(JSON.parse(fixed.stdout).state.borderFraction, 0.37);
  });

  it("reads the usual words for off", () => {
    for (const off of ["false", "no", "off", "0"]) assert.equal(JSON.parse(cli("plan", "--process=cut", `--openings=${off}`, "--json").stdout).state.openings, false);
  });

  it("exits 2 on usage errors and 1 when the design doesn't build", () => {
    assert.equal(cli().status, 2);
    assert.equal(cli("frobnicate").status, 2);
    assert.equal(cli("plan", "--process=laser").status, 2);
    assert.equal(cli("plan", "--process=cut", "--nonsense=1").status, 2);
    assert.equal(cli("plan", "--process=cut", "--join=staples").status, 2);
    assert.equal(cli("plan", "--process=cut", "--sheet-mm=99").status, 2);
    assert.equal(cli("plan", "--process=cut", "--board=2500x1250").status, 2);
    assert.equal(cli("plan", "--process=cut", "--constructor=1").status, 2);
    assert.equal(cli("plan", "no-such-file.json").status, 2);
    assert.equal(cli("plan", "--base=nothing").status, 1);
  });

  it("lists each process's settings", () => {
    const r = cli("settings", "--process=fold");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--seam-mm=/);
    assert.doesNotMatch(r.stdout, /--sheet-mm=/);
  });
});

describe("status headline", () => {
  const made = (job) => produce(compileShape({ ...DEFAULT_STATE, circumdiameterMm: 200 }), job);

  it("says a job in a few words", () => {
    assert.match(headline(made({ process: "cut" })), /^32 panels · \d+ clips · \d boards?$/);
    assert.match(headline(made({ process: "fold" })), /^\d+ nets? · \d+ folds · \d boards?$/);
  });

  it("names the join in use", () => {
    assert.match(headline(made({ process: "cut", cut: { join: "ties" } })), /\d+ ties/);
    const cube = compileShape({ ...DEFAULT_STATE, base: "cube", circumdiameterMm: 140, openings: false });
    assert.match(headline(produce(cube, { process: "cut", cut: { join: "fingers" } })), /finger joints?/);
    assert.match(headline(made({ process: "cut", cut: { clipsBy: "print" } })), /printed clips/);
  });

  it("carries a failure's own words", () => {
    assert.equal(headline(produce({ state: DEFAULT_STATE }, { process: "cut" })), "No model to lay out");
  });
});
