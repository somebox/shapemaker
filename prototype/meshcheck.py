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


# Candidate pairs are produced in batches of about this many, so memory stays
# bounded whatever the mesh looks like.
PAIR_BATCH = 1_000_000


def _sphere_pairs(cent, rad, batch=PAIR_BATCH):
    """Yield (a, b) index arrays, a < b, of triangles whose bounding spheres
    overlap (|ca - cb| <= ra + rb), batch by batch.

    One KD-tree query at twice the largest radius lets a few big triangles
    (Cut face fans, long rounding strips) widen the search for every small
    one: ~10^9 candidate pairs and tens of GB on some meshes. Triangles are
    grouped by radius (powers of two) and each group pair is searched at
    radius r_a + max r_b, sized from counts before any list is built.
    """
    r0 = rad[rad > 0].min() if (rad > 0).any() else 1.0
    cls = np.floor(np.log2(np.maximum(rad, r0) / r0)).astype(np.int64)
    groups = [np.flatnonzero(cls == k) for k in np.unique(cls)]
    trees = [cKDTree(cent[g]) for g in groups]
    rmax = [rad[g].max() for g in groups]
    for gi, g in enumerate(groups):
        for hj in range(gi, len(groups)):
            h, tree = groups[hj], trees[hj]
            r = rad[g] + rmax[hj]
            counts = tree.query_ball_point(cent[g], r, return_length=True)
            start = 0
            while start < len(g):
                # Grow the slice of query points until it holds a batch.
                end = start + 1
                total = counts[start]
                while end < len(g) and total + counts[end] <= batch:
                    total += counts[end]
                    end += 1
                if total:
                    q = g[start:end]
                    lists = tree.query_ball_point(cent[q], r[start:end])
                    lens = np.fromiter((len(x) for x in lists), np.int64, len(lists))
                    a = np.repeat(q, lens)
                    b = h[np.fromiter((j for x in lists for j in x), np.int64, int(lens.sum()))]
                    # Within one group each pair is found from both ends.
                    keep = (a < b) if gi == hj else np.ones(len(a), bool)
                    keep &= np.linalg.norm(cent[a] - cent[b], axis=1) <= rad[a] + rad[b]
                    a, b = np.minimum(a, b), np.maximum(a, b)
                    if keep.any():
                        yield a[keep], b[keep]
                start = end


def self_intersections(mesh, report=8):
    """Return a list of intersecting triangle-index pairs (may be truncated)."""
    tri = mesh.triangles
    faces = mesh.faces
    cent = tri.mean(axis=1)
    rad = np.linalg.norm(tri - cent[:, None, :], axis=2).max(axis=1)

    found = []
    total = 0
    for a, b in _sphere_pairs(cent, rad):
        # drop pairs that legitimately share a vertex
        sa, sb = faces[a], faces[b]
        shares = (sa[:, :, None] == sb[:, None, :]).any(axis=(1, 2))
        a, b = a[~shares], b[~shares]
        if len(a) == 0:
            continue
        A, B = tri[a], tri[b]
        hit = np.zeros(len(a), dtype=bool)
        for (src, dst) in ((A, B), (B, A)):
            for k in range(3):
                hit |= _seg_tri_hits(src[:, k], src[:, (k + 1) % 3],
                                     dst[:, 0], dst[:, 1], dst[:, 2])
        total += int(hit.sum())
        if len(found) < report:
            found.extend(zip(a[hit][:report].tolist(), b[hit][:report].tolist()))
    if total == 0:
        return []
    return [tuple(p) for p in sorted(found)[:report]], total


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
