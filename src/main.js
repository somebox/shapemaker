/**
 * Adapter only: events → state → compile → viewer / export.
 * Must not branch on pipeline stages.
 */

import { compile } from "./compile.js";
import { createViewer } from "./viewer.js";
import { writeBinaryStl } from "./export/stl.js";
import { exportSvg } from "./export/svg.js";
import { createPanel, normalizePatch } from "./ui.js";
import { serializeProjectV1, parseProject } from "./project-format.js";
import { normalizeState, statesEqual } from "./schema.js";
import { encodeHash, decodeHash } from "./hashcodec.js";
import { nextHistoryAction } from "./history.js";
import {
  canSaveProject,
  classifyOpen,
  shouldEstablishCleanBaseline,
  sessionHistoryPayload,
  restoreSessionFromPopstate,
  depthAfterPopstate,
} from "./session.js";
import { adaptStateForBase } from "./adapt-base.js";
import { isKnownBase } from "./bases.js";
import { hullSkeletonForBase, scaleSkeleton } from "./pipeline.js";
import { computeLimits } from "./limits.js";
import { parsePresetsEnvelope } from "./presets.js";
import { startFromRecipe, startStatuses } from "./starts.js";
import { computeOrientation, nearestFaceByNormal } from "./orient.js";
import { toFaceFrame } from "./faceframe.js";
import { HEAVY_COMPILE_MS, predictedCompileMs } from "./perf.js";
import { computePrintRisk } from "./metrics.js";
import { VERSION } from "./version.js";
import {
  createChrome,
  maybeShowFirstVisit,
} from "./onboarding.js";

const appEl = document.getElementById("app");
const canvasHost = document.getElementById("canvas-host");
const panelEl = document.getElementById("panel");

const chrome = createChrome({
  version: VERSION,
  onHelp() {
    chrome.openOnboarding();
  },
});
appEl?.prepend(chrome.header);
document.body.appendChild(chrome.dialog);
{
  const h = chrome.header.getBoundingClientRect().height;
  document.documentElement.style.setProperty("--header-offset", `${Math.ceil(h)}px`);
}

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
/** Same-document push depth — Undo must not leave the app. */
let sessionPushDepth = 0;

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
    refreshHistoryPayload();
    updateProjectStatus();
  },
  onSave() {
    if (!canSaveProject({ draftValid, last })) return;
    const text = serializeProjectV1({ name: projectName, state: last.state });
    downloadText(text, `${safeName(projectName)}.shapemaker.json`);
    cleanState = normalizeState(last.state);
    cleanName = projectName;
    refreshHistoryPayload();
    updateProjectStatus();
  },
  onOpen() {
    fileInput.value = "";
    fileInput.click();
  },
  onStart(id) {
    applyStart(id);
  },
  onUndo() {
    if (sessionPushDepth > 0) history.back();
  },
  onCopyLink() {
    // Ensure the URL reflects the current valid state without adding history.
    if (draftValid && last?.state) writeUrl(encodeHash(last.state), "replace");
    const url = location.href;
    const done = (ok) => ui.setCopyFeedback(ok);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => done(true)).catch(() => {
        done(fallbackCopy(url));
      });
    } else {
      done(fallbackCopy(url));
    }
  },
  onPrepareShare() {
    if (draftValid && last?.state) writeUrl(encodeHash(last.state), "replace");
  },
  onExport() {
    exportStl();
  },
  onExportSvg() {
    exportSvgFile();
  },
  onMaterial() {
    /* mass readout updates inside the panel */
  },
});

function exportStem(state) {
  const { base, circumdiameterMm: size, seed, jitter, points } = state;
  // Seed and point count go in the filename whenever the shape depends on
  // them — the reproducibility story survives outside the URL (spec rule),
  // and two exports of different densities don't overwrite each other.
  const parts = [];
  if (base === "random" || jitter > 0) parts.push(`s${seed}`);
  if (base === "sphere" || base === "random") parts.push(`p${points}`);
  const tag = parts.length ? `_${parts.join("_")}` : "";
  return `${base}_${size}mm${tag}`;
}

