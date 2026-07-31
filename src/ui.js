/**
 * Panel UI — owns DOM, emits patches. Never owns canonical state.
 * Control definitions live in schema.js.
 */

import { VERSION } from "./version.js";
import { CONTROL_DEFS } from "./schema.js";
import { faceFamilies, locateFace } from "./face-families.js";

export { CONTROL_DEFS };

const GROUPS = [
  { id: "shape", title: "Shape" },
  { id: "form", title: "Form" },
  { id: "inspect", title: "Inspect" },
  { id: "make", title: "Make" },
];

/**
 * Apply coupled-control rules so routine interactions never emit invalid combos.
 * @param {object} patch
 * @param {object} current
 */
export function normalizePatch(patch) {
  const next = { ...patch };
  if (next.depth === "solid") next.openings = false;
  if (next.openings === true) next.depth = "hollow";
  return next;
}

/**
 * @param {HTMLElement} panelEl
 * @param {{
 *   onPatch: (patch: object, opts: { commit: boolean }) => void,
 *   onSave: () => void,
 *   onExport: () => void,
 *   onOpen?: () => void,
 *   onCopyLink?: () => void,
 *   onPreset?: (id: string) => void,
 *   onNameChange: (name: string) => void,
 * }} handlers
 */
export function createPanel(panelEl, handlers) {
  panelEl.innerHTML = "";
  const scroll = el("div", { id: "panel-scroll" });
  panelEl.appendChild(scroll);

  // Identity
  const identity = el("div", { className: "identity" });
  const nameInput = el("input", {
    className: "identity-name",
    type: "text",
    id: "project-name",
    value: "Untitled",
    spellcheck: "false",
  });
  nameInput.setAttribute("aria-label", "Project name");
  const dirtyDot = el("span", { className: "dirty-dot" });
  dirtyDot.setAttribute("data-on", "0");
  const dirtyLabel = el("span", { className: "dirty-label", textContent: "edited" });
  dirtyLabel.setAttribute("data-on", "0");
  identity.append(nameInput, dirtyDot, dirtyLabel);
  scroll.appendChild(identity);

  const presetStrip = el("div", { className: "preset-strip" });
  presetStrip.setAttribute("data-preset-strip", "");
  presetStrip.hidden = true;
  scroll.appendChild(presetStrip);

  nameInput.addEventListener("input", () => {
    handlers.onNameChange(nameInput.value.trim() || "Untitled");
  });

  /** @type {Map<string, HTMLElement>} */
  const controlRoots = new Map();
  /** @type {Map<string, HTMLInputElement|HTMLSelectElement>} */
  const inputs = new Map();
  /** @type {Map<string, HTMLInputElement>} */
  const ranges = new Map();
  /** @type {Map<string, HTMLElement>} */
  const errNodes = new Map();
  /** @type {Map<string, {min: HTMLElement, max: HTMLElement}>} */
  const limitLabels = new Map();

  for (const g of GROUPS) {
    const section = el("section", { className: "group", dataset: { group: g.id } });
    section.appendChild(groupHeader(g.title));
    scroll.appendChild(section);

    if (g.id === "shape" || g.id === "form") {
      for (const def of CONTROL_DEFS.filter((c) => c.group === g.id)) {
        const root = buildControl(def, handlers, inputs, ranges, errNodes, limitLabels);
        controlRoots.set(def.key, root);
        section.appendChild(root);
      }
      if (g.id === "shape") {
        section.appendChild(buildFutureBlock());
      }
    } else if (g.id === "inspect") {
      section.appendChild(buildInspect());
    } else if (g.id === "make") {
      section.appendChild(buildMake(handlers));
    }
  }

  const version = el("div", { className: "version", textContent: `v${VERSION}` });
  scroll.appendChild(version);

  const strip = el("div", { id: "dimension-strip" });
  strip.setAttribute("aria-live", "polite");
  strip.textContent = "compiling…";
  panelEl.appendChild(strip);

  let lastStrip = "";
  let edgeMean = null;
  let circumdiameter = null;
  /** @type {ReturnType<typeof requestAnimationFrame>|null} */
  let raf = null;
  let pendingPatch = null;

  function flushPatch(commit) {
    if (raf != null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    if (pendingPatch) {
      const p = pendingPatch;
      pendingPatch = null;
      handlers.onPatch(p, { commit });
    } else if (commit) {
      handlers.onPatch({}, { commit: true });
    }
  }

  function queuePatch(patch, commit) {
    pendingPatch = { ...(pendingPatch || {}), ...patch };
    if (commit) {
      flushPatch(true);
      return;
    }
    if (raf == null) {
      raf = requestAnimationFrame(() => {
        raf = null;
        flushPatch(false);
      });
    }
  }

  // Wire inputs that were built with placeholders — rebind through closure
  for (const [key, input] of inputs) {
    const def = CONTROL_DEFS.find((c) => c.key === key);
    if (!def) continue;
    if (def.type === "range" || def.type === "number") {
      input.addEventListener("input", () => {
        const n = Number(input.value);
        if (!Number.isFinite(n)) return;
        if (key === "edgeLengthMm") {
          if (edgeMean == null || circumdiameter == null || edgeMean <= 0) return;
          const nextCirc = (n / edgeMean) * circumdiameter;
          queuePatch({ circumdiameterMm: round1(nextCirc) }, false);
          return;
        }
        queuePatch({ [key]: uiToState(def, n) }, false);
      });
      input.addEventListener("change", () => {
        const n = Number(input.value);
        if (!Number.isFinite(n)) return;
        if (key === "edgeLengthMm") {
          if (edgeMean == null || circumdiameter == null || edgeMean <= 0) return;
          const nextCirc = (n / edgeMean) * circumdiameter;
          queuePatch({ circumdiameterMm: round1(nextCirc) }, true);
          return;
        }
        queuePatch({ [key]: uiToState(def, n) }, true);
      });
    } else if (def.type === "select") {
      input.addEventListener("change", () => {
        queuePatch({ [key]: input.value }, true);
      });
    }
  }

  for (const [key, range] of ranges) {
    const def = CONTROL_DEFS.find((c) => c.key === key);
    range.addEventListener("input", () => {
      const n = Number(range.value);
      const num = inputs.get(key);
      if (num) num.value = fmtInput(n);
      queuePatch({ [key]: uiToState(def, n) }, false);
    });
    range.addEventListener("change", () => {
      queuePatch({ [key]: uiToState(def, Number(range.value)) }, true);
    });
  }

  // Segment buttons
  panelEl.querySelectorAll("[data-seg-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-seg-key");
      let value = btn.getAttribute("data-seg-value");
      if (key === "openings") value = value === "true";
      queuePatch({ [key]: value }, true);
    });
  });

  const inspectEls = {
    dims: panelEl.querySelector("[data-inspect=dims]"),
    edge: panelEl.querySelector("[data-inspect=edge]"),
    wall: panelEl.querySelector("[data-inspect=wall]"),
    border: panelEl.querySelector("[data-inspect=border]"),
    opening: panelEl.querySelector("[data-inspect=opening]"),
    fillet: panelEl.querySelector("[data-inspect=fillet]"),
    selectedEdge: panelEl.querySelector("[data-inspect=selected-edge]"),
  };
  const faceReadout = panelEl.querySelector("[data-face-readout]");
  const faceStepper = panelEl.querySelector("[data-face-stepper]");
  const warnLine = panelEl.querySelector("[data-base-warn]");
  const saveBtn = panelEl.querySelector("#btn-save");
  const exportBtn = panelEl.querySelector("#btn-export");
  const openBtn = panelEl.querySelector("#btn-open");
  const copyBtn = panelEl.querySelector("#btn-copy-link");

  /** @type {{ sides: number, label: string, indices: number[] }[]} */
  let families = [];
  let familyIndex = 0;

  saveBtn?.addEventListener("click", () => handlers.onSave());
  exportBtn?.addEventListener("click", () => handlers.onExport());
  openBtn?.addEventListener("click", () => handlers.onOpen?.());
  copyBtn?.addEventListener("click", () => handlers.onCopyLink?.());

  faceStepper?.querySelector("[data-face-prev]")?.addEventListener("click", () => {
    stepFace(-1);
  });
  faceStepper?.querySelector("[data-face-next]")?.addEventListener("click", () => {
    stepFace(1);
  });
  faceStepper?.querySelector("[data-face-family]")?.addEventListener("click", () => {
    if (families.length < 2) return;
    familyIndex = (familyIndex + 1) % families.length;
    const faceIndex = families[familyIndex].indices[0];
    queuePatch({ faceIndex }, true);
  });

  function stepFace(delta) {
    if (!families.length) return;
    const fam = families[familyIndex] || families[0];
    const loc = locateFace(families, Number(faceReadout?.dataset.faceIndex ?? 0));
    familyIndex = loc.familyIndex;
    const cur = families[familyIndex];
    const n = cur.indices.length;
    const nextK = (loc.indexInFamily + delta + n) % n;
    queuePatch({ faceIndex: cur.indices[nextK] }, true);
  }

  function setSegment(key, value) {
    panelEl.querySelectorAll(`[data-seg-key="${key}"]`).forEach((btn) => {
      btn.setAttribute(
        "aria-pressed",
        btn.getAttribute("data-seg-value") === String(value) ? "true" : "false",
      );
    });
  }

  return {
    setResult(result, { limits, invalid, warnings } = {}) {
      const state = result?.state;
      const metrics = result?.metrics;
      const validation = result?.validation;
      const lim = limits || metrics?.limits;

      if (state) {
        circumdiameter = state.circumdiameterMm;
        applyStateToControls(state, inputs, ranges, controlRoots);
        setSegment("depth", state.depth);
        setSegment("openings", String(!!state.openings));
      }

      if (result?.skeleton?.faces) {
        families = faceFamilies(result.skeleton.faces);
        const fi = state?.faceIndex ?? 0;
        const loc = locateFace(families, fi);
        familyIndex = loc.familyIndex;
        updateFaceStepper(faceStepper, faceReadout, loc, families.length > 1);
      }

      if (warnLine) {
        const msg = warnings?.[0] || "";
        warnLine.textContent = msg;
        warnLine.hidden = !msg;
      }

      if (metrics) {
        edgeMean = metrics.edgeMm.mean;
        const edgeInput = inputs.get("edgeLengthMm");
        if (edgeInput && document.activeElement !== edgeInput) {
          edgeInput.value = fmtInput(metrics.edgeMm.mean);
        }
        setInspect(inspectEls, metrics);
        updateStrip(strip, metrics, validation, lastStrip, (s) => {
          lastStrip = s;
        });
      } else if (invalid && validation) {
        updateStripErrors(strip, validation);
      }

      if (lim) applyLimits(lim, ranges, limitLabels, CONTROL_DEFS);

      for (const [, node] of errNodes) node.textContent = "";
      for (const [, root] of controlRoots) root.classList.remove("has-error");
      if (validation && !validation.ok) {
        for (const err of validation.errors) {
          const root = controlRoots.get(err.key);
          const msg = errNodes.get(err.key);
          if (root) root.classList.add("has-error");
          if (msg) msg.textContent = `▲ ${err.message}`;
        }
      }
    },

    setProjectStatus({ name, dirty, canSave }) {
      if (name != null && document.activeElement !== nameInput) {
        nameInput.value = name;
      }
      dirtyDot.setAttribute("data-on", dirty ? "1" : "0");
      dirtyLabel.setAttribute("data-on", dirty ? "1" : "0");
      if (saveBtn) saveBtn.disabled = !canSave;
    },

    setSelectedEdge(lengthMm) {
      if (!inspectEls.selectedEdge) return;
      inspectEls.selectedEdge.textContent =
        lengthMm == null ? "—" : `${fmt(lengthMm)} mm`;
    },

    setActionsVisible({ open, copyLink }) {
      if (openBtn) openBtn.hidden = !open;
      if (copyBtn) copyBtn.hidden = !copyLink;
    },

    setPresets(list) {
      presetStrip.innerHTML = "";
      if (!list?.length) {
        presetStrip.hidden = true;
        return;
      }
      presetStrip.hidden = false;
      for (const p of list) {
        const btn = el("button", {
          type: "button",
          className: "preset-chip",
          textContent: p.name,
        });
        btn.setAttribute("data-preset-id", p.id);
        btn.title = p.description || p.name;
        btn.addEventListener("click", () => handlers.onPreset?.(p.id));
        presetStrip.appendChild(btn);
      }
    },

    setPresetStatus(statuses) {
      for (const s of statuses || []) {
        const btn = presetStrip.querySelector(`[data-preset-id="${s.id}"]`);
        if (!btn) continue;
        btn.setAttribute("data-active", s.active ? "1" : "0");
        btn.setAttribute("data-edited", s.edited ? "1" : "0");
      }
    },
  };
}

