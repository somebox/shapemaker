/**
 * Pure session-policy helpers for Save / Open eligibility.
 * Keeps browser I/O and DOM out of the decision rules.
 */

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
