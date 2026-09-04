# Shapemaker specification

Shapemaker is a static browser app for designing geometric forms that can be
built physically or used as artwork. A user chooses a base polyhedron, changes
its proportions and shell, inspects real dimensions, and exports geometry for
workflows such as 3D printing, laser cutting, model making, or PCB-based
structures.

The creative vocabulary stays deliberately small: base shape, scale, density,
jitter, truncate, spike, openings, seed, orientation, and presets. These
controls should combine into interesting results without turning the app into
general CAD.

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

- Icosidodecahedron, Platonic solids, cuboctahedron, Catalan rhombics
  (dodecahedron / triacontahedron), lat/long globe, fibonacci sphere, and
  seeded random convex polyhedra. Spike (after truncate) grows origin-star-
  convex pyramids or dimples on every face; named stars are presets, not
  extra bases.
- Uniform free scaling with live dimensions and edge-length inspection.
- On-sphere jitter.
- Solid closed forms and hollow shells, with optional openings on hollow forms.
- Inset-and-fillet openings.
- Face-based resting orientation.
- STL and camera-projected SVG export.
- Project save/load, URL state, undo/redo, presets, measurements, and honest
  print-risk overlays.

### Not in version 1

- General CAD, booleans, or concave forms that are not origin-star-convex
  (every ray from the origin must hit the surface once). Origin-star-convex
  spikes and dimples are in scope; Kepler–Poinsot pentagram faces and
  true boolean CSG are not.
- Slicing, or scored orientation of the unsplit model (Split already
  ranks session-only print poses; click-to-rest stays a face pick).
