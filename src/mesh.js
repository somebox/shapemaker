/**
 * Mesh invariants: edge-manifold + consistent orientation, non-zero area,
 * winding via volume sign. No repair pass — correct by construction.
 */

/**
 * @typedef {{ positions: Float64Array|Float32Array, indices: Uint32Array, faceId: Uint32Array }} Mesh
 */

/**
 * Validate mesh invariants. Throws on hard failures.
 * @param {Mesh} mesh
 * @returns {{ ok: true, volume: number, triangleCount: number }}
 */
export function assertMeshInvariants(mesh) {
  const { positions, indices, faceId } = mesh;

  // Structural checks first: a malformed buffer otherwise surfaces as a
  // confusing volume or winding failure several loops later.
  if (indices.length % 3 !== 0) {
    throw new Error(`index count ${indices.length} is not a multiple of 3`);
  }
  const nTris = indices.length / 3;
  if (nTris === 0) throw new Error("mesh has no triangles");

  const nVerts = positions.length / 3;
  if (positions.length % 3 !== 0) throw new Error("positions is not a flat xyz array");
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= nVerts) {
      throw new Error(`index ${indices[i]} out of range [0, ${nVerts})`);
    }
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) throw new Error(`non-finite position at ${i}`);
  }
  if (faceId && faceId.length !== nTris) {
    throw new Error(`faceId length ${faceId.length} ≠ triangle count ${nTris}`);
  }
  for (let t = 0; t < nTris; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    if (a === b || b === c || a === c) {
      throw new Error(`triangle ${t} repeats a vertex (${a}, ${b}, ${c})`);
    }
  }

  // Directed-edge map: each directed edge must appear exactly once
  // (manifold AND consistent orientation).
  const directed = new Map();
  for (let t = 0; t < nTris; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = `${u},${v}`;
      if (directed.has(key)) {
        throw new Error(`directed edge ${key} used twice — winding/manifold failure`);
      }
      directed.set(key, t);
    }
  }
  // Every directed edge must have its reverse (closed manifold)
  for (const key of directed.keys()) {
    const [u, v] = key.split(",");
    if (!directed.has(`${v},${u}`)) {
      throw new Error(`boundary edge ${key} — mesh is not closed`);
    }
  }

  // Non-degenerate areas + signed volume
  let volume6 = 0;
  for (let t = 0; t < nTris; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const area2 = Math.hypot(nx, ny, nz);
    if (area2 < 1e-18) throw new Error(`degenerate triangle ${t}`);
    // tet volume contribution: a · (b × c) / 6, but using origin:
    // V = (1/6) sum det(a,b,c)
    volume6 += ax * (by * cz - bz * cy)
             - ay * (bx * cz - bz * cx)
             + az * (bx * cy - by * cx);
  }
  const volume = volume6 / 6.0;
  if (!(volume > 0)) {
    throw new Error(`signed volume is not positive: ${volume}`);
  }

  return { ok: true, volume, triangleCount: nTris };
}

/**
 * Downcast float64 positions to Float32Array for the Mesh type / GPU / STL.
 * @param {Float64Array} positions64
 * @param {Uint32Array} indices
 * @param {Uint32Array} faceId
 * @returns {import('./mesh.js').Mesh & { positions64: Float64Array }}
 */
export function toMesh(positions64, indices, faceId) {
  return {
    positions: new Float32Array(positions64),
    positions64,
    indices,
    faceId,
  };
}
