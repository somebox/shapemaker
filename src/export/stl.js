/**
 * Binary STL writer (little-endian). Units are millimetres.
 *
 * Layout: 80-byte header, uint32 triangle count, then N records of:
 *   float32 normal[3], float32 v0[3], float32 v1[3], float32 v2[3], uint16 attr
 * Each record is 50 bytes → file size = 84 + 50 * nTris.
 */

/**
 * @param {{ positions: Float32Array|Float64Array, indices: Uint32Array|number[] }} mesh
 * @param {{ header?: string, matrix?: Float64Array|number[]|null }} [opts]
 *   matrix is a column-major 4×4 transform applied to each vertex (orientation).
 * @returns {ArrayBuffer}
 */
export function writeBinaryStl(mesh, opts = {}) {
  const { positions, indices } = mesh;
  const nTris = (indices.length / 3) | 0;
  const buf = new ArrayBuffer(84 + 50 * nTris);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const header = opts.header ?? "shapemaker";
  for (let i = 0; i < 80; i++) bytes[i] = i < header.length ? header.charCodeAt(i) & 0xff : 0;
  view.setUint32(80, nTris, true);

  const M = opts.matrix ?? null;
  let offset = 84;

  for (let t = 0; t < nTris; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;

    let ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    let bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    let cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    if (M) {
      ;[ax, ay, az] = xform(M, ax, ay, az);
      ;[bx, by, bz] = xform(M, bx, by, bz);
      ;[cx, cy, cz] = xform(M, cx, cy, cz);
    }

    // Geometric normal from winding (STL normals are often ignored by slicers,
    // but we fill a unit normal for completeness).
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; }

    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;
    view.setFloat32(offset, ax, true); offset += 4;
    view.setFloat32(offset, ay, true); offset += 4;
    view.setFloat32(offset, az, true); offset += 4;
    view.setFloat32(offset, bx, true); offset += 4;
    view.setFloat32(offset, by, true); offset += 4;
    view.setFloat32(offset, bz, true); offset += 4;
    view.setFloat32(offset, cx, true); offset += 4;
    view.setFloat32(offset, cy, true); offset += 4;
    view.setFloat32(offset, cz, true); offset += 4;
    view.setUint16(offset, 0, true); offset += 2;
  }

  return buf;
}

/** Apply column-major 4×4 affine transform to a point. */
function xform(M, x, y, z) {
  return [
    M[0] * x + M[4] * y + M[8] * z + M[12],
    M[1] * x + M[5] * y + M[9] * z + M[13],
    M[2] * x + M[6] * y + M[10] * z + M[14],
  ];
}
