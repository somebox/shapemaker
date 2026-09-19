/**
 * Application version.
 *
 * Duplicated from package.json because the app has no build step to inject it
 * — there is nothing to substitute a placeholder at publish time. A test
 * asserts the two stay equal, so the duplication cannot drift silently.
 */
export const VERSION = "0.14.0";
