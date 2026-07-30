import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeBinaryStl } from "../src/export/stl.js";

describe("writeBinaryStl", () => {
  // Regular tetrahedron: 4 verts, 4 faces
  const positions = new Float32Array([
    1, 1, 1,
    1, -1, -1,
    -1, 1, -1,
    -1, -1, 1,
  ]);
  const indices = new Uint32Array([
    0, 1, 2,
    0, 2, 3,
    0, 3, 1,
    1, 3, 2,
  ]);

  it("emits 84 + 50*nTris bytes with correct triangle count", () => {
    const buf = writeBinaryStl({ positions, indices }, { header: "test" });
    assert.equal(buf.byteLength, 84 + 50 * 4);
    const view = new DataView(buf);
    assert.equal(view.getUint32(80, true), 4);
    const header = String.fromCharCode(...new Uint8Array(buf, 0, 4));
    assert.equal(header, "test");
  });

  it("round-trips vertex coordinates as float32", () => {
    const buf = writeBinaryStl({ positions, indices });
    const view = new DataView(buf);
    // First triangle vertices start at offset 84 + 12 (after normal)
    let off = 84 + 12;
    for (let v = 0; v < 3; v++) {
      const ix = indices[v] * 3;
      assert.equal(view.getFloat32(off, true), positions[ix]);
      assert.equal(view.getFloat32(off + 4, true), positions[ix + 1]);
      assert.equal(view.getFloat32(off + 8, true), positions[ix + 2]);
      off += 12;
    }
  });

  it("applies orientation matrix to vertices", () => {
    // Translate +10 in Z (column-major identity with tz=10)
    const M = new Float64Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 10, 1,
    ]);
    const buf = writeBinaryStl({ positions, indices }, { matrix: M });
    const view = new DataView(buf);
    const z0 = view.getFloat32(84 + 12 + 8, true); // first vertex z
    assert.equal(z0, positions[2] + 10);
  });
});
