/**
 * Polygon-with-holes triangulation for planar mesh caps.
 *
 * Nesting is ours; the actual triangulation is mapbox earcut (vendored from
 * three.js / BSD-2-Clause) — see geom/earcut.js. bridgeHoles + earClip stay
 * exported for unit tests of the nesting/bridge contract.
 */

import { triangulate as earcut } from "../../vendor/earcut/earcut.js";

/**
 * @param {Float64Array} points2d  flat [x0,y0,x1,y1,…]
 * @param {number[][]} loops  each loop is vertex indices into points2d
 * @returns {{ regions: { outer: number[], holes: number[][] }[] }}
 */
export function nestLoops(points2d, loops) {
  const n = loops.length;
  const parent = new Array(n).fill(-1);
  const areaAbs = loops.map((loop) => Math.abs(shoelace(points2d, loop)));

  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestArea = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (!loopContainsLoop(points2d, loops[j], loops[i])) continue;
      if (areaAbs[j] < bestArea) {
        bestArea = areaAbs[j];
        best = j;
      }
    }
    parent[i] = best;
  }

  const depth = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let d = 0;
    let p = parent[i];
    while (p >= 0) {
      d++;
      p = parent[p];
    }
    depth[i] = d;
  }

  /** @type {{ outer: number[], holes: number[][] }[]} */
  const regions = [];
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 !== 0) continue;
    const holes = [];
    for (let j = 0; j < n; j++) {
      if (parent[j] === i && depth[j] % 2 === 1) holes.push(loops[j].slice());
    }
    regions.push({ outer: loops[i].slice(), holes });
  }
  return { regions };
}

/**
 * Bridge every hole into its outer ring (doubled bridge edge). Kept for
 * tests; triangulateRegions uses earcut's own hole elimination instead.
 *
 * @param {Float64Array} points2d
 * @param {number[]} outer
 * @param {number[][]} holes
 * @returns {number[]}
 */
export function bridgeHoles(points2d, outer, holes) {
  let poly = outer.slice();
  const remaining = holes.map((h) => h.slice());

  while (remaining.length) {
    let pick = 0;
    let pickX = -Infinity;
    let pickVertInHole = 0;
    for (let hi = 0; hi < remaining.length; hi++) {
      const hole = remaining[hi];
      for (let k = 0; k < hole.length; k++) {
        const x = points2d[hole[k] * 2];
        if (x > pickX) {
          pickX = x;
          pick = hi;
          pickVertInHole = k;
        }
      }
    }
    const hole = remaining.splice(pick, 1)[0];
    const rotated = hole.slice(pickVertInHole).concat(hole.slice(0, pickVertInHole));
    const holeRight = rotated[0];
    const insertAt = findBridgeSlot(points2d, poly, holeRight);
    if (insertAt < 0) throw new Error("capfill: no visible bridge vertex for hole");
    const bridgeTo = poly[insertAt];
    const spliced = [bridgeTo, ...rotated, holeRight, bridgeTo];
    poly = [...poly.slice(0, insertAt), ...spliced, ...poly.slice(insertAt + 1)];
  }
  return poly;
}

/**
 * Ear-clip a simple polygon (no holes) via earcut.
 * @param {Float64Array} points2d
 * @param {number[]} ring
 * @returns {number[]} flat [a,b,c,…] into points2d indices
 */
export function earClip(points2d, ring) {
  if (ring.length < 3) throw new Error("capfill: ring needs ≥3 verts");
  const data = new Float64Array(ring.length * 2);
  for (let i = 0; i < ring.length; i++) {
    data[i * 2] = points2d[ring[i] * 2];
    data[i * 2 + 1] = points2d[ring[i] * 2 + 1];
  }
  const local = earcut(data);
  if (local.length < 3) throw new Error("capfill: no ear found");
  const out = new Array(local.length);
  for (let i = 0; i < local.length; i++) out[i] = ring[local[i]];
  return out;
}

/**
 * Full pipeline: nest → earcut every region (outer + holes).
 * @param {Float64Array} points2d
 * @param {number[][]} loops
 * @returns {number[]} flat triangle indices into points2d
 */
export function triangulateRegions(points2d, loops) {
  if (!loops.length) return [];
  const { regions } = nestLoops(points2d, loops);
  /** @type {number[]} */
  const out = [];
  for (const { outer, holes } of regions) {
    // Build a packed vertex buffer: outer then each hole. Remap earcut's
    // local indices back to points2d indices.
    /** @type {number[]} */
    const indexMap = [];
    /** @type {number[]} */
    const data = [];
    /** @type {number[]} */
    const holeStarts = [];

    const pushLoop = (loop) => {
      for (const vi of loop) {
        indexMap.push(vi);
        data.push(points2d[vi * 2], points2d[vi * 2 + 1]);
      }
    };

    pushLoop(outer);
    for (const h of holes) {
      holeStarts.push(indexMap.length);
      pushLoop(h);
    }

    const local = earcut(data, holeStarts.length ? holeStarts : undefined);
    if (holes.length && local.length < 3) {
      throw new Error("capfill: no ear found");
    }
    for (let i = 0; i < local.length; i++) out.push(indexMap[local[i]]);
  }
  return out;
}

