/**
 * Clickable mockup of the Cut and Fold modes, mounted over the real app
 * when the URL carries ?sheet. It adds the switch to the Build tab, swaps the
 * rows each mode doesn't use for its own, shows the cut parts put together
 * in the viewer, adds a Flat view of the boards, and replaces the export
 * buttons with one dialog.
 *
 * This file is only the panel. The rows come from JOB_DEFS and everything
 * they make comes from src/production/, the same path the CLI runs. It
 * touches only the DOM the app already built, and keeps its settings in
 * localStorage, so the app itself is unchanged without the flag. Design and
 * what ships: docs/PRODUCTION.md.
 */

import {
  produce, finishProduction, assemblyOf, listArtifacts, exportNotes, summarize, designStem, normalizeJob, serializeJob,
  settingsOf, settingApplies, boardOf, fmt, JOB_DEFS, PROCESSES, PROCESS_STOCK, BOARD_PROFILES, PRINT_BEDS, PLATE_CLIP,
} from "./production/index.js";
import { createFlatView } from "./flat-view.js";
import { PRINT_KEYS } from "./schema.js";
import { el, isWideField } from "./controls.js";

const STORE_KEY = "shapemaker.sheetMockup";

const COLORS = {
  panel: 0xcfa874,
  clip: 0x9a7448,
  pclip: 0xe08040,
  tie: 0x2a2a2e,
  paper: 0xf0ece4,
  flap: 0xe2d8c6,
  tape: 0x8fb6c9,
  thread: 0xc0503c,
  felt: 0x688c9e,
  feltB: 0x4e7082,
  seam: 0x96b8c6,
  seamB: 0x80a4b4,
  pick: 0xffcc44,
};

/** The job, plus which view of it the mockup shows. */
function loadSettings() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
  } catch {
    /* private window, blocked storage or bad JSON: defaults */
  }
  const job = normalizeJob(saved?.job);
  return { job, flat: saved?.flat === true && job.process !== "print" };
}

function saveSettings(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ job: serializeJob(s.job), flat: s.flat }));
  } catch {
    /* ignore */
  }
}

/**
 * @param {{
 *   viewer: ReturnType<import("./viewer.js").createViewer>,
 *   getLast: () => any,
 *   applyPatch: (patch: object, commit: boolean) => void,
 *   download: (data: BlobPart, filename: string, mime: string) => void,
 *   setJob: (job: object) => void,
 * }} app
 */