function buildControl(def, _handlers, inputs, ranges, errNodes, limitLabels) {
  const root = el("div", { className: "control", dataset: { key: def.key } });

  if (def.type === "select") {
    const lab = el("label", { textContent: def.label });
    lab.htmlFor = `ctrl-${def.key}`;
    const sel = el("select", { className: "base-select", id: `ctrl-${def.key}` });
    for (const opt of def.options || []) {
      const o = el("option", { value: opt.value, textContent: opt.label });
      if (opt.disabled) o.disabled = true;
      sel.appendChild(o);
    }
    inputs.set(def.key, sel);
    root.append(lab, sel);
  } else if (def.type === "segments") {
    const lab = el("div", { className: "control-row" });
    lab.appendChild(el("label", { textContent: def.label }));
    root.appendChild(lab);
    const segs = el("div", { className: "segments", role: "group" });
    segs.setAttribute("aria-label", def.label);
    for (const opt of def.options || []) {
      const btn = el("button", {
        type: "button",
        textContent: opt.label,
      });
      btn.setAttribute("data-seg-key", def.key);
      btn.setAttribute("data-seg-value", opt.value);
      btn.setAttribute("aria-pressed", "false");
      segs.appendChild(btn);
    }
    root.appendChild(segs);
  } else if (def.type === "range" || def.type === "number") {
    const row = el("div", { className: "control-row" });
    const lab = el("label", { textContent: def.label });
    lab.htmlFor = `ctrl-${def.key}`;
    const num = el("input", {
      type: "number",
      id: `ctrl-${def.key}`,
      step: String(def.step ?? 0.1),
    });
    if (def.min != null) num.min = String(def.min);
    // Size slider max is convenience-only; typed circumdiameter may exceed it.
    if (def.max != null && def.key !== "circumdiameterMm") {
      num.max = String(def.max);
    }
    inputs.set(def.key, num);
    row.append(lab, num, el("span", { className: "unit", textContent: def.unit || "" }));
    root.appendChild(row);

    if (def.type === "range") {
      const wrap = el("div", { className: "slider-wrap" });
      const range = el("input", {
        type: "range",
        min: String(def.min ?? 0),
        max: String(def.max ?? 100),
        step: String(def.step ?? 0.1),
      });
      range.setAttribute("aria-label", def.label);
      ranges.set(def.key, range);
      const lim = el("div", { className: "slider-limits" });
      const minL = el("span", { textContent: String(def.min ?? "") });
      const maxL = el("span", { textContent: String(def.max ?? "") });
      lim.append(minL, maxL);
      limitLabels.set(def.key, { min: minL, max: maxL });
      wrap.append(range, lim);
      root.appendChild(wrap);
    }
  }

  const err = el("p", { className: "control-error", id: `err-${def.key}` });
  errNodes.set(def.key, err);
  const input = inputs.get(def.key);
  if (input) input.setAttribute("aria-describedby", err.id);
  root.appendChild(err);
  return root;
}

