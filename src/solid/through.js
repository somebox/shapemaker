/**
 * Through openings: a straight cutter per face, run along the inward face
 * normal far enough to clear the inner surface, then subtracted from the
 * closed shell (solid/csg.js). Cutters may reach neighbouring inner faces
 * and overlap each other; the boolean merges whatever they remove.
 */

/**
 * Surface polygons with bounding spheres, for {@link throughDepth}.
 * @param {number[][]} faces  rings of vertex indices
 * @param {(i: number) => number[]} vertAt
 */
export function surfacePolys(faces, vertAt) {
  return faces.map((ring) => {
    const pts = ring.map(vertAt);
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    let r2 = 0;
    for (const p of pts) {
      r2 = Math.max(r2, (p[0] - cx) ** 2 + (p[1] - cy) ** 2 + (p[2] - cz) ** 2);
    }
    return { pts, c: [cx, cy, cz], r: Math.sqrt(r2) };
  });
}

/**
 * Indices of polygons whose bounding sphere comes within `reach` of the
 * sphere (c, r) — the only ones a ray from that region can hit before
 * travelling `reach`.
 * @param {ReturnType<typeof surfacePolys>} polys
 */
export function polysNear(polys, c, r, reach) {
  const out = [];
  for (let j = 0; j < polys.length; j++) {
    const q = polys[j];
    const lim = r + reach + q.r;
    const dx = q.c[0] - c[0], dy = q.c[1] - c[1], dz = q.c[2] - c[2];
    if (dx * dx + dy * dy + dz * dz <= lim * lim) out.push(j);
  }
  return out;
}

/**
 * Walk the ray p − t·n from the outer face into the shape. The first inner
 * surface it meets is where the cavity starts (`tIn`, on face `inFace`);
 * the next inner hit is where the cavity ends (`tOut`). `tExit` is the
 * first hit on another face's outer surface, where the ray leaves the part.
 * A ray with `tExit` < `tIn` runs through wall material only.
 *
 * @param {number[]} p
 * @param {number[]} n  outward unit normal of the face p lies on
 * @param {ReturnType<typeof surfacePolys>} inner
 * @param {ReturnType<typeof surfacePolys>} outer
 * @param {number} ownFace
 * @param {number[]} [only]  polygon indices to test (default all)
 * @returns {{ tIn: number, tOut: number, inFace: number, tExit: number, exitFace: number }}
 */
export function throughDepth(p, n, inner, outer, ownFace, only) {
  const d = [-n[0], -n[1], -n[2]];
  const innerHits = rayHits(p, d, inner, -1, only);
  const outerHits = rayHits(p, d, outer, ownFace, only);
  return {
    tIn: innerHits.length ? innerHits[0].t : Infinity,
    tOut: innerHits.length > 1 ? innerHits[1].t : Infinity,
    inFace: innerHits.length ? innerHits[0].face : -1,
    tExit: outerHits.length ? outerHits[0].t : Infinity,
    exitFace: outerHits.length ? outerHits[0].face : -1,
  };
}

/** Sorted ray hits against fan-triangulated polygons (skipping `skip`). */
function rayHits(p, d, polys, skip, only) {
  const hits = [];
  const n = only ? only.length : polys.length;
  for (let i = 0; i < n; i++) {
    const j = only ? only[i] : i;
    if (j === skip) continue;
    const { pts, c, r } = polys[j];
    // Bounding-sphere reject: distance from the sphere centre to the ray.
    const ox = c[0] - p[0], oy = c[1] - p[1], oz = c[2] - p[2];
    const along = ox * d[0] + oy * d[1] + oz * d[2];
    if (along < -r) continue;
    const perp2 = ox * ox + oy * oy + oz * oz - along * along;
    if (perp2 > r * r * 1.0001) continue;
    for (let k = 1; k + 1 < pts.length; k++) {
      const t = rayTri(p, d, pts[0], pts[k], pts[k + 1]);
      if (t != null && t > 1e-9) {
        hits.push({ t, face: j });
        break;
      }
    }
  }
  hits.sort((a, b) => a.t - b.t);
  return hits;
}