export function mountSheetMockup({ viewer, getLast, applyPatch, download, setJob }) {
  const S = loadSettings();
  /** The latest production; null in Print. @type {any} */
  let prod = null;
  let buildTimer = null;

  injectStyles();

  const panelEl = document.getElementById("panel");
  const canvasHost = document.getElementById("canvas-host");
  const appStrip = document.getElementById("dimension-strip");
  const buildBody = panelEl.querySelector('section[data-tab="build"]');
  const hud = canvasHost.querySelector(".section-hud");

  // The app's own rows each mode hides.
  const byKey = (k) => panelEl.querySelector(`.control[data-key="${k}"]`);
  const printRows = [
    ...PRINT_KEYS.map(byKey),
    buildBody.querySelector('[data-cluster="build-advanced"]'),
    ...buildBody.querySelectorAll(".control-row--material"),
  ].filter(Boolean);
  const faceRow = buildBody.querySelector("[data-face-row]");
  const faceLabel = buildBody.querySelector("[data-face-label]");
  const faceHint = faceRow.querySelector("p.hint");
  const faceHintPrint = faceHint.textContent;
  // Print's viewport overlays don't apply to sheet parts: switched off on
  // the way out of Print (through their own checkboxes, so the app keeps
  // its state) and Print risk and Section switched back on the way in.
  const overlayInputs = ["[data-print-risk]", "[data-section-on]", "[data-split-on]"].map((q) => hud?.querySelector(q)).filter(Boolean);
  let printOverlays = [];
  const exportStl = document.getElementById("btn-export");
  const exportSvg = document.getElementById("btn-export-svg");

  // ── Header chip ──
  const header = document.querySelector("#app > header, #app header");
  const chip = el("span", { className: "sheet-chip", textContent: "Sheet mockup", title: "Cut and Fold modes, mocked up over the real app (?sheet)" });
  header?.querySelector("h1, .brand, .title")?.after(chip) ?? header?.prepend(chip);

  // ── Build: the switch and each mode's rows ──
  const buildRow = segControl("Build", PROCESSES.map((p) => [p, p[0].toUpperCase() + p.slice(1)]), () => S.job.process, (v) => {
    if (v === S.job.process) return;
    switchOverlays(S.job.process, v);
    S.job.process = v;
    changed();
  });
  buildRow.root.classList.add("sheet-build");
  buildRow.root.dataset.wide = "1";
  const materialNote = el("p", { className: "hint sheet-material" });
  buildRow.root.append(materialNote);
  buildBody.prepend(buildRow.root);

  // One row per job setting, sorted into its place in the panel.
  const rows = [];
  for (const process of PROCESSES) {
    for (const def of JOB_DEFS[process]) {
      if (!def.group || def.kind === "size") continue;
      rows.push({ process, def, control: settingControl(process, def) });
    }
  }
  const rowsIn = (process, group) => rows.filter((r) => r.process === process && r.def.group === group).map((r) => r.control.root);
  const clipCluster = cluster("Clips", rowsIn("cut", "clips"), () => {
    const m = S.job.cut;
    return [
      m.clipSize === "auto" && prod?.sheet?.stats?.clipSize ? `auto (${prod.sheet.stats.clipSize})` : m.clipSize,
      m.clipPlace,
      m.clipsBy === "print" ? `printed ${fmt(Math.max(m.clipWidthMm, m.sheetMm))} mm` : "laser",
    ].join(" · ");
  });
  const cutAdvanced = cluster("Advanced", rowsIn("cut", "advanced"), () => {
    const m = S.job.cut, def = JOB_DEFS.cut.find((d) => d.key === "clearanceMm");
    const fit = def.options.find(([v]) => v === m.clearanceMm)[1];
    return `kerf ${fmt(m.kerfMm, 2)} · fit ${fit}${m.clipsBy === "print" && m.join !== "ties" ? ` · ${PRINT_BEDS[m.printBed].label.split(" /")[0]}` : ""}`;
  });
  buildRow.root.after(
    ...rowsIn("cut", "main"), clipCluster.root, ...rowsIn("fold", "main"),
    ...rowsIn("cut", "make"), ...rowsIn("fold", "make"),
  );
  buildBody.append(cutAdvanced.root);

  // ── Viewport: Flat toggle, board tabs ──
  const flatToggle = el("label", { className: "section-hud-toggle sheet-flat-toggle", title: "Show the boards laid out flat" });
  const flatInput = el("input", { type: "checkbox" });
  flatToggle.append(flatInput, el("span", { textContent: "Flat" }));
  flatInput.addEventListener("change", () => {
    S.flat = flatInput.checked;
    changed(false);
  });
  hud?.append(flatToggle);
  const flatView = createFlatView(canvasHost, { onPick: showPart });

  // ── Bottom bar ──
  // One Export button opens a dialog with every file this mode makes.
  const exportBtn = el("button", { type: "button", className: "btn btn-accent", textContent: "Export" });
  exportBtn.addEventListener("click", openExport);
  exportStl?.before(exportBtn);
  const exportDialog = el("dialog", { className: "onboarding sheet-export", "aria-label": "Export" });
  document.body.append(exportDialog);
  const strip = el("div", { id: "sheet-strip", "aria-live": "polite", hidden: true });
  appStrip.after(strip);

  // ── Wiring ──
  function switchOverlays(from, to) {
    if (from === "print" && to !== "print") {
      printOverlays = overlayInputs.filter((i) => i.checked);
      for (const i of printOverlays) i.click();
    } else if (from !== "print" && to === "print") {
      for (const i of printOverlays) if (!i.checked && !i.matches("[data-split-on]")) i.click();
      printOverlays = [];
      S.flat = false;
    }
  }

  function changed(rebuild = true) {
    saveSettings(S);
    setJob(S.job);
    syncPanel();
    if (rebuild) scheduleBuild();
    else render();
  }

  function syncPanel() {
    const process = S.job.process, sheetMode = process !== "print";
    for (const n of printRows) n.hidden = sheetMode;
    for (const { process: p, def, control } of rows) {
      control.root.hidden = p !== process || !settingApplies(def, S.job[p]);
      control.sync();
    }
    clipCluster.root.hidden = process !== "cut" || S.job.cut.join === "ties";
    cutAdvanced.root.hidden = process !== "cut";
    materialNote.textContent = PROCESS_STOCK[process] ?? "";
    materialNote.hidden = !sheetMode;
    // Cut has no face to choose; a click there still finds the panel.
    faceRow.hidden = process === "cut";
    faceLabel.textContent = process === "fold" ? "Net centres on" : "Rests on";
    faceHint.textContent = process === "fold" ? "Click a face on the model to centre the first net on it." : faceHintPrint;
    hud?.classList.toggle("sheet-mode", sheetMode);
    flatInput.checked = S.flat;
    if (exportStl) exportStl.hidden = true;
    if (exportSvg) exportSvg.hidden = true;
    appStrip.hidden = sheetMode;
    strip.hidden = !sheetMode;
    buildRow.sync();
    cutAdvanced.sync();
    clipCluster.sync();
  }

  function scheduleBuild() {
    clearTimeout(buildTimer);
    if (S.job.process === "print") {
      prod = null;
      viewer.setAltModel(null);
      render();
      return;
    }
    strip.textContent = "laying out…";
    buildTimer = setTimeout(build, 60);
  }

  function build() {
    const last = getLast();
    prod = produce(last ?? {}, S.job);
    try {
      viewer.setAltModel(prod.ok ? assemblyModel(prod) : null);
    } catch (err) {
      console.error("sheet mockup:", err);
      prod = { ...prod, ok: false, error: `Couldn't put this shape together: ${err.message}` };
      viewer.setAltModel(null);
    }
    if (prod.weld?.pending) {
      // The mesh library loads on demand; a newer build wins.
      const pending = prod;
      finishProduction(pending).then((done) => {
        if (prod !== pending) return;
        prod = done;
        render();
        if (exportDialog.open) openExport();
      });
    }
    render();
  }

  function render() {
    syncPanel();
    paintStrip();
    flatView.show(S.job.process !== "print" && S.flat && prod?.ok ? prod : null);
  }

  // ── Status line ──
  function paintStrip() {
    strip.replaceChildren();
    if (S.job.process === "print" || !prod) return;
    if (!prod.ok) {
      strip.append(el("span", { className: "err", textContent: prod.error }));
      return;
    }
    strip.append(document.createTextNode(summarize(prod).join("\n")));
    const warn = prod.warnings[0];
    if (warn) {
      const w = el("span", { className: "sheet-warn", textContent: `\n▲ ${warn}${prod.warnings.length > 1 ? ` (+${prod.warnings.length - 1})` : ""}` });
      w.title = prod.warnings.join("\n");
      strip.append(w);
      // Same "fix" pattern as the print warnings.
      for (const f of prod.fixes) {
        const fix = el("button", { type: "button", className: "control-fix", textContent: f.label });
        fix.addEventListener("click", () => applyPatch(f.patch, true));
        strip.append(" ", fix);
      }
    }
  }

  /** Leave Flat and light the part up on the model. */
  function showPart(part) {
    const keys =
      part.kind === "panel" ? [`p${part.panel}`]
      : part.kind === "clip" ? [`j${part.joint}`]
      : part.kind === "net" ? part.panels.map((p) => `p${p}`)
      : part.kind === "weld" ? part.clips.map((c) => `j${c.joint}`)
      : [];
    if (!keys.length) return;
    S.flat = false;
    changed(false);
    viewer.highlightAlt(keys, COLORS.pick, 2400);
  }

  // ── 3D: the parts put together, as plain data the viewer draws ──
  function assemblyModel(production) {
    const { solids } = assemblyOf(production);
    const linePts = [];
    const parts = solids.map((s) => {
      const positions = new Float32Array(s.tris.length * 9);
      let o = 0;
      for (const tri of s.tris) for (const p of tri) {
        positions[o++] = p[0];
        positions[o++] = p[1];
        positions[o++] = p[2];
      }
      // Segments [a, b, tag?]: outlines and engraved marks.
      for (const [a, b] of s.lines ?? []) linePts.push(...a, ...b);
      return {
        positions,
        color: COLORS[s.tag] ?? COLORS.panel,
        opacity: s.tag === "tape" ? 0.8 : 1,
        key: s.panel != null ? `p${s.panel}` : s.joint != null ? `j${s.joint}` : null,
      };
    });
    return { parts, lines: new Float32Array(linePts), lineColor: 0x3a2a1a };
  }

  // ── Export dialog ──
  /** Every file this mode makes. Print's two run through the app's own buttons, which know the view and the split. */
  function exportFiles() {
    if (S.job.process !== "print") {
      return prod?.ok ? listArtifacts(prod).map((f) => ({ ...f, run: () => download(f.bytes(), f.name, f.mime) })) : [];
    }
    const stem = getLast()?.state ? designStem(getLast().state) : "shape";
    return [
      { group: "3D print", name: `${stem}.stl`, detail: "The shell as shown (two halves when Split is on)", run: () => exportStl?.click() },
      { group: "Drawing", name: `${stem}.svg`, detail: "Line drawing of the model from the current view", run: () => exportSvg?.click() },
    ];
  }

  function exportIntro() {
    const { process } = S.job;
    if (process === "print") return "Print: the shell for a 3D printer, and a line drawing.";
    const m = settingsOf(S.job), board = boardOf(m).label;
    if (process === "fold") return `Fold: thin stock on ${board}.`;
    return `Cut: ${fmt(m.sheetMm)} mm sheet on ${board}.${prod?.sheet?.plates?.length ? ` Clips print on ${PRINT_BEDS[m.printBed].label}.` : ""}`;
  }

  function openExport() {
    const files = exportFiles();
    const body = el("form", { method: "dialog", className: "onboarding-body sheet-export-body" });
    const head = el("div", { className: "sheet-export-head" });
    head.append(
      el("h2", { textContent: "Export" }),
      el("button", { type: "submit", className: "btn-quiet sheet-export-close", "aria-label": "Close", textContent: "×" }),
    );
    body.append(head, el("p", { className: "onboarding-note", textContent: exportIntro() }));
    if (prod?.weld?.pending) body.append(el("p", { className: "onboarding-note", textContent: "Welding corner pieces… the print files follow in a moment." }));
    let group = null, list = null;
    for (const f of files) {
      if (f.group !== group) {
        group = f.group;
        list = el("div", { className: "sheet-export-list" });
        body.append(el("div", { className: "group-subheader", textContent: group }), list);
      }
      const row = el("div", { className: "sheet-export-row" });
      const thumb = el("div", { className: "sheet-export-thumb" });
      if (f.thumb) thumb.innerHTML = f.thumb();
      const text = el("div", { className: "sheet-export-text" });
      text.append(el("div", { className: "sheet-export-name", textContent: f.name }), el("div", { className: "sheet-export-detail", textContent: f.detail }));
      const btn = el("button", { type: "button", className: "btn", textContent: "Download" });
      btn.addEventListener("click", () => f.run());
      row.append(thumb, text, btn);
      list.append(row);
    }
    if (prod?.ok) for (const note of exportNotes(prod)) body.append(el("p", { className: "onboarding-note", textContent: note }));
    const foot = el("div", { className: "sheet-export-foot" });
    const all = el("button", { type: "button", className: "btn btn-accent", textContent: files.length > 1 ? `Download all (${files.length})` : "Download" });
    all.disabled = !files.length;
    all.addEventListener("click", () => {
      // Staggered: browsers coalesce or block clicks in the same tick.
      files.forEach((f, i) => setTimeout(() => f.run(), i * 200));
      exportDialog.close();
    });
    foot.append(all);
    body.append(foot);
    exportDialog.replaceChildren(body);
    if (!exportDialog.open) exportDialog.showModal();
  }

  // ── Controls in the app's markup ──
  function segControl(label, options, get, set, titles = {}) {
    const root = el("div", { className: "control sheet-control" });
    const row = el("div", { className: "control-row control-row--seg" });
    const segs = el("div", { className: "segments", role: "group", "aria-label": label });
    const buttons = options.map(([value, text]) => {
      const b = el("button", { type: "button", "aria-pressed": "false", title: titles[value] ?? null, textContent: text });
      b.addEventListener("click", () => set(value));
      segs.append(b);
      return [value, b];
    });
    row.append(el("label", { textContent: label }), segs);
    root.append(row);
    return {
      root,
      sync() {
        const v = get();
        for (const [value, b] of buttons) b.setAttribute("aria-pressed", String(value === v));
      },
    };
  }

  function selectControl(label, options, get, set) {
    const root = el("div", { className: "control sheet-control" });
    const row = el("div", { className: "control-row control-row--material" });
    const select = el("select", { className: "material-select", "aria-label": label });
    for (const [value, text] of options) select.append(el("option", { value, textContent: text }));
    select.addEventListener("change", () => set(select.value));
    row.append(el("label", { textContent: label }), select);
    root.append(row);
    return {
      root,
      sync() {
        select.value = get();
      },
    };
  }

  function rangeControl(label, min, max, step, unit, get, set) {
    const root = el("div", { className: "control sheet-control" });
    const row = el("div", { className: "control-row control-row--range" });
    const input = el("input", { type: "range", min, max, step, "aria-label": label });
    const readout = el("span", { className: "value-readout" });
    const box = el("div", { className: "value-box" });
    box.append(readout, el("span", { className: "unit", textContent: unit }));
    row.append(el("label", { textContent: label }), input, box);
    root.append(row);
    input.addEventListener("input", () => {
      readout.textContent = input.value;
    });
    input.addEventListener("change", () => set(Number(input.value)));
    return {
      root,
      sync() {
        input.value = String(get());
        readout.textContent = String(get());
      },
    };
  }

  function cluster(label, children, summary) {
    const root = el("div", { className: "control-cluster sheet-control" });
    const toggle = el("button", { type: "button", className: "cluster-toggle", "aria-expanded": "false" });
    const chev = el("span", { className: "group-chevron", "aria-hidden": "true", textContent: "▸" });
    const sum = el("span", { className: "cluster-summary" });
    toggle.append(chev, el("span", { className: "cluster-label", textContent: label }), sum);
    const body = el("div", { className: "cluster-body", hidden: true });
    for (const c of children) {
      c.classList.add("control--clustered");
      body.append(c);
    }
    toggle.addEventListener("click", () => {
      body.hidden = !body.hidden;
      toggle.setAttribute("aria-expanded", String(!body.hidden));
      chev.textContent = body.hidden ? "▸" : "▾";
    });
    root.append(toggle, body);
    return {
      root,
      sync() {
        sum.textContent = summary();
      },
    };
  }

  /** A job setting's row, from its definition. */
  function settingControl(process, def) {
    const m = () => S.job[process];
    const set = (v) => {
      m()[def.key] = v;
      changed();
    };
    const control = rowFor(def, m, set);
    if (isWideField(def)) control.root.dataset.wide = "1";
    return control;
  }

  function rowFor(def, m, set) {
    if (def.kind === "board") return boardControl(m);
    if (def.kind === "bed") {
      return selectControl(def.label, Object.entries(PRINT_BEDS).map(([id, b]) => [id, `${b.label} · ${b.w}×${b.h}`]), () => m()[def.key], set);
    }
    if (def.kind === "range") {
      return rangeControl(def.label, def.min, def.max, def.step, def.unit, () => Math.max(m()[def.key], def.floor?.(m()) ?? -Infinity), set);
    }
    const titles = Object.fromEntries(def.options.filter((o) => o[2]).map(([v, , hint]) => [v, hint]));
    return segControl(def.label, def.options.map(([v, text]) => [v, text]), () => m()[def.key], set, titles);
  }

  function boardControl(m) {
    const root = el("div", { className: "control sheet-control" });
    const row = el("div", { className: "control-row control-row--material" });
    const select = el("select", { className: "material-select", "aria-label": "Board" });
    for (const [id, p] of Object.entries(BOARD_PROFILES)) {
      select.append(el("option", { value: id, textContent: `${p.label} · ${fmt(p.w)}×${fmt(p.h)}` }));
    }
    select.append(el("option", { value: "custom", textContent: "Custom…" }));
    row.append(el("label", { textContent: "Board" }), select);
    const customRow = el("div", { className: "control-row sheet-custom" });
    const w = el("input", { type: "number", min: 50, max: 2000, step: 1, className: "sheet-num", "aria-label": "Board width" });
    const h = el("input", { type: "number", min: 50, max: 2000, step: 1, className: "sheet-num", "aria-label": "Board height" });
    customRow.append(el("label", { textContent: "Size" }), w, el("span", { className: "unit", textContent: "×" }), h, el("span", { className: "unit", textContent: "mm" }));
    root.append(row, customRow);
    select.addEventListener("change", () => {
      m().board = select.value;
      changed();
    });
    // Out-of-range or empty sizes snap back into 50–2000 mm.
    const clampSize = (input, was) => {
      const v = Number(input.value);
      return Number.isFinite(v) && input.value !== "" ? Math.min(2000, Math.max(50, Math.round(v))) : was;
    };
    const onSize = () => {
      const { boardSize: was } = m();
      m().boardSize = { w: clampSize(w, was.w), h: clampSize(h, was.h) };
      changed();
    };
    w.addEventListener("change", onSize);
    h.addEventListener("change", onSize);
    return {
      root,
      sync() {
        select.value = m().board;
        customRow.hidden = m().board !== "custom";
        w.value = String(m().boardSize.w);
        h.value = String(m().boardSize.h);
      },
    };
  }

  syncPanel();
  setJob(S.job);
  return {
    /** Called after every rebuild of the model. */
    onResult() {
      if (S.job.process !== "print") scheduleBuild();
    },
    /** The job, for a saved project; a Print project carries none. */
    job: () => (S.job.process === "print" ? null : serializeJob(S.job)),
    /**
     * A project's job; none means Print, as it does without the mockup. The
     * file decides only its own process: the browser keeps its settings for
     * the others.
     */
    setJob(job) {
      const next = normalizeJob(job);
      for (const p of PROCESSES) if (p !== next.process && S.job[p]) next[p] = S.job[p];
      switchOverlays(S.job.process, next.process);
      S.job = next;
      changed();
    },
  };
}

