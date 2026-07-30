# shapemaker

Parametric icosidodecahedron shell with an opening in every face, generated as a
watertight STL ready to slice. Built for FDM printing in flexible filament
(TPU 95A) without supports.

The solid is a hollow shell whose 32 faces — 20 triangles and 12 pentagons —
are each turned into a flat frame: the face polygon with a corner-rounded, inset
copy of itself removed from the middle.

```
pip install numpy scipy trimesh shapely rtree pillow
python3 icosidodecahedron.py --verify -o ball.stl
```

## Files

| file | purpose |
|---|---|
| `icosidodecahedron.py` | the generator, and the orientation search |
| `meshcheck.py` | mesh validation, **including self-intersections** |
| `bridges.py` | slices the model and measures unsupported spans |

## Parameters

| flag | default | meaning |
|---|---|---|
| `--diameter` | 100 | outer diameter across opposite vertices, mm |
| `--border` | 3.2 | frame width at the middle of each edge, in the plane of the face |
| `--thickness` | 1.4 | minimum wall thickness (pentagons); triangles come out ~10% more |
| `--fillet` | 4.5 | corner radius of the openings; clamped per face type |
| `--edge-div` | 10 | segments per polyhedron edge — controls fillet smoothness |
| `--orient` | `low-bridge` | `low-bridge`, `pentagon` (flat base), `none`, or `x,y,z` |
| `--verify` | | run the full geometric check |
| `--bridges` | | measure sliced unsupported spans |
| `--find-orientation` | | re-run the orientation search |

`--border` is capped by the face size: at 100 mm diameter the triangles allow at
most 8.92 mm, the pentagons 21.27 mm. Exceeding it is a clean error, not a
broken mesh.

## Three things worth knowing before changing anything

### 1. Topological checks do not catch self-intersection

An earlier version of this generator produced a mesh that was watertight,
winding-consistent, single-bodied, genus-31, zero degenerate triangles — and had
**1542 pairs of triangles passing through each other.** Those tests are all
topological: they only ask whether each edge is used by exactly two faces. A
surface can satisfy every one of them while intersecting itself.

The cause was the annulus triangulation. It matched the outer ring (3 or 5
corners) to the opening ring (30+ points after filleting) by sweeping polar
angle, which emits triangles spanning a whole outer edge with their apex on the
opening — and those cut straight across the hole. It went unnoticed because
before fillets were added both rings had the same point count and the sweep
degenerated into a clean quad strip.

`meshcheck.py` adds the geometric test: Möller–Trumbore edge-through-face over
every non-adjacent triangle pair whose bounding spheres overlap. **Run
`--verify` after any change to the mesh construction.**

The current construction cannot self-intersect:

1. Each polyhedron edge is subdivided **once, globally**, and both faces sharing
   it use the same points — no cracks, no T-junctions. The distribution is
   symmetric under reversal, because the two faces traverse the edge in
   opposite directions and have to agree.
2. Each face's opening is sampled by casting a ray from the face centroid
   through every outer boundary point. Both rings are convex and contain the
   centroid, so the rays are in strict angular order and consecutive rays bound
   exactly one quad. Equal counts, one-to-one, no overlap possible.
3. Every quad is planar — including the rim quads, which lie in a plane through
   the origin because the inner shell is a pure scale of the outer.

### 2. Print orientation matters far more than hole size

Resting a pentagon face on the bed gives a flat base and puts **20 of the 60
struts perfectly horizontal in one plane** at the hemisphere. A third of the
frame appears in a single layer with nothing beneath it.

Widening the borders does **not** fix this — the horizontal struts are as long
as the polyhedron edge (30.9 mm at 100 mm diameter) regardless of frame width:

| | worst unsupported reach | total unsupported |
|---|---|---|
| pentagon-down, border 3.2 | 10.8 mm | 645 mm² |
| pentagon-down, border 4.0 | 9.7 mm | 749 mm² |
| pentagon-down, border 5.6 | 7.3 mm | 898 mm² |
| **`low-bridge` tilt, border 3.2** | **2.8 mm** | **531 mm²** |