/** Signed area (positive = CCW). */
export function shoelace(points2d, loop) {
  let a = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = points2d[loop[i] * 2], yi = points2d[loop[i] * 2 + 1];
    const xj = points2d[loop[j] * 2], yj = points2d[loop[j] * 2 + 1];
    a += xi * yj - xj * yi;
  }
  return a / 2;
}

// ── helpers ──────────────────────────────────────────────────────────

function loopContainsLoop(points2d, outer, inner) {
  for (const vi of inner) {
    if (!pointInPoly(points2d, outer, points2d[vi * 2], points2d[vi * 2 + 1])) {
      return false;
    }
  }
  return true;
}

function pointInPoly(points2d, loop, x, y) {
  let inside = false;
  const n = loop.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points2d[loop[i] * 2], yi = points2d[loop[i] * 2 + 1];
    const xj = points2d[loop[j] * 2], yj = points2d[loop[j] * 2 + 1];
    if (pointOnSegment(xi, yi, xj, yj, x, y)) return false;
    if ((yi > y) !== (yj > y)) {
      const t = (y - yi) / (yj - yi);
      const xCross = xi + t * (xj - xi);
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

function pointOnSegment(ax, ay, bx, by, px, py) {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-12) return false;
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  if (dot < 0) return false;
  const len2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  return dot <= len2;
}

function findBridgeSlot(points2d, poly, holeRight) {
  const hx = points2d[holeRight * 2];
  const hy = points2d[holeRight * 2 + 1];
  const n = poly.length;

  let hitX = Infinity;
  let hitEdge = -1;
  for (let i = 0; i < n; i++) {
    const u = poly[i], v = poly[(i + 1) % n];
    const ux = points2d[u * 2], uy = points2d[u * 2 + 1];
    const vx = points2d[v * 2], vy = points2d[v * 2 + 1];
    if (uy === vy) continue;
    if ((uy > hy) === (vy > hy)) continue;
    const t = (hy - uy) / (vy - uy);
    const x = ux + t * (vx - ux);
    if (x <= hx) continue;
    if (x < hitX) {
      hitX = x;
      hitEdge = i;
    }
  }

  /** @type {number[]} */
  const candidates = [];
  if (hitEdge >= 0) {
    const u = poly[hitEdge], v = poly[(hitEdge + 1) % n];
    const ux = points2d[u * 2], vx = points2d[v * 2];
    const primary = ux >= vx ? hitEdge : (hitEdge + 1) % n;
    candidates.push(primary);
  }

  let bestSlot = -1;
  let bestX = -Infinity;
  let bestDy = Infinity;
  const consider = (slot) => {
    const vi = poly[slot];
    if (!segmentInsidePoly(points2d, poly, holeRight, vi)) return;
    const vx = points2d[vi * 2];
    const vy = points2d[vi * 2 + 1];
    const dy = Math.abs(vy - hy);
    if (vx > bestX || (vx === bestX && dy < bestDy)) {
      bestX = vx;
      bestDy = dy;
      bestSlot = slot;
    }
  };
  for (const s of candidates) consider(s);
  if (bestSlot < 0) {
    for (let i = 0; i < n; i++) consider(i);
  }
  return bestSlot;
}

function segmentInsidePoly(points2d, poly, a, b) {
  const ax = points2d[a * 2], ay = points2d[a * 2 + 1];
  const bx = points2d[b * 2], by = points2d[b * 2 + 1];
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  if (!pointInPolyInclusive(points2d, poly, mx, my)) return false;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const u = poly[i], v = poly[(i + 1) % n];
    if (u === a || u === b || v === a || v === b) continue;
    if (segmentsCross(
      ax, ay, bx, by,
      points2d[u * 2], points2d[u * 2 + 1],
      points2d[v * 2], points2d[v * 2 + 1],
    )) return false;
  }
  return true;
}

function pointInPolyInclusive(points2d, loop, x, y) {
  const n = loop.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points2d[loop[i] * 2], yi = points2d[loop[i] * 2 + 1];
    const xj = points2d[loop[j] * 2], yj = points2d[loop[j] * 2 + 1];
    if (pointOnSegment(xi, yi, xj, yj, x, y)) return true;
  }
  return pointInPoly(points2d, loop, x, y);
}

export function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = orient(ax, ay, bx, by, cx, cy);
  const d2 = orient(ax, ay, bx, by, dx, dy);
  const d3 = orient(cx, cy, dx, dy, ax, ay);
  const d4 = orient(cx, cy, dx, dy, bx, by);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function orient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}
