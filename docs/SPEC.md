# Shapemaker specification

Shapemaker is a static browser app for designing geometric forms that can be
built physically or used as artwork. A user chooses a base polyhedron, changes
its proportions and shell, inspects real dimensions, and exports geometry for
workflows such as 3D printing, laser cutting, model making, or PCB-based
structures.

The creative vocabulary stays deliberately small: base shape, scale, density,
jitter, openings, seed, orientation, and presets. These controls should combine
into interesting results without turning the app into general CAD.

## Product goals

- **Immediate feedback:** controls regenerate the preview interactively.
- **Real, inspectable dimensions:** all geometry is expressed in millimetres.
  Overall dimensions and edge lengths remain visible while the user scales or
  edits the shape.
- **Fabrication-ready geometry:** exports are internally consistent and retain
  true scale. STL is watertight, consistently wound, and free of known
  self-intersections.
- **Fabrication-aware preview:** the form can rest on a real-scale reference
  plane while the camera orbits it. Optional printing overlays indicate
  approximate overhang risk without pretending to replace a slicer.
- **Reproducible iteration:** a design can be saved as a portable project,
  reopened later, shared by URL, and restored through undo/redo.
- **Useful starting points:** presets demonstrate attractive and practical
  combinations. The prototype TPU frame remains the default reference.
- **Static deployment:** no backend or build step is required. The complete app
  runs from GitHub Pages or another static HTTP server.

## Scope

### Version 1

- Icosidodecahedron, Platonic solids, and seeded random convex polyhedra.
- Uniform free scaling with live dimensions and edge-length inspection.
- On-sphere jitter.
- Solid closed forms and hollow shells, with optional openings on hollow forms.
- Inset-and-fillet openings.
- Face-based resting orientation.
- STL and camera-projected SVG export.
- Project save/load, URL state, undo/redo, presets, measurements, and honest
  print-risk overlays.

### Not in version 1

- General CAD, booleans, or concave forms.
- Slicing or automatic/scored orientation.
- Fabrication-specific nesting, toolpaths, Gerber generation, or slicer output.
- Additional opening styles or editable operator stacks.
- Dihedral edge fillets or resin drain-hole design.
- Mobile-first layout.

Ideas without a committed use case, including true round struts, live in
[`ROADMAP.md`](ROADMAP.md) rather than the active specification.

## Application contract

```text
compile(state) -> {
  skeleton,
  mesh,
  metrics,
  validation,
  orientation,
  state
}

Skeleton    { positions: Float64Array, faces: number[][], edges: [i, j][] }
Mesh        { positions: Float32Array, indices: Uint32Array,
              faceId: Uint32Array }
Orientation { faceIndex, matrix }
```

Rules:

1. `compile()` is the only regeneration API used by UI, exports, project and
   URL restore, and tests.
2. Geometry modules never import Three.js and must run headlessly under Node.
3. Stage outputs are treated as immutable.
4. Geometry is correct by construction; no normal- or topology-repair pass is
   used.
5. User-reachable failures return structured validation and do not throw
   through the `compile()` boundary.
6. The orientation matrix is computed once and applied by preview and export;
   geometry buffers remain unoriented.
7. From Milestone 2 onward, the parameter schema is the source of defaults,
   bounds, visibility, project serialization, and URL serialization. Phase 1
   defaults currently live in `src/types.js`.

## Geometry pipeline

```text
base points -> (jitter) -> convex hull -> (plane-perturb) -> subdivide/smooth -> scale -> shell -> orient -> export
```

From Milestone 3 the interactive path is points → hull+merge+face-identity
(`assertSkeleton`) → scale to mm in the pipeline → shell. Jitter, subdivide,
and smooth are shipped (Milestone 5); order is jitter → subdivide → smooth.
Origin-centered hull input is required by `assertSkeleton`'s outward-winding
check.

### Base points and jitter

Base generators produce normalized points on a sphere: Platonic solids, the
default icosidodecahedron, a deterministic fibonacci-lattice sphere, or
seeded random points with a minimum angular separation. Parametric point
count (sphere and random) tops out near 60 until interactive performance is
measured; the sphere's density sets how faceted it is, while Quality only
refines the shell tessellation.

The jitter UI exposes 0–50%; an experimental soft amplitude scale maps that
range so low-slider values stay subtle (jitter 0 remains identity — exact
bases stay exact). At high amplitudes on regular bases a perturbed face
plane can stop bounding the solid; that face simply vanishes (dropping a
non-binding half-space is exact), so extreme jitter deforms gradually
instead of failing. On the random base, jitter moves points along the
sphere; staying on the sphere prevents vertices from silently disappearing
inside the hull. One seed controls random placement and jitter in version 1.

