/**
 * File names for a design, shared by the app's exports and the CLI.
 */

import { BASES } from "../bases.js";

/**
 * File name stem for a design. Seed and point count go in the name whenever
 * the shape depends on them — the reproducibility story survives outside the
 * URL (spec rule), and two exports of different densities don't overwrite
 * each other.
 * @param {object} state
 */
export function designStem(state) {
  const { base, circumdiameterMm: size, seed, jitter, points } = state;
  const parts = [];
  if (BASES[base]?.seeded || jitter > 0) parts.push(`s${seed}`);
  if (BASES[base]?.parametric) parts.push(`p${points}`);
  if (state.truncate > 0) parts.push(`t${state.truncate}`);
  if (state.spike > 0) parts.push(`k${Number(state.spike.toFixed(2))}`);
  const tag = parts.length ? `_${parts.join("_")}` : "";
  return `${base}_${size}mm${tag}`;
}
