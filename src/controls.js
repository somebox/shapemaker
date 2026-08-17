/**
 * Schema-driven control builders and pure display helpers.
 * DOM builders live here so ui.js stays a session/wiring shell; pure helpers
 * are unit-tested without a browser.
 */

/**
 * @param {number} n
 * @returns {string}
 */
export function fmt(n) {
  return Number.isFinite(n)
    ? (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "")
    : "—";
}

/** Like fmt but keeps two decimals alive for sub-0.1 limit values. */
export function fmt2(n) {
  if (!Number.isFinite(n)) return "—";
  return n < 1 ? String(Math.round(n * 100) / 100) : fmt(n);
}

export function fmtInput(n) {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";
}

export function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Clamp a UI value into [lo, hi] when all are finite.
 * @param {number} value
 * @param {number} lo
 * @param {number} hi
 */
export function clampUi(value, lo, hi) {
  if (!Number.isFinite(value)) return value;
  let out = value;
  if (Number.isFinite(lo)) out = Math.max(lo, out);
  if (Number.isFinite(hi)) out = Math.min(hi, out);
  return out;
}

/**
 * Dynamic wall/border/fillet ceiling → slider floor/ceil pair.
 * Tiny-face ceilings can drop below the control default minimum.
 * @param {number} max
 * @param {number} [defMin=0]
 * @returns {{ floor: number, ceil: number }}
 */
export function limitRangeBounds(max, defMin = 0) {
  const ceil = max >= 1 ? round1(max) : Math.max(0.01, Math.floor(max * 100) / 100);
  const floor =
    ceil > defMin ? defMin : Math.max(0.01, Math.floor((ceil / 2) * 100) / 100);
  return { floor, ceil };
}

/** Title/tooltip text for a range control's live limits. */
export function limitTitle(label, floor, ceil, unit = "") {
  const u = unit ? ` ${unit}` : "";
  return `${label}: ${fmt2(floor)}–${fmt2(ceil)}${u}`;
}

export function uiToState(def, uiVal) {
  if (def?.toState) return def.toState(uiVal);
  return uiVal;
}

export function stateToUi(def, stateVal) {
  if (def?.fromState) return def.fromState(stateVal);
  return stateVal;
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [props]
 */
export function el(tag, props = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") node.className = /** @type {string} */ (v);
    else if (k === "textContent") node.textContent = /** @type {string} */ (v);
    else if (k === "dataset") {
      for (const [dk, dv] of Object.entries(/** @type {object} */ (v))) {
        node.dataset[dk] = String(dv);
      }
    } else if (k === "hidden") node.hidden = !!v;
    else if (v != null) node.setAttribute(k === "htmlFor" ? "for" : k, String(v));
  }
  if (props.htmlFor) node.htmlFor = /** @type {string} */ (props.htmlFor);
  return node;
}

/**
 * Build one schema-driven control. Range controls use a single row:
 * label · slider · editable value + unit. Limits live in title/aria, not a
 * third row.
 *
 * @param {object} def ControlDef
 * @param {Map<string, HTMLInputElement|HTMLSelectElement>} inputs
 * @param {Map<string, HTMLInputElement>} ranges
 * @param {Map<string, HTMLElement>} errNodes
 * @param {Map<string, {min: HTMLElement, max: HTMLElement, titleHost: HTMLElement}>} limitLabels
 */