**Jitter direction** is a mode: *Surface* (default) slides points along the
sphere / tilts face planes; *Radial* randomizes the center-to-surface
distance (scaling point radii or offsetting planes along their normals —
parametric points can sink inside the hull and vanish, accepted as gradual);
*Both* applies both. Every mode draws the same random sequence per element,
so switching modes reworks the same randomness instead of rerolling. Radial
point clouds renormalize so Size still means circumdiameter.

**Density** is a direct point-count slider (4–60) for parametric bases;
separation derives from the count (matching the retired Sparse / Medium /
Dense anchors at 12/24/48). **Subdivide** (0/1/2) is the first fixed-order
skeleton operator: each level splits every face flat, in its own plane —
4:1 for triangles, centroid fans over midpoint-split edges for larger
polygons — so mixed-face solids stay closed and level alone only adds
resolution (grids of openings). **Smooth** (0–100%) is an outer-edge
fillet by sphere clip: vertices outside a shrinking clip radius pull onto
it, rounding corners and edges while flat face interiors keep their planes
— overall dimensions hold, only sharpness melts (most pronounced on cube
and tetra). At 100 the clip reaches the nearest face plane and the solid
becomes the inscribed ball.

Operation order is fixed and load-bearing: **jitter → subdivide → smooth**.
Jitter distorts the simple base form (plane perturbation on regulars, point
jitter before the hull on parametric bases), subdivision adds resolution to
the distorted solid, and smooth fillets its edges. Running jitter after
subdivision would perturb families of near-coplanar sub-face planes, most
of which stop binding — silently discarding the subdivision and smoothing.

**Jitter is available on every base.** On regular bases it perturbs face
*planes* (small tilt and offset) and rebuilds vertices by re-intersecting the
planes through the dual hull — faces stay planar convex polygons, so a
jittered cube is six wobbly quad frames and every solidifier guarantee holds.
Vertices where four or more faces meet split into short edges that grow
gradually from zero with amplitude. On the random base jitter moves the
points themselves on the sphere; those hulls are already triangulated, so
face count is continuous there too.

### Hull, skeleton, and scale