/**
 * Shared blob → download path for Save / STL / SVG.
 * @param {BlobPart} data
 * @param {string} filename
 * @param {string} mime
 */
function downloadBlob(data, filename, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadText(text, filename) {
  downloadBlob(text, filename, "application/json");
}

/** Prefer the last successful compile so export matches the on-screen mesh. */
function exportResult() {
  if (draftValid && last?.validation?.ok && last.mesh) return last;
  const result = compile(draft);
  if (!result.validation.ok || !result.mesh) {
    ui.setResult(result, { limits: null, invalid: true });
    return null;
  }
  return result;
}

function exportStl() {
  const result = exportResult();
  if (!result) return;
  const stem = exportStem(result.state);
  const buf = writeBinaryStl(result.mesh, {
    header: `shapemaker_${stem}`,
    matrix: result.orientation.matrix,
  });
  downloadBlob(buf, `${stem}.stl`, "model/stl");
}

function exportSvgFile() {
  const result = exportResult();
  if (!result) return;
  const stem = exportStem(result.state);
  const cam = viewer.camera;
  const tgt = viewer.controls.target;
  const svg = exportSvg({
    mesh: result.mesh,
    orientation: result.orientation,
    camera: {
      position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      target: { x: tgt.x, y: tgt.y, z: tgt.z },
      up: { x: cam.up.x, y: cam.up.y, z: cam.up.z },
      near: cam.near,
    },
    label: stem,
  });
  downloadBlob(svg, `${stem}.svg`, "image/svg+xml");
}

ui.setActionsVisible({ open: true });

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
  .catch((err) => console.warn("presets:", err));

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    openProjectText(await file.text());
  } catch (err) {
    console.warn("open project:", err);
    ui.setResult(
      {
        validation: {
          ok: false,
          errors: [{ key: "project", message: "Could not read that file" }],
          warnings: [],
        },
        state: draft,
        metrics: null,
      },
      { limits: null, invalid: true },
    );
    updateProjectStatus();
  }
});

/**
 * Start strip (built-in point packs + named presets) — full recipe hard reset.
 * Same session path as Open; one history push via regenerate(commit).
 * @param {string} id  base id or preset id
 */
function applyStart(id) {
  const start = startFromRecipe(id, presets);
  if (!start) return;
  const text = serializeProjectV1({
    name: start.name,
    state: start.state,
  });
  openProjectText(text);
}

/**
 * Open / start apply — shared session mutation path.
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
      { limits: null, invalid: true },
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
    // regenerate pushed this entry before the baseline existed — rewrite it.
    refreshHistoryPayload();
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
  sessionPushDepth = depthAfterPopstate({
    historyState: history.state,
    previousDepth: sessionPushDepth,
  });
  const restored = restoreSessionFromPopstate({
    decoded: decodeHash(location.hash),
    historyState: history.state,
  });
  if (!restored.ok) return;
  liveHistoryEdit = false;
  draft = restored.draft;
  if (restored.projectName != null) {
    projectName = restored.projectName;
    cleanName = restored.cleanName;
    cleanState = normalizeState(restored.cleanState);
  }
  regenerate({ forceFrame: false, fromHistory: true });
  updateProjectStatus();
});

/** Keys that change the skeleton itself — edits to them re-run adaptation. */
const SKELETON_KEYS = [
  "base",
  "seed",
  "points",
  "separation",
  "jitter",
  "jitterMode",
  "subdiv",
  "soften",
];

function applyPatch(patch, commit) {
  const normalized = normalizePatch(patch);
  // Predict cost BEFORE the adaptation probe: the probe builds the real next
  // skeleton, which for heavy configs is most of the freeze — the busy badge
  // must cover it too, not appear after it. Reshape edits pay for both the
  // probe and the compile, so their estimate doubles.
  const prospective = { ...draft, ...normalized };
  const reshapes = SKELETON_KEYS.some(
    (k) => normalized[k] != null && normalized[k] !== draft[k],
  );
  const est =
    predictedCompileMs(
      lastCompileMs,
      last?.state,
      prospective,
      last?.skeleton?.faces?.length ?? 0,
    ) * (reshapes ? 2 : 1);
  const run = () => applyEdit(normalized, commit);
  if (est > HEAVY_COMPILE_MS) deferBehindBadge(run);
  else run();
}

