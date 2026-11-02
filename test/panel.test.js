import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, memoryStore, visible } from "./mini-dom.js";
import { CONTROL_DEFS, PRINT_KEYS, normalizeState } from "../src/schema.js";
import { TABS, tabOfKey, tabCaptions, validTab, markedTabs, statusHeadline, geometryLines, warningLine } from "../src/panel-model.js";
import { createPanel, PANEL_TAB_KEY } from "../src/ui.js";
import { isWideField } from "../src/controls.js";
import { JOB_DEFS } from "../src/production/job.js";

const noop = () => {};
const handlers = (over = {}) => ({ onPatch: noop, onNameChange: noop, onSave: noop, ...over });
const state = (over = {}) => ({ ...normalizeState({}), ...over });

function mount({ store = memoryStore(), on = {} } = {}) {
  const doc = installDom({ store });
  const panelEl = doc.getElementById("panel");
  return { doc, panelEl, store, ui: createPanel(panelEl, handlers(on)) };
}
const tabBody = (panelEl, id) => panelEl.querySelector(`section[data-tab="${id}"]`);
const tabButton = (panelEl, id) => panelEl.querySelector(`#tab-${id}`);

describe("what each tab holds", () => {
  it("gives every control a tab", () => {
    for (const def of CONTROL_DEFS) {
      assert.ok(TABS.some((t) => t.id === def.group), `${def.key} has no tab`);
    }
  });

  it("keeps everything only a printed shell reads in Build", () => {
    for (const key of PRINT_KEYS) assert.equal(tabOfKey(key), "build", key);
    const buildKeys = CONTROL_DEFS.filter((d) => d.group === "build").map((d) => d.key);
    assert.deepEqual(buildKeys.sort(), [...PRINT_KEYS].sort());
  });

  it("names the tab behind errors no control carries", () => {
    assert.equal(tabOfKey("borderMm"), "openings");
    assert.equal(tabOfKey("base"), "shape");
    assert.equal(tabOfKey("faceIndex"), "build");
    assert.equal(tabOfKey("sheet"), "build");
    assert.equal(tabOfKey("project"), null);
    assert.equal(tabOfKey(undefined), null);
  });
});

describe("tab captions", () => {
  it("say the design at a glance", () => {
    const words = tabCaptions({ state: state({ circumdiameterMm: 142, borderFraction: 0.36, wallMm: 2.4 }) });
    assert.deepEqual(words, { shape: "142 mm", openings: "36% border", build: "Print 2.4 mm", files: "0 files" });
    assert.equal(tabCaptions({ state: state(), fileCount: 1 }).files, "1 file");
    assert.equal(tabCaptions({ state: state(), fileCount: 3 }).files, "3 files");
  });

  it("follow a closed, solid or legacy-border design", () => {
    assert.equal(tabCaptions({ state: state({ openings: false, depth: "solid" }) }).openings, "closed");
    assert.equal(tabCaptions({ state: state({ openings: false, depth: "solid" }) }).build, "Print solid");
    assert.equal(tabCaptions({ state: state({ borderFraction: null, borderMm: 3 }) }).openings, "3 mm border");
  });

  it("follow the job", () => {
    const job = { process: "cut", cut: { sheetMm: 3 }, fold: { join: "tape" } };
    assert.equal(tabCaptions({ state: state(), job }).build, "Cut 3 mm");
    assert.equal(tabCaptions({ state: state(), job: { ...job, process: "fold" } }).build, "Fold tape");
  });
});

