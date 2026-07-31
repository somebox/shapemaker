/**
 * Adapter only: events → state → compile → viewer / export.
 * Must not branch on pipeline stages.
 */

import { compile } from "./compile.js";
import { createViewer } from "./viewer.js";
import { writeBinaryStl } from "./export/stl.js";
import { createPanel, normalizePatch } from "./ui.js";
import { serializeProjectV1, parseProject } from "./project-format.js";
import { normalizeState, statesEqual } from "./schema.js";
import { encodeHash, decodeHash } from "./hashcodec.js";
import { nextHistoryAction } from "./history.js";
import {
  canSaveProject,
  classifyOpen,
  shouldEstablishCleanBaseline,
} from "./session.js";
import { adaptStateForBase } from "./adapt-base.js";
import { hullSkeletonForBase, scaleSkeleton } from "./pipeline.js";
import { computeLimits } from "./limits.js";
import { parsePresetsEnvelope } from "./presets.js";

const canvasHost = document.getElementById("canvas-host");
const panelEl = document.getElementById("panel");

/** @type {ReturnType<typeof compile> | null} */
let last = null;
/** @type {object} */
let draft = normalizeState({});
let projectName = "Untitled";
/** @type {object} */
let cleanState = normalizeState({});
let cleanName = "Untitled";
/** @type {object|null} */
let lastLimits = null;
/** Ignore popstate we ourselves caused via replace/push. */
let applyingHistory = false;
/** Whether the current history entry is the live preview for an edit. */
let liveHistoryEdit = false;
/** Whether the draft, rather than merely the last preview, compiles. */
let draftValid = false;
/** Last hash we wrote — canonical-equality gate. */
let lastWrittenHash = "";
/** @type {{ id: string, name: string, state: object, resolved: object }[]} */
let presets = [];

if (new URLSearchParams(location.search).get("mock") === "future") {
  document.body.classList.add("mock-future");
}

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".json,.shapemaker.json,application/json";
fileInput.hidden = true;
document.body.appendChild(fileInput);

/** @type {ReturnType<typeof createPanel>} */
let ui;
/** @type {number|null} */
let pinnedEdgeMm = null;

const viewer = createViewer(canvasHost, {
  onFacePick(faceIndex) {
    applyPatch({ faceIndex }, true);
    viewer.setFocusFaces([faceIndex]);
  },
  onEdgeHover(info) {
    if (info) ui?.setSelectedEdge(info.lengthMm);
    else ui?.setSelectedEdge(pinnedEdgeMm);
  },
  onEdgeSelect(info) {
    pinnedEdgeMm = info?.lengthMm ?? null;
    ui?.setSelectedEdge(pinnedEdgeMm);
  },
});

ui = createPanel(panelEl, {
  onPatch(patch, { commit }) {
    applyPatch(patch, commit);
  },
  onNameChange(name) {
    projectName = name;
    updateProjectStatus();
  },
  onSave() {
    if (!canSaveProject({ draftValid, last })) return;
    const text = serializeProjectV1({ name: projectName, state: last.state });
    downloadText(text, `${safeName(projectName)}.shapemaker.json`);
    cleanState = normalizeState(last.state);
    cleanName = projectName;
    updateProjectStatus();
  },
  onOpen() {
    fileInput.value = "";
    fileInput.click();
  },
  onPreset(id) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    // Same path as Open: project bytes from immutable app data.
    const text = serializeProjectV1({
      name: preset.name,
      state: preset.state,
    });
    openProjectText(text);
  },
  onCopyLink() {
    // Ensure the URL reflects the current valid state without adding history.
    if (draftValid && last?.state) writeUrl(encodeHash(last.state), "replace");
    const url = location.href;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => fallbackCopy(url));
    } else {
      fallbackCopy(url);
    }
  },
  onExport() {
    const result = compile(draft);
    if (!result.validation.ok || !result.mesh) {
      ui.setResult(result, { limits: lastLimits, invalid: true });
      return;
    }
    const size = result.state.circumdiameterMm;
    const base = result.state.base;
    const buf = writeBinaryStl(result.mesh, {
      header: `shapemaker_${base}_${size}mm`,
      matrix: result.orientation.matrix,
    });
    const blob = new Blob([buf], { type: "model/stl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}_${size}mm.stl`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
});

ui.setActionsVisible({ open: true, copyLink: true });

fetch(new URL("../presets.json", import.meta.url))
  .then((r) => r.json())
  .then((raw) => {
    const parsed = parsePresetsEnvelope(raw);
    if (!parsed.ok) {
      console.warn("presets:", parsed.error);
      return;
    }
    presets = parsed.presets;
    ui.setPresets(presets);
    updateProjectStatus();
  })
  .catch((err) => console.warn("presets load failed", err));

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  openProjectText(await file.text());
});

/**
 * Open / preset apply — shared session mutation path.
 * @param {string} text
 */