function buildInspect() {
  const dl = el("dl", { className: "inspect-grid" });
  const rows = [
    ["dims", "Dimensions"],
    ["edge", "Edge min / mean / max"],
    ["wall", "Wall"],
    ["border", "Border"],
    ["opening", "Min opening"],
    ["fillet", "Fillet applied"],
    ["selected-edge", "Selected edge"],
  ];
  for (const [key, label] of rows) {
    dl.appendChild(el("dt", { textContent: label }));
    const dd = el("dd", { textContent: "—" });
    dd.setAttribute("data-inspect", key);
    dl.appendChild(dd);
  }
  return dl;
}

function buildMake(handlers) {
  const box = el("div", { className: "actions" });
  const warn = el("p", { className: "hint base-warn", textContent: "" });
  warn.setAttribute("data-base-warn", "");
  warn.hidden = true;
  box.appendChild(warn);

  const stepper = el("div", { className: "face-stepper" });
  stepper.setAttribute("data-face-stepper", "");
  const familyBtn = el("button", {
    type: "button",
    className: "btn-quiet",
    textContent: "triangle",
  });
  familyBtn.setAttribute("data-face-family", "");
  familyBtn.setAttribute("aria-label", "Cycle face family");
  const prev = el("button", { type: "button", className: "btn-quiet", textContent: "←" });
  prev.setAttribute("data-face-prev", "");
  prev.setAttribute("aria-label", "Previous face in family");
  const next = el("button", { type: "button", className: "btn-quiet", textContent: "→" });
  next.setAttribute("data-face-next", "");
  next.setAttribute("aria-label", "Next face in family");
  const readout = el("span", { className: "face-readout", textContent: "Face: —" });
  readout.setAttribute("data-face-readout", "");
  stepper.append(familyBtn, prev, readout, next);
  box.appendChild(stepper);
  box.appendChild(
    el("p", {
      className: "hint",
      textContent: "Click a face on the model, or step within a family.",
    }),
  );

  const save = el("button", {
    type: "button",
    className: "btn",
    id: "btn-save",
    textContent: "Save",
  });
  const open = el("button", {
    type: "button",
    className: "btn",
    id: "btn-open",
    textContent: "Open",
    hidden: true,
  });
  const copy = el("button", {
    type: "button",
    className: "btn",
    id: "btn-copy-link",
    textContent: "Copy Link",
    hidden: true,
  });
  const exp = el("button", {
    type: "button",
    className: "btn btn-accent",
    id: "btn-export",
    textContent: "Export STL",
  });
  box.append(save, open, copy, exp);
  return box;
}