describe("panel tabs", () => {
  beforeEach(() => installDom());

  it("show one tab at a time, Shape first", () => {
    const { panelEl } = mount();
    assert.deepEqual([...panelEl.querySelectorAll("[role=\"tab\"]")].map((b) => b.textContent), ["Shape", "Openings", "Build", "Files"]);
    assert.deepEqual(TABS.filter((t) => visible(tabBody(panelEl, t.id))).map((t) => t.id), ["shape"]);
    assert.equal(tabButton(panelEl, "shape").getAttribute("aria-selected"), "true");
  });

  it("switch on a click, and remember it", () => {
    const { panelEl, store } = mount();
    tabButton(panelEl, "build").click();
    assert.deepEqual(TABS.filter((t) => visible(tabBody(panelEl, t.id))).map((t) => t.id), ["build"]);
    assert.equal(tabButton(panelEl, "build").getAttribute("aria-selected"), "true");
    assert.equal(tabButton(panelEl, "shape").getAttribute("aria-selected"), "false");
    assert.equal(store.data[PANEL_TAB_KEY], "build");
    const again = mount({ store });
    assert.ok(visible(tabBody(again.panelEl, "build")));
  });

  it("fall back to Shape from a stored tab that no longer exists", () => {
    assert.equal(validTab("form"), "shape");
    const { panelEl } = mount({ store: memoryStore({ [PANEL_TAB_KEY]: "form" }) });
    assert.ok(visible(tabBody(panelEl, "shape")));
  });

  it("move with the arrow keys, wrapping at the ends", () => {
    const { panelEl } = mount();
    const bar = panelEl.querySelector(".panel-tabs");
    bar.dispatch("keydown", { key: "ArrowLeft" });
    assert.ok(visible(tabBody(panelEl, "files")));
    bar.dispatch("keydown", { key: "ArrowRight" });
    assert.ok(visible(tabBody(panelEl, "shape")));
  });

  it("keep each tab's place in the scroll", () => {
    const { panelEl } = mount();
    const scroll = panelEl.querySelector("#panel-scroll");
    scroll.scrollTop = 120;
    tabButton(panelEl, "build").click();
    assert.equal(scroll.scrollTop, 0);
    tabButton(panelEl, "shape").click();
    assert.equal(scroll.scrollTop, 120);
    scroll.scrollTop = 300;
    tabButton(panelEl, "shape").click();
    assert.equal(scroll.scrollTop, 300, "the open tab keeps its place");
  });

  it("put every control in its own tab, and the rest where people look", () => {
    const { panelEl } = mount();
    for (const def of CONTROL_DEFS) {
      const body = tabBody(panelEl, def.group);
      assert.ok(body.querySelector(`.control[data-key="${def.key}"]`), `${def.key} is not in ${def.group}`);
    }
    assert.ok(tabBody(panelEl, "shape").querySelector(".start-current"));
    assert.ok(tabBody(panelEl, "build").querySelector("[data-face-stepper]"));
    assert.ok(tabBody(panelEl, "build").querySelector("[data-material]"));
    assert.ok(tabBody(panelEl, "files").querySelector("#btn-save"));
    assert.ok(tabBody(panelEl, "files").querySelector("#btn-open"));
  });

  it("keep the project's name and Undo out of the tabs", () => {
    const { doc, panelEl } = mount();
    assert.ok(doc.getElementById("app-header").querySelector("#project-name"));
    assert.equal(panelEl.querySelector("#project-name"), null);
    assert.ok(doc.getElementById("app-header").querySelector(".undo-chip"));
  });

  it("caption themselves from each result, and from the job", () => {
    const { panelEl, ui } = mount();
    ui.setResult({ state: state({ circumdiameterMm: 120 }) });
    assert.equal(tabButton(panelEl, "shape").querySelector(".panel-tab-caption").textContent, "120 mm");
    ui.setJob({ process: "cut", cut: { sheetMm: 3 }, fold: { join: "tape" } });
    assert.equal(tabButton(panelEl, "build").querySelector(".panel-tab-caption").textContent, "Cut 3 mm");
    ui.setJob(null);
    assert.match(tabButton(panelEl, "build").querySelector(".panel-tab-caption").textContent, /^Print/);
  });

  it("mark the tab that holds an error, then clear it", () => {
    const { panelEl, ui } = mount();
    const fail = { ok: false, errors: [{ key: "wallMm", message: "too thick" }], warnings: [] };
    ui.setResult({ state: state(), validation: fail }, { invalid: true });
    assert.equal(tabButton(panelEl, "build").dataset.marked, "1");
    assert.match(tabButton(panelEl, "build").textContent, /has an error/);
    assert.equal(tabButton(panelEl, "shape").dataset.marked, undefined);
    assert.equal(panelEl.querySelector("#err-wallMm").textContent.includes("too thick"), true);
    ui.setResult({ state: state(), validation: { ok: true, errors: [], warnings: [] } });
    assert.equal(tabButton(panelEl, "build").dataset.marked, undefined);
    assert.doesNotMatch(tabButton(panelEl, "build").textContent, /has an/);
  });
});

describe("field widths", () => {
  const wide = (key) => isWideField(CONTROL_DEFS.find((d) => d.key === key));

  it("set sliders and short choices side by side", () => {
    for (const key of ["wallMm", "seed", "depth", "dual", "wallMode"]) assert.equal(wide(key), false, key);
  });

  it("give long choices the whole row", () => {
    for (const key of ["openingAxis", "edgeDiv"]) assert.equal(wide(key), true, key);
  });

  it("read job rows too", () => {
    const row = (key) => isWideField(JOB_DEFS.cut.find((d) => d.key === key));
    assert.equal(row("board"), true);
    assert.equal(row("join"), true);
    assert.equal(row("clearanceMm"), true);
    assert.equal(row("sheetMm"), false);
  });

  it("reach the page", () => {
    const { panelEl } = mount();
    assert.equal(panelEl.querySelector('.control[data-key="openingAxis"]').dataset.wide, "1");
    assert.equal(panelEl.querySelector('.control[data-key="wallMm"]').dataset.wide, undefined);
  });
});

