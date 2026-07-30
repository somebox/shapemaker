/**
 * Versioned URL hash codec — encodes canonical authoring state only.
 * Equal serializeState(state) ⇒ equal hash.
 */

import { normalizeState, serializeState } from "./schema.js";

export const HASH_VERSION = 1;
const PREFIX = `v${HASH_VERSION}.`;

/**
 * @param {object} state
 * @returns {string} hash body without leading '#'
 */
export function encodeHash(state) {
  const canonical = serializeState(state);
  const json = JSON.stringify(canonical);
  return PREFIX + base64UrlEncode(json);
}

/**
 * @param {string} hash  with or without leading '#'
 * @returns {{ ok: true, state: object } | { ok: false, error: string }}
 */
export function decodeHash(hash) {
  let h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!h) return { ok: false, error: "empty hash" };
  if (!h.startsWith(PREFIX)) {
    return { ok: false, error: `unsupported hash version` };
  }
  const payload = h.slice(PREFIX.length);
  let json;
  try {
    json = base64UrlDecode(payload);
  } catch {
    return { ok: false, error: "invalid hash encoding" };
  }
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    return { ok: false, error: "invalid hash JSON" };
  }
  if (!obj || typeof obj !== "object") {
    return { ok: false, error: "hash payload must be an object" };
  }
  return { ok: true, state: normalizeState(obj) };
}

function base64UrlEncode(str) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8").toString("base64url");
  }
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "base64url").toString("utf8");
  }
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