QuickHull closes the point cloud. Coplanar facets are merged using a
size-relative tolerance for regular generators (jittered regulars keep the
merge: their jitter perturbs the merged faces' planes afterwards). Random
bases with nonzero jitter skip the merge entirely — jittered points
are almost never coplanar, so merging would be a no-op with over-merge risk —
and the hull triangles become the faces.

The resulting normalized `Skeleton` is the central shape representation. A
single uniform scale converts it to millimetres. The primary interaction is
free scaling by overall size; the UI continuously reports bounding dimensions
and edge minimum, mean, and maximum. Hovering or selecting an edge reports its
exact length.

For a regular shape, entering an edge length is an alternate way to set the same
uniform scale because all edges are equal. It is not a second independent size
parameter. Constraints that preserve a target mean or selected edge while the
shape changes are future workflow features tracked in the roadmap.

Before additional generators are accepted, skeleton validation must check
finite positions, valid face indices, planarity, non-degenerate faces and edges,
closed edge adjacency, and consistent outward rings.

### Shell

Version 1 supports three combinations:

- solid with closed faces;
- hollow with closed faces;
- hollow with one opening per face.

Openings require a hollow shell because their rims close against the inner
surface. Solid bodies with through-holes require a different construction and
are deferred.

A hollow shell uses a uniformly scaled inner surface. This keeps shared vertices
exact and makes the shell watertight by construction. Wall thickness specifies
the minimum thickness; the actual range is reported.

Openings use a centroid-scaled inset and tangent fillet. Fillet is authored as
a radius in millimetres; a face whose opening cannot fit the requested radius
clamps it locally, and the applied range is reported. Each face boundary is
subdivided globally so adjacent faces share identical points. The opening is
sampled on matching centroid rays, preserving the prototype's non-intersecting
annulus construction.

Mesh density is controlled by edge subdivision and fillet-arc sampling. A
user-facing quality preset (Milestone 4) may raise or lower those counts;
it must not introduce smooth shading that makes the preview diverge from the
exported triangle mesh. The viewer uses flat shading so preview ≡ STL.

Border width is authored in millimetres in version 1. This is useful across
physical fabrication methods because it describes the actual width of material,
not merely visual openness. The UI dynamically limits it using the smallest
face and reports the resulting range and relative openness. Exactly one border
representation is authoritative in state and project files.

Opening, border, and applied-fillet measurements are retained per face and
aggregated for status reporting. Metrics must not assume that faces with the
same side count are congruent.

### Orientation

Clicking a face selects it as the resting face. The face's actual plane normal
is aligned with `-Z`, then the shape is translated until its minimum `Z` is
zero. Selection is stored as a skeleton face index; stale indices fall back to a
stable default with a warning.

### Export

- Binary STL applies the resting orientation and writes millimetres.
- Seed-dependent filenames include the seed.
- SVG projects skeleton edges from the current camera and retains real units.
- Export compiles through the same `compile()` path as the preview and refuses
  invalid state. When a mesh quality preset exists, preview and STL use that
  same tessellation — there is no separate “pretty” preview mesh.
- More specialized fabrication outputs belong in the roadmap until their
  required semantics are defined.

## Projects and persistence

A **project** is the durable unit of work. It contains canonical authoring
state plus optional view and descriptive metadata; generated meshes and
exports remain derived artifacts.

Projects use portable UTF-8 JSON files with the extension
`.shapemaker.json`. They are opened and downloaded locally in the browser, so
no account or backend is required. The versioned schema, migration behavior,
canonical serialization, and example file are defined in
[`PROJECT_FORMAT.md`](PROJECT_FORMAT.md).

Project parsing and migration happen before `compile()`. Loading replaces the
current session as one undoable action; saving establishes the clean baseline
without discarding undo history. Unsupported future versions are never
silently overwritten.

URL state is the compact sharing format, while project files are the durable
and human-readable format. Optional local recovery may retain an unsaved
session, but does not replace explicit project files.

### Session model (browse → edit)

Choosing a **starting point** (Platonic / icosidodeca / random / named preset)
fills the whole panel with that recipe — a hard reset of Form and distort
defaults, not a mode switch that preserves Form intent. Built-in starts and
presets share one apply path with project Open. In the UI they appear together
in a **Start-from chooser**: thumbnail cards (wireframe previews projected
from each start's skeleton) grouped as built-in shapes and presets. Selecting
a card loads its points (and Form pack) to modify; it is not a lasting Base
mode. Shape controls are size, edge, density, seed, and jitter.

- **Browse:** the draft matches a clean start (or its clean baseline). Clicking
  other starts is frictionless viewing.
- **Edit:** any tweak marks the session modified. The user is drafting from
  that start.
- **Switch while modified:** load the new start and discard the draft with no
  confirm dialog. Safety net is Undo (browser-history snapshots of canonical
  state). Undo must not navigate away from the app.
- Project **Save** remains project files. User-owned preset Save/delete is out
  of scope until a separate “Yours” store is specified.
## Architecture

### Implemented in Phase 1

```text
index.html
vendor/three/          pinned Three.js, controls, licence, provenance
src/
  main.js              browser event adapter
  compile.js           sole regeneration entry point
  pipeline.js          stage runner and bounded caches
  validate.js          state validation and structured geometry errors
  types.js             Phase 1 defaults and core type documentation
  skeleton.js          shape-independent skeleton utilities
  faceframe.js         face-local 2D/world transforms
  points/
    icosidodeca.js
  geom/
    poly2.js           inset, fillet, radial sampling
    edgesub.js         shared edge subdivisions
    annulus.js         rings to triangles
  solid/
    shell.js
  mesh.js              structural and manifold invariants
  orient.js            resting-face transform
  metrics.js
  export/
    stl.js
  viewer.js            Three.js preview and picking
prototype/             Python reference: geometry, meshcheck, bridge analysis
test/                  fixtures, parity tests, and acceptance references
```

### Planned modules

```text
presets.json            shipped (M3)
vendor/quickhull3d/     shipped (M3)
src/schema.js           canonical state codec + control defs
src/hashcodec.js        versioned URL hash
src/project-format.js   .shapemaker.json serialize/parse
src/ui.js               Shape/Form/Inspect/Make panel
src/limits.js           proactive slider ceilings
src/hull.js             shipped (M3)
src/points/platonic.js  shipped (M3)
src/bases.js            shipped (M3)
src/points/random.js    shipped (M5 path)
src/starts.js           start-from recipes
src/start-thumbs.js     chooser wireframe thumbnails (SVG)
src/points/jitter.js    on-sphere jitter (parametric bases)
src/points/sphere.js    fibonacci-lattice sphere points
src/plane-perturb.js    plane-perturbation jitter (regular bases)
src/subdivide.js        spherified surface subdivision (skeleton operator)
src/export/svg.js       hidden-line SVG export (M6 path)
```

The viewer and UI consume compiled outputs only. Face-local opening geometry is
isolated in `faceframe.js` and `geom/`; shell policy does not depend on a
particular polyhedron.

Preview and export may use different quality settings, but they use the same
solidifier. Pipeline caches are bounded and exclude resting-face selection from
the mesh key.

Project parsing, migration, and serialization are separate from `compile()`.
The parser produces canonical state; `compile()` validates and builds it.

## Validation and metrics

Validation has three layers:

1. `validateState()` checks public parameter semantics and combinations.
2. Geometry stages check constraints that require a skeleton.
3. Mesh invariants detect internal construction defects.

Validation entries have this shape:

```text
{ stage, key, message, clampTo?, faceIds? }
```

The UI keeps the last valid preview visible, identifies the offending control,
and can highlight limiting faces.

Metrics are computed once by `compile()` and include dimensions, triangle
count, volume, edge minimum/mean/maximum, selected-edge length, wall and border
ranges, applied fillet range, minimum opening diameter, and the longest
near-horizontal skeleton edge. Placement-dependent metrics use the orientation
matrix.

A hollow closed shell has two disconnected boundary surfaces (outer and inner),
which mesh tools may report as two bodies. This is expected; other version-1
outputs must be a single connected body.

## UI principles

The canvas is primary; controls are grouped by user intent:

- **Shape:** base, random density/seed, jitter, uniform scale.
- **Form:** solid/hollow, wall, openings, border, fillet.
- **Inspect:** overall dimensions, edge statistics, selected edge, face data.
- **Make:** orientation, mesh quality preset, preview overlay, project
  save/open, export, copy link.

Additional principles:

- Free scaling is the default workflow. Measurements update continuously and do
  not require opening a separate dialog.
- The preview is flat-shaded so it matches the exported triangle mesh. Finer
  appearance comes from denser tessellation (quality preset), not smooth normals.
- Clicking or hovering an edge exposes its exact length. Regular shapes may use
  edge length as the scale input.
- Clicking a face is the primary way to choose a resting face; a grouped picker
  is the accessible alternative.
- The reference grid uses 10 mm squares and emphasized 50 mm lines.
- Sliders recompile live while compiles stay under the performance
  threshold (`HEAVY_COMPILE_MS`, 100 ms). Above it, drags update only the
  number readout and the recompile lands on release; a busy badge is
  painted before heavy blocking work so the UI never looks locked.
  Subdivision clicks are predicted heavy from the projected face count
  before any slow compile has been measured.
- Ordinary parameter changes preserve the camera view. Reframing occurs on
  first load, explicit reset, or a major size/base change — not on jitter-only
  or seed-only edits. Framing fits the bounding *sphere*, so solids of equal
  circumdiameter occupy equal screen presence (box framing zoomed cubes far
  past round solids).
- A persistent status bar under the view carries the dimension/mesh stats,
  the busy badge, and Export STL — always visible regardless of panel
  scroll.
- Controls that do not apply stay visible and dimmed (`inert`), not hidden, for
  Shape distort knobs (density / seed / jitter) at minimum.
- Dynamic control limits prevent invalid geometry where possible; structured
  validation is the fallback.
- Printing overlays are optional tools, not the default appearance, and never
  communicate only through colour.
- Status separates dimensional/fabrication information from mesh diagnostics.
- Equal canonical state produces an equal versioned URL. Only committed changes
  create history entries.
- The UI visibly distinguishes Browse vs Edit (modified draft) and unsaved
  project changes, and shows the current project name.

## Deployment

The app is a static ES-module site. It must be served over HTTP(S), not opened
through `file://`.

All browser paths are document-relative (`./...`) so GitHub Pages project sites
work under `/repository-name/`. `.nojekyll` remains at the repository root.
Local deployment testing should serve the parent directory and open
`http://localhost:8000/shapemaker/` to reproduce a Pages subpath.

Project open/save uses browser file input and download APIs. Where available,
the File System Access API may improve repeated saves, but it must remain an
optional progressive enhancement.

## Verification

- Numeric fixtures compare JavaScript geometry helpers with the Python
  prototype.
- The prototype-default model is checked against reference triangle count,
  volume, wall range, and placed height.
- Browser-independent tests exercise `compile()`, validation, orientation,
  solidification, project migration/round-trip, and STL output.
- Every supported project fixture must load, serialize canonically, reload, and
  produce equivalent compiled state.
- `scripts/acceptance.sh` exports representative cases and requires expected
  body count, watertightness, consistent winding, no degenerate triangles,
  positive volume, and zero self-intersections.
- New hull generators and irregular seeds enter the acceptance matrix before
  release.

## Milestones

1. **Place and export — complete:** prototype-default frame, face resting,
   browser preview, STL parity, and geometric acceptance.
2. **Measure, save, and continue:** schema-driven controls, free scaling and
   edge inspection, project open/save, dynamic bounds, URL state, undo/redo,
   and Copy Link.
3. **Change the family:** Platonic solids, QuickHull/coplanar merge, face
   stepper, and presets — shipped in v0.3.
4. **Mesh quality:** tessellation presets (Draft / Normal / Fine) via edge and
   fillet sampling; flat-shaded preview that matches STL.
5. **Distort and invent:** on-sphere jitter (all bases), seeded random hulls,
   density presets, start-from browse/edit session, and irregular-shape
   acceptance.
6. **Share, draw, and judge:** unit-aware SVG and honest print-risk overlays.

Priorities and uncommitted future ideas are maintained in
[`ROADMAP.md`](ROADMAP.md).
