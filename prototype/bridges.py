#!/usr/bin/env python3
"""Measure unsupported spans layer by layer, the way a slicer sees them.

For each layer we rasterise the cross-section, dilate the previous layer by the
distance a 45-degree overhang can reach in one layer, and call whatever is left
"unsupported". The worst number that matters is then, for each unsupported
pixel, how far it is from the nearest material on the layer below:

    reach          = max distance from unsupported material to the layer below.
                     A one-sided overhang has to cantilever this far.
    bridge (~2x)   = an unsupported region anchored on both sides spans about
                     twice the reach.

Also reports the unsupported area per layer, which is what actually droops.
"""
import numpy as np
import trimesh
from PIL import Image, ImageDraw
from scipy import ndimage

PX = 0.30           # raster resolution, mm
LAYER = 0.20        # layer height, mm
OVERHANG_DEG = 45.0


def _raster(polys, xmin, ymin, nx, ny):
    img = Image.new("1", (nx, ny), 0)
    d = ImageDraw.Draw(img)
    for p in polys:
        ext = [((x - xmin) / PX, (y - ymin) / PX) for x, y in p.exterior.coords]
        d.polygon(ext, fill=1)
        for h in p.interiors:
            d.polygon([((x - xmin) / PX, (y - ymin) / PX) for x, y in h.coords], fill=0)
    return np.array(img, dtype=bool)


def analyse(mesh, layer=LAYER, verbose=False):
    xmin, ymin = mesh.bounds[0][:2] - 1.0
    xmax, ymax = mesh.bounds[1][:2] + 1.0
    nx = int((xmax - xmin) / PX) + 1
    ny = int((ymax - ymin) / PX) + 1
    zs = np.arange(layer * 0.5, mesh.bounds[1][2], layer)

    reach_px = max(1, int(round(layer / np.tan(np.radians(90 - OVERHANG_DEG)) / PX)))
    struct = np.ones((2 * reach_px + 1, 2 * reach_px + 1), bool)

    prev = None
    rows = []
    for z in zs:
        sec = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        if sec is None:
            prev = None
            continue
        p2, _ = sec.to_planar(to_2D=trimesh.transformations.translation_matrix(
            [0, 0, -z]))
        cur = _raster(p2.polygons_full, xmin, ymin, nx, ny)
        if prev is not None and cur.any():
            support = ndimage.binary_dilation(prev, struct)
            uns = cur & ~support
            if uns.any():
                dist = ndimage.distance_transform_edt(~prev) * PX
                rows.append((z, dist[uns].max(), uns.sum() * PX * PX))
            else:
                rows.append((z, 0.0, 0.0))
        prev = cur
    return np.array(rows) if rows else np.zeros((0, 3))


def summary(mesh, label):
    r = analyse(mesh)
    if len(r) == 0:
        return None
    worst = r[np.argmax(r[:, 1])]
    top = r[np.argsort(-r[:, 1])[:3]]
    print(f"{label}")
    print(f"   worst reach        : {worst[1]:.1f} mm  (~{2*worst[1]:.0f} mm bridge) at z={worst[0]:.1f}")
    print(f"   layers with reach>3mm : {(r[:,1]>3).sum()} of {len(r)}")
    print(f"   total unsupported  : {r[:,2].sum():.0f} mm^2")
    print(f"   worst 3 layers z   : " + ", ".join(f"{z:.1f}mm({d:.1f})" for z, d, _ in top))
    return r


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        summary(trimesh.load(p), p)
        print()
