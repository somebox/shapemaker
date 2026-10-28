/**
 * Clickable mockup of the Cut and Fold modes, mounted over the real app
 * when the URL carries ?sheet. It adds the Build switch to Form, swaps the
 * rows each mode doesn't use for its own, shows the cut parts put together
 * in the viewer, adds a Flat view of the boards, and turns Export STL into
 * Export cut file. Everything is computed live from the current skeleton.
 *
 * It only touches the DOM the app already built, and keeps its own
 * settings in localStorage, so the app itself is unchanged without the
 * flag. Plan: docs/LASER_RESEARCH.md §8.
 */

import { buildSheet, BOARD_PROFILES, boardSvg, LAYERS } from "./index.js";
import { buildAssembly } from "./assembly.js";
import { apply } from "./geom2.js";
import { MAX_BORDER } from "./cut.js";
import { OPENING_GENERATORS } from "../solid/shell.js";
import { el } from "../controls.js";

const STORE_KEY = "shapemaker.sheetMockup";

const DEFAULTS = {
  build: "print",
  flat: false,
  cut: { sheetMm: 3, join: "clips", kerfMm: 0, fit: "normal", board: "falcon-a1", custom: { w: 300, h: 200 }, labels: true },
  fold: { join: "tape", foldStyle: "score", board: "a4", custom: { w: 300, h: 200 }, labels: true },
};

/** Slot clearance per fit, mm. */
const FIT_CLEARANCE = { snug: 0, normal: 0.1, loose: 0.2 };

const MATERIAL = { cut: "Rigid sheet: plywood, acrylic, MDF", fold: "Thin stock: paper, card, felt" };

/** Board fill in the Flat view, by mode. */
const BOARD_FILL = { cut: "#d8b98c", fold: "#f3f0e8" };

const COLORS = {
  panel: 0xcfa874,
  clip: 0x9a7448,
  tie: 0x2a2a2e,
  paper: 0xf0ece4,
  flap: 0xe2d8c6,
  tape: 0x8fb6c9,
  thread: 0xc0503c,
  pick: 0xffcc44,
};

/** Choices each setting may take; anything else falls back to the default. */
const CHOICES = {
  build: ["print", "cut", "fold"],
  join: { cut: ["clips", "ties", "tabs"], fold: ["tape", "flaps", "sew"] },
  fit: Object.keys(FIT_CLEARANCE),
  foldStyle: ["score", "perforate", "mark"],
};

function loadSettings() {
  const S = structuredClone(DEFAULTS);
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
  } catch {
    /* private window, blocked storage or bad JSON: defaults */
  }
  if (!saved || typeof saved !== "object") return S;
  const ok = (v, list) => list.includes(v);
  const num = (v, lo, hi) => typeof v === "number" && v >= lo && v <= hi;
  if (ok(saved.build, CHOICES.build)) S.build = saved.build;
  S.flat = saved.flat === true && S.build !== "print";
  for (const m of ["cut", "fold"]) {
    const from = saved[m] ?? {}, to = S[m];
    if (ok(from.join, CHOICES.join[m])) to.join = from.join;
    if (from.board === "custom" || BOARD_PROFILES[from.board]) to.board = from.board;
    if (num(from.custom?.w, 50, 2000) && num(from.custom?.h, 50, 2000)) to.custom = { w: from.custom.w, h: from.custom.h };
    if (typeof from.labels === "boolean") to.labels = from.labels;
  }
  if (num(saved.cut?.sheetMm, 0.5, 8)) S.cut.sheetMm = saved.cut.sheetMm;
  if (num(saved.cut?.kerfMm, 0, 0.4)) S.cut.kerfMm = saved.cut.kerfMm;
  if (ok(saved.cut?.fit, CHOICES.fit)) S.cut.fit = saved.cut.fit;
  if (ok(saved.fold?.foldStyle, CHOICES.foldStyle)) S.fold.foldStyle = saved.fold.foldStyle;
  return S;
}

