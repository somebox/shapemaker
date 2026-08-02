/**
 * First-visit onboarding dialog. Uses localStorage for the seen-flag —
 * the app's first persistent local state (not session recovery).
 */

export const ONBOARDING_SEEN_KEY = "shapemaker.onboarding.seen";

const GITHUB_URL = "https://github.com/somebox/shapemaker";

/**
 * @param {Storage} [store]
 * @returns {boolean}
 */
export function hasSeenOnboarding(store = localStorage) {
  try {
    return store.getItem(ONBOARDING_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * @param {Storage} [store]
 */
export function markOnboardingSeen(store = localStorage) {
  try {
    store.setItem(ONBOARDING_SEEN_KEY, "1");
  } catch {
    /* private mode / quota — treat as best-effort */
  }
}

/**
 * Build the slim app header and mount the onboarding dialog.
 * @param {{ version: string, onHelp?: () => void }} opts
 * @returns {{ header: HTMLElement, dialog: HTMLDialogElement, openOnboarding: () => void }}
 */
export function createChrome({ version, onHelp }) {
  const header = document.createElement("header");
  header.id = "app-header";

  const brand = document.createElement("div");
  brand.className = "app-brand";
  const title = document.createElement("span");
  title.className = "app-title";
  title.textContent = "Shapemaker";
  const ver = document.createElement("span");
  ver.className = "app-version";
  ver.textContent = `v${version}`;
  brand.append(title, ver);

  const actions = document.createElement("div");
  actions.className = "app-header-actions";

  const github = document.createElement("a");
  github.className = "app-header-link";
  github.href = GITHUB_URL;
  github.target = "_blank";
  github.rel = "noopener noreferrer";
  github.textContent = "GitHub";
  github.setAttribute("aria-label", "Shapemaker on GitHub");

  const help = document.createElement("button");
  help.type = "button";
  help.className = "app-header-help";
  help.textContent = "?";
  help.title = "How to use Shapemaker";
  help.setAttribute("aria-label", "How to use Shapemaker");
  help.addEventListener("click", () => {
    onHelp?.();
  });

  actions.append(github, help);
  header.append(brand, actions);

  const dialog = document.createElement("dialog");
  dialog.id = "onboarding";
  dialog.className = "onboarding";
  dialog.innerHTML = `
    <form method="dialog" class="onboarding-body">
      <h2>Design a printable form</h2>
      <ol class="onboarding-steps">
        <li><strong>Pick a start</strong> — choose a built-in shape or preset from the panel.</li>
        <li><strong>Adjust</strong> — tune Size, Form, and distort controls until the look fits.</li>
        <li><strong>Click a face</strong> — set which side rests on the print bed. This is easy to miss; the model orients to that face.</li>
        <li><strong>Export</strong> — download STL for printing or SVG for a line drawing.</li>
      </ol>
      <p class="onboarding-note">Reopen this tip anytime with <kbd>?</kbd> in the header.</p>
      <button type="submit" class="btn btn-accent onboarding-dismiss" value="ok">Got it</button>
    </form>
  `;

  function openOnboarding() {
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    }
  }

  dialog.addEventListener("close", () => {
    markOnboardingSeen();
  });

  return { header, dialog, openOnboarding, helpBtn: help };
}

/**
 * Show on first visit if the seen-flag is absent.
 * @param {() => void} openOnboarding
 * @param {Storage} [store]
 */
export function maybeShowFirstVisit(openOnboarding, store = localStorage) {
  if (!hasSeenOnboarding(store)) openOnboarding();
}
