/**
 * Pure session-policy helpers for Save / Open eligibility and history restore.
 * Keeps browser I/O and DOM out of the decision rules.
 */

/**
 * Payload stored in `history.state` alongside the URL hash.
 * Hash carries authoring geometry; this carries name + dirty baseline +
 * this entry's same-document push depth (so Back AND Forward can restore
 * the Undo budget exactly instead of guessing from a counter).
 * @param {{ projectName: string, cleanName: string, cleanState: object, depth: number }} args
 */
export function sessionHistoryPayload({ projectName, cleanName, cleanState, depth }) {
  return {
    shapemaker: true,
    projectName,
    cleanName,
    cleanState,
    depth,
  };
}

/**
 * Push depth after landing on a history entry: the entry's own recorded
 * depth when it carries one, else one step back from the previous depth
 * (entry written before depths were recorded, or a foreign entry).
 * @param {{ historyState: object | null | undefined, previousDepth: number }} args
 */
export function depthAfterPopstate({ historyState, previousDepth }) {
  if (
    historyState &&
    historyState.shapemaker === true &&
    Number.isInteger(historyState.depth) &&
    historyState.depth >= 0
  ) {
    return historyState.depth;
  }
  return Math.max(0, previousDepth - 1);
}

/**
 * Decide what a popstate should restore from the hash decode + history.state.
 * @param {{
 *   decoded: { ok: boolean, state?: object },
 *   historyState: object | null | undefined,
 * }} args
 * @returns {{ ok: false } | {
 *   ok: true,
 *   draft: object,
 *   projectName?: string,
 *   cleanName?: string,
 *   cleanState?: object,
 * }}
 */
export function restoreSessionFromPopstate({ decoded, historyState }) {
  if (!decoded.ok || !decoded.state) return { ok: false };
  /** @type {{ ok: true, draft: object, projectName?: string, cleanName?: string, cleanState?: object }} */
  const out = { ok: true, draft: decoded.state };
  if (
    historyState &&
    historyState.shapemaker === true &&
    typeof historyState.projectName === "string" &&
    typeof historyState.cleanName === "string" &&
    historyState.cleanState &&
    typeof historyState.cleanState === "object"
  ) {
    out.projectName = historyState.projectName;
    out.cleanName = historyState.cleanName;
    out.cleanState = historyState.cleanState;
  }
  return out;
}

/**
 * Save is allowed only when the *current* draft compiles — not merely because
 * a previous successful mesh still exists in memory.
 * @param {{ draftValid: boolean, last: { state?: object } | null }} args
 */
export function canSaveProject({ draftValid, last }) {
  return Boolean(draftValid && last?.state);
}

/**
 * Classify an Open attempt before mutating the live session.
 * @param {{ parseOk: boolean, compileOk: boolean }} args
 * @returns {'reject-parse'|'reject-compile'|'accept'}
 */
export function classifyOpen({ parseOk, compileOk }) {
  if (!parseOk) return "reject-parse";
  if (!compileOk) return "reject-compile";
  return "accept";
}

/**
 * Clean baseline (dirty tracking) is established only after Open has been
 * accepted *and* regeneration of the opened state succeeded.
 * @param {{ openAccepted: boolean, regenerateOk: boolean }} args
 */
export function shouldEstablishCleanBaseline({ openAccepted, regenerateOk }) {
  return Boolean(openAccepted && regenerateOk);
}