/** Probe limits, adapt, mutate the draft, and rebuild — the whole edit. */
function applyEdit(patchIn, commit) {
  let normalized = patchIn;
  let warnings = [];

  // Any skeleton-shaping edit (base switch, seed reroll, density, jitter)
  // adapts wall/border to the NEW skeleton's limits — same policy as base
  // change: fix what would fail validation, never taste. Without this, a
  // reroll into a tighter hull lands on an error instead of a shape.
  const reshapes = SKELETON_KEYS.some(
    (k) => normalized[k] != null && normalized[k] !== draft[k],
  );
  // A draft carrying an invalid border (e.g. an old URL where a clamp
  // rounded to 0) heals on the next edit of any kind, not only reshapes.
  const brokenBorder =
    (normalized.openings ?? draft.openings) &&
    !((normalized.borderMm ?? draft.borderMm) > 0);
  if (reshapes || brokenBorder) {
    const nextBase = normalized.base ?? draft.base;
    // Guard against a draft carrying an unknown base (e.g. a corrupt URL
    // hash): hullSkeletonForBase would throw a validationError with no
    // catch here. Skip adaptation — the draft is already failing compile.
    if (isKnownBase(nextBase)) {
      const probe = { ...draft, ...normalized, faceIndex: -1 };
      const unit = hullSkeletonForBase(nextBase, probe);
      const sk = scaleSkeleton(unit, probe.circumdiameterMm / 2);
      const limits = computeLimits(sk, probe);
      const adapted = adaptStateForBase({
        currentState: { ...draft, ...normalized },
        nextBase,
        nextLimits: limits,
      });
      normalized = normalizePatch({ ...normalized, ...adapted.patch });
      warnings = adapted.warnings;
    }
  }

  draft = { ...draft, ...normalized };
  regenerate({ commit, warnings });
}
/** Last measured valid-compile duration; drives the heavy-config policy. */
let lastCompileMs = 0;
/** @type {Array<() => void>|null} edits queued behind the busy badge */
let heavyQueue = null;
const busyEl = document.getElementById("busy");

function setBusy(on) {
  if (busyEl) busyEl.hidden = !on;
}

/**
 * Show the busy badge, let it paint, then run the queued work. Edits that
 * arrive while a launch is pending run in order in the same batch. rAF lands
 * before the paint and the timeout inside launch() lands behind one, so the
 * badge is visible before the blocking work; rAF never fires in hidden
 * tabs, so a plain timeout backstops it.
 */
function deferBehindBadge(run) {
  if (heavyQueue) {
    heavyQueue.push(run);
    return;
  }
  heavyQueue = [run];
  setBusy(true);
  let launched = false;
  const launch = () => {
    if (launched) return;
    launched = true;
    setTimeout(() => {
      const queue = heavyQueue;
      heavyQueue = null;
      try {
        for (const fn of queue) fn();
      } finally {
        setBusy(false);
      }
    }, 0);
  };
  requestAnimationFrame(launch);
  setTimeout(launch, 150);
}

