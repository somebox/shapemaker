/**
 * Generic operations on a Skeleton (convex V/E/F) — shape-family agnostic.
 *
 * Nothing here may know which polyhedron it is looking at. Point generators
 * produce skeletons; the solidifier consumes them through this module, which
 * is what lets M3 add platonic bases without touching solid/shell.js.
 */

/**
 * Undirected edges as sorted [i, j] pairs, derived from face rings.
 * @param {number[][]} faces
 * @returns {number[][]}
 */
export function edgeList(faces) {
  const seen = new Set();
  const out = [];
  for (const f of faces) {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = lo * 0x100000 + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([lo, hi]);
    }
  }
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/**
 * Smallest and largest face inradius (origin → face plane distance).
 *
 * The hollow wall is a uniform scale about the origin, so the *thinnest* wall
 * lands on the face closest to the centre. Callers size the scale from `min`
 * and report the resulting range from both.
 *
 * @param {{ inradius: number }[]} frames
 * @returns {{ min: number, max: number }}
 */
export function inradiusRange(frames) {
  let min = Infinity, max = -Infinity;
  for (const f of frames) {
    if (f.inradius < min) min = f.inradius;
    if (f.inradius > max) max = f.inradius;
  }
  return { min, max };
}

/**
 * Check the assumptions the solidifier makes about a Skeleton.
 *
 * These are conventions today because exactly one hardcoded generator exists.
 * From M3 the skeletons arrive from quickhull + coplanar merge, then from
 * subdivision and jitter — at which point a malformed skeleton would surface
 * as a baffling mesh failure several stages downstream. Failing here names
 * the real cause instead.
 *
 * Convexity is NOT checked: it is the hull stage's responsibility and an
 * O(V·F) test is too expensive for the interactive path.
 *
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton
 * @param {{ planarityTol?: number }} [opts] tolerance is size-relative
 */
export function assertSkeleton(skeleton, opts = {}) {
  const { positions, faces } = skeleton;

  if (!positions || positions.length % 3 !== 0) {
    throw new Error("skeleton positions must be a flat xyz array");
  }
  const nVerts = positions.length / 3;
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) throw new Error(`non-finite position at ${i}`);
  }
  if (!Array.isArray(faces) || faces.length < 4) {
    throw new Error(`a closed polyhedron needs ≥ 4 faces, got ${faces?.length}`);
  }

  const R = circumradius(positions);
  const tol = (opts.planarityTol ?? 1e-7) * R;
  const directed = new Set();

  for (let f = 0; f < faces.length; f++) {
    const ring = faces[f];
    if (!Array.isArray(ring) || ring.length < 3) {
      throw new Error(`face ${f} has ${ring?.length} vertices, needs ≥ 3`);
    }
    if (new Set(ring).size !== ring.length) {
      throw new Error(`face ${f} repeats a vertex`);
    }
    for (const vi of ring) {
      if (!Number.isInteger(vi) || vi < 0 || vi >= nVerts) {
        throw new Error(`face ${f} references vertex ${vi}, out of [0, ${nVerts})`);
      }
    }

    // Each directed edge exactly once ⇒ closed, manifold, consistently wound.
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const key = a * 0x100000 + b;
      if (directed.has(key)) {
        throw new Error(`directed edge ${a}→${b} used by two faces (face ${f})`);
      }
      directed.add(key);
      const d = Math.hypot(
        positions[a * 3] - positions[b * 3],
        positions[a * 3 + 1] - positions[b * 3 + 1],
        positions[a * 3 + 2] - positions[b * 3 + 2],
      );
      if (d <= tol) throw new Error(`face ${f} has a zero-length edge ${a}→${b}`);
    }

    // Planarity, via Newell's normal through the face centroid.
    const { normal, centroid, area } = newell(positions, ring);
    if (!(area > 0)) throw new Error(`face ${f} has a degenerate normal`);
    for (const vi of ring) {
      const dev = Math.abs(
        (positions[vi * 3] - centroid[0]) * normal[0] +
        (positions[vi * 3 + 1] - centroid[1]) * normal[1] +
        (positions[vi * 3 + 2] - centroid[2]) * normal[2],
      );
      if (dev > tol) {
        throw new Error(`face ${f} is not planar (vertex ${vi} off by ${dev.toFixed(6)})`);
      }
    }
    // Outward order: with the origin inside, the normal must point away.
    if (normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2] <= 0) {
      throw new Error(`face ${f} is wound inward (or the origin is outside the solid)`);
    }
  }

  for (const key of directed) {
    const a = Math.floor(key / 0x100000), b = key % 0x100000;
    if (!directed.has(b * 0x100000 + a)) {
      throw new Error(`edge ${a}→${b} has no opposing face — skeleton is not closed`);
    }
  }
  return true;
}

/**
 * Newell's method over one face ring: unit plane normal, vertex-mean
 * centroid, and planar polygon area (Newell magnitude / 2). A degenerate
 * ring (zero area) yields a zero normal rather than NaN.
 *
 * @param {Float64Array} positions
 * @param {number[]} ring
 * @returns {{ normal: number[], centroid: number[], area: number }}
 */
export function newell(positions, ring) {
  const n = ring.length;
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < n; k++) {
    const a = ring[k] * 3, b = ring[(k + 1) % n] * 3;
    nx += (positions[a + 1] - positions[b + 1]) * (positions[a + 2] + positions[b + 2]);
    ny += (positions[a + 2] - positions[b + 2]) * (positions[a] + positions[b]);
    nz += (positions[a] - positions[b]) * (positions[a + 1] + positions[b + 1]);
    cx += positions[a]; cy += positions[a + 1]; cz += positions[a + 2];
  }
  const L = Math.hypot(nx, ny, nz);
  return {
    normal: L > 0 ? [nx / L, ny / L, nz / L] : [0, 0, 0],
    centroid: [cx / n, cy / n, cz / n],
    area: L / 2,
  };
}

/** Circumradius = distance from origin to the farthest vertex. */
export function circumradius(positions) {
  let r2 = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const d = positions[i] ** 2 + positions[i + 1] ** 2 + positions[i + 2] ** 2;
    if (d > r2) r2 = d;
  }
  return Math.sqrt(r2);
}
