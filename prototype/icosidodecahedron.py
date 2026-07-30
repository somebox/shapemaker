#!/usr/bin/env python3
"""
Parametric icosidodecahedron shell with an opening in every face.

A hollow shell whose 32 faces (20 triangles + 12 pentagons) are each turned into
a flat frame: the face polygon with a corner-rounded, inset copy of itself
removed. Designed for FDM printing in flexible filament without supports.

    python3 icosidodecahedron.py --verify -o ball.stl

--------------------------------------------------------------------------
WHY THE MESH IS BUILT THE WAY IT IS
--------------------------------------------------------------------------
An earlier version triangulated each face's annulus by sweeping polar angle and
matching the outer ring (3 or 5 corners) to the opening ring (30+ points). That
produced triangles spanning a whole outer edge with their apex on the opening,
which cut straight across the hole: 1500+ self-intersecting triangle pairs in a
mesh that still reported watertight, because watertight/genus/winding are
TOPOLOGICAL tests and pass happily on a surface that passes through itself.

This version cannot do that, by construction:

  1. Each polyhedron edge is subdivided ONCE, globally. Both faces sharing the
     edge use the same points, so neighbours meet exactly -- no cracks, no
     T-junctions. The distribution is symmetric under reversal, because the two
     faces traverse the edge in opposite directions and must agree.

  2. Each face's opening ring is sampled by casting a ray from the face centroid
     through every outer boundary point. Both rings are convex and contain the
     centroid, so the rays are in strict angular order, and the quad between two
     consecutive rays is a well-formed piece of the annulus. Equal point counts,
     one-to-one correspondence, no overlap possible.

  3. Every quad is planar -- including the rim quads, which lie in a plane
     through the origin because the inner shell is a pure scale of the outer.
     Splitting them into triangles is therefore exact.

Run with --verify to confirm geometrically (see meshcheck.py).

--------------------------------------------------------------------------
WALL THICKNESS IS NOT PERFECTLY UNIFORM
--------------------------------------------------------------------------
The inner shell is a uniform scale of the outer one, which is what keeps every
vertex exactly shared. But the pentagons sit closer to the centre than the
triangles (inradius 42.5 vs 46.7 mm at 100 mm diameter), so one scale factor
cuts a proportionally thinner wall on them: triangles come out ~10% thicker.
--thickness sets the THINNER (pentagon) value, so the wall is never below what
you ask for.

Making it exactly uniform would mean offsetting each face plane by the same
distance instead. Those planes do not meet at a common point at the vertices
(again because the two inradii differ), so every vertex would split and each
strut would gain a V-ridge along its inside. Buildable, but real added
complexity for a 10% difference that slices identically.

--------------------------------------------------------------------------
PRINT ORIENTATION MATTERS FAR MORE THAN HOLE SIZE
--------------------------------------------------------------------------
Resting a pentagon on the bed gives a lovely flat base -- and puts 20 of the 60
struts perfectly horizontal in a single plane at the hemisphere. A third of the
frame then appears in one layer with nothing beneath it. Measured worst
unsupported reach: 10.8 mm (a ~22 mm bridge).

Widening the borders does NOT fix this. The horizontal struts are as long as
the polyhedron edge (30.9 mm at 100 mm diameter) no matter how wide the frames
are; going from 3.2 to 5.6 mm of border only took the reach from 10.8 to 7.3 mm
while INCREASING total unsupported area, because there is simply more material
hanging. Tilting does fix it: --orient low-bridge drops the worst reach to
2.4 mm with no layer worse than 3 mm.

The cost is the flat base -- tilted, the shell rests on about 4 points and needs
a brim. For flexible filament that is usually the better trade.
"""

import argparse
import math

import numpy as np
import trimesh
from scipy.spatial import ConvexHull

PHI = (1.0 + math.sqrt(5.0)) / 2.0

# Orientation that minimises unsupported spans, in the canonical polyhedron
# frame. Found by directly measuring the sliced bridge metric (bridges.py) over
# candidate axes that have no near-horizontal struts -- not by a geometric
# proxy, which disagrees: several axes share the same 7.5 deg minimum strut tilt
# but differ by 3x in measured reach. Reproduce with --find-orientation.
LOW_BRIDGE_AXIS = np.array([-0.33593647, 0.22640901, 0.91426782])


