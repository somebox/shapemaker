/**
 * Panel UI — owns DOM, emits patches. Never owns canonical state.
 * Control definitions live in schema.js; row builders in controls.js.
 */

import {
  CONTROL_DEFS,
  qualityLevelFor,
  separationForPoints,
  isEdgeInputReadOnly,
} from "./schema.js";
import { faceFamilies, locateFace } from "./face-families.js";
import { BASES, BASE_IDS } from "./bases.js";
import { recipeForBase } from "./starts.js";
import { startThumbSvg } from "./start-thumbs.js";
import {
  el,
  fmt,
  fmtInput,
  round1,
  buildControl,
  applyLimits,
  applyStateToControls,
  uiToState,
  clampUi,
} from "./controls.js";

const GROUPS = [
  { id: "shape", title: "Shape" },
  { id: "form", title: "Form" },
  { id: "make", title: "Make" },
];

export const GROUPS_OPEN_KEY = "shapemaker.groups.open";
export const START_EXPANDED_KEY = "shapemaker.start.expanded";

const DEFAULT_OPEN = { shape: true, form: true, make: true };

/**
 * Apply coupled-control rules so routine interactions never emit invalid combos.
 * @param {object} patch
 */
export function normalizePatch(patch) {
  const next = { ...patch };
  if (next.depth === "solid") next.openings = false;
  if (next.openings === true) next.depth = "hollow";
  if (next.points != null && next.separation == null) {
    next.separation = separationForPoints(next.points);
  }
  return next;
}

/**
 * @param {Storage} [store]
 * @returns {Record<string, boolean>}
 */
export function loadGroupsOpen(store = localStorage) {
  try {
    const raw = store.getItem(GROUPS_OPEN_KEY);
    if (!raw) return { ...DEFAULT_OPEN };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_OPEN, ...parsed };
  } catch {
    return { ...DEFAULT_OPEN };
  }
}

/**
 * @param {Record<string, boolean>} open
 * @param {Storage} [store]
 */
export function saveGroupsOpen(open, store = localStorage) {
  try {
    store.setItem(GROUPS_OPEN_KEY, JSON.stringify(open));
  } catch {
    /* ignore */
  }
}

/**
 * @param {Storage} [store]
 */
