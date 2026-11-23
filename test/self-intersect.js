// Self-intersection scan for tests — the same edge-through-triangle test as
// prototype/meshcheck.py, over a bounding-volume tree. More than half of a
// test run's processor time used to go here, so the tree and the scan work
// on flat typed arrays and allocate nothing per triangle: a rounded mesh of
// 100,000 triangles scans in under 0.1 s, one of a million in under 1 s.

const LEAF = 8;
const EPS = 1e-9;
// A triangle with all three corners clear of the other's plane, on one
// side, cannot cross it. "Clear" is this share of the pair's size cubed, in
// the units of the plane sums below (six times a tetrahedron's volume):
// about a hundred times the rounding error of those sums and of the edge
// test's own, so a corner within rounding of the plane is never passed over.
const CLEAR = 1e-12;

/**
 * Pairs of triangles that share no vertex and where an edge of one passes
 * through the interior of the other. Pairs come as [t, u] with t < u, in
 * order of t and then u. With a `limit` the scan stops once it has that
 * many: no more than `limit` pairs come back, and which ones is not fixed
 * when the mesh holds more.
 * @param {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} mesh
 * @param {number} [limit=Infinity]  stop after this many pairs
 * @returns {[number, number][]}
 */
export function selfIntersections(mesh, limit = Infinity) {
  // Own copies: one element type whatever the caller passes (float32 or
  // float64 positions, plain arrays), so the loops below stay fast.
  const P = new Float64Array(mesh.positions);
  const I = new Uint32Array(mesh.indices);
  const n = Math.floor(I.length / 3);
  if (n === 0) return [];

  // Each triangle's box (lo x y z, hi x y z), centre, and longest side of the box.
  const box = new Float64Array(n * 6), mid = new Float64Array(n * 3), size = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
    for (let c = 0; c < 3; c++) {
      const x = P[a + c], y = P[b + c], z = P[d + c];
      const lo = Math.min(x, y, z), hi = Math.max(x, y, z);
      box[t * 6 + c] = lo;
      box[t * 6 + 3 + c] = hi;
      mid[t * 3 + c] = (x + y + z) / 3;
      if (hi - lo > size[t]) size[t] = hi - lo;
    }
  }

  // Tree nodes in the order they are made, so a node's left child is the
  // next node. A split halves the node's triangles across the longest side
  // of the box of their centres. Leaves hold LEAF triangles or fewer, and no
  // fewer than half that below the root: at most n / 2 nodes.
  const order = new Uint32Array(n);
  for (let t = 0; t < n; t++) order[t] = t;
  const cap = Math.max(1, n >> 1) + 1;
  const nodeBox = new Float64Array(cap * 6);
  const nodeRight = new Uint32Array(cap); // 0 marks a leaf
  const nodeStart = new Uint32Array(cap), nodeEnd = new Uint32Array(cap);
  let nodes = 0;
  const build = (start, end) => {
    const id = nodes++;
    nodeStart[id] = start;
    nodeEnd[id] = end;
    const nb = id * 6;
    if (end - start <= LEAF) {
      let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
      for (let i = start; i < end; i++) {
        const t = order[i], b = t * 6;
        if (box[b] < lx) lx = box[b];
        if (box[b + 1] < ly) ly = box[b + 1];
        if (box[b + 2] < lz) lz = box[b + 2];
        if (box[b + 3] > hx) hx = box[b + 3];
        if (box[b + 4] > hy) hy = box[b + 4];
        if (box[b + 5] > hz) hz = box[b + 5];
      }
      nodeBox[nb] = lx; nodeBox[nb + 1] = ly; nodeBox[nb + 2] = lz;
      nodeBox[nb + 3] = hx; nodeBox[nb + 4] = hy; nodeBox[nb + 5] = hz;
      return id;
    }
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let i = start; i < end; i++) {
      const m = order[i] * 3;
      if (mid[m] < cx0) cx0 = mid[m];
      if (mid[m] > cx1) cx1 = mid[m];
      if (mid[m + 1] < cy0) cy0 = mid[m + 1];
      if (mid[m + 1] > cy1) cy1 = mid[m + 1];
      if (mid[m + 2] < cz0) cz0 = mid[m + 2];
      if (mid[m + 2] > cz1) cz1 = mid[m + 2];
    }
    let axis = 0, wide = cx1 - cx0;
    if (cy1 - cy0 > wide) { axis = 1; wide = cy1 - cy0; }
    if (cz1 - cz0 > wide) axis = 2;
    const half = (start + end) >> 1;
    splitAt(order, mid, axis, start, end - 1, half);
    const left = build(start, half), right = build(half, end);
    nodeRight[id] = right;
    // The node's box holds its children's.
    const lb = left * 6, rb = right * 6;
    for (let c = 0; c < 3; c++) {
      nodeBox[nb + c] = Math.min(nodeBox[lb + c], nodeBox[rb + c]);
      nodeBox[nb + 3 + c] = Math.max(nodeBox[lb + 3 + c], nodeBox[rb + 3 + c]);
    }
    return id;
  };
  build(0, n);

  // The pairs of triangles under two leaves (or under one, taken with itself).
  const hits = [];
  const leafPairs = (a, b) => {
    const same = a === b, nb = b * 6, bEnd = nodeEnd[b];
    for (let i = nodeStart[a], aEnd = nodeEnd[a]; i < aEnd; i++) {
      const t = order[i], tb = t * 6;
      const lx = box[tb], ly = box[tb + 1], lz = box[tb + 2], hx = box[tb + 3], hy = box[tb + 4], hz = box[tb + 5];
      if (!same && (nodeBox[nb] > hx || nodeBox[nb + 3] < lx || nodeBox[nb + 1] > hy || nodeBox[nb + 4] < ly
        || nodeBox[nb + 2] > hz || nodeBox[nb + 5] < lz)) continue;
      const i0 = I[t * 3], i1 = I[t * 3 + 1], i2 = I[t * 3 + 2];
      const a0 = i0 * 3, a1 = i1 * 3, a2 = i2 * 3;
      const ax = P[a0], ay = P[a0 + 1], az = P[a0 + 2];
      const bx = P[a1], by = P[a1 + 1], bz = P[a1 + 2];
      const cx = P[a2], cy = P[a2 + 1], cz = P[a2 + 2];
      // The triangle's plane: its normal, as long as twice its area.
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const sizeT = size[t];
      for (let j = same ? i + 1 : nodeStart[b]; j < bEnd; j++) {
        const u = order[j], ub = u * 6;
        // Triangles whose boxes stand apart cannot cross.
        if (box[ub] > hx || box[ub + 3] < lx || box[ub + 1] > hy || box[ub + 4] < ly
          || box[ub + 2] > hz || box[ub + 5] < lz) continue;
        const j0 = I[u * 3], j1 = I[u * 3 + 1], j2 = I[u * 3 + 2];
        if (j0 === i0 || j0 === i1 || j0 === i2 || j1 === i0 || j1 === i1 || j1 === i2
          || j2 === i0 || j2 === i1 || j2 === i2) continue;
        const b0 = j0 * 3, b1 = j1 * 3, b2 = j2 * 3;
        const px = P[b0], py = P[b0 + 1], pz = P[b0 + 2];
        const qx = P[b1], qy = P[b1 + 1], qz = P[b1 + 2];
        const rx = P[b2], ry = P[b2 + 1], rz = P[b2 + 2];
        // A triangle wholly to one side of the other's plane cannot cross
        // it. On a smooth skin that is most of the pairs that get this far.
        const reach = sizeT + size[u], clear = CLEAR * reach * reach * reach;
        const sp = (px - ax) * nx + (py - ay) * ny + (pz - az) * nz;
        const sq = (qx - ax) * nx + (qy - ay) * ny + (qz - az) * nz;
        const sr = (rx - ax) * nx + (ry - ay) * ny + (rz - az) * nz;
        if ((sp > clear && sq > clear && sr > clear) || (sp < -clear && sq < -clear && sr < -clear)) continue;
        const mx = (qy - py) * (rz - pz) - (qz - pz) * (ry - py);
        const my = (qz - pz) * (rx - px) - (qx - px) * (rz - pz);
        const mz = (qx - px) * (ry - py) - (qy - py) * (rx - px);
        const sa = (ax - px) * mx + (ay - py) * my + (az - pz) * mz;
        const sb = (bx - px) * mx + (by - py) * my + (bz - pz) * mz;
        const sc = (cx - px) * mx + (cy - py) * my + (cz - pz) * mz;
        if ((sa > clear && sb > clear && sc > clear) || (sa < -clear && sb < -clear && sc < -clear)) continue;
        // Lower triangle first, so a pair gets the same sums however the walk comes to it.
        if (t < u) {
          if (edgesCross(ax, ay, az, bx, by, bz, cx, cy, cz, px, py, pz, qx, qy, qz, rx, ry, rz)) hits.push([t, u]);
        } else if (edgesCross(px, py, pz, qx, qy, qz, rx, ry, rz, ax, ay, az, bx, by, bz, cx, cy, cz)) hits.push([u, t]);
      }
    }
  };

  // Walk the tree against itself. A node against itself is its two halves,
  // each against itself and one against the other; two nodes whose boxes
  // stand apart hold no pair; of two that overlap, the fuller one is opened.
  // Every pair of triangles whose boxes overlap is met once, at two leaves.
  const stack = new Uint32Array(1024); // pairs of nodes: a few per level of a tree at most 32 deep
  let top = 0;
  stack[top++] = 0;
  stack[top++] = 0;
  while (top && hits.length < limit) {
    const b = stack[--top], a = stack[--top];
    const ra = nodeRight[a], rb = nodeRight[b];
    if (a === b) {
      if (!ra) leafPairs(a, a);
      else {
        stack[top++] = ra; stack[top++] = ra;
        stack[top++] = a + 1; stack[top++] = ra;
        stack[top++] = a + 1; stack[top++] = a + 1;
      }
      continue;
    }
    const ab = a * 6, bb = b * 6;
    if (nodeBox[ab] > nodeBox[bb + 3] || nodeBox[ab + 3] < nodeBox[bb] || nodeBox[ab + 1] > nodeBox[bb + 4]
      || nodeBox[ab + 4] < nodeBox[bb + 1] || nodeBox[ab + 2] > nodeBox[bb + 5] || nodeBox[ab + 5] < nodeBox[bb + 2]) continue;
    if (!ra && !rb) leafPairs(a, b);
    else if (!rb || (ra && nodeEnd[a] - nodeStart[a] >= nodeEnd[b] - nodeStart[b])) {
      stack[top++] = ra; stack[top++] = b;
      stack[top++] = a + 1; stack[top++] = b;
    } else {
      stack[top++] = a; stack[top++] = rb;
      stack[top++] = a; stack[top++] = b + 1;
    }
  }
  hits.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  if (hits.length > limit) hits.length = limit;
  return hits;
}

