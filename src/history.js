/**
 * Pure browser-history transaction helper for parameter edits.
 *
 * Live slider drags must not erase the pre-drag entry: the first preview tick
 * pushes a new entry, subsequent ticks replace it, and commit finalizes that
 * same entry. Discrete edits (segments, release) push once when the hash
 * actually changes.
 */

/**
 * @param {{
 *   commit: boolean,
 *   liveEdit: boolean,
 *   hash: string,
 *   lastWrittenHash: string,
 * }} args
 * @returns {{ action: 'push'|'replace'|'none', liveEdit: boolean }}
 */
export function nextHistoryAction({ commit, liveEdit, hash, lastWrittenHash }) {
  if (!commit) {
    if (!liveEdit) return { action: "push", liveEdit: true };
    if (hash !== lastWrittenHash) return { action: "replace", liveEdit: true };
    return { action: "none", liveEdit: true };
  }
  if (liveEdit) {
    if (hash !== lastWrittenHash) return { action: "replace", liveEdit: false };
    return { action: "none", liveEdit: false };
  }
  if (hash !== lastWrittenHash) return { action: "push", liveEdit: false };
  return { action: "none", liveEdit: false };
}
