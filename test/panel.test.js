import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, memoryStore, visible } from "./mini-dom.js";
import { CONTROL_DEFS, PRINT_KEYS, normalizeState } from "../src/schema.js";
import { TABS, tabOfKey, tabCaptions, validTab } from "../src/panel-model.js";
import { createPanel, PANEL_TAB_KEY } from "../src/ui.js";

const noop = () => {};
const handlers = (over = {}) => ({ onPatch: noop, onNameChange: noop, onSave: noop, onExport: noop, ...over });
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
    assert.equal(tabOfKey("project"), null);
    assert.equal(tabOfKey(undefined), null);
  });
});

describe("tab captions", () => {
  it("say the design at a glance", () => {
    const words = tabCaptions({ state: state({ circumdiameterMm: 142, borderFraction: 0.36, wallMm: 2.4 }) });
    assert.deepEqual(words, { shape: "142 mm", openings: "36% border", build: "Print 2.4 mm" });
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
    assert.equal(tabButton(panelEl, "shape").dataset.marked, undefined);
    assert.equal(panelEl.querySelector("#err-wallMm").textContent.includes("too thick"), true);
    ui.setResult({ state: state(), validation: { ok: true, errors: [], warnings: [] } });
    assert.equal(tabButton(panelEl, "build").dataset.marked, undefined);
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

  it("commit a slider on release", () => {
    const patches = [];
    const { panelEl } = mount({ on: { onPatch: (p, o) => patches.push([p, o]) } });
    const range = panelEl.querySelector('.control[data-key="wallMm"] input[type="range"]');
    range.value = "3";
    range.dispatch("change");
    assert.deepEqual(patches.at(-1), [{ wallMm: 3 }, { commit: true }]);
  });
});