/**
 * Reorder order[lo..hi] so that the triangle at k is the one a full sort by
 * centre along `axis` would put there, with none before it farther along
 * than any after it (Hoare's selection).
 *
 * Selection takes a few passes over the range in most orders, but one pass
 * per handful of triangles in some: centres that rise and then fall, as
 * round a ring, leave the middle pivot at the far end every time. So the
 * passes have a budget of eight times the range, and when it is spent what
 * is left is sorted.
 */
function splitAt(order, mid, axis, lo, hi, k) {
  let budget = 8 * (hi - lo + 1);
  while (lo < hi) {
    budget -= hi - lo + 1;
    if (budget < 0) {
      order.subarray(lo, hi + 1).sort((a, b) => mid[a * 3 + axis] - mid[b * 3 + axis]);
      return;
    }
    const pivot = mid[order[(lo + hi) >> 1] * 3 + axis];
    let i = lo, j = hi;
    while (i <= j) {
      while (mid[order[i] * 3 + axis] < pivot) i++;
      while (mid[order[j] * 3 + axis] > pivot) j--;
      if (i <= j) {
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

/** Whether an edge of triangle (a, b, c) passes through triangle (p, q, r), or one of its edges through (a, b, c). */
function edgesCross(ax, ay, az, bx, by, bz, cx, cy, cz, px, py, pz, qx, qy, qz, rx, ry, rz) {
  return segmentHitsTriangle(ax, ay, az, bx, by, bz, px, py, pz, qx, qy, qz, rx, ry, rz)
    || segmentHitsTriangle(bx, by, bz, cx, cy, cz, px, py, pz, qx, qy, qz, rx, ry, rz)
    || segmentHitsTriangle(cx, cy, cz, ax, ay, az, px, py, pz, qx, qy, qz, rx, ry, rz)
    || segmentHitsTriangle(px, py, pz, qx, qy, qz, ax, ay, az, bx, by, bz, cx, cy, cz)
    || segmentHitsTriangle(qx, qy, qz, rx, ry, rz, ax, ay, az, bx, by, bz, cx, cy, cz)
    || segmentHitsTriangle(rx, ry, rz, px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
}

/**
 * Möller–Trumbore on the open segment p→q and the open triangle (v0, v1, v2).
 * The sums are written out term by term in a fixed order: the result for a
 * pair of triangles does not depend on how the scan came to them.
 */
function segmentHitsTriangle(px, py, pz, qx, qy, qz, v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z) {
  const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
  const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
  const dx = qx - px, dy = qy - py, dz = qz - pz;
  const pvx = dy * e2z - dz * e2y, pvy = dz * e2x - dx * e2z, pvz = dx * e2y - dy * e2x;
  const det = e1x * pvx + e1y * pvy + e1z * pvz;
  if (Math.abs(det) <= EPS) return false;
  const inv = 1 / det;
  const tx = px - v0x, ty = py - v0y, tz = pz - v0z;
  const u = (tx * pvx + ty * pvy + tz * pvz) * inv;
  if (!(u > EPS)) return false;
  const qvx = ty * e1z - tz * e1y, qvy = tz * e1x - tx * e1z, qvz = tx * e1y - ty * e1x;
  const v = (dx * qvx + dy * qvy + dz * qvz) * inv;
  if (!(v > EPS && u + v < 1 - EPS)) return false;
  const t = (e2x * qvx + e2y * qvy + e2z * qvz) * inv;
  return t > EPS && t < 1 - EPS;
}
