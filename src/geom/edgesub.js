/**
 * Interior point positions along an edge, as fractions in (0, 1).
 * Symmetric under reversal — faces sharing an edge walk it opposite ways.
 * Cosine clustering puts resolution near the ends (fillet arcs).
 *
 * @param {number} k  segments per edge (edge_div)
 * @returns {Float64Array} k-1 interior fractions, or empty if k ≤ 1
 */
export function edgeInteriorFractions(k) {
  if (k <= 1) return new Float64Array(0);
  const out = new Float64Array(k - 1);
  for (let i = 1; i < k; i++) {
    out[i - 1] = (1.0 - Math.cos(Math.PI * i / k)) / 2.0;
  }
  return out;
}

/**
 * Undirected edge key for global stitch maps.
 * @param {number} i
 * @param {number} j
 * @returns {string}
 */
export function edgeKey(i, j) {
  return i < j ? `${i},${j}` : `${j},${i}`;
}