function buildFutureBlock() {
  const block = el("div", { className: "future-block" });
  block.appendChild(el("span", { className: "tag", textContent: "M5 — density / seed / jitter" }));
  for (const label of ["Density", "Seed", "Jitter"]) {
    const row = el("div", { className: "control-row" });
    row.append(
      el("label", { textContent: label }),
      el("input", { type: "number", disabled: true, value: "—" }),
      el("span", { className: "unit", textContent: "" }),
    );
    block.appendChild(row);
  }
  return block;
}

function applyStateToControls(state, inputs, ranges, controlRoots) {
  for (const def of CONTROL_DEFS) {
    const root = controlRoots.get(def.key);
    if (root && def.hideWhen) {
      root.setAttribute("data-hidden", def.hideWhen(state) ? "1" : "0");
    }
    if (def.key === "edgeLengthMm") continue;
    const v = state[def.key];
    if (v === undefined) continue;
    const uiVal = stateToUi(def, v);
    const input = inputs.get(def.key);
    if (input && document.activeElement !== input) {
      if (input.tagName === "SELECT") input.value = String(v);
      else input.value = fmtInput(uiVal);
    }
    const range = ranges.get(def.key);
    if (range && document.activeElement !== range) {
      const lo = Number(range.min);
      const hi = Number(range.max);
      const clamped =
        Number.isFinite(uiVal) && Number.isFinite(lo) && Number.isFinite(hi)
          ? Math.min(hi, Math.max(lo, uiVal))
          : uiVal;
      range.value = String(clamped);
    }
  }
}