export function loadStartExpanded(store = localStorage) {
  try {
    return store.getItem(START_EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * @param {boolean} expanded
 * @param {Storage} [store]
 */
export function saveStartExpanded(expanded, store = localStorage) {
  try {
    store.setItem(START_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * Whether a range/scrub drag should emit a live patch (false = readout only).
 * @param {{ heavyMode: boolean }} args
 */
export function shouldLivePatchDuringDrag({ heavyMode }) {
  return !heavyMode;
}

/**
 * @param {HTMLElement} panelEl
 * @param {object} handlers
 */
export function createPanel(panelEl, handlers) {
  panelEl.innerHTML = "";
  const scroll = el("div", { id: "panel-scroll" });
  panelEl.appendChild(scroll);

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

  // Start-from — whole row toggles the chooser; re-click cancels (no change).
  const startSection = el("section", { className: "group start-group" });
  const startHeader = el("div", { className: "group-header start-header" });
  startHeader.appendChild(el("span", { textContent: "Start from" }));
  const sessionMode = el("span", {
    className: "session-mode",
    textContent: "Browse",
  });
  sessionMode.setAttribute("data-mode", "browse");
  sessionMode.setAttribute("aria-live", "polite");
  const undoBtn = el("button", {
    type: "button",
    className: "preset-chip undo-chip",
    textContent: "Undo",
    title: "Restore previous session snapshot",
  });
  undoBtn.addEventListener("click", () => handlers.onUndo?.());
  startHeader.append(sessionMode, undoBtn);
  startSection.appendChild(startHeader);

  const currentStart = el("button", {
    type: "button",
    className: "start-current",
  });
  currentStart.setAttribute("aria-expanded", "false");
  currentStart.setAttribute("aria-controls", "start-chooser");
  const startChevron = el("span", {
    className: "start-chevron",
    textContent: "▸",
  });
  startChevron.setAttribute("aria-hidden", "true");
  const currentThumb = el("span", { className: "start-thumb" });
  currentThumb.setAttribute("aria-hidden", "true");
  const currentLabel = el("span", { className: "start-current-label", textContent: "—" });
  currentStart.append(startChevron, currentThumb, currentLabel);
  startSection.appendChild(currentStart);

  const chooser = el("div", { className: "start-chooser", id: "start-chooser", hidden: true });
  const baseCards = el("div", { className: "start-cards start-cards--grid" });
  baseCards.setAttribute("role", "group");
  baseCards.setAttribute("aria-label", "Built-in starting shapes");
  for (const id of BASE_IDS) {
    const def = BASES[id];
    baseCards.appendChild(
      startCard({
        id,
        label: def.shortLabel || def.label,
        title: `${def.label} — load as starting points`,
        svg: safeThumb(recipeForBase(id)),
        onStart: (sid) => {
          handlers.onStart?.(sid);
          closeStartChooser();
        },
      }),
    );
  }
  chooser.appendChild(baseCards);
  startSection.appendChild(chooser);
  scroll.appendChild(startSection);

  function closeStartChooser() {
    chooser.hidden = true;
    currentStart.setAttribute("aria-expanded", "false");
    startChevron.textContent = "▸";
  }
  function openStartChooser() {
    chooser.hidden = false;
    currentStart.setAttribute("aria-expanded", "true");
    startChevron.textContent = "▾";
  }
  currentStart.addEventListener("click", () => {
    if (chooser.hidden) openStartChooser();
    else closeStartChooser(); // cancel — no recipe change
  });

  function refreshCurrentStart(statuses) {
    const active = (statuses || []).find((s) => s.active);
    const id = active?.id || "icosidodeca";
    const def = BASES[id];
    const label = active?.name || def?.label || id;
    currentLabel.textContent = label;
    currentThumb.innerHTML = safeThumb(recipeForBase(def ? id : "icosidodeca"));
    for (const btn of baseCards.querySelectorAll("[data-start-id]")) {
      const sid = btn.getAttribute("data-start-id");
      btn.setAttribute("data-active", sid === id ? "1" : "0");
    }
  }

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
  /** @type {Map<string, {min: HTMLElement, max: HTMLElement, titleHost?: HTMLElement}>} */
  const limitLabels = new Map();

  const groupsOpen = loadGroupsOpen();

  for (const g of GROUPS) {
    const section = el("section", {
      className: "group",
      dataset: { group: g.id },
    });
    const open = groupsOpen[g.id] !== false;
    const toggle = el("button", {
      type: "button",
      className: "group-header group-toggle",
    });
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const chevron = el("span", {
      className: "group-chevron",
      textContent: open ? "▾" : "▸",
    });
    chevron.setAttribute("aria-hidden", "true");
    toggle.append(chevron, el("span", { textContent: g.title }));
    const body = el("div", { className: "group-body" });
    body.hidden = !open;
    section.append(toggle, body);
    scroll.appendChild(section);

    toggle.addEventListener("click", () => {
      const next = body.hidden;
      body.hidden = !next;
      toggle.setAttribute("aria-expanded", next ? "true" : "false");
      chevron.textContent = next ? "▾" : "▸";
      groupsOpen[g.id] = next;
      saveGroupsOpen(groupsOpen);
    });

    if (g.id === "shape" || g.id === "form") {
      /** @type {HTMLElement | null} */
      let jitterCluster = null;
      /** @type {HTMLElement | null} */
      let pendingSeed = null;
      for (const def of CONTROL_DEFS.filter((c) => c.group === g.id)) {
        const root = buildControl(def, inputs, ranges, errNodes, limitLabels);
        controlRoots.set(def.key, root);
        if (def.key === "seed") {
          // Park until the jitter cluster exists, then nest under it.
          pendingSeed = root;
          root.classList.add("control--clustered");
          continue;
        }
        if (def.key === "jitter") {
          jitterCluster = el("div", {
            className: "control-cluster",
            dataset: { cluster: "jitter" },
          });
          jitterCluster.appendChild(
            el("div", { className: "cluster-label", textContent: "Jitter" }),
          );
          root.classList.add("control--clustered");
          const lab = root.querySelector("label");
          if (lab) lab.textContent = "Amount";
          jitterCluster.appendChild(root);
          if (pendingSeed) {
            jitterCluster.appendChild(pendingSeed);
            pendingSeed = null;
          }
          body.appendChild(jitterCluster);
        } else if (def.key === "jitterMode" && jitterCluster) {
          root.classList.add("control--clustered");
          jitterCluster.appendChild(root);
        } else {
          body.appendChild(root);
        }
      }
      if (pendingSeed && jitterCluster) jitterCluster.appendChild(pendingSeed);
      else if (pendingSeed) body.appendChild(pendingSeed);
    } else if (g.id === "make") {
      body.appendChild(buildMake(handlers));
    }
  }

  const strip = document.getElementById("dimension-strip");
  const barEl = document.getElementById("bottombar");
  const shareWrap = el("div", { className: "share-wrap" });
  const shareBtn = el("button", {
    type: "button",
    className: "btn",
    id: "btn-share",
    textContent: "Share",
  });
  const sharePanel = el("div", { className: "share-panel", hidden: true });
  const shareUrl = el("code", { className: "share-url", textContent: "" });
  const shareCopy = el("button", {
    type: "button",
    className: "btn btn-accent",
    textContent: "Copy",
  });
  sharePanel.append(shareUrl, shareCopy);
  shareWrap.append(shareBtn, sharePanel);
  const exportBtn = el("button", {
    type: "button",
    className: "btn btn-accent",
    id: "btn-export",
    textContent: "Export STL",
  });
  const exportSvgBtn = el("button", {
    type: "button",
    className: "btn",
    id: "btn-export-svg",
    textContent: "Export SVG",
  });
  barEl?.append(shareWrap, exportBtn, exportSvgBtn);

  function truncateUrl(url, max = 42) {
    if (url.length <= max) return url;
    return `${url.slice(0, max - 1)}…`;
  }
  shareBtn.addEventListener("click", () => {
    const open = sharePanel.hidden;
    if (open) {
      handlers.onPrepareShare?.();
      shareUrl.textContent = truncateUrl(location.href);
      shareUrl.title = location.href;
    }
    sharePanel.hidden = !open;
    shareBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  shareCopy.addEventListener("click", () => {
    handlers.onCopyLink?.();
  });

  let lastStripCore = "";
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
    pendingPatch = normalizePatch({ ...(pendingPatch || {}), ...patch });
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
    }
  }

  let heavyMode = false;

  for (const [key, range] of ranges) {
    const def = CONTROL_DEFS.find((c) => c.key === key);
    range.addEventListener("input", () => {
      const n = Number(range.value);
      const num = inputs.get(key);
      if (num) {
        num.value = fmtInput(n);
        const readout = num.parentElement?.querySelector(".value-readout");
        if (readout) readout.textContent = fmtInput(n);
      }
      if (!shouldLivePatchDuringDrag({ heavyMode })) return;
      queuePatch({ [key]: uiToState(def, n) }, false);
    });
    range.addEventListener("change", () => {
      queuePatch({ [key]: uiToState(def, Number(range.value)) }, true);
    });
  }

  // Label scrubbing — same heavy-compile policy as range drags.
  panelEl.querySelectorAll("[data-scrub-key]").forEach((lab) => {
    const key = lab.getAttribute("data-scrub-key");
    const range = ranges.get(key);
    const def = CONTROL_DEFS.find((c) => c.key === key);
    if (!range || !def) return;
    let dragging = false;
    let lastX = 0;
    lab.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lab.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    lab.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      const step = Number(range.step) || 0.1;
      const lo = Number(range.min);
      const hi = Number(range.max);
      const next = clampUi(Number(range.value) + dx * step, lo, hi);
      range.value = String(next);
      const num = inputs.get(key);
      if (num) {
        num.value = fmtInput(next);
        const readout = num.parentElement?.querySelector(".value-readout");
        if (readout) readout.textContent = fmtInput(next);
      }
      if (shouldLivePatchDuringDrag({ heavyMode })) {
        queuePatch({ [key]: uiToState(def, next) }, false);
      }
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      try {
        lab.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      queuePatch({ [key]: uiToState(def, Number(range.value)) }, true);
    };
    lab.addEventListener("pointerup", end);
    lab.addEventListener("pointercancel", end);
  });

  panelEl.querySelectorAll("[data-seg-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-seg-key");
      const def = CONTROL_DEFS.find((c) => c.key === key);
      let value = btn.getAttribute("data-seg-value");
      if (def?.boolean) value = value === "true";
      else if (def?.numeric) value = Number(value);
      queuePatch({ [key]: value }, true);
    });
  });

  {
    const seedInput = inputs.get("seed");
    seedInput?.addEventListener("change", () => {
      const n = Math.floor(Number(seedInput.value));
      if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) queuePatch({ seed: n }, true);
    });
    panelEl.querySelector("[data-reroll]")?.addEventListener("click", () => {
      const s =
        typeof crypto !== "undefined" && crypto.getRandomValues
          ? crypto.getRandomValues(new Uint32Array(1))[0]
          : Math.floor(Math.random() * 4294967296);
      queuePatch({ seed: s >>> 0 }, true);
    });
  }

  const faceReadout = panelEl.querySelector("[data-face-readout]");
  const faceStepper = panelEl.querySelector("[data-face-stepper]");
  const warnLine = panelEl.querySelector("[data-base-warn]");
  const saveBtn = panelEl.querySelector("#btn-save");
  const openBtn = panelEl.querySelector("#btn-open");
  const materialSel = panelEl.querySelector("[data-material]");
  const massReadout = panelEl.querySelector("[data-mass-readout]");

  /** @type {{ sides: number, label: string, indices: number[] }[]} */
  let families = [];
  let familyIndex = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let copyFeedbackTimer = null;
  let lastVolumeCm3 = null;
  let pinnedEdgeText = "";

  saveBtn?.addEventListener("click", () => handlers.onSave());
  exportBtn?.addEventListener("click", () => handlers.onExport());
  exportSvgBtn?.addEventListener("click", () => handlers.onExportSvg?.());
  openBtn?.addEventListener("click", () => handlers.onOpen?.());

  materialSel?.addEventListener("change", () => {
    handlers.onMaterial?.(materialSel.value);
    updateMassReadout();
  });

  function updateMassReadout() {
    if (!massReadout) return;
    if (lastVolumeCm3 == null || !materialSel) {
      massReadout.textContent = "—";
      return;
    }
    const density = Number(materialSel.selectedOptions[0]?.dataset.density);
    if (!Number.isFinite(density)) {
      massReadout.textContent = "—";
      return;
    }
    massReadout.textContent = `${fmt(lastVolumeCm3 * density)} g`;
  }

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
    const loc = locateFace(families, Number(faceReadout?.dataset.faceIndex ?? 0));
    familyIndex = loc.familyIndex;
    const cur = families[familyIndex];
    const n = cur.indices.length;
    const nextK = (loc.indexInFamily + delta + n) % n;
    queuePatch({ faceIndex: cur.indices[nextK] }, true);
  }

  function paintStrip() {
    if (!strip || !lastStripCore) return;
    const [line1, ...rest] = lastStripCore.split("\n");
    strip.textContent = [line1 + pinnedEdgeText, ...rest].join("\n");
    strip.classList.remove("err");
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
        applyStateToControls(state, inputs, ranges, controlRoots, CONTROL_DEFS);
        setSegment("depth", state.depth);
        setSegment("openings", String(!!state.openings));
        setSegment("edgeDiv", state.edgeDiv);
        setSegment("subdiv", state.subdiv);
        setSegment("jitterMode", state.jitterMode);
        const customTag = panelEl.querySelector('[data-custom-key="edgeDiv"]');
        if (customTag) {
          const custom = qualityLevelFor(state.edgeDiv) == null;
          customTag.hidden = !custom;
          customTag.textContent = custom ? `custom · ${state.edgeDiv}` : "";
        }
        const edgeInput = inputs.get("edgeLengthMm");
        if (edgeInput) {
          edgeInput.readOnly = isEdgeInputReadOnly(state);
          edgeInput.classList.toggle("is-readout", edgeInput.readOnly);
        }
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
        lastVolumeCm3 = metrics.volumeCm3;
        const edgeInput = inputs.get("edgeLengthMm");
        if (edgeInput && document.activeElement !== edgeInput) {
          edgeInput.value = fmtInput(metrics.edgeMm.mean);
        }
        updateMassReadout();
        lastStripCore = formatStripCore(metrics, validation);
        paintStrip();
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

    setHeavy(on) {
      heavyMode = !!on;
    },

    setProjectStatus({ name, dirty, canSave, canUndo }) {
      if (name != null && document.activeElement !== nameInput) {
        nameInput.value = name;
      }
      dirtyDot.setAttribute("data-on", dirty ? "1" : "0");
      dirtyLabel.setAttribute("data-on", dirty ? "1" : "0");
      sessionMode.textContent = dirty ? "Edit" : "Browse";
      sessionMode.setAttribute("data-mode", dirty ? "edit" : "browse");
      if (saveBtn) saveBtn.disabled = !canSave;
      undoBtn.disabled = !canUndo;
    },

    setSelectedEdge(lengthMm) {
      pinnedEdgeText =
        lengthMm == null ? "" : ` · edge ${fmt(lengthMm)} mm`;
      paintStrip();
    },

    setActionsVisible({ open }) {
      if (openBtn) openBtn.hidden = !open;
    },

    setCopyFeedback(ok) {
      if (copyFeedbackTimer != null) clearTimeout(copyFeedbackTimer);
      shareCopy.textContent = ok ? "Copied" : "Failed";
      shareCopy.setAttribute("data-copy", ok ? "ok" : "err");
      copyFeedbackTimer = setTimeout(() => {
        shareCopy.textContent = "Copy";
        shareCopy.removeAttribute("data-copy");
        copyFeedbackTimer = null;
      }, 1600);
    },

    setPresets(_list) {
      // Named presets retired from the chooser; bases only.
    },

    setStartStatus(statuses) {
      refreshCurrentStart(statuses);
      for (const s of statuses || []) {
        const btn = baseCards.querySelector(`[data-start-id="${s.id}"]`);
        if (!btn) continue;
        btn.setAttribute("data-active", s.active ? "1" : "0");
        btn.setAttribute("data-edited", s.edited ? "1" : "0");
      }
    },
  };
}