describe("panel controls", () => {
  it("send a segment click as a patch", () => {
    const patches = [];
    const { panelEl } = mount({ on: { onPatch: (p, o) => patches.push([p, o]) } });
    panelEl.querySelector('[data-seg-key="wallMode"][data-seg-value="scaled"]').click();
    assert.deepEqual(patches, [[{ wallMode: "scaled" }, { commit: true }]]);
  });

  it("couple Faces and Shell across tabs", () => {
    const patches = [];
    const { panelEl } = mount({ on: { onPatch: (p) => patches.push(p) } });
    panelEl.querySelector('[data-seg-key="openings"][data-seg-value="true"]').click();
    assert.equal(patches[0].depth, "hollow");
  });

  it("name a face once in Rests on", () => {
    const { panelEl, ui } = mount();
    const faces = [[0, 1, 2], [0, 2, 3], [0, 1, 2, 3]];
    ui.setResult({ state: state({ faceIndex: 1 }), skeleton: { faces } });
    assert.equal(panelEl.querySelector("[data-face-family]").textContent, "triangle");
    assert.equal(panelEl.querySelector("[data-face-readout]").textContent, "2 of 2");
  });

  it("commit a slider on release", () => {
    const patches = [];
    const { panelEl } = mount({ on: { onPatch: (p, o) => patches.push([p, o]) } });
    const range = panelEl.querySelector('.control[data-key="wallMm"] input[type="range"]');
    range.value = "3";
    range.dispatch("change");
    assert.deepEqual(patches.at(-1), [{ wallMm: 3 }, { commit: true }]);
  });
});

const metrics = (over = {}) => ({
  extentsMm: [95.1, 100, 85.1],
  wallMm: { min: 1.4, max: 1.5 },
  longestHorizontalMm: 30.9,
  volumeCm3: 24.51,
  triangleCount: 7280,
  watertight: true,
  edgeMm: { mean: 30.9 },
  limits: null,
  ...over,
});
const valid = (warnings = []) => ({ ok: true, errors: [], warnings });
const statusOf = (doc) => doc.getElementById("status-line");

describe("status words", () => {
  it("lead with the size and the wall", () => {
    assert.equal(statusHeadline(metrics()), "95.1×100×85.1 mm · wall 1.4–1.5");
    assert.equal(statusHeadline(metrics({ wallMm: { min: null } })), "95.1×100×85.1 mm · solid");
  });

  it("leave the geometry detail for Files", () => {
    assert.deepEqual(geometryLines(metrics()), ["longest flat 30.9 mm · 24.5 cm³", "mesh 7,280 tris · watertight ✓"]);
  });

  it("count the warnings past the first", () => {
    assert.equal(warningLine(["a"]), "▲ a");
    assert.equal(warningLine(["a", "b", "c"]), "▲ a (+2)");
  });

  it("mark tabs by a problem's key and a fix's patch", () => {
    assert.deepEqual([...markedTabs([{ key: "wallMm" }, { key: "project" }, {}])], ["build"]);
    assert.deepEqual([...markedTabs([], [{ patch: { borderFraction: 0.8 } }])], ["openings"]);
  });
});