- Fabrication-specific nesting, toolpaths, Gerber generation, or slicer output.
- Additional opening styles or editable operator stacks.
- Valley / concave fillets, or resin drain-hole design. Convex dihedral
  rounding is in scope (ridge-only on spiked meshes).
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
base points -> (jitter) -> convex hull -> (plane-perturb) -> truncate -> spike -> subdivide/smooth -> scale -> shell -> orient -> export
```

From Milestone 3 the interactive path is points → hull+merge+face-identity
(`assertSkeleton`) → scale to mm in the pipeline → shell. Jitter, truncate,
spike, subdivide, and smooth are shipped; order is jitter → truncate →
spike → subdivide → smooth. Origin-centered hull input is required by
`assertSkeleton`'s outward-winding check. After Spike the mesh is origin-
star-convex (`assertStarShaped`), not necessarily convex.

### Base points and jitter

Base generators produce origin-centered point clouds normalized to unit
circumradius (max vertex radius = 1): Platonic solids, the default
icosidodecahedron, the cuboctahedron, Catalan rhombic solids (vertices at two
radii — the inner ring stays inside the circumsphere), a lat/long globe, a
deterministic fibonacci-lattice sphere, or seeded random points with a minimum
angular separation. Parametric point count (sphere and random) tops out near
60 until interactive performance is measured; on the globe the same Density
slider means meridian count (clamped 6–36), so edges follow latitude/longitude
lines after coplanar merge. The sphere's density sets how faceted it is, while
Quality only refines the shell tessellation.

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
Dense anchors at 12/24/48). On the globe the same control sets meridian count:
the base advertises its effective range (6–36) through the registry
(`pointsRange`), and the slider clamps to it so no positions are dead.
**Truncate** (0–50%) is a fixed-order skeleton
operator that cuts every corner: each edge contributes the points at t and
1−t of its length, and the re-hull (with coplanar merge) is the truncated
solid, renormalized to unit circumradius so Size keeps meaning
circumdiameter. Classic stops fall out of the slider: a cube at 50 is the
cuboctahedron, an icosahedron at 33 is the truncated icosahedron (the
soccer ball), a dodecahedron at 50 the icosidodecahedron. On irregular or
jittered solids the cut points are generally not coplanar and the hull
approximates the cut with triangles — still convex, degrading gradually.
**Spike** (0–4, parent circumradius units) is the next skeleton operator:
one apex per face on the centroid ray at radius `t`. Schema 0 skips (it is
not “apex at the origin”). `t` above that face’s inradius is a pyramid;
`t` below (but > 0) is a dimple. Each n-gon becomes n triangles with no
coplanar merge — unmerged flanks are the wireframe openings. Mixed-face
solids share one spherical `t`, so pyramid height differs by family. After
the operator the mesh is renormalized to unit circumradius so Size still
means circumdiameter. Named stars (stella octangula, small stellated
dodecahedron, small triambic icosahedron, great stellated dodecahedron,
great dodecahedron dimple) are presets of a parent plus an exact `t`, not
new `BASE_IDS`. Smooth is inert when spiked: the halfspace inset of a
star is its convex hull. Rounding stays live but **ridge-only** — reflex
valleys skip the rolling-ball strip (the blend centre would sit on the
wrong side of the fold), so the points round and the gutters stay sharp.
Jitter stays on the convex
parent (before spike); surface jitter on a spiked mesh would flatten
parent verts and apexes onto the unit sphere.
**Subdivide** (0/1/2) is the next
skeleton operator: each level splits every face flat, in its own plane, so
mixed-face solids stay closed and level alone only adds resolution.
**Pattern** picks the polygon split: *Radial* (default) fans 2k triangles
per k-gon from the centroid (8 openings per cube side at level 1);
*Grid* cuts k corner quads (4 per cube side at level 1, 16 at level 2).
Triangles split 4:1 in both. Smooth requires Radial — its sphere clip
would bend Grid's flat quads out of plane, so under Grid the Smooth
control is inert and its value ignored. Smooth is also inert (value
ignored) when Spike is on. **Smooth** (0–100%) is a true edge
fillet: soften sets a rounding radius (that fraction of the parent
inradius) and every subdivided vertex projects onto the rounded parent
solid — the parent inset by the radius, Minkowski-expanded back by it.
Edges and corners round proportionally from the first step (including
inner-radius Catalan corners) while flat face interiors are exact fixed
points — overall dimensions hold, only sharpness melts (most pronounced
on cube and tetra). Above 50 a melt phase additionally clips the deeper
flats of mixed-plane-distance solids spherically toward the inscribed
ball, so 100 reaches the ball on every base.

Operation order is fixed and load-bearing: **jitter → truncate → spike →
subdivide → smooth**.
Jitter distorts the simple base form (plane perturbation on regulars, point
jitter before the hull on parametric bases), truncation cuts corners,
spike erects pyramids or dimples, subdivision adds resolution, and smooth
fillets convex edges. Running jitter after subdivision would perturb
families of near-coplanar sub-face planes, most of which stop binding —
silently discarding the subdivision and smoothing. Jitter after spike is
not offered: surface mode would snap every vertex to unit radius.

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
the minimum thickness; the actual range is reported. That uniform inner scale
requires origin-star-convexity, which is why Spike is legal and general
concave offset is not.

Openings use a centroid-scaled inset and tangent fillet. Fillet is authored as
a radius in millimetres; a face whose opening cannot fit the requested radius
clamps it locally, and the applied range is reported. Each face boundary is
subdivided globally so adjacent faces share identical points. The opening is
sampled on matching centroid rays, preserving the prototype's non-intersecting
annulus construction. Spike does not change this: openings still require
hollow, and each unmerged pyramid flank is one opening.

**Rounding** (`roundingMm`) is a separate Form parameter that softens every
hard edge of the model: quarter-circle roundovers on the opening lips (outer
face → opening wall, and the inner mirror) AND circular-arc strips along every
dihedral edge with sphere-patch fans at corners — a rounded cube is a die.
It never changes the opening outline in-plane or the flat face planes.
Default `0` keeps the hard construction byte-identical. Rounding applies to
every depth/face mode (dihedral edges always; rims when hollow+open). On a
spiked mesh only convex ridges and apexes take a radius; reflex valleys
stay sharp.

Subdivide seams that stay coplanar with their parent face are **not** rounding
features: Stage-2 follows the parent (macro) graph so a subdivided icosahedron
rounds the original 30 edges rather than leaving sharp midpoints on the 4:1
split, and the seams keep their edge sampling in each face's boundary ring so
the opening outline is byte-for-byte the same construction as without rounding.
Smooth can bend those parent groups out of plane; the resulting facets are then
independent dihedrals, except that a crease whose rolling-ball band would be
narrower than 0.1 % of the circumradius stays sharp (Smooth already rounded
it; a micrometre strip is degenerate in float32). An internal invariant
failure during rounding does not emit a corrupt mesh — the last valid preview
stays on screen.

Clamping is **proportional per feature**: each edge clamps to its own two
faces' local flat allowances (60% of the border band along that edge on open
faces, 45% of the centroid–edge distance on closed ones) and each rim to its
face's remaining flat and wall — one small feature never caps the whole
model. The applied range is reported as `metrics.roundingMm` {min,max}; the
slider ceiling is the LARGEST useful value, not the tightest limit. Hollow
depths mirror the rounding on the inner shell via the uniform inner scale.
Arc segment count tracks the quality preset via edge subdivision.

Mesh density is controlled by edge subdivision and fillet-arc sampling. A
user-facing quality preset (Milestone 4) may raise or lower those counts;
it must not introduce smooth shading that makes the preview diverge from the
exported triangle mesh. The viewer uses flat shading so preview ≡ STL.

Border width is authored as a **fraction of each face's apothem**
(`borderFraction`, shown as % in Form). That scales the frame with every
opening so subdiv, globe bands, and mixed face sizes stay valid without a
global hard-fail on the smallest face. Applied millimetre widths are reported
as a {min,max} range in status. Legacy **constant `borderMm`** remains valid
in hashes, projects, and headless export (`--border=`); exactly one spelling
is authoritative. Printability warnings fire when the thinnest applied border
falls below ≈2.5 mm.

Opening, border, applied-fillet, and applied-rounding measurements are retained
per face and aggregated for status reporting. Metrics must not assume that
faces with the same side count are congruent.

### Orientation

Clicking a face selects it as the resting face. The face's actual plane normal
is aligned with `-Z`, then the shape is translated until its minimum `Z` is
zero. Selection is stored as a skeleton face index; stale indices fall back to a
stable default with a warning. After Spike every skeleton face is a pyramid
flank, so click-to-rest sits on a pointy side; orientation stays valid.

### Model split (session-only)

Viewport **Split** is a print helper, not canonical state: it is never written
to the URL hash, project JSON, or `STATE_KEYS`. While Split is on:

- the control panel is locked (`inert`); the bottom bar stays live;
- Export STL downloads two bed-ready halves (`*_half-a.stl`, `*_half-b.stl`)
  with half B flipped cut-face-down;
- Export SVG still exports the unsplit model;
- Share / URL omit the split;
- regenerating the mesh, Undo/Back, or turning Split off clears the preview;
- a **reorient** button (⟳) beside the toggle cycles session-only axis
  alignments ranked by projected overhang of the bed-ready halves (45°
  self-support, area-weighted). Canonical rest is a candidate, not the
  default — a spiked solid sitting on a pyramid flank is often a poor
  split even when it seals. The construction axis, face axes, and vertex
  axes (including spike apexes) are considered, spread-capped so dense
  meshes cannot stall the HUD. Canonical state (faceIndex, URL, history)
  is untouched and the placement reverts when Split turns off; alignments
  that cannot seal are skipped. A relative support readout (mm², not
  grams) sits in the HUD so a reorient click is comparable. A cut-height
  control snaps to valid gaps only and is a seam/shape knob, not a print-
  quality ranking.

Orientation ranking is the printability pass (projected overhang of a
mid-band cut). Once a pose is chosen, the cut plane ranks by **bed
contact then seam**: larger cut area first, a natural seam (an edge
ring the plane can hug) as the tiebreak, then nearer mid-height. Seams
are an aesthetic preference when area is similar — they are not a trump
over a much larger cut. The HUD cut-height slider walks that plane list;
it is a seam/shape knob, not a second overhang ranking. Ranked planes
are tried until one seals; both halves are capped and must pass mesh
invariants. A failed plane or orientation leaves the last sealed preview
in place.

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
src/points/globe.js     lat/long globe (meridian Density)
src/points/cuboctahedron.js  cuboctahedron
src/points/rhombic.js   rhombic dodecahedron / triacontahedron
src/plane-perturb.js    plane-perturbation jitter (regular bases)
src/subdivide.js        spherified surface subdivision (skeleton operator)
src/solid/spike.js      face pyramids / dimples (origin-star-convex)
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

- **Shape:** base (start chooser, including named star presets), random
  density/seed, jitter, truncate, spike, subdivide, uniform scale.
- **Form:** solid/hollow, wall, openings, border, fillet, rounding.
- **Make:** orientation, mesh quality preset, preview overlay, material/mass,
  project export/load.
- **Viewport tools:** section plane, optional print-risk overlay, and session
  Split (see Model split above).

Fabrication dimensions and mesh stats live in the persistent status bar under
the view (not a separate Inspect group). Share lives next to Export STL/SVG.

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
- A slim app header shows the product title, version, a link to the source
  repository, and a help control that reopens first-visit onboarding.
- First-visit onboarding (native `<dialog>`) teaches the core loop: pick a
  start, adjust Shape/Form, click a face to set the resting side, export.
  A `localStorage` seen-flag suppresses automatic re-show; this is not
  session recovery.
- Panel controls prefer a single row (label, slider, editable value + unit)
  with collapsible groups; Start-from stays compact until expanded.
- A preview-only section plane may clip the model along bed height for
  inspection; it does not affect export.
- The plate grid carries millimetre labels on major lines; an in-view
  dimension callout complements Inspect and the status bar.
- Material density presets yield an approximate mass from compiled volume;
  density choice is a UI preference, not canonical geometry state.

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