/** Möller–Trumbore, two-sided; edges count as hits so seams never leak. */
function rayTri(o, d, a, b, c) {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const px = d[1] * e2z - d[2] * e2y;
  const py = d[2] * e2x - d[0] * e2z;
  const pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  const tx = o[0] - a[0], ty = o[1] - a[1], tz = o[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  const eps = 1e-9;
  if (u < -eps || u > 1 + eps) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < -eps || u + v > 1 + eps) return null;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

/**
 * Closed cutter mesh in the face frame: the opening ring extruded from
 * `topMm` above the face to `depthMm` below it. With `lipMm` > 0 the top
 * flares by a quarter circle, so subtracting it leaves a rounded rim of
 * that radius where the hole meets the face.
 *
 * @param {{ origin: number[], u: number[], w: number[], normal: number[] }} frame
 * @param {Float64Array} Px  opening ring in face coordinates
 * @param {Float64Array} Py
 * @param {{ lipMm: number, segments: number, topMm: number, depthMm: number, faceId: number, jitterMm?: number }} opts
 * @returns {{ positions: number[], indices: number[], faceIds: number[] }}
 */
export function throughCutter(frame, Px, Py, {
  lipMm, segments, topMm, depthMm, faceId, jitterMm = 0,
}) {
  const m = Px.length;
  // Miter offset directions: each ring edge moves out by exactly δ.
  let area2 = 0;
  for (let k = 0; k < m; k++) {
    const k2 = (k + 1) % m;
    area2 += Px[k] * Py[k2] - Px[k2] * Py[k];
  }
  const sgn = area2 >= 0 ? 1 : -1;
  const edgeN = [];
  for (let k = 0; k < m; k++) {
    const k2 = (k + 1) % m;
    const ex = Px[k2] - Px[k], ey = Py[k2] - Py[k];
    const len = Math.hypot(ex, ey) || 1;
    edgeN.push([(ey * sgn) / len, (-ex * sgn) / len]);
  }
  const miter = [];
  for (let k = 0; k < m; k++) {
    const a = edgeN[(k + m - 1) % m], b = edgeN[k];
    let mx = a[0] + b[0], my = a[1] + b[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const cos = Math.max(0.2, mx * b[0] + my * b[1]);
    miter.push([mx / cos, my / cos]);
  }

  /** [offset δ, height h] per ring, top to bottom. */
  const levels = [];
  if (lipMm > 0) {
    levels.push([lipMm, topMm]);
    for (let j = 0; j <= segments; j++) {
      const phi = (Math.PI / 2) * (j / segments);
      levels.push([lipMm * (1 - Math.sin(phi)), -lipMm * (1 - Math.cos(phi))]);
    }
  } else {
    levels.push([0, topMm]);
  }
  levels.push([0, -depthMm]);

  const { origin: o, u, w, normal: n } = frame;
  const at = (x, y, h) => [
    o[0] + x * u[0] + y * w[0] + h * n[0],
    o[1] + x * u[1] + y * w[1] + h * n[1],
    o[2] + x * u[2] + y * w[2] + h * n[2],
  ];
  // A fixed few-micron nudge per vertex keeps cutter features off the
  // shell's planes and off each other: exact contacts (symmetric faces,
  // coplanar neighbours) otherwise leave zero-area triangles.
  const positions = [];
  let seed = (faceId + 1) * 2654435761;
  const nudge = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 2147483648 - 0.5) * 2 * jitterMm;
  };
  for (const [delta, h] of levels) {
    for (let k = 0; k < m; k++) {
      positions.push(...at(
        Px[k] + delta * miter[k][0] + nudge(),
        Py[k] + delta * miter[k][1] + nudge(),
        h + nudge(),
      ));
    }
  }
  const topC = positions.length / 3;
  positions.push(...at(0, 0, levels[0][1]));
  const botC = topC + 1;
  positions.push(...at(0, 0, levels[levels.length - 1][1]));

  const indices = [];
  const L = levels.length;
  for (let l = 0; l + 1 < L; l++) {
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const a = l * m + k, b = l * m + k2, c = (l + 1) * m + k2, d = (l + 1) * m + k;
      indices.push(a, d, c, a, c, b);
    }
  }
  for (let k = 0; k < m; k++) {
    const k2 = (k + 1) % m;
    indices.push(topC, k, k2);
    indices.push(botC, (L - 1) * m + k2, (L - 1) * m + k);
  }
  if (signedVolume(positions, indices) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
  return { positions, indices, faceIds: new Array(indices.length / 3).fill(faceId) };
}

function signedVolume(P, I) {
  let v = 0;
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
       - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
       + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v;
}