# ==========================================================================
# Polyhedron
# ==========================================================================
def icosidodecahedron(circumradius=1.0):
    """Return (vertices, faces): 30 vertices, 32 ordered face loops.

    Vertices are the icosahedron's edge midpoints pushed out to the sphere.
    Faces are recovered by grouping coplanar convex-hull facets, then sorting
    each group into a ring counter-clockwise as seen from outside.
    """
    ico = []
    for s1 in (-1, 1):
        for s2 in (-1, 1):
            ico += [(0.0, s1, s2 * PHI), (s1, s2 * PHI, 0.0), (s1 * PHI, 0.0, s2)]
    ico = np.array(ico, dtype=float)

    pts = [(ico[i] + ico[j]) / 2.0
           for i in range(len(ico)) for j in range(i + 1, len(ico))
           if abs(np.linalg.norm(ico[i] - ico[j]) - 2.0) < 1e-9]   # icosa edge = 2
    verts = np.array(pts)
    verts *= circumradius / np.linalg.norm(verts[0])
    assert len(verts) == 30, f"expected 30 vertices, got {len(verts)}"

    faces = []
    for eq in {tuple(np.round(e, 9)) for e in ConvexHull(verts).equations}:
        normal, offset = np.array(eq[:3]), -eq[3]
        ring = [i for i, v in enumerate(verts)
                if abs(normal @ v - offset) < 1e-7 * circumradius]
        c = verts[ring].mean(axis=0)
        u = verts[ring[0]] - c
        u /= np.linalg.norm(u)
        w = np.cross(normal, u)
        ang = [math.atan2(w @ (verts[i] - c), u @ (verts[i] - c)) for i in ring]
        faces.append([i for _, i in sorted(zip(ang, ring))])

    assert sorted(len(f) for f in faces) == [3] * 20 + [5] * 12, "face recovery failed"
    return verts, faces


def inradii(circumradius):
    """(triangle, pentagon) perpendicular distance from centre to face plane."""
    R = circumradius
    edge = R / PHI
    rho3 = edge / math.sqrt(3.0)                     # in-plane circumradius, tri
    rho5 = edge / (2.0 * math.sin(math.pi / 5))      # in-plane circumradius, pent
    return math.sqrt(R * R - rho3 * rho3), math.sqrt(R * R - rho5 * rho5)


def edge_list(faces):
    """The 60 undirected edges as sorted (i, j) index pairs."""
    return sorted({tuple(sorted((f[k], f[(k + 1) % len(f)])))
                   for f in faces for k in range(len(f))})


# ==========================================================================
# 2D geometry helpers
# ==========================================================================
def fillet_polygon(poly, radius, segments=64):
    """Round every corner of a convex 2D polygon with a tangent circular arc.

    The straight portions of the edges are left untouched, so the frame width at
    the edge midpoints stays exactly `border` no matter how large the fillet.
    Radius is clamped to the largest value whose tangent points still fit.

    Returns (dense polyline, radius actually applied).
    """
    n = len(poly)
    if radius <= 1e-9:
        return poly.copy(), 0.0

    rmax = np.inf
    for k in range(n):
        prev, cur, nxt = poly[k - 1], poly[k], poly[(k + 1) % n]
        d1, d2 = prev - cur, nxt - cur
        l1, l2 = np.linalg.norm(d1), np.linalg.norm(d2)
        half = math.acos(np.clip((d1 @ d2) / (l1 * l2), -1, 1)) / 2.0
        rmax = min(rmax, 0.5 * min(l1, l2) * math.tan(half))
    r = min(radius, rmax * 0.999)

    out = []
    for k in range(n):
        prev, cur, nxt = poly[k - 1], poly[k], poly[(k + 1) % n]
        d1 = (prev - cur) / np.linalg.norm(prev - cur)
        d2 = (nxt - cur) / np.linalg.norm(nxt - cur)
        half = math.acos(np.clip(d1 @ d2, -1, 1)) / 2.0
        centre = cur + (d1 + d2) / np.linalg.norm(d1 + d2) * (r / math.sin(half))
        p1 = cur + d1 * (r / math.tan(half))
        p2 = cur + d2 * (r / math.tan(half))
        a1 = math.atan2(*(p1 - centre)[::-1])
        a2 = math.atan2(*(p2 - centre)[::-1])
        sweep = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi   # take the short way
        for t in np.linspace(0.0, 1.0, segments + 1):
            a = a1 + sweep * t
            out.append(centre + r * np.array([math.cos(a), math.sin(a)]))
    return np.array(out), r