function applyLimits(lim, ranges, limitLabels, defs) {
  const map = {
    wallMm: lim.wallMmMax,
    borderMm: lim.borderMmMax,
    filletMm: lim.filletMmMax,
  };
  for (const [key, max] of Object.entries(map)) {
    if (max == null || !Number.isFinite(max)) continue;
    const range = ranges.get(key);
    const labels = limitLabels.get(key);
    const def = defs.find((d) => d.key === key);
    if (range) {
      range.max = String(round1(max));
      const num = range.ownerDocument.getElementById(`ctrl-${key}`);
      if (num) num.max = String(round1(max));
    }
    if (labels) {
      labels.min.textContent = fmt(def?.min ?? 0);
      labels.max.textContent = fmt(max);
    }
  }
}

function uiToState(def, uiVal) {
  if (def?.toState) return def.toState(uiVal);
  return uiVal;
}

function stateToUi(def, stateVal) {
  if (def?.fromState) return def.fromState(stateVal);
  return stateVal;
}

function updateFaceStepper(stepper, readout, loc, multiFamily) {
  if (!stepper || !readout || !loc?.family) return;
  const { family, indexInFamily } = loc;
  readout.textContent = `Face: ${family.label} · ${indexInFamily + 1} of ${family.indices.length}`;
  readout.dataset.faceIndex = String(family.indices[indexInFamily]);
  const famBtn = stepper.querySelector("[data-face-family]");
  if (famBtn) {
    famBtn.textContent = family.label;
    famBtn.hidden = !multiFamily;
  }
}

