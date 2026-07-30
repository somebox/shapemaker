/**
 * Icosidodecahedron: 30 vertices (icosahedron edge midpoints on a sphere),
 * 32 faces (20 triangles + 12 pentagons) by combinatorics — no hull.
 *
 * Each icosahedron face → a triangle of its 3 edge-midpoints.
 * Each icosahedron vertex → a pentagon of its 5 incident edge-midpoints.
 */

const PHI = (1.0 + Math.sqrt(5.0)) / 2.0;

/**
 * @param {number} circumradius
 * @returns {{ positions: Float64Array, faces: number[][] }}
 *   positions: 30×3 flat float64; faces: 32 ordered CCW rings (seen from outside)
 */
export function icosidodecahedron(circumradius = 1.0) {
  const ico = icosahedronVerts(); // 12 verts, edge length 2
  const edges = icosaEdges(ico);  // 30 edges as [i,j] with i < j
  const edgeIndex = new Map();
  for (let e = 0; e < edges.length; e++) {
    edgeIndex.set(`${edges[e][0]},${edges[e][1]}`, e);
  }

  // Midpoints → icosidodeca verts, scaled to circumradius
  const positions = new Float64Array(30 * 3);
  for (let e = 0; e < 30; e++) {
    const [i, j] = edges[e];
    let x = (ico[i][0] + ico[j][0]) / 2;
    let y = (ico[i][1] + ico[j][1]) / 2;
    let z = (ico[i][2] + ico[j][2]) / 2;
    const L = Math.hypot(x, y, z);
    positions[e * 3] = (x / L) * circumradius;
    positions[e * 3 + 1] = (y / L) * circumradius;
    positions[e * 3 + 2] = (z / L) * circumradius;
  }

  const icoFaces = icosaFaces(ico); // 20 triangles
  const faces = [];

  // Triangles from icosa faces
  for (const f of icoFaces) {
    const mids = [];
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      mids.push(edgeIndex.get(key));
    }
    faces.push(orderRingCCW(positions, mids));
  }

  // Pentagons from icosa vertices
  for (let v = 0; v < 12; v++) {
    const incident = [];
    for (let e = 0; e < 30; e++) {
      if (edges[e][0] === v || edges[e][1] === v) incident.push(e);
    }
    if (incident.length !== 5) {
      throw new Error(`expected 5 edges at icosa vertex ${v}, got ${incident.length}`);
    }
    faces.push(orderRingCCW(positions, incident));
  }

  const lengths = faces.map((f) => f.length).sort((a, b) => a - b);
  const expected = [...Array(20).fill(3), ...Array(12).fill(5)];
  for (let i = 0; i < 32; i++) {
    if (lengths[i] !== expected[i]) {
      throw new Error(`face recovery failed: ${lengths}`);
    }
  }

  return { positions, faces };
}

/**
 * Analytic inradii (centre → face plane) for triangle and pentagon faces.
 *
 * Not used by the solidifier — that derives inradii from the skeleton so it
 * stays shape-agnostic. Kept as an independent closed-form cross-check in
 * tests: if the generic path and this formula ever disagree, one is wrong.
 */
export function inradii(circumradius) {
  const R = circumradius;
  const edge = R / PHI;
  const rho3 = edge / Math.sqrt(3.0);
  const rho5 = edge / (2.0 * Math.sin(Math.PI / 5));
  return {
    r3: Math.sqrt(R * R - rho3 * rho3),
    r5: Math.sqrt(R * R - rho5 * rho5),
  };
}

function icosahedronVerts() {
  const verts = [];
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      verts.push([0.0, s1, s2 * PHI]);
      verts.push([s1, s2 * PHI, 0.0]);
      verts.push([s1 * PHI, 0.0, s2]);
    }
  }
  return verts;
}

function icosaEdges(ico) {
  const edges = [];
  for (let i = 0; i < ico.length; i++) {
    for (let j = i + 1; j < ico.length; j++) {
      const d = Math.hypot(
        ico[i][0] - ico[j][0],
        ico[i][1] - ico[j][1],
        ico[i][2] - ico[j][2],
      );
      if (Math.abs(d - 2.0) < 1e-9) edges.push([i, j]);
    }
  }
  if (edges.length !== 30) throw new Error(`expected 30 icosa edges, got ${edges.length}`);
  return edges;
}

/** Convex-hull faces of the 12-vertex icosahedron (brute-force; N=12). */
function icosaFaces(ico) {
  const faces = [];
  const n = ico.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = ico[i], b = ico[j], c = ico[k];
        // Skip non-edges
        if (!isIcosaEdge(a, b) || !isIcosaEdge(b, c) || !isIcosaEdge(c, a)) continue;
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-12) continue;
        // Plane: n·(x-a) = 0. All other verts must be on the inner side (n·(v-a) ≤ 0
        // if n points outward). Pick outward by centroid of triangle from origin.
        let ox = nx / len, oy = ny / len, oz = nz / len;
        const cx = (a[0] + b[0] + c[0]) / 3;
        const cy = (a[1] + b[1] + c[1]) / 3;
        const cz = (a[2] + b[2] + c[2]) / 3;
        if (ox * cx + oy * cy + oz * cz < 0) { ox = -ox; oy = -oy; oz = -oz; }
        let hull = true;
        for (let t = 0; t < n; t++) {
          if (t === i || t === j || t === k) continue;
          const d = ox * (ico[t][0] - a[0]) + oy * (ico[t][1] - a[1]) + oz * (ico[t][2] - a[2]);
          if (d > 1e-9) { hull = false; break; }
        }
        if (hull) faces.push([i, j, k]);
      }
    }
  }
  if (faces.length !== 20) throw new Error(`expected 20 icosa faces, got ${faces.length}`);
  return faces;
}

function isIcosaEdge(a, b) {
  return Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - 2.0) < 1e-9;
}

/** Order ring indices CCW as seen from outside (from +radial). */
function orderRingCCW(positions, idxs) {
  let cx = 0, cy = 0, cz = 0;
  for (const i of idxs) {
    cx += positions[i * 3];
    cy += positions[i * 3 + 1];
    cz += positions[i * 3 + 2];
  }
  const n = idxs.length;
  cx /= n; cy /= n; cz /= n;
  const nl = Math.hypot(cx, cy, cz);
  const nx = cx / nl, ny = cy / nl, nz = cz / nl;

  // Orthonormal frame in the face plane
  const i0 = idxs[0];
  let ux = positions[i0 * 3] - cx, uy = positions[i0 * 3 + 1] - cy, uz = positions[i0 * 3 + 2] - cz;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  // w = n × u
  const wx = ny * uz - nz * uy;
  const wy = nz * ux - nx * uz;
  const wz = nx * uy - ny * ux;

  const keyed = idxs.map((i) => {
    const dx = positions[i * 3] - cx;
    const dy = positions[i * 3 + 1] - cy;
    const dz = positions[i * 3 + 2] - cz;
    const x = dx * ux + dy * uy + dz * uz;
    const y = dx * wx + dy * wy + dz * wz;
    return { i, ang: Math.atan2(y, x) };
  });
  keyed.sort((a, b) => a.ang - b.ang);
  return keyed.map((k) => k.i);
}
