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
import { startFromRecipe, startStatuses } from "./starts.js";
import { computeOrientation, nearestFaceByNormal } from "./orient.js";
import { toFaceFrame } from "./faceframe.js";
import { HEAVY_COMPILE_MS, predictedCompileMs } from "./perf.js";

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
    const { base, circumdiameterMm: size, seed, jitter } = result.state;
    // Seed in the filename whenever the shape depends on one — the
    // reproducibility story survives outside the URL (spec rule).
    const seeded = base === "random" || jitter > 0;
    const stem = seeded ? `${base}_s${seed}_${size}mm` : `${base}_${size}mm`;
    const buf = writeBinaryStl(result.mesh, {
      header: `shapemaker_${stem}`,
      matrix: result.orientation.matrix,
    });
    const blob = new Blob([buf], { type: "model/stl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stem}.stl`;
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
  if (sessionPushDepth > 0) sessionPushDepth -= 1;
  const decoded = decodeHash(location.hash);
  if (!decoded.ok) return;
  liveHistoryEdit = false;
  draft = decoded.state;
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
    draft.openings && !((normalized.borderMm ?? draft.borderMm) > 0);
  if (reshapes || brokenBorder) {
    const nextBase = normalized.base ?? draft.base;
    const probe = { ...draft, ...normalized, faceIndex: -1 };
    const unit = hullSkeletonForBase(probe.base, probe);
    const sk = scaleSkeleton(unit, (probe.circumdiameterMm ?? 100) / 2);
    const limits = computeLimits(sk, probe);
    const adapted = adaptStateForBase({
      currentState: { ...draft, ...normalized },
      nextBase,
      nextLimits: limits,
    });
    normalized = normalizePatch({ ...normalized, ...adapted.patch });
    warnings = adapted.warnings;
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
    ui.setResult(next, { limits: lastLimits, invalid: true, warnings });
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
  viewer.setMesh(stable.mesh, stable.orientation, {
    frame: shouldFrame,
    skeleton: stable.skeleton,
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
  applyingHistory = true;
  if (action === "push") {
    history.pushState({ shapemaker: true }, "", url);
    sessionPushDepth += 1;
  } else {
    history.replaceState({ shapemaker: true }, "", url);
  }
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
    canUndo: sessionPushDepth > 0,
  });
  ui.setStartStatus(
    startStatuses({ draft, projectName, presets }),
  );
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