/** Synchronous rebuild — callers read `last`/`draftValid` right after. */
function regenerate({
  forceFrame = false,
  commit = true,
  fromHistory = false,
  warnings = [],
} = {}) {
  const t0 = performance.now();
  const next = compile(draft);
  if (!next.validation.ok) {
    draftValid = false;
    ui.setResult(next, { limits: null, invalid: true, warnings });
    updateProjectStatus();
    // Do not write an invalid hash.
    return;
  }
  // Only valid compiles carry geometry cost; invalid ones return early and
  // must not clear heavy mode.
  lastCompileMs = performance.now() - t0;
  ui.setHeavy(lastCompileMs > HEAVY_COMPILE_MS);

  // Do not reframe on jitter/seed-only edits. Reframe on force, first mesh,
  // base change, or size change.
  const shouldFrame =
    forceFrame ||
    !last ||
    last.state.base !== next.state.base ||
    last.state.circumdiameterMm !== next.state.circumdiameterMm;

  // Keep the underside stable when distort rebuilds the face list (merge-skip
  // reindexes faces; keeping faceIndex by number rotates the model).
  let stable = next;
  if (
    !forceFrame &&
    last?.skeleton &&
    last.state.base === next.state.base &&
    Number.isInteger(last.state.faceIndex) &&
    last.state.faceIndex >= 0 &&
    last.state.faceIndex < last.skeleton.faces.length
  ) {
    const prevN = toFaceFrame(last.skeleton, last.state.faceIndex).normal;
    const mapped = nearestFaceByNormal(next.skeleton, prevN);
    if (mapped !== next.state.faceIndex) {
      const orientation = computeOrientation(next.skeleton, mapped);
      // Limits and orientation-dependent metrics deliberately stay from compile.
      stable = {
        ...next,
        orientation,
        state: { ...next.state, faceIndex: mapped },
      };
    }
  }

  draftValid = true;
  const prevFace = last?.state?.faceIndex;
  const prevJitter = last?.state?.jitter;
  const prevSeed = last?.state?.seed;
  last = stable;
  draft = { ...stable.state };
  lastLimits = stable.metrics.limits;
  const [w, d, h] = stable.metrics.extentsMm;
  viewer.setDimensionCallout({ width: w, depth: d, height: h }, true);
  viewer.setMesh(stable.mesh, stable.orientation, {
    frame: shouldFrame,
    skeleton: stable.skeleton,
    depth: stable.state.depth,
    heightMm: h,
  });
  // Risk comes from compile; the face-remap path changed the orientation,
  // so only there is it re-derived (via the same metrics scan).
  const printRisk =
    stable === next
      ? stable.metrics.printRisk
      : computePrintRisk(stable.skeleton, stable.orientation.matrix);
  viewer.setPrintRisk({
    skeleton: stable.skeleton,
    flatEdgeIndices: printRisk.flatEdgeIndices,
    overhangFaceIndices: printRisk.overhangFaceIndices,
  });
  ui.setResult(stable, { limits: lastLimits, warnings });
  // Focus on frame or deliberate face pick — not on distort remaps.
  const facePick =
    prevFace != null &&
    stable.state.faceIndex !== prevFace &&
    stable.state.jitter === prevJitter &&
    stable.state.seed === prevSeed;
  if (stable.state.faceIndex >= 0 && (shouldFrame || facePick)) {
    viewer.setFocusFaces([stable.state.faceIndex]);
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
  if (action === "push") sessionPushDepth += 1;
  const payload = sessionHistoryPayload({
    projectName,
    cleanName,
    cleanState,
    depth: sessionPushDepth,
  });
  applyingHistory = true;
  if (action === "push") history.pushState(payload, "", url);
  else history.replaceState(payload, "", url);
  lastWrittenHash = hash;
  applyingHistory = false;
}

/**
 * Rewrite the current entry's payload after name or baseline changes
 * (Save, rename, Open) — otherwise Undo/Redo re-entering this entry
 * restores the stale values captured when it was pushed.
 */
function refreshHistoryPayload() {
  applyingHistory = true;
  history.replaceState(
    sessionHistoryPayload({
      projectName,
      cleanName,
      cleanState,
      depth: sessionPushDepth,
    }),
    "",
    location.href,
  );
  applyingHistory = false;
}

function updateProjectStatus() {
  const dirty =
    projectName !== cleanName || !statesEqual(draft, cleanState);
  ui.setProjectStatus({
    name: projectName,
    dirty,
    canSave: canSaveProject({ draftValid, last }),
    canUndo: sessionPushDepth > 0,
  });
  ui.setStartStatus(
    startStatuses({ draft, projectName, presets }),
  );
}

function safeName(name) {
  return name.replace(/[^\w\-]+/g, "_") || "shapemaker";
}

/** @returns {boolean} whether the copy appears to have succeeded */
function fallbackCopy(url) {
  const ta = document.createElement("textarea");
  ta.value = url;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
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
// A shared link means the visitor came to see a specific shape — never
// interpose the tutorial over it. The header "?" still offers it.
if (!boot.ok) maybeShowFirstVisit(() => chrome.openOnboarding());