def radial_sample(polyline, angles):
    """Radius of a closed star-shaped polyline (about the origin) at each angle.

    Exact ray/segment intersection, so the fillet is sampled without the error
    that polar interpolation would introduce on the straight sections.
    """
    P = polyline
    E = np.roll(P, -1, axis=0) - P
    radii = np.empty(len(angles))
    for k, th in enumerate(angles):
        dx, dy = math.cos(th), math.sin(th)
        denom = dx * E[:, 1] - dy * E[:, 0]
        num = dy * P[:, 0] - dx * P[:, 1]
        with np.errstate(divide="ignore", invalid="ignore"):
            v = num / denom                       # position along each segment
        hit = P + v[:, None] * E
        u = hit[:, 0] * dx + hit[:, 1] * dy       # distance along the ray
        ok = (np.abs(denom) > 1e-12) & (v >= -1e-9) & (v <= 1 + 1e-9) & (u > 1e-9)
        if not ok.any():
            raise RuntimeError("opening is not star-shaped about the face centroid")
        radii[k] = u[ok].min()
    return radii


def edge_params(k):
    """Interior point positions along an edge, as fractions in (0, 1).

    Symmetric under reversal -- the two faces sharing an edge walk it in
    opposite directions and must produce identical points. Cosine clustering
    puts the resolution near the ends, where the fillet arcs are.
    """
    if k <= 1:
        return np.array([])
    return (1.0 - np.cos(np.pi * np.arange(1, k) / k)) / 2.0


