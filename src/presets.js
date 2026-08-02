/**
 * Versioned preset envelope — immutable app data, same state codec as projects.
 */

import { normalizeState, serializeState } from "./schema.js";
import { compile } from "./compile.js";
import { isKnownBase } from "./bases.js";

export const PRESETS_FORMAT = "shapemaker-presets";
export const PRESETS_FORMAT_VERSION = 1;

/**
 * @param {unknown} raw
 * @returns {{
 *   ok: true,
 *   presets: {
 *     id: string,
 *     name: string,
 *     description?: string,
 *     state: object,
 *     resolved: object,
 *   }[]
 * } | { ok: false, error: string }}
 */
export function parsePresetsEnvelope(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Presets root must be an object" };
  }
  if (raw.format !== PRESETS_FORMAT) {
    return { ok: false, error: `Unknown presets format "${raw.format}"` };
  }
  if (raw.formatVersion !== PRESETS_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Unsupported presets formatVersion ${raw.formatVersion}`,
    };
  }
  if (!Array.isArray(raw.presets)) {
    return { ok: false, error: "presets must be an array" };
  }

  const seen = new Set();
  /** @type {object[]} */
  const out = [];

  for (const p of raw.presets) {
    if (!p || typeof p !== "object") {
      return { ok: false, error: "Each preset must be an object" };
    }
    if (typeof p.id !== "string" || !p.id) {
      return { ok: false, error: "Preset is missing id" };
    }
    if (seen.has(p.id)) {
      return { ok: false, error: `Duplicate preset id "${p.id}"` };
    }
    seen.add(p.id);
    if (typeof p.name !== "string" || !p.name) {
      return { ok: false, error: `Preset "${p.id}" is missing name` };
    }
    if (!p.state || typeof p.state !== "object") {
      return { ok: false, error: `Preset "${p.id}" is missing state` };
    }
    const state = normalizeState(p.state);
    if (!isKnownBase(state.base)) {
      return { ok: false, error: `Preset "${p.id}" has unknown base` };
    }
    const result = compile(state);
    if (!result.validation.ok) {
      return {
        ok: false,
        error: `Preset "${p.id}" failed to compile: ${result.validation.errors.map((e) => e.message).join("; ")}`,
      };
    }
    out.push({
      id: p.id,
      name: p.name,
      description: typeof p.description === "string" ? p.description : "",
      state: serializeState(state),
      resolved: serializeState(result.state),
    });
  }

  return { ok: true, presets: out };
}