function injectStyles() {
  // The bottom-bar strip borrows the app's own #dimension-strip rules.
  const borrowed = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of rules) {
      if (r.selectorText?.includes("#dimension-strip")) borrowed.push(r.cssText.replaceAll("#dimension-strip", "#sheet-strip"));
    }
  }
  const style = document.createElement("style");
  style.textContent = `
${borrowed.join("\n")}
#panel .control[hidden], #panel .control-cluster[hidden], #panel .control-row[hidden], #panel p[hidden],
#sheet-strip[hidden], .sheet-control[hidden], .sheet-custom[hidden], .sheet-flat[hidden], .sheet-flat-tip[hidden],
.section-hud.sheet-mode > :not(.sheet-flat-toggle), .section-hud:not(.sheet-mode) > .sheet-flat-toggle,
#dimension-strip[hidden], .btn[hidden], .sheet-material[hidden] { display: none; }
#sheet-strip .sheet-warn { color: var(--warn); }
#sheet-strip .control-fix { color: var(--warn); font-size: 0.68rem; }
.sheet-chip {
  margin-left: 10px; padding: 1px 7px; border: 1px solid var(--accent); border-radius: 3px;
  font: 500 0.62rem var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent);
}
.sheet-build .control-row { margin-bottom: 2px; }
.sheet-material { margin: 0 0 6px; }
.sheet-custom { grid-template-columns: 4.5rem 1fr auto 1fr auto; align-items: center; gap: 6px; margin-top: 4px; }
.sheet-num {
  width: 100%; min-width: 0; padding: 3px 6px; font: 0.75rem var(--font-mono); color: var(--text);
  background: var(--panel-inset); border: 1px solid var(--line); border-radius: 3px;
}
#canvas-host .section-hud { z-index: 2; }
.sheet-flat {
  position: absolute; inset: 0; z-index: 1; display: flex; flex-direction: column;
  background: var(--bg); padding: 12px 12px 60px;
}
.sheet-flat-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.sheet-flat-tabs { display: flex; gap: 4px; }
.sheet-tab {
  font: 500 0.68rem var(--font-mono); letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-dim);
  background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 3px 9px; cursor: pointer;
}
.sheet-tab[aria-pressed="true"] { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); }
.sheet-flat-legend { display: flex; gap: 12px; margin-left: auto; font: 0.68rem var(--font-mono); color: var(--text-dim); }
.sheet-legend-item::before {
  content: ""; display: inline-block; width: 14px; height: 0; margin-right: 5px; vertical-align: middle;
  border-top: 2px solid var(--c);
}
.sheet-flat-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.sheet-board { width: 100%; height: 100%; }
.sheet-board-bg { stroke: rgba(0,0,0,0.25); stroke-width: 0.6; }
.sheet-part { cursor: pointer; }
.sheet-part-hit { fill: transparent; stroke: none; pointer-events: fill; }
.sheet-part-fill { fill: rgba(0,0,0,0.04); stroke: none; pointer-events: none; transition: fill 120ms ease; }
.sheet-line { pointer-events: none; }
.sheet-part:hover .sheet-part-fill { fill: color-mix(in srgb, #ffcc44 45%, transparent); }
.sheet-part--coupon { cursor: help; }
.sheet-part--printed .sheet-part-fill { fill: ${PLATE_CLIP}; }
.sheet-part--printed .sheet-line--cut { stroke: #8a4a20; }
.sheet-part--printed:hover .sheet-part-fill { fill: #ffcc44; }
.sheet-line { fill: none; stroke-width: 0.45; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.sheet-line--cut { stroke-width: 1.2; }
.sheet-line--mark { stroke-width: 0.8; opacity: 0.75; }
.sheet-line--valley, .sheet-line--mountain, .sheet-line--score { stroke-width: 1.1; }
.sheet-line--mountain { stroke-dasharray: 6 3; }
.sheet-line--valley { stroke-dasharray: 6 2 1.5 2; }
.sheet-export { width: min(640px, calc(100vw - 32px)); max-width: none; }
.sheet-export-body { gap: 10px; max-height: min(80vh, 760px); overflow: auto; }
.sheet-export-head { display: flex; align-items: center; justify-content: space-between; }
.sheet-export-close { font-size: 1.2rem; line-height: 1; padding: 2px 8px; }
.sheet-export-list { display: flex; flex-direction: column; gap: 6px; }
.sheet-export-row {
  display: grid; grid-template-columns: 72px 1fr auto; gap: 12px; align-items: center;
  padding: 6px 8px; border: 1px solid var(--line); border-radius: 3px; background: var(--panel-inset);
}
.sheet-export-thumb svg { display: block; width: 72px; height: 54px; border-radius: 2px; }
.sheet-export-text { min-width: 0; }
.sheet-export-name { font: 500 0.75rem var(--font-mono); color: var(--text); overflow-wrap: anywhere; }
.sheet-export-detail { font-size: 0.72rem; color: var(--text-dim); line-height: 1.35; margin-top: 2px; }
.sheet-export-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.sheet-flat-tip {
  position: absolute; left: 12px; bottom: 12px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 3px;
  background: color-mix(in srgb, var(--panel) 92%, transparent); font: 500 0.72rem var(--font-mono); color: var(--accent);
  pointer-events: none;
}
`;
  document.head.append(style);
}