function startCard({ id, label, title, svg, onStart }) {
  const btn = el("button", { type: "button", className: "start-card" });
  btn.setAttribute("data-start-id", id);
  btn.title = title;
  const thumb = el("span", { className: "start-thumb" });
  thumb.setAttribute("aria-hidden", "true");
  thumb.innerHTML = svg;
  btn.append(thumb, el("span", { className: "start-card-label", textContent: label }));
  btn.addEventListener("click", () => onStart?.(id));
  return btn;
}

function safeThumb(state) {
  try {
    return startThumbSvg(state);
  } catch {
    return "";
  }
}

function buildMake(_handlers) {
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

  const matRow = el("div", { className: "control-row control-row--material" });
  matRow.appendChild(el("label", { textContent: "Material" }));
  const mat = el("select", { className: "material-select" });
  mat.setAttribute("data-material", "");
  mat.setAttribute("aria-label", "Material density preset");
  for (const m of MATERIAL_PRESETS) {
    const opt = el("option", { value: m.id, textContent: m.label });
    opt.dataset.density = String(m.densityGPerCm3);
    if (m.id === "pla") opt.selected = true;
    mat.appendChild(opt);
  }
  matRow.appendChild(mat);
  box.appendChild(matRow);
  const massRow = el("div", { className: "control-row control-row--material" });
  massRow.appendChild(el("label", { textContent: "Mass (est.)" }));
  const mass = el("span", { className: "mass-readout", textContent: "—" });
  mass.setAttribute("data-mass-readout", "");
  massRow.appendChild(mass);
  box.appendChild(massRow);

  box.appendChild(el("div", { className: "group-subheader", textContent: "JSON Model File" }));
  const save = el("button", {
    type: "button",
    className: "btn",
    id: "btn-save",
    textContent: "Export",
  });
  const open = el("button", {
    type: "button",
    className: "btn",
    id: "btn-open",
    textContent: "Load",
    hidden: true,
  });
  box.append(save, open);
  return box;
}

