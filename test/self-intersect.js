// Self-intersection scan for tests — the same edge-through-triangle test as
// prototype/meshcheck.py, over a bounding-volume tree so rounded meshes of
// tens of thousands of triangles scan in well under a second.

const LEAF = 8;

/**
 * Pairs of triangles that share no vertex and where an edge of one passes
 * through the interior of the other.
 * @param {{ positions: Float64Array|number[], indices: Uint32Array|number[] }} mesh
 * @param {number} [limit=Infinity]  stop after this many pairs
 * @returns {[number, number][]}
 */
export function selfIntersections(mesh, limit = Infinity) {
  const P = mesh.positions, I = mesh.indices;
  const n = I.length / 3;
  const lo = new Float64Array(n * 3), hi = new Float64Array(n * 3), mid = new Float64Array(n * 3);
  for (let t = 0; t < n; t++) {
    for (let c = 0; c < 3; c++) {
      const a = P[I[t * 3] * 3 + c], b = P[I[t * 3 + 1] * 3 + c], d = P[I[t * 3 + 2] * 3 + c];
      lo[t * 3 + c] = Math.min(a, b, d);
      hi[t * 3 + c] = Math.max(a, b, d);
      mid[t * 3 + c] = (a + b + d) / 3;
    }
  }

  // Tree nodes: bounds, then either children or a leaf range of `order`.
  const order = Uint32Array.from({ length: n }, (_, i) => i);
  const nodes = [];
  const build = (start, end) => {
    const node = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], start, end, left: -1, right: -1 };
    const cLo = [Infinity, Infinity, Infinity], cHi = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = order[i];
      for (let c = 0; c < 3; c++) {
        node.lo[c] = Math.min(node.lo[c], lo[t * 3 + c]);
        node.hi[c] = Math.max(node.hi[c], hi[t * 3 + c]);
        cLo[c] = Math.min(cLo[c], mid[t * 3 + c]);
        cHi[c] = Math.max(cHi[c], mid[t * 3 + c]);
      }
    }
    const id = nodes.push(node) - 1;
    if (end - start > LEAF) {
      let axis = 0;
      for (let c = 1; c < 3; c++) if (cHi[c] - cLo[c] > cHi[axis] - cLo[axis]) axis = c;
      const half = Math.floor((start + end) / 2);
      const slice = Array.from(order.subarray(start, end))
        .sort((a, b) => mid[a * 3 + axis] - mid[b * 3 + axis]);
      order.set(slice, start);
      node.left = build(start, half);
      node.right = build(half, end);
    }
    return id;
  };
  build(0, n);

  const V = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const hits = [];
  const stack = [];
  for (let t = 0; t < n && hits.length < limit; t++) {
    const A = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
    const a = A.map(V);
    stack.length = 0;
    stack.push(0);
    while (stack.length) {
      const node = nodes[stack.pop()];
      let overlap = true;
      for (let c = 0; c < 3 && overlap; c++) {
        overlap = node.lo[c] <= hi[t * 3 + c] && node.hi[c] >= lo[t * 3 + c];
      }
      if (!overlap) continue;
      if (node.left >= 0) {
        stack.push(node.left, node.right);
        continue;
      }
      for (let i = node.start; i < node.end; i++) {
        const u = order[i];
        if (u <= t) continue;
        const B = [I[u * 3], I[u * 3 + 1], I[u * 3 + 2]];
        if (A.some((x) => B.includes(x))) continue;
        const b = B.map(V);
        let hit = false;
        for (let k = 0; k < 3 && !hit; k++) {
          hit = segmentHitsTriangle(a[k], a[(k + 1) % 3], b[0], b[1], b[2])
            || segmentHitsTriangle(b[k], b[(k + 1) % 3], a[0], a[1], a[2]);
        }
        if (hit) hits.push([t, u]);
      }
    }
  }
  return hits;
}

/** Möller–Trumbore on the open segment p0→p1 and the open triangle. */
function segmentHitsTriangle(p0, p1, v0, v1, v2, eps = 1e-9) {
  const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
  if (Math.abs(det) <= eps) return false;
  const inv = 1 / det;
  const tv = [p0[0] - v0[0], p0[1] - v0[1], p0[2] - v0[2]];
  const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
  const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
  const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
  const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
  return u > eps && v > eps && u + v < 1 - eps && t > eps && t < 1 - eps;
}