export function buildControl(def, inputs, ranges, errNodes, limitLabels) {
  const root = el("div", { className: "control", dataset: { key: def.key } });

  if (def.type === "segments") {
    const lab = el("div", { className: "control-row control-row--seg" });
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
    if (def.customTag) {
      const tag = el("span", { className: "seg-custom", hidden: true });
      tag.setAttribute("data-custom-key", def.key);
      segs.appendChild(tag);
    }
    root.appendChild(segs);
  } else if (def.type === "seed") {
    const row = el("div", { className: "control-row control-row--seed" });
    const lab = el("label", { textContent: def.label });
    lab.htmlFor = `ctrl-${def.key}`;
    const num = el("input", {
      type: "number",
      id: `ctrl-${def.key}`,
      step: "1",
      min: "0",
      max: "4294967295",
    });
    const reroll = el("button", {
      type: "button",
      className: "reroll",
      textContent: "↻",
      title: "New seed",
    });
    reroll.setAttribute("aria-label", "New random seed");
    reroll.setAttribute("data-reroll", "");
    inputs.set(def.key, num);
    row.append(lab, num, reroll);
    root.appendChild(row);
  } else if (def.type === "range") {
    const row = el("div", { className: "control-row control-row--range" });
    const lab = el("label", {
      textContent: def.label,
      className: "scrub-label",
    });
    lab.htmlFor = `ctrl-${def.key}`;
    lab.setAttribute("data-scrub-key", def.key);
    lab.title = "Drag to adjust";

    const range = el("input", {
      type: "range",
      min: String(def.min ?? 0),
      max: String(def.max ?? 100),
      step: String(def.step ?? 0.1),
    });
    range.setAttribute("aria-label", def.label);
    ranges.set(def.key, range);

    const valueBox = el("div", { className: "value-box" });
    // Readout is the default; the number field appears only while editing.
    const readout = el("button", {
      type: "button",
      className: "value-readout",
      textContent: "",
    });
    readout.setAttribute("aria-label", `${def.label} value`);
    const num = el("input", {
      type: "number",
      id: `ctrl-${def.key}`,
      className: "value-input",
      step: String(def.step ?? 0.1),
      hidden: true,
    });
    if (def.min != null) num.min = String(def.min);
    if (def.max != null && def.key !== "circumdiameterMm") {
      num.max = String(def.max);
    }
    inputs.set(def.key, num);
    const unit = el("span", { className: "unit", textContent: def.unit || "" });
    valueBox.append(readout, num, unit);

    function showReadout() {
      num.hidden = true;
      readout.hidden = false;
      readout.textContent = num.value;
    }
    function showEditor() {
      readout.hidden = true;
      num.hidden = false;
      num.focus();
      num.select();
    }
    readout.addEventListener("click", (e) => {
      e.preventDefault();
      showEditor();
    });
    num.addEventListener("blur", () => showReadout());
    num.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        num.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        num.blur();
      }
    });
    // Keep readout in sync when the slider moves the hidden input.
    num.addEventListener("input", () => {
      if (readout.hidden) return;
      readout.textContent = num.value;
    });

    const minL = el("span", { hidden: true, textContent: String(def.min ?? "") });
    const maxL = el("span", { hidden: true, textContent: String(def.max ?? "") });
    limitLabels.set(def.key, { min: minL, max: maxL, titleHost: row });
    row.title = limitTitle(def.label, def.min ?? 0, def.max ?? 100, def.unit || "");

    row.append(lab, range, valueBox, minL, maxL);
    root.appendChild(row);
  } else if (def.type === "number") {
    const row = el("div", { className: "control-row control-row--number" });
    const lab = el("label", { textContent: def.label });
    lab.htmlFor = `ctrl-${def.key}`;
    const num = el("input", {
      type: "number",
      id: `ctrl-${def.key}`,
      step: String(def.step ?? 0.1),
    });
    if (def.min != null) num.min = String(def.min);
    if (def.max != null && def.key !== "circumdiameterMm") {
      num.max = String(def.max);
    }
    inputs.set(def.key, num);
    row.append(lab, num, el("span", { className: "unit", textContent: def.unit || "" }));
    root.appendChild(row);
  }

  const err = el("p", { className: "control-error", id: `err-${def.key}` });
  errNodes.set(def.key, err);
  const input = inputs.get(def.key);
  if (input) input.setAttribute("aria-describedby", err.id);
  root.appendChild(err);
  return root;
}

/**
 * @param {object} lim
 * @param {Map<string, HTMLInputElement>} ranges
 * @param {Map<string, {min: HTMLElement, max: HTMLElement, titleHost?: HTMLElement}>} limitLabels
 * @param {object[]} defs
 */