# ==========================================================================
# Shell construction
# ==========================================================================
def build(diameter=100.0, border=3.2, thickness=1.4, fillet=4.5, edge_div=10,
          orient="low-bridge"):
    """Build the shell.

    diameter   outer diameter across opposite vertices, mm
    border     frame width at the middle of each edge, in the plane of the face
    thickness  minimum wall thickness (pentagons; triangles ~10% more)
    fillet     corner radius of the openings, clamped per face type
    edge_div   segments per polyhedron edge; controls fillet smoothness
    orient     "pentagon" (flat base), "low-bridge" (fewest unsupported spans),
               "none", or a 3-vector to place pointing down

    Returns (trimesh.Trimesh, info dict).
    """
    R = diameter / 2.0
    corners, faces = icosidodecahedron(R)
    r3, r5 = inradii(R)

    # Inner shell is a uniform scale; pick it so the thinnest wall == thickness.
    s = 1.0 - thickness / r5
    if s <= 0.0:
        raise ValueError("thickness is larger than the shell radius")

    # ---- one shared subdivision per polyhedron edge -----------------------
    outer = [c for c in corners]
    edge_extra = {}
    ts = edge_params(edge_div)
    for key in edge_list(faces):
        a, b = corners[key[0]], corners[key[1]]
        idx = []
        for t in ts:
            outer.append(a + (b - a) * t)
            idx.append(len(outer) - 1)
        edge_extra[key] = idx
    outer = np.array(outer)

    blocks = [outer, outer * s]          # both shells share every boundary point
    base_o, base_i = 0, len(outer)
    nxt = 2 * len(outer)
    quads = []
    applied, opening_size = {}, {}

    for ring in faces:
        ro = corners[ring]
        c = ro.mean(axis=0)
        normal = c / np.linalg.norm(c)
        apothem = np.linalg.norm((ro[0] + ro[1]) / 2.0 - c)
        if border >= apothem:
            raise ValueError(
                f"--border {border:g}mm is too wide: the {len(ring)}-sided faces "
                f"allow at most {apothem:.2f}mm before the opening closes")

        # ordered outer boundary: corner, that edge's interior points, corner...
        boundary = []
        for k in range(len(ring)):
            i, j = ring[k], ring[(k + 1) % len(ring)]
            boundary.append(i)
            extra = edge_extra[(min(i, j), max(i, j))]
            boundary.extend(extra if i < j else extra[::-1])
        boundary = np.array(boundary)

        # local 2D frame centred on the face
        u = ro[0] - c
        u /= np.linalg.norm(u)
        w = np.cross(normal, u)
        B2 = np.stack([(outer[boundary] - c) @ u, (outer[boundary] - c) @ w], -1)

        # opening = face inset by `border`, corners rounded
        opening, r_used = fillet_polygon(B2[::edge_div] * (1.0 - border / apothem),
                                         fillet)
        applied.setdefault(len(ring), r_used)
        opening_size.setdefault(len(ring), 2 * np.linalg.norm(opening, axis=1).min())

        # sample the opening along the same rays as the boundary points
        ang = np.arctan2(B2[:, 1], B2[:, 0])
        rad = radial_sample(opening, ang)
        O2 = rad[:, None] * np.stack([np.cos(ang), np.sin(ang)], axis=-1)
        op_o = c + O2[:, :1] * u + O2[:, 1:] * w
        blocks += [op_o, op_o * s]

        m = len(boundary)
        BO, BI = base_o + boundary, base_i + boundary
        OO = np.arange(nxt, nxt + m)
        OI = np.arange(nxt + m, nxt + 2 * m)
        nxt += 2 * m

        for k in range(m):
            k2 = (k + 1) % m
            quads.append((BO[k], BO[k2], OO[k2], OO[k]))     # outer face annulus
            quads.append((BI[k2], BI[k], OI[k], OI[k2]))     # inner face annulus
            quads.append((OO[k], OO[k2], OI[k2], OI[k]))     # rim of the opening

    tris = []
    for (p0, p1, p2, p3) in quads:
        tris += [[p0, p1, p2], [p0, p2, p3]]
    mesh = trimesh.Trimesh(vertices=np.vstack(blocks), faces=np.array(tris),
                           process=True)
    trimesh.repair.fix_normals(mesh)
    if mesh.volume < 0:
        mesh.invert()

    axis = resolve_orientation(orient, corners, faces)
    if axis is not None:
        mesh.apply_transform(trimesh.geometry.align_vectors(axis, [0.0, 0.0, -1.0]))
        mesh.apply_translation([0, 0, -mesh.bounds[0][2]])

    return mesh, dict(r3=r3, r5=r5, scale=s, fillet=applied,
                      opening=opening_size,
                      wall=(r5 * (1 - s), r3 * (1 - s)))


def resolve_orientation(orient, corners, faces):
    """Turn an --orient value into the axis that should point at the bed."""
    if orient in (None, "none"):
        return None
    if isinstance(orient, str):
        if orient == "pentagon":
            pent = next(f for f in faces if len(f) == 5)
            a = corners[pent].mean(axis=0)
        elif orient == "low-bridge":
            a = LOW_BRIDGE_AXIS
        else:
            a = np.array([float(x) for x in orient.split(",")])
    else:
        a = np.asarray(orient, dtype=float)
    return a / np.linalg.norm(a)