function openProjectText(text) {
  const parsed = parseProject(text);
  const check = parsed.ok ? compile(parsed.state) : null;
  const decision = classifyOpen({
    parseOk: parsed.ok,
    compileOk: Boolean(check?.validation?.ok),
  });

  if (decision !== "accept") {
    const message =
      decision === "reject-parse"
        ? parsed.error
        : check.validation.errors[0]?.message || "Project failed to compile";
    ui.setResult(
      {
        validation: {
          ok: false,
          errors: [{ key: "project", message }],
          warnings: [],
        },
        state: draft,
        metrics: null,
      },
      { limits: lastLimits, invalid: true },
    );
    updateProjectStatus();
    return;
  }

  const prevName = projectName;
  const prevDraft = draft;
  const prevClean = cleanState;
  const prevCleanName = cleanName;

  projectName = parsed.project.name || "Untitled";
  draft = normalizeState(parsed.state);
  regenerate({ forceFrame: true, commit: true });
  if (
    shouldEstablishCleanBaseline({
      openAccepted: true,
      regenerateOk: draftValid && !!last?.state,
    })
  ) {
    cleanState = normalizeState(last.state);
    cleanName = projectName;
    updateProjectStatus();
    return;
  }
  projectName = prevName;
  draft = prevDraft;
  cleanState = prevClean;
  cleanName = prevCleanName;
  updateProjectStatus();
}

window.addEventListener("popstate", () => {
  if (applyingHistory) return;
  const decoded = decodeHash(location.hash);
  if (!decoded.ok) return;
  liveHistoryEdit = false;
  draft = decoded.state;
  regenerate({ forceFrame: false, fromHistory: true });
});

function applyPatch(patch, commit) {
  let normalized = normalizePatch(patch);
  let warnings = [];

  if (normalized.base != null && normalized.base !== draft.base) {
    const unit = hullSkeletonForBase(normalized.base);
    const R = (draft.circumdiameterMm ?? 100) / 2;
    const sk = scaleSkeleton(unit, R);
    // Limits from skeleton (no solidifier). Border max does not depend on the
    // current border value; fillet ceiling is unused by adaptation.
    const limits = computeLimits(sk, {
      ...draft,
      base: normalized.base,
      faceIndex: -1,
    });
    const adapted = adaptStateForBase({
      currentState: draft,
      nextBase: normalized.base,
      nextLimits: limits,
    });
    normalized = normalizePatch({ ...normalized, ...adapted.patch });
    warnings = adapted.warnings;
  }

  draft = { ...draft, ...normalized };
  regenerate({ commit, warnings });
}

function regenerate({
  forceFrame = false,
  commit = true,
  fromHistory = false,
  warnings = [],
} = {}) {
  const next = compile(draft);
  if (!next.validation.ok) {
    draftValid = false;
    ui.setResult(next, { limits: lastLimits, invalid: true, warnings });
    updateProjectStatus();
    // Do not write an invalid hash.
    return;
  }

  const reframe =
    forceFrame ||
    !last ||
    last.state.base !== next.state.base ||
    last.state.circumdiameterMm !== next.state.circumdiameterMm;

  draftValid = true;
  last = next;
  draft = { ...next.state };
  lastLimits = next.metrics.limits;
  viewer.setMesh(next.mesh, next.orientation, {
    frame: reframe,
    skeleton: next.skeleton,
  });
  ui.setResult(next, { limits: lastLimits, warnings });
  if (next.state.faceIndex >= 0) {
    viewer.setFocusFaces([next.state.faceIndex]);
  }
  updateProjectStatus();

  if (fromHistory) {
    lastWrittenHash = encodeHash(draft);
    return;
  }
  syncHistory(commit);
}

function syncHistory(commit) {
  if (!last?.state) return;
  const hash = encodeHash(last.state);
  const step = nextHistoryAction({
    commit,
    liveEdit: liveHistoryEdit,
    hash,
    lastWrittenHash,
  });
  liveHistoryEdit = step.liveEdit;
  if (step.action !== "none") writeUrl(hash, step.action);
  else lastWrittenHash = hash;
}

/** @param {string} hash @param {'push'|'replace'} action */
function writeUrl(hash, action) {
  const url = `${location.pathname}${location.search}#${hash}`;
  applyingHistory = true;
  if (action === "push") history.pushState({ shapemaker: true }, "", url);
  else history.replaceState({ shapemaker: true }, "", url);
  lastWrittenHash = hash;
  applyingHistory = false;
}

function updateProjectStatus() {
  const dirty =
    projectName !== cleanName || !statesEqual(draft, cleanState);
  ui.setProjectStatus({
    name: projectName,
    dirty,
    canSave: canSaveProject({ draftValid, last }),
  });
  if (presets.length) {
    ui.setPresetStatus(
      presets.map((p) => ({
        id: p.id,
        active: statesEqual(draft, p.resolved),
        edited: projectName === p.name && !statesEqual(draft, p.resolved),
      })),
    );
  }
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function safeName(name) {
  return name.replace(/[^\w\-]+/g, "_") || "shapemaker";
}

function fallbackCopy(url) {
  const ta = document.createElement("textarea");
  ta.value = url;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* ignore */
  }
  ta.remove();
}

// Boot: prefer URL hash, else defaults. Seed the URL without a live-edit entry.
const boot = decodeHash(location.hash);
if (boot.ok) {
  draft = boot.state;
  regenerate({ forceFrame: true, fromHistory: true });
  cleanState = normalizeState(draft);
  cleanName = projectName;
} else {
  regenerate({ forceFrame: true, fromHistory: true });
  if (last?.state) {
    cleanState = normalizeState(last.state);
    draft = { ...last.state };
    writeUrl(encodeHash(last.state), "replace");
  }
}
updateProjectStatus();