export function applyLimits(lim, ranges, limitLabels, defs) {
  const map = {
    wallMm: lim.wallMmMax,
    borderFraction: lim.borderFractionMax != null
      ? lim.borderFractionMax * 100
      : null,
    borderMm: lim.borderMmMax,
    filletMm: lim.filletMmMax,
    roundingMm: lim.roundingMmMax,
    spike: lim.spikeMax,
  };
  for (const [key, max] of Object.entries(map)) {
    if (max == null || !Number.isFinite(max)) continue;
    const range = ranges.get(key);
    const labels = limitLabels.get(key);
    const def = defs.find((d) => d.key === key);
    const { floor, ceil } = limitRangeBounds(max, def?.min ?? 0);
    if (range) {
      range.min = String(floor);
      range.max = String(ceil);
      const num = range.ownerDocument.getElementById(`ctrl-${key}`);
      if (num) {
        num.min = String(floor);
        num.max = String(ceil);
      }
    }
    if (labels) {
      labels.min.textContent = fmt2(floor);
      labels.max.textContent = fmt2(ceil);
      if (labels.titleHost) {
        labels.titleHost.title = limitTitle(def?.label || key, floor, ceil, def?.unit || "");
      }
    }
  }
}

/**
 * @param {object} state
 * @param {Map<string, HTMLInputElement|HTMLSelectElement>} inputs
 * @param {Map<string, HTMLInputElement>} ranges
 * @param {Map<string, HTMLElement>} controlRoots
 * @param {object[]} defs
 */
export function applyStateToControls(state, inputs, ranges, controlRoots, defs) {
  for (const def of defs) {
    const root = controlRoots.get(def.key);
    if (root && def.hideWhen) {
      root.setAttribute("data-hidden", def.hideWhen(state) ? "1" : "0");
    }
    // Per-state slider bounds (e.g. globe advertises Density 6–36): keep
    // the control honest so no slider positions are dead for this base.
    if (def.boundsForState) {
      const bounds = def.boundsForState(state);
      const lo = bounds?.min ?? def.min;
      const hi = bounds?.max ?? def.max;
      const range = ranges.get(def.key);
      const input = inputs.get(def.key);
      if (range && lo != null && hi != null) {
        range.min = String(lo);
        range.max = String(hi);
      }
      if (input && lo != null && hi != null) {
        input.min = String(lo);
        input.max = String(hi);
      }
    }
    if (root && def.inertWhen) {
      const inert = !!def.inertWhen(state);
      root.setAttribute("data-inert", inert ? "1" : "0");
      root.querySelectorAll("input, select, button").forEach((node) => {
        /** @type {HTMLInputElement} */ (node).disabled = inert;
      });
    }
    if (def.key === "edgeLengthMm") continue;
    const v = state[def.key];
    if (v === undefined) continue;
    const uiVal = stateToUi(def, v);
    const input = inputs.get(def.key);
    const range = ranges.get(def.key);
    // Prefer the live control bounds (limits / boundsForState) so the
    // number field and range never disagree after a base switch.
    const lo = range != null && range.min !== "" ? Number(range.min) : def.min;
    const hi = range != null && range.max !== "" ? Number(range.max) : def.max;
    const display =
      lo != null &&
      hi != null &&
      Number.isFinite(lo) &&
      Number.isFinite(hi)
        ? clampUi(uiVal, lo, hi)
        : uiVal;
    if (input && document.activeElement !== input) {
      input.value = fmtInput(display);
      const readout = input.parentElement?.querySelector(".value-readout");
      if (readout && !readout.hidden) readout.textContent = fmtInput(display);
    }
    if (range && document.activeElement !== range) {
      range.value = String(display);
      const readout = range.parentElement?.querySelector(".value-readout");
      if (readout && !readout.hidden) {
        readout.textContent = fmtInput(Number(range.value));
      }
    }
  }
}