/** Density presets (g/cm³) for mass estimate — not part of canonical state. */
export const MATERIAL_PRESETS = Object.freeze([
  Object.freeze({ id: "pla", label: "PLA · 1.24", densityGPerCm3: 1.24 }),
  Object.freeze({ id: "petg", label: "PETG · 1.27", densityGPerCm3: 1.27 }),
  Object.freeze({ id: "abs", label: "ABS · 1.04", densityGPerCm3: 1.04 }),
  Object.freeze({ id: "tpu", label: "TPU · 1.21", densityGPerCm3: 1.21 }),
  Object.freeze({ id: "nylon", label: "Nylon · 1.14", densityGPerCm3: 1.14 }),
]);

/**
 * @param {number} volumeCm3
 * @param {number} densityGPerCm3
 */
export function estimateMassG(volumeCm3, densityGPerCm3) {
  if (!Number.isFinite(volumeCm3) || !Number.isFinite(densityGPerCm3)) return null;
  return volumeCm3 * densityGPerCm3;
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


function formatStripCore(m, validation) {
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
  return line1 + "\n" + line2 + warn;
}

function updateStripErrors(strip, validation) {
  strip.innerHTML = "";
  const p = el("span", { className: "err" });
  p.textContent = validation.errors
    .map((e) => `${e.key ?? e.stage}: ${e.message}`)
    .join("\n");
  strip.appendChild(p);
}