function saveSettings(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * @param {{
 *   viewer: ReturnType<import("../viewer.js").createViewer>,
 *   getLast: () => any,
 *   applyPatch: (patch: object, commit: boolean) => void,
 *   exportStem: () => string,
 *   download: (data: BlobPart, filename: string, mime: string) => void,
 * }} app
 */
export function mountSheetMockup({ viewer, getLast, applyPatch, exportStem, download }) {
  const S = loadSettings();
  /** @type {any} */
  let sheet = null;
  let sheetError = "";
  let boardIndex = 0;
  let buildTimer = null;

  injectStyles();

  const panelEl = document.getElementById("panel");
  const canvasHost = document.getElementById("canvas-host");
  const appStrip = document.getElementById("dimension-strip");
  const formBody = panelEl.querySelector('section[data-group="form"] .group-body');
  const makeBody = panelEl.querySelector('section[data-group="make"] .group-body');
  const hud = canvasHost.querySelector(".section-hud");

  // The app's own rows each mode hides.
  const byKey = (k) => panelEl.querySelector(`.control[data-key="${k}"]`);
  const printOnlyForm = [
    byKey("depth"),
    byKey("wallMm"),
    byKey("roundingMm"),
    byKey("openingAxis"),
    formBody.querySelector('[data-cluster="form-advanced"]'),
  ];
  const materialRows = [...makeBody.querySelectorAll(".control-row--material")];
  const printOnlyMake = [byKey("edgeDiv"), ...materialRows];
  const faceHint = [...makeBody.querySelectorAll("p.hint")].find((p) => /click a face/i.test(p.textContent));
  const faceHintPrint = faceHint?.textContent ?? "";
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

  // ── Form: Build switch and each mode's rows ──
  const buildRow = segControl("Build", [["print", "Print"], ["cut", "Cut"], ["fold", "Fold"]], () => S.build, (v) => {
    if (v === S.build) return;
    if (S.build === "print") {
      printOverlays = overlayInputs.filter((i) => i.checked);
      for (const i of printOverlays) i.click();
    } else if (v === "print") {
      for (const i of printOverlays) if (!i.checked && !i.matches("[data-split-on]")) i.click();
      printOverlays = [];
      S.flat = false;
    }
    S.build = v;
    changed();
  });
  buildRow.root.classList.add("sheet-build");
  const materialNote = el("p", { className: "hint sheet-material" });
  buildRow.root.append(materialNote);
  formBody.prepend(buildRow.root);

  const sheetRow = rangeControl("Sheet", 0.5, 8, 0.5, "mm", () => S.cut.sheetMm, (v) => {
    S.cut.sheetMm = v;
    changed();
  });
  const cutJoin = segControl("Join", [["clips", "Clips"], ["ties", "Ties"], ["tabs", "Tabs"]], () => S.cut.join, (v) => {
    S.cut.join = v;
    changed();
  }, {
    clips: "A small clip cut in the plane square to each edge; holds any angle",
    ties: "Pairs of holes along each edge for zip ties or wire",
    tabs: "Tabs on one panel through slots in the next; near-90° edges only, others get clips",
  });
  const foldJoin = segControl("Join", [["tape", "Tape"], ["flaps", "Flaps"], ["sew", "Sew"]], () => S.fold.join, (v) => {
    S.fold.join = v;
    changed();
  }, {
    tape: "Plain open edges; tape them inside",
    flaps: "Glue flaps on one side of each open edge",
    sew: "Stitch holes along both sides of each open edge",
  });
  const foldLines = segControl("Fold lines", [["score", "Score"], ["perforate", "Perforate"], ["mark", "Mark"]], () => S.fold.foldStyle, (v) => {
    S.fold.foldStyle = v;
    changed();
  }, {
    score: "Low-power lines, valley and mountain on their own layers",
    perforate: "Dashed through-cuts; folds easily, weaker",
    mark: "Engraved only; fold by hand",
  });
  const kerfRow = rangeControl("Kerf", 0, 0.4, 0.01, "mm", () => S.cut.kerfMm, (v) => {
    S.cut.kerfMm = v;
    changed();
  });
  const fitRow = segControl("Fit", [["snug", "Snug"], ["normal", "Normal"], ["loose", "Loose"]], () => S.cut.fit, (v) => {
    S.cut.fit = v;
    changed();
  });
  const cutAdvanced = cluster("Advanced", [kerfRow.root, fitRow.root], () => `kerf ${fmt(S.cut.kerfMm, 2)} · ${S.cut.fit}`);
  const cutRows = [sheetRow.root, cutJoin.root];
  const foldRows = [foldJoin.root, foldLines.root];
  buildRow.root.after(...cutRows, ...foldRows);
  formBody.querySelector('[data-cluster="form-advanced"]')?.after(cutAdvanced.root);
  if (!cutAdvanced.root.isConnected) formBody.append(cutAdvanced.root);

  // ── Make: Board and Labels ──
  const boardRow = boardControl();
  const labelsRow = segControl("Labels", [["on", "On"], ["off", "Off"]], () => (mode()?.labels ? "on" : "off"), (v) => {
    mode().labels = v === "on";
    changed();
  });
  makeBody.prepend(boardRow.root, labelsRow.root);

  // ── Viewport: Flat toggle, board tabs ──
  const flatToggle = el("label", { className: "section-hud-toggle sheet-flat-toggle", title: "Show the boards laid out flat" });
  const flatInput = el("input", { type: "checkbox" });
  flatToggle.append(flatInput, el("span", { textContent: "Flat" }));
  flatInput.addEventListener("change", () => {
    S.flat = flatInput.checked;
    changed(false);
  });
  hud?.append(flatToggle);

  const flatView = el("div", { className: "sheet-flat", hidden: true });
  const flatBar = el("div", { className: "sheet-flat-bar" });
  const flatTabs = el("div", { className: "sheet-flat-tabs" });
  const flatLegend = el("div", { className: "sheet-flat-legend" });
  flatBar.append(flatTabs, flatLegend);
  const flatStage = el("div", { className: "sheet-flat-stage" });
  const flatTip = el("div", { className: "sheet-flat-tip", hidden: true });
  flatView.append(flatBar, flatStage, flatTip);
  canvasHost.append(flatView);

  // ── Bottom bar ──
  const exportCut = el("button", { type: "button", className: "btn btn-accent", textContent: "Export cut file", hidden: true });
  exportCut.addEventListener("click", downloadBoards);
  exportSvg?.before(exportCut);
  const strip = el("div", { id: "sheet-strip", "aria-live": "polite", hidden: true });
  appStrip.after(strip);

  // ── Wiring ──
  function mode() {
    return S.build === "cut" ? S.cut : S.build === "fold" ? S.fold : null;
  }

  function changed(rebuild = true) {
    saveSettings(S);
    syncPanel();
    if (rebuild) scheduleBuild();
    else render();
  }

  function syncPanel() {
    const sheetMode = S.build !== "print";
    for (const n of [...printOnlyForm, ...printOnlyMake]) if (n) n.hidden = sheetMode;
    for (const n of cutRows) n.hidden = S.build !== "cut";
    for (const n of foldRows) n.hidden = S.build !== "fold";
    cutAdvanced.root.hidden = S.build !== "cut";
    boardRow.root.hidden = !sheetMode;
    labelsRow.root.hidden = !sheetMode;
    materialNote.textContent = MATERIAL[S.build] ?? "";
    materialNote.hidden = !sheetMode;
    if (faceHint) {
      faceHint.textContent =
        S.build === "cut" ? "Click a face on the model to find its panel on the board."
        : S.build === "fold" ? "Click a face on the model to centre the first net on it."
        : faceHintPrint;
    }
    hud?.classList.toggle("sheet-mode", sheetMode);
    flatInput.checked = S.flat;
    exportStl.hidden = sheetMode;
    exportCut.hidden = !sheetMode;
    appStrip.hidden = sheetMode;
    strip.hidden = !sheetMode;
    for (const c of [buildRow, sheetRow, cutJoin, foldJoin, foldLines, kerfRow, fitRow, labelsRow]) c.sync();
    boardRow.sync();
    cutAdvanced.sync();
  }

  function scheduleBuild() {
    clearTimeout(buildTimer);
    if (S.build === "print") {
      sheet = null;
      viewer.setAltModel(null);
      render();
      return;
    }
    strip.textContent = "laying out…";
    buildTimer = setTimeout(build, 60);
  }

  function boardSize() {
    const m = mode();
    if (m.board === "custom") return { label: `${fmt(m.custom.w)} × ${fmt(m.custom.h)} mm`, ...m.custom };
    return BOARD_PROFILES[m.board];
  }

  function openingsOf(state) {
    return state.openings
      ? { generator: OPENING_GENERATORS[state.openingStyle], borderFraction: state.borderFraction ?? 0.36, filletMm: state.filletMm }
      : null;
  }

  function build() {
    const last = getLast();
    sheet = null;
    sheetError = "";
    if (!last?.skeleton) {
      sheetError = "No model to lay out";
      render();
      return;
    }
    const state = last.state;
    const openings = openingsOf(state);
    try {
      const m = mode();
      sheet = buildSheet(last.skeleton, {
        mode: S.build,
        board: boardSize(),
        labels: m.labels,
        openings,
        ...(S.build === "cut"
          ? { join: m.join, sheetMm: m.sheetMm, kerfMm: m.kerfMm, clearanceMm: FIT_CLEARANCE[m.fit], coupon: true }
          : { join: m.join, foldStyle: m.foldStyle, rootFace: state.faceIndex }),
      });
      sheet.openings = openings;
      sheet.borderFraction = openings?.borderFraction ?? null;
      viewer.setAltModel(assemblyModel(last.skeleton, sheet, openings));
    } catch (err) {
      console.error("sheet mockup:", err);
      sheetError = `Couldn't lay this shape out: ${err.message}`;
      viewer.setAltModel(null);
    }
    boardIndex = Math.min(boardIndex, Math.max(0, (sheet?.boards.length ?? 1) - 1));
    render();
  }

  function render() {
    syncPanel();
    paintStrip();
    const flat = S.build !== "print" && S.flat && sheet;
    flatView.hidden = !flat;
    if (flat) paintFlat();
  }

  // ── Status line ──
  function paintStrip() {
    strip.replaceChildren();
    if (S.build === "print") return;
    if (sheetError) {
      strip.append(el("span", { className: "err", textContent: sheetError }));
      return;
    }
    if (!sheet) return;
    const st = sheet.stats;
    const b = boardSize();
    const boards = `${plural(st.boards, "board")} ${fmt(b.w)}×${fmt(b.h)}`;
    let line1, line2;
    if (sheet.mode === "cut") {
      const clips = Object.values(st.clips ?? {}).reduce((a, n) => a + n, 0);
      const joins = [clips && plural(clips, "clip"), st.ties && plural(st.ties, "tie"), st.tabs && plural(st.tabs, "tab"), st.glued && `${st.glued} glued`]
        .filter(Boolean)
        .join(" + ");
      line1 = `cut   ${plural(st.panels, "panel")} · ${joins} · ${boards} · sheet ${fmt(S.cut.sheetMm)} mm`;
      const types = Object.keys(st.clips ?? {}).length;
      line2 = `edges ${fmt(st.dihedralDeg[0], 0)}–${fmt(st.dihedralDeg[1], 0)}° · shortest side ${fmt(st.smallestSideMm)} mm${types ? ` · ${plural(types, "clip shape")}` : ""}`;
    } else {
      line1 = `fold  ${plural(st.nets, "net")} · ${plural(st.panels, "face")} · ${plural(st.folds, "fold")} · ${plural(st.openEdges, S.fold.join === "tape" ? "taped edge" : S.fold.join === "flaps" ? "flap" : "sewn edge")} · ${boards}`;
      line2 = `largest net ${plural(st.largestNet, "face")} · fold lines ${S.fold.foldStyle}`;
    }
    strip.append(document.createTextNode(`${line1}\n${line2}`));
    const warn = sheet.warnings[0];
    if (warn) {
      const w = el("span", { className: "sheet-warn", textContent: `\n▲ ${warn}${sheet.warnings.length > 1 ? ` (+${sheet.warnings.length - 1})` : ""}` });
      w.title = sheet.warnings.join("\n");
      strip.append(w);
      // Same "fix" pattern as the print warnings: a wider border, or
      // closed faces when no border is wide enough.
      const need = sheet.stats.minBorderFraction;
      if (sheet.mode === "cut" && sheet.borderFraction != null && need > sheet.borderFraction) {
        const pct = Math.ceil(need * 100);
        const fix = pct <= MAX_BORDER * 100
          ? el("button", { type: "button", className: "control-fix", textContent: `Use ${pct}% border` })
          : el("button", { type: "button", className: "control-fix", textContent: "Close the faces" });
        fix.addEventListener("click", () => applyPatch(pct <= MAX_BORDER * 100 ? { borderFraction: pct / 100 } : { openings: false }, true));
        strip.append(" ", fix);
      }
    }
  }

  // ── Flat view ──
  function paintFlat() {
    const size = boardSize();
    flatTip.hidden = true;
    flatTabs.replaceChildren(
      ...sheet.boards.map((_, i) =>
        Object.assign(el("button", { type: "button", className: "sheet-tab", textContent: `Board ${i + 1}`, "aria-pressed": String(i === boardIndex) }), {
          onclick: () => {
            boardIndex = i;
            paintFlat();
          },
        }),
      ),
    );
    const used = new Set(sheet.boards.flatMap((b) => b.items.flatMap((it) => it.part.paths.map((p) => p.layer))));
    flatLegend.replaceChildren(
      ...Object.entries(LAYERS)
        .filter(([k]) => used.has(k))
        .map(([k, { color }]) =>
          el("span", { className: "sheet-legend-item", style: `--c:${color}`, textContent: { cut: "cut", mark: "engrave", valley: "valley fold", mountain: "mountain fold", score: "score" }[k] }),
        ),
    );

    const board = sheet.boards[boardIndex];
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `-4 -4 ${size.w + 8} ${size.h + 8}`);
    svg.setAttribute("class", "sheet-board");
    const bg = document.createElementNS(svgNS, "rect");
    Object.entries({ x: 0, y: 0, width: size.w, height: size.h, rx: 1.5, fill: BOARD_FILL[sheet.mode], class: "sheet-board-bg" }).forEach(([k, v]) => bg.setAttribute(k, String(v)));
    svg.append(bg);
    const P = (tf, q) => {
      const [x, y] = apply(tf, q);
      return `${fmt(x, 2)},${fmt(size.h - y, 2)}`;
    };
    for (const { part, tf } of board.items) {
      const g = document.createElementNS(svgNS, "g");
      g.setAttribute("class", `sheet-part sheet-part--${part.kind}`);
      // The piece's area takes the hover fill (evenodd leaves its holes
      // open). A net's outline is open cut runs, so its faces and flaps
      // stand in for it.
      const closed = part.faces ? part.faces.map((pts) => ({ pts })) : part.paths.filter((p) => p.closed && p.layer === "cut");
      const ring = (pts) => `M${pts.map((q) => P(tf, q)).join("L")}Z`;
      const body = closed.map((p) => ring(p.pts)).join("");
      if (closed.length) {
        // The outline alone takes the pointer, so holes still pick the part.
        const hit = document.createElementNS(svgNS, "path");
        hit.setAttribute("d", part.faces ? body : ring(closed[0].pts));
        hit.setAttribute("class", "sheet-part-hit");
        g.append(hit);
      }
      if (body) {
        const fill = document.createElementNS(svgNS, "path");
        fill.setAttribute("d", body);
        fill.setAttribute("class", "sheet-part-fill");
        fill.setAttribute("fill-rule", part.faces ? "nonzero" : "evenodd");
        g.append(fill);
      }
      for (const [layer, { color }] of Object.entries(LAYERS)) {
        const d = part.paths.filter((p) => p.layer === layer).map((p) => `M${p.pts.map((q) => P(tf, q)).join("L")}${p.closed ? "Z" : ""}`).join("");
        if (!d) continue;
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", d);
        path.setAttribute("stroke", color);
        path.setAttribute("class", `sheet-line sheet-line--${layer}`);
        g.append(path);
      }
      g.addEventListener("pointerenter", () => {
        flatTip.hidden = false;
        flatTip.textContent = partLabel(part);
      });
      g.addEventListener("pointerleave", () => {
        flatTip.hidden = true;
      });
      g.addEventListener("click", () => showPart(part));
      svg.append(g);
    }
    flatStage.replaceChildren(svg);
  }

  function partLabel(part) {
    const see = "click to see it on the model";
    if (part.kind === "panel") return `Panel ${part.panel + 1} · ${see}`;
    if (part.kind === "clip") return `Clip ${part.name.replace(/^clip /, "")} · edge ${part.joint} · ${see}`;
    if (part.kind === "net") return `Net ${part.name.replace(/^net /, "")} · ${plural(part.panels.length, "face")} · ${see}`;
    if (part.kind === "coupon") return `${part.name[0].toUpperCase()}${part.name.slice(1)} · cut this first to check the slot fit`;
    return part.name;
  }

  /** Leave Flat and light the part up on the model. */
  function showPart(part) {
    const keys =
      part.kind === "panel" ? [`p${part.panel}`]
      : part.kind === "clip" ? [`j${part.joint}`]
      : part.kind === "net" ? part.panels.map((p) => `p${p}`)
      : [];
    if (!keys.length) return;
    S.flat = false;
    changed(false);
    highlight(keys);
  }

  function highlight(keys) {
    viewer.highlightAlt(keys, COLORS.pick, 2400);
  }

  // ── 3D: the parts put together, as plain data the viewer draws ──
  function assemblyModel(skeleton, res, openings) {
    const { solids } = buildAssembly(skeleton, res, { openings });
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

  // ── Export cut file ──
  function downloadBoards() {
    if (!sheet) return;
    const size = boardSize();
    const m = mode();
    const stem = `${exportStem()}_${sheet.mode}_${m.join}${sheet.mode === "cut" ? `_${fmt(m.sheetMm)}mm` : ""}`;
    sheet.boards.forEach((board, i) => {
      const name = sheet.boards.length > 1 ? `${stem}_board${i + 1}` : stem;
      download(boardSvg(board, size, { title: name }), `${name}.svg`, "image/svg+xml");
    });
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

  function boardControl() {
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
      mode().board = select.value;
      changed();
    });
    // Out-of-range or empty sizes snap back into 50–2000 mm.
    const clampSize = (input, was) => {
      const v = Number(input.value);
      return Number.isFinite(v) && input.value !== "" ? Math.min(2000, Math.max(50, Math.round(v))) : was;
    };
    const onSize = () => {
      const m = mode();
      m.custom = { w: clampSize(w, m.custom.w), h: clampSize(h, m.custom.h) };
      changed();
    };
    w.addEventListener("change", onSize);
    h.addEventListener("change", onSize);
    return {
      root,
      sync() {
        const m = mode();
        if (!m) return;
        select.value = m.board;
        customRow.hidden = m.board !== "custom";
        w.value = String(m.custom.w);
        h.value = String(m.custom.h);
      },
    };
  }

  syncPanel();
  return {
    /** Called after every rebuild of the model. */
    onResult() {
      if (S.build !== "print") scheduleBuild();
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
.sheet-custom { grid-template-columns: var(--label-col, 88px) 1fr auto 1fr auto; align-items: center; gap: 6px; }
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
.sheet-line { fill: none; stroke-width: 0.45; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.sheet-line--cut { stroke-width: 1.2; }
.sheet-line--mark { stroke-width: 0.8; opacity: 0.75; }
.sheet-line--valley, .sheet-line--mountain, .sheet-line--score { stroke-width: 1.1; }
.sheet-line--mountain { stroke-dasharray: 6 3; }
.sheet-line--valley { stroke-dasharray: 6 2 1.5 2; }
.sheet-flat-tip {
  position: absolute; left: 12px; bottom: 12px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 3px;
  background: color-mix(in srgb, var(--panel) 92%, transparent); font: 500 0.72rem var(--font-mono); color: var(--accent);
  pointer-events: none;
}
`;
  document.head.append(style);
}
