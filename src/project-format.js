/**
 * Shapemaker project files (.shapemaker.json).
 */

import { VERSION } from "./version.js";
import { normalizeState, serializeState } from "./schema.js";

export const FORMAT_ID = "shapemaker-project";
export const FORMAT_VERSION = 1;

/**
 * @param {{ name?: string, state: object }} args
 * @returns {string} two-space JSON + trailing newline
 */
export function serializeProjectV1({ name, state }) {
  const project = {
    format: FORMAT_ID,
    formatVersion: FORMAT_VERSION,
  };
  if (name != null && name !== "") project.name = name;
  project.createdWith = VERSION;
  project.state = serializeState(state);
  return `${JSON.stringify(project, null, 2)}\n`;
}

/**
 * Parse and migrate a project file. Does not replace the session — caller does.
 *
 * @param {string} text
 * @returns {{ ok: true, project: object, state: object } | { ok: false, error: string }}
 */
export function parseProject(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON" };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Project root must be an object" };
  }
  if (raw.format !== FORMAT_ID) {
    return { ok: false, error: `Unknown format "${raw.format}"` };
  }
  if (!Number.isInteger(raw.formatVersion) || raw.formatVersion < 1) {
    return { ok: false, error: "formatVersion must be a positive integer" };
  }
  if (raw.formatVersion > FORMAT_VERSION) {
    return {
      ok: false,
      error:
        `This project is format version ${raw.formatVersion}; ` +
        `this app supports up to ${FORMAT_VERSION}. Upgrade Shapemaker to open it.`,
    };
  }

  let project = raw;
  for (let v = raw.formatVersion; v < FORMAT_VERSION; v++) {
    project = migrateProject(project, v);
  }

  if (!project.state || typeof project.state !== "object") {
    return { ok: false, error: "Project is missing state" };
  }

  // Reject the uncommitted relative-`fillet` experiment rather than silently
  // dropping it and changing geometry (v1 stores filletMm only).
  if (
    Object.prototype.hasOwnProperty.call(project.state, "fillet") &&
    project.state.filletMm == null
  ) {
    return {
      ok: false,
      error:
        'Unsupported state field "fillet" — v1 projects use filletMm (millimetres).',
    };
  }

  const state = normalizeState(project.state);
  return {
    ok: true,
    project: {
      format: FORMAT_ID,
      formatVersion: FORMAT_VERSION,
      name: typeof project.name === "string" ? project.name : "Untitled",
      createdWith: project.createdWith,
      state,
      view: project.view,
      metadata: project.metadata,
      extensions: project.extensions,
    },
    state,
  };
}

/** Migrate one version step. v1 is current — no steps yet. */
function migrateProject(project, fromVersion) {
  if (fromVersion === FORMAT_VERSION) return project;
  // Future: fromVersion N → N+1
  return project;
}