describe("status line", () => {
  it("says the result", () => {
    const { doc, ui } = mount();
    ui.setResult({ state: state(), metrics: metrics(), validation: valid() });
    assert.match(statusOf(doc).textContent, /^95\.1×100×85\.1 mm · wall/);
  });

  it("adds a picked edge", () => {
    const { doc, ui } = mount();
    ui.setResult({ state: state(), metrics: metrics(), validation: valid() });
    ui.setSelectedEdge(31.2);
    assert.match(statusOf(doc).textContent, /edge 31\.2 mm/);
  });

  it("shows a warning and marks the tab that causes it", () => {
    const { doc, panelEl, ui } = mount();
    ui.setResult({ state: state(), metrics: metrics(), validation: valid([{ key: "openingAxis", message: "2 faces stay closed" }]) });
    assert.match(statusOf(doc).textContent, /▲ 2 faces stay closed/);
    assert.equal(tabButton(panelEl, "build").dataset.marked, "1");
    ui.setResult({ state: state(), metrics: metrics(), validation: valid() });
    assert.equal(tabButton(panelEl, "build").dataset.marked, undefined);
    assert.ok(!statusOf(doc).textContent.includes("▲"));
  });

  it("carries a warning that came with the edit, marking the settings it changed", () => {
    const { doc, panelEl, ui } = mount();
    ui.setResult({ state: state(), metrics: metrics(), validation: valid() }, { warnings: ["Some settings were reduced"], warningKeys: ["wallMm", "borderMm"] });
    assert.match(statusOf(doc).textContent, /Some settings were reduced/);
    assert.equal(tabButton(panelEl, "build").dataset.marked, "1");
    assert.equal(tabButton(panelEl, "openings").dataset.marked, "1");
    assert.match(tabButton(panelEl, "build").textContent, /has a warning/);
  });

  it("says a failed build even when old metrics are still on screen", () => {
    const { doc, ui } = mount();
    ui.setResult({ state: state(), metrics: metrics(), validation: valid() });
    const fail = { ok: false, errors: [{ key: "wallMm", message: "too thick", clampTo: 2 }], warnings: [] };
    ui.setResult({ state: state(), metrics: metrics(), validation: fail }, { invalid: true });
    assert.match(statusOf(doc).textContent, /Wall: too thick/);
    assert.ok(!statusOf(doc).textContent.includes("95.1"));
  });

  it("offers a failed build's fix, which lands as a patch", () => {
    const patches = [];
    const { doc, ui } = mount({ on: { onPatch: (p) => patches.push(p) } });
    const fail = { ok: false, errors: [{ key: "wallMm", message: "too thick", clampTo: 2 }], warnings: [] };
    ui.setResult({ state: state(), validation: fail }, { invalid: true });
    const fix = statusOf(doc).querySelector(".control-fix");
    assert.equal(fix.textContent, "Use 2 mm");
    fix.click();
    assert.deepEqual(patches, [{ wallMm: 2 }]);
  });

  it("gives way to a job, and comes back", () => {
    const { doc, panelEl, ui } = mount();
    ui.setResult({ state: state(), metrics: metrics(), validation: valid() });
    ui.setJobStatus({ headline: "32 panels", warnings: ["faces closed"], fixes: [{ label: "Use Border 80", patch: { borderFraction: 0.8 } }], geometry: ["edges 90–120°"] });
    assert.match(statusOf(doc).textContent, /^32 panels/);
    assert.equal(tabButton(panelEl, "openings").dataset.marked, "1");
    assert.match(tabBody(panelEl, "files").textContent, /edges 90–120°/);
    ui.setJobStatus(null);
    assert.match(statusOf(doc).textContent, /^95\.1/);
    assert.equal(tabButton(panelEl, "openings").dataset.marked, undefined);
  });

  it("marks tabs for the job on screen, not for Print", () => {
    const { panelEl, ui } = mount();
    ui.setResult({ state: state(), metrics: metrics(), validation: valid([{ key: "borderMm", message: "thin border" }]) });
    assert.equal(tabButton(panelEl, "openings").dataset.marked, "1");
    ui.setJobStatus({ headline: "32 panels", warnings: [], fixes: [], geometry: [] });
    assert.equal(tabButton(panelEl, "openings").dataset.marked, undefined);
    ui.setJobStatus({ headline: "32 panels", warnings: ["3 parts are larger than the board"], problems: [{ key: "sheet", message: "3 parts are larger than the board" }], fixes: [], geometry: [] });
    assert.equal(tabButton(panelEl, "build").dataset.marked, "1");
    ui.setJobStatus(null);
    assert.equal(tabButton(panelEl, "build").dataset.marked, undefined);
    assert.equal(tabButton(panelEl, "openings").dataset.marked, "1");
  });
});

