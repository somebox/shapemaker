/**
 * Adapter only: events → state → compile → viewer / export.
 * Must not branch on pipeline stages.
 */

import { compile } from "./compile.js";
import { createViewer } from "./viewer.js";
import { writeBinaryStl } from "./export/stl.js";

const canvasHost = document.getElementById("canvas-host");
const statusEl = document.getElementById("status");
const exportBtn = document.getElementById("btn-export");

/** @type {ReturnType<typeof compile> | null} */
let last = null;
let state = {};

const viewer = createViewer(canvasHost, {
  onFacePick(faceIndex) {
    state = { ...state, faceIndex };
    regenerate();
    viewer.setFocusFaces([faceIndex]); // after regenerate — setMesh clears it
  },
});

function regenerate() {
  const next = compile(state);
  if (!next.validation.ok) {
    // Keep the last good mesh on screen; the message names the bad parameter.
    statusEl.textContent = next.validation.errors
      .map((e) => `${e.key ?? e.stage}: ${e.message}`)
      .join("\n");
    return;
  }
  // Reframe only when the object's size or identity changes; ordinary wall /
  // border / fillet edits must leave the camera where the user put it.
  const reframe = !last ||
    last.state.base !== next.state.base ||
    last.state.circumdiameterMm !== next.state.circumdiameterMm;

  last = next;
  state = { ...next.state };
  viewer.setMesh(next.mesh, next.orientation, { frame: reframe });

  const m = next.metrics;
  const warn = next.validation.warnings.map((w) => `\n${w.message}`).join("");
  statusEl.textContent =
    `print  ${fmt(m.extentsMm[0])}×${fmt(m.extentsMm[1])}×${fmt(m.extentsMm[2])} mm` +
    (m.wallMm.min != null ? ` · wall ${fmt(m.wallMm.min)}–${fmt(m.wallMm.max)}` : " · solid") +
    ` · longest flat ${fmt(m.longestHorizontalMm)} mm\n` +
    `mesh   ${m.triangleCount.toLocaleString("en-US")} tris` +
    ` · watertight ${m.watertight ? "✓" : "✗"}` +
    ` · ${m.volumeCm3.toFixed(1)} cm³` +
    warn;
}

function fmt(n) {
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "") : "—";
}

exportBtn.addEventListener("click", () => {
  // Export regenerates at full quality through the same code. Once M2 exposes
  // editable fields the on-screen mesh may be the last *good* one while the
  // current state is invalid, so this must check rather than assume.
  const result = compile(state);
  if (!result.validation.ok || !result.mesh) {
    statusEl.textContent = result.validation.errors
      .map((e) => `cannot export — ${e.key ?? e.stage}: ${e.message}`)
      .join("\n");
    return;
  }
  const size = result.state.circumdiameterMm;
  const buf = writeBinaryStl(result.mesh, {
    header: `shapemaker_${size}mm`,
    matrix: result.orientation.matrix,
  });
  const blob = new Blob([buf], { type: "model/stl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `icosidodeca_${size}mm.stl`;
  a.click();
  URL.revokeObjectURL(a.href);
});

regenerate();