Note that widening the border *increases* total unsupported area — there is
simply more material hanging.

`LOW_BRIDGE_AXIS` was found by **measuring** the sliced bridge metric over
candidate axes, not by a geometric proxy. The obvious proxy — maximise the
minimum strut tilt — is misleading: several axes share the same 7.5° minimum
tilt but differ by 3× in measured reach. Re-run with `--find-orientation`.

The cost of tilting is the flat base: the shell rests on ~4 points and needs a
brim. For TPU that is usually the better trade.

### 3. The wall is deliberately not uniform

The inner shell is a uniform scale of the outer one, which is what keeps every
vertex exactly shared and makes the mesh trivially watertight. But the pentagons
sit closer to the centre than the triangles (inradius 42.5 vs 46.7 mm at 100 mm
diameter), so one scale factor cuts a proportionally thinner wall on them —
triangles end up ~10% thicker. `--thickness` sets the *thinner* value.

Exact uniformity would require offsetting each face plane by the same distance.
Those planes don't meet at a common point at the vertices (again because the two
inradii differ), so every vertex would split and each strut would gain a V-ridge
along its inside. Buildable, but real complexity for a 10% difference that
slices identically.

## Sizing for TPU 95A

Squeeze force to compress the 100 mm ball by 10 mm between flat plates,
estimated with a 60-strut space-frame model (E ≈ 40 MPa):

| | wall 0.8 | wall 1.0 | wall 1.2 | wall 1.4 | wall 1.6 |
|---|---|---|---|---|---|
| border 2.8 | 20 N / 10 g | 24 N / 13 g | 28 N / 15 g | — | 34 N / 20 g |
| **border 3.2** | 28 N / 11 g | 34 N / 14 g | 40 N / 17 g | **45 N / 20 g** | 50 N / 22 g |
| border 3.6 | 37 N / 12 g | 45 N / 15 g | 53 N / 18 g | — | 68 N / 24 g |
| border 4.0 | 47 N / 13 g | 58 N / 17 g | 68 N / 20 g | — | 87 N / 26 g |

Absolute forces carry roughly ±50% uncertainty — published modulus for printed
95A ranges 25–60 MPa across brands. The relative comparisons are solid.

Stiffness scales roughly as border^2.5, and wall thickness is a comparable
lever (0.8 → 1.6 mm nearly doubles the force). To go wider *and* softer, move
down-left through the table.

Fragility is not the constraint. Even squeezed 40 mm — nearly half flat — peak
material strain is ~23%, and TPU 95A doesn't take a permanent set until several
hundred percent. Below ~2 mm of border it goes limp and creases rather than
breaking. The real lower bound is printability: 2.5 mm is about 6 extrusion
lines at a 0.4 mm nozzle.

### Slicer settings

- **No supports.** With the default orientation, no layer has an unsupported
  reach over 3 mm.
- **Brim.** The tilted orientation rests on about 4 points.
- Wall 1.4 mm = 3.5 lines at a 0.4 mm nozzle, so Arachne resolves it as 3 solid
  perimeters at ~0.47 mm. Avoid exactly 1.2 mm — it sits on the 3-line boundary
  and regions can drop back to 2 walls plus a sliver.
- 15–20 mm/s, retraction near zero, cooling on.
- **Vase mode will not work.** It spiralises a single closed contour per layer,
  and every layer here has multiple separate islands. Use 0% infill, 3
  perimeters, 0 top/bottom layers for the same thin-shell result.

## How the measurements work

`bridges.py` rasterises each layer's cross-section, dilates the previous layer
by how far a 45° overhang reaches in one layer, and treats what's left as
unsupported. For each unsupported pixel it reports the distance to the nearest
material below:

- **reach** — how far material has to cantilever. A region anchored on both
  sides spans about twice this.
- **unsupported area** — what actually droops, summed over the print.
