/**
 * Start-from recipes — full panel packs for built-in bases and named presets.
 * Choosing a start hard-resets Form + distort; it is not preserve-intent adapt.
 * A start loads points (and a Form pack) to modify — not a lasting "mode".
 */

import { DEFAULT_STATE, normalizeState, serializeState, statesEqual } from "./schema.js";
import { BASES, BASE_IDS, isKnownBase } from "./bases.js";

/**
 * Per-base Form overrides so every built-in start compiles without clamp
 * at its own defaults; later Density/jitter edits re-fit wall and border
 * through applyEdit's reshape adaptation. Regulars share DEFAULT_STATE;
 * parametric hulls (globe, twisted globe, sphere, random) and the
 * ninety-face rhombic solid need a softer fillet on their small faces.
 */
const BASE_PACKS = Object.freeze({
  // Relative border is the default for every base. Parametric hulls only
  // need a softer fillet on their small faces.
  globe: Object.freeze({
    filletMm: 1.5,
  }),
  sphere: Object.freeze({
    filletMm: 1.5,
  }),
  random: Object.freeze({
    filletMm: 1.5,
  }),
  // All-triangle bands: twice the globe's faces per meridian, so the start
  // opens at 16 meridians (224 faces) rather than the shared Density default
  // of 24 (528). Separation rides along so the pack equals what the Density
  // slider writes at 16 and the chip reads as clean, not edited.
  twistedglobe: Object.freeze({
    filletMm: 1,
    points: 16,
    separation: 0.56,
  }),
  // Ninety small rhombi; the slim ones cap the fillet near 2.3 mm at Ø100.
  rhombicenneaconta: Object.freeze({
    filletMm: 2,
  }),
});

/**
 * Default pack for a built-in base id (Platonics, icosidodeca, random).
 * @param {string} baseId
 * @returns {object} normalized state
 */
export function recipeForBase(baseId) {
  if (!isKnownBase(baseId)) {
    throw new Error(`Unknown start base "${baseId}"`);
  }
  return normalizeState({
    ...DEFAULT_STATE,
    ...(BASE_PACKS[baseId] || {}),
    base: baseId,
    faceIndex: -1,
  });
}

/**
 * True when draft matches the built-in recipe for `baseId`, ignoring resting
 * face (compile resolves faceIndex; recipes ship with -1).
 * @param {object} draft
 * @param {string} baseId
 */
export function isCleanBaseRecipe(draft, baseId) {
  if (!draft || !isKnownBase(baseId) || draft.base !== baseId) return false;
  return statesEqual({ ...draft, faceIndex: -1 }, recipeForBase(baseId));
}

/**
 * Active / edited chip status for built-in bases and named presets.
 * Preset claim wins over base highlighting so a named recipe is not also
 * shown as an edited point-pack.
 * @param {{
 *   draft: object,
 *   projectName: string,
 *   presets?: { id: string, name: string, resolved: object }[],
 * }} args
 * @returns {{ id: string, kind: 'base'|'preset', active: boolean, edited: boolean }[]}
 */
export function startStatuses({ draft, projectName, presets = [] }) {
  const presetStatuses = presets.map((p) => {
    const match = statesEqual(draft, p.resolved);
    // Name gate: default icosidodeca equals Prototype TPU's recipe; only
    // highlight the preset when that start was actually chosen.
    const active = projectName === p.name && match;
    return {
      id: p.id,
      kind: /** @type {'preset'} */ ("preset"),
      active,
      edited: projectName === p.name && !match,
    };
  });
  const presetClaims = presetStatuses.some((s) => s.active || s.edited);
  const baseStatuses = BASE_IDS.map((id) => {
    const active = !presetClaims && isCleanBaseRecipe(draft, id);
    const edited = !presetClaims && draft.base === id && !active;
    return {
      id,
      kind: /** @type {'base'} */ ("base"),
      active,
      edited,
    };
  });
  return [...baseStatuses, ...presetStatuses];
}

/**
 * Resolve a start id to a full replace payload.
 * @param {string} id  base id or preset id
 * @param {{ id: string, name: string, state: object, resolved?: object }[]} [presets]
 * @returns {{ name: string, state: object, resolved: object } | null}
 */
export function startFromRecipe(id, presets = []) {
  const preset = presets.find((p) => p.id === id);
  if (preset) {
    const state = normalizeState(preset.state);
    return {
      name: preset.name,
      state: serializeState(state),
      resolved: preset.resolved
        ? serializeState(preset.resolved)
        : serializeState(state),
    };
  }
  if (!isKnownBase(id)) return null;
  const state = recipeForBase(id);
  return {
    name: BASES[id].label,
    state: serializeState(state),
    resolved: serializeState(state),
  };
}