# ==========================================================================
# Orientation search (reproduces LOW_BRIDGE_AXIS)
# ==========================================================================
def find_orientation(diameter=100.0, border=3.2, thickness=1.4, fillet=4.5,
                     n_candidates=24, seed=7):
    """Search print orientations by MEASURING sliced unsupported spans.

    Candidates are axes with no near-horizontal struts, spread over the sphere;
    each is scored with bridges.analyse() rather than a geometric proxy.
    """
    import bridges
    corners, faces = icosidodecahedron(diameter / 2.0)
    E = np.array([corners[j] - corners[i] for i, j in edge_list(faces)])
    E /= np.linalg.norm(E, axis=1)[:, None]

    rng = np.random.default_rng(seed)
    S = rng.normal(size=(200000, 3))
    S /= np.linalg.norm(S, axis=1)[:, None]
    S = S[S[:, 2] > 0]
    S = S[np.degrees(np.arcsin(np.abs(S @ E.T))).min(axis=1) > 5.5]

    pick = [0]                                   # greedy farthest-point spread
    for _ in range(n_candidates - 1):
        d = np.min(np.arccos(np.clip(np.abs(S[pick] @ S.T), -1, 1)), axis=0)
        pick.append(int(np.argmax(d)))

    base, _ = build(diameter, border, thickness, fillet, orient="none")
    scored = []
    for z in S[pick]:
        m = base.copy()
        m.apply_transform(trimesh.geometry.align_vectors(-z, [0, 0, -1.0]))
        m.apply_translation([0, 0, -m.bounds[0][2]])
        r = bridges.analyse(m)
        scored.append((r[:, 1].max(), int((r[:, 1] > 2).sum()), z))
    scored.sort(key=lambda x: (x[0], x[1]))
    return scored


# ==========================================================================
# CLI
# ==========================================================================
def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--diameter", type=float, default=100.0,
                   help="outer diameter across opposite vertices, mm (default 100)")
    p.add_argument("--border", type=float, default=3.2,
                   help="frame width at the edge midpoints, mm (default 3.2)")
    p.add_argument("--thickness", type=float, default=1.4,
                   help="minimum wall thickness, mm (default 1.4 = 3 lines @0.4)")
    p.add_argument("--fillet", type=float, default=4.5,
                   help="corner radius of the openings, mm (default 4.5; 0 = sharp)")
    p.add_argument("--edge-div", type=int, default=10,
                   help="segments per polyhedron edge (default 10)")
    p.add_argument("--orient", default="low-bridge",
                   help="'low-bridge' (default), 'pentagon' for a flat base, "
                        "'none', or a custom 'x,y,z' axis to point down")
    p.add_argument("--verify", action="store_true",
                   help="geometric check incl. self-intersections (meshcheck.py)")
    p.add_argument("--bridges", action="store_true",
                   help="measure sliced unsupported spans (bridges.py)")
    p.add_argument("--find-orientation", action="store_true",
                   help="re-run the orientation search; prints the best axes")
    p.add_argument("-o", "--output", default="icosidodecahedron.stl")
    a = p.parse_args()

    if a.find_orientation:
        for w, n2, z in find_orientation(a.diameter, a.border, a.thickness,
                                         a.fillet)[:5]:
            print(f"  reach {w:5.1f} mm  layers>2mm {n2:>3}   axis {np.round(z, 6)}")
        return

    try:
        mesh, info = build(a.diameter, a.border, a.thickness, a.fillet,
                           a.edge_div, a.orient)
    except ValueError as err:
        raise SystemExit(f"error: {err}")
    mesh.export(a.output)

    wp, wt = info["wall"]
    print(f"wrote {a.output}")
    print(f"  bounding box   : {np.round(mesh.extents, 2)} mm")
    print(f"  triangles      : {len(mesh.faces)}")
    print(f"  wall thickness : {wp:.2f} mm pentagons / {wt:.2f} mm triangles "
          f"({wp / 0.4:.1f} lines @0.4mm nozzle)")
    for n_ in sorted(info["fillet"]):
        tag = "triangle" if n_ == 3 else "pentagon"
        note = "" if abs(info["fillet"][n_] - a.fillet) < 1e-3 else " (clamped)"
        print(f"  {tag} faces : opening {info['opening'][n_]:5.1f} mm, "
              f"fillet {info['fillet'][n_]:.2f} mm{note}")
    print(f"  volume         : {mesh.volume / 1000.0:.1f} cm^3  "
          f"(~{mesh.volume / 1000.0 * 1.21:.0f} g in TPU)")

    if a.verify:
        import meshcheck
        print()
        meshcheck.check(mesh, label=f"verification of {a.output}")
    if a.bridges:
        import bridges
        print()
        bridges.summary(mesh, f"unsupported spans in {a.output}")


if __name__ == "__main__":
    main()