describe("Files tab", () => {
  const file = (name, run = noop) => ({ group: "3D print", name, detail: "d", run });

  it("lists what the design makes, and runs a download", () => {
    let ran = 0;
    const { panelEl, ui } = mount();
    ui.setFiles({ files: [file("a.stl", () => ran++), { ...file("a.svg"), group: "Drawing" }] });
    const rows = panelEl.querySelectorAll(".file-row");
    assert.deepEqual(rows.map((r) => r.querySelector(".file-name").textContent), ["a.stl", "a.svg"]);
    rows[0].querySelector("button").click();
    assert.equal(ran, 1);
  });

  it("staggers Download all, so browsers keep every file", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const ran = [];
    const { panelEl, ui } = mount();
    ui.setFiles({ files: [file("a", () => ran.push("a")), file("b", () => ran.push("b"))] });
    panelEl.querySelector("section[data-tab=\"files\"] .btn-accent").click();
    t.mock.timers.tick(0);
    assert.deepEqual(ran, ["a"]);
    t.mock.timers.tick(200);
    assert.deepEqual(ran, ["a", "b"]);
  });

  it("captions the count, and says why it's empty", () => {
    const { panelEl, ui } = mount();
    ui.setResult({ state: state() });
    ui.setFiles({ files: [file("a"), file("b")] });
    assert.equal(tabButton(panelEl, "files").querySelector(".panel-tab-caption").textContent, "2 files");
    ui.setFiles({ files: [] });
    assert.match(tabBody(panelEl, "files").textContent, /Nothing to export/);
  });

  it("keeps the geometry and Share here", () => {
    const { panelEl, ui } = mount();
    ui.setResult({ state: state(), metrics: metrics(), validation: valid() });
    assert.match(tabBody(panelEl, "files").textContent, /longest flat 30\.9 mm/);
    assert.ok(tabBody(panelEl, "files").querySelector("#btn-share"));
  });

  it("lists a warning in full, even one alone", () => {
    const { panelEl, ui } = mount();
    ui.setResult({ state: state(), metrics: metrics(), validation: valid([{ key: "wallMm", message: "use Wall 2.4 for straight sides" }]) });
    assert.match(tabBody(panelEl, "files").textContent, /use Wall 2\.4 for straight sides/);
  });

  it("drops the warnings while the build has failed", () => {
    const { panelEl, ui } = mount();
    ui.setResult({ state: state(), metrics: metrics(), validation: valid([{ key: "wallMm", message: "old warning" }]) });
    ui.setResult({ state: state(), metrics: metrics(), validation: { ok: false, errors: [{ key: "wallMm", message: "too thin" }], warnings: [] } }, { invalid: true });
    assert.ok(!tabBody(panelEl, "files").textContent.includes("Warnings"));
  });

  it("is where Export goes, and Export stands down there", () => {
    const { doc, panelEl } = mount();
    const exportBtn = doc.getElementById("bottombar").querySelector("#btn-export");
    exportBtn.focus();
    exportBtn.click();
    assert.ok(visible(tabBody(panelEl, "files")));
    assert.equal(exportBtn.hidden, true);
    assert.equal(doc.activeElement, tabButton(panelEl, "files"));
    tabButton(panelEl, "shape").click();
    assert.equal(exportBtn.hidden, false);
  });
});

describe("Split lock", () => {
  it("locks three tabs and leaves Files live", () => {
    const { panelEl, ui } = mount();
    ui.setLocked(true);
    for (const id of ["shape", "openings", "build"]) assert.equal(tabBody(panelEl, id).inert, true, id);
    assert.equal(tabBody(panelEl, "files").inert, false);
    assert.ok(visible(tabBody(panelEl, "files")));
    assert.equal(panelEl.querySelector("#btn-open").disabled, true);
  });

  it("says why when you look at a locked tab", () => {
    const { panelEl, ui } = mount();
    ui.setLocked(true);
    const note = panelEl.querySelector(".panel-lock-note");
    assert.equal(note.hidden, true);
    tabButton(panelEl, "build").click();
    assert.equal(note.hidden, false);
  });

  it("goes back to the tab you were on, and doesn't remember Files", () => {
    const { panelEl, store, ui } = mount();
    tabButton(panelEl, "openings").click();
    ui.setLocked(true);
    assert.equal(store.data[PANEL_TAB_KEY], "openings");
    ui.setLocked(false);
    assert.ok(visible(tabBody(panelEl, "openings")));
    assert.equal(tabBody(panelEl, "openings").inert, false);
    assert.equal(panelEl.querySelector("#btn-open").disabled, false);
  });

  it("locks the project's name and Undo too", () => {
    const { doc, ui } = mount();
    ui.setProjectStatus({ name: "x", dirty: false, canSave: true, canUndo: true });
    ui.setLocked(true);
    assert.equal(doc.getElementById("project-name").disabled, true);
    ui.setProjectStatus({ name: "x", dirty: false, canSave: true, canUndo: true });
    assert.equal(doc.getElementById("app-header").querySelector(".undo-chip").disabled, true);
  });

  it("ignores a repeat, so an unlock can't lose the tab", () => {
    const { panelEl, ui } = mount();
    tabButton(panelEl, "build").click();
    ui.setLocked(false);
    assert.ok(visible(tabBody(panelEl, "build")));
    ui.setLocked(true);
    ui.setLocked(true);
    ui.setLocked(false);
    assert.ok(visible(tabBody(panelEl, "build")));
  });
});
