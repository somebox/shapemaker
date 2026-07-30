#!/usr/bin/env python3
"""Mesh validation: topology + exact self-intersection scan.

Watertight/genus checks are topological -- they pass happily on a mesh whose
triangles pass through each other. This adds the geometric test: every pair of
non-adjacent triangles whose bounding spheres overlap is checked for a real
edge-through-face crossing (Moller-Trumbore), plus a coplanar-overlap test.
"""
import numpy as np
from scipy.spatial import cKDTree


def _seg_tri_hits(P0, P1, V0, V1, V2, eps=1e-9):
    """Vectorised Moller-Trumbore: does segment P0->P1 cross triangle V0V1V2?"""
    e1, e2 = V1 - V0, V2 - V0
    d = P1 - P0
    pv = np.cross(d, e2)
    det = np.einsum("ij,ij->i", e1, pv)
    ok = np.abs(det) > eps
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    tv = P0 - V0
    u = np.einsum("ij,ij->i", tv, pv) * inv
    qv = np.cross(tv, e1)
    v = np.einsum("ij,ij->i", d, qv) * inv
    t = np.einsum("ij,ij->i", e2, qv) * inv
    return ok & (u > eps) & (v > eps) & (u + v < 1 - eps) & (t > eps) & (t < 1 - eps)


def self_intersections(mesh, report=8):
    """Return a list of intersecting triangle-index pairs (may be truncated)."""
    tri = mesh.triangles
    faces = mesh.faces
    n = len(tri)
    cent = tri.mean(axis=1)
    rad = np.linalg.norm(tri - cent[:, None, :], axis=2).max(axis=1)
    tree = cKDTree(cent)
    pairs = tree.query_pairs(r=2 * rad.max(), output_type="ndarray")
    if len(pairs) == 0:
        return []

    # prune: bounding spheres must actually overlap
    a, b = pairs[:, 0], pairs[:, 1]
    close = np.linalg.norm(cent[a] - cent[b], axis=1) <= rad[a] + rad[b]
    pairs = pairs[close]
    a, b = pairs[:, 0], pairs[:, 1]

    # drop pairs that legitimately share a vertex
    sa, sb = faces[a], faces[b]
    shares = (sa[:, :, None] == sb[:, None, :]).any(axis=(1, 2))
    pairs = pairs[~shares]
    if len(pairs) == 0:
        return []
    a, b = pairs[:, 0], pairs[:, 1]

    A, B = tri[a], tri[b]
    hit = np.zeros(len(pairs), dtype=bool)
    for (src, dst) in ((A, B), (B, A)):
        for k in range(3):
            hit |= _seg_tri_hits(src[:, k], src[:, (k + 1) % 3],
                                 dst[:, 0], dst[:, 1], dst[:, 2])
    bad = pairs[hit]
    return [tuple(p) for p in bad[:report]], int(hit.sum())


def check(path_or_mesh, label=""):
    import trimesh
    m = (trimesh.load(path_or_mesh, process=True)
         if isinstance(path_or_mesh, str) else path_or_mesh)
    res = self_intersections(m)
    nbad = 0 if res == [] else res[1]
    examples = [] if res == [] else res[0]
    print(f"{label or path_or_mesh}")
    print(f"  triangles          : {len(m.faces)}")
    print(f"  watertight         : {m.is_watertight}")
    print(f"  winding consistent : {m.is_winding_consistent}")
    print(f"  bodies             : {m.body_count}")
    print(f"  genus              : {(2 - m.euler_number) // 2}")
    print(f"  degenerate tris    : {int((m.area_faces < 1e-9).sum())}")
    print(f"  volume             : {m.volume / 1000:.2f} cm^3 (positive: {m.volume > 0})")
    print(f"  SELF-INTERSECTIONS : {nbad}" + (f"  e.g. {examples}" if examples else "  <- clean"))
    return nbad


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        check(p)
        print()