function setInspect(els, m) {
  if (els.dims) {
    els.dims.innerHTML = `${fmt(m.extentsMm[0])}×${fmt(m.extentsMm[1])}×${fmt(m.extentsMm[2])}<span class="u">mm</span>`;
  }
  if (els.edge) {
    els.edge.innerHTML = `${fmt(m.edgeMm.min)} / ${fmt(m.edgeMm.mean)} / ${fmt(m.edgeMm.max)}<span class="u">mm</span>`;
  }
  if (els.wall) {
    els.wall.textContent =
      m.wallMm.min != null
        ? `${fmt(m.wallMm.min)}–${fmt(m.wallMm.max)} mm`
        : "solid";
  }
  if (els.border) {
    els.border.textContent =
      m.borderMm?.min != null
        ? `${fmt(m.borderMm.min)}–${fmt(m.borderMm.max)} mm`
        : "—";
  }
  if (els.opening) {
    els.opening.textContent =
      m.openingMinDiameterMm != null
        ? `${fmt(m.openingMinDiameterMm)} mm`
        : "—";
  }
  if (els.fillet) {
    els.fillet.textContent =
      m.filletMm?.min != null
        ? `${fmt(m.filletMm.min)}–${fmt(m.filletMm.max)} mm`
        : "—";
  }
}

function updateStrip(strip, m, validation, _prev, setPrev) {
  const line1 =
    `dimensions  ${fmt(m.extentsMm[0])}×${fmt(m.extentsMm[1])}×${fmt(m.extentsMm[2])} mm` +
    (m.wallMm.min != null ? ` · wall ${fmt(m.wallMm.min)}–${fmt(m.wallMm.max)}` : " · solid") +
    ` · longest flat ${fmt(m.longestHorizontalMm)} mm`;
  const line2 =
    `mesh  ${m.triangleCount.toLocaleString("en-US")} tris` +
    ` · watertight ${m.watertight ? "✓" : "✗"}` +
    ` · ${m.volumeCm3.toFixed(1)} cm³`;
  const warn =
    validation?.warnings?.map((w) => `\n${w.message}`).join("") || "";
  const text = line1 + "\n" + line2 + warn;
  strip.textContent = text;
  strip.classList.remove("err");
  setPrev(text);
}

function updateStripErrors(strip, validation) {
  strip.innerHTML = "";
  const p = el("span", { className: "err" });
  p.textContent = validation.errors
    .map((e) => `${e.key ?? e.stage}: ${e.message}`)
    .join("\n");
  strip.appendChild(p);
}

function groupHeader(title) {
  const h = el("div", { className: "group-header" });
  h.appendChild(el("span", { textContent: title }));
  return h;
}

function el(tag, props = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") node.className = v;
    else if (k === "textContent") node.textContent = v;
    else if (k === "dataset") {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    } else if (k === "hidden") node.hidden = v;
    else if (v != null) node.setAttribute(k === "htmlFor" ? "for" : k, v);
  }
  // htmlFor via property
  if (props.htmlFor) node.htmlFor = props.htmlFor;
  return node;
}

function fmt(n) {
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "") : "—";
}
function fmtInput(n) {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
