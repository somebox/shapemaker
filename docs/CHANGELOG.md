# Changelog

Notable changes to Shapemaker. Versions follow [semantic versioning](https://semver.org/).

While the project is pre-1.0 this file is kept deliberately light: the public
surface is still moving, and git history is the detailed record. From **1.0**
onward every release gets a full entry here, and breaking changes to the
[project format](PROJECT_FORMAT.md) get a migration note.

## [Unreleased]

### Added

- **Dual** — a new distort operator (Shape panel, between Jitter and
  Truncate). Polar reciprocation about the origin swaps faces and vertices:
  cube ↔ octahedron, dodecahedron ↔ icosahedron, icosidodecahedron → rhombic
  triacontahedron, and any triangulated base (sphere, twisted globe, random
  hull) → pentagon and hexagon cells. Dual faces are exactly planar on any
  parent, and a triangulation's dual is all three-valent corners, so a
  following Truncate cuts exactly. Canonical state key `dual` (default
  `false`); older hashes and projects load unchanged.
- **Ellipse openings** — a second opening style (Form → Opening). Each face
  opens with its largest inscribed oval: a circle on regular faces, the
  Steiner inellipse on triangles, the midpoint-tangent ellipse on rhombi.
  Border keeps its meaning (the oval sits inside the polygon inset, so every
  existing limit holds) and Fillet is inert. With Dual this is the ring-ball
  form. Canonical state key `openingStyle` (`polygon` | `ellipse`, default
  `polygon`); the polygon path is byte-identical to before.
- **Rhombic enneacontahedron** base ("Rhomb 90"): the zonohedron of the ten
  icosahedral three-fold axes — 90 equal-edged rhombi (60 broad, 30 slim) in
  ten belts, 92 vertices, built directly as a zonotope.
- **Twisted globe** base ("Twist"): the lat/long globe with alternate rings
  rotated half a meridian step, so every band is an antiprism of triangles.
  Density sets meridians (6–24); the start opens at 16.
- **Ring ball** and **Ring lantern** presets (dual + ellipse on the sphere
  and the twisted globe). The preset strip heading is now "Presets".
- Acceptance matrix covers 15 bases and the ring-ball family (105 STLs).

### Fixed

- A skeleton operator refusing the edit-time limits probe (a folding Spike,
  a parent with no clean dual) is reported as a validation message instead
  of escaping the edit as an uncaught error.

## [0.13.0] — 2026-09-13

### Added

- **Rhombicosidodecahedron** (Archimedean): 12 pentagons + 30 squares +
  20 triangles on 60 circumsphere vertices, 120 equal edges (vertex figure
  3.4.4.5). A `regular` base like the cuboctahedron, so Edge↔Size and
  plane-perturb jitter apply; it rests pentagon-down by default and shares
  the icosidodecahedron's axes. Acceptance matrix covers 13 bases (91 STLs).

## [0.12.1] — 2026-09-04

### Changed

- **Rounding follows the parent form under Smooth.** Subdivision children
  of one parent face stay one macro face even after Smooth bends them, so
  Form Rounding fillets the parent edges (now bent chains, mitred at each
  subdivision knee by averaging the two strip columns) instead of every
  sub-facet crease. Under Smooth this removes the per-vertex caps and
  hair-width strips of 0.12.0 (dodecahedron subdiv 1: 75 k triangles
  instead of 94 k, caps only at the 20 true corners) and restores exact
  symmetry. The width floor remains as a safety net.
- **Rim lips are true fillets.** The opening wall follows the origin ray,
  so on an off-axis sub-face it is not perpendicular to the face; the lip
  arc is now the rolling-ball fillet between the face plane and the actual
  wall (radius r, tangent to both, `lipArc`), and the per-face rounding
  clamp uses the real tangent lengths. On-axis lips are unchanged.

## [0.12.0] — 2026-09-04

### Changed

- **Typed values validate as you type and commit on Enter/blur.** A value
  box that is empty, non-numeric, or outside the control's live limits is
  highlighted with a bounds hint instead of being pushed into the model;
  Escape (or leaving the field invalid) reverts, Enter or leaving it valid
  commits. Arrow keys still step live.
- **Slider drags recompile on a budget.** Live recompiles are throttled to
  1.5× the last measured compile time (50–350 ms) and always catch up when
  the pointer pauses; heavy configurations compile only on the pause.
  Release commits as before.
- **Jitter is a collapsible cluster** (folded by default, state remembered)
  whose header shows the current amount and direction.
- **Stable panel layout while editing:** the value column has a fixed
  width so swapping readout↔editor or growing from 1 to 100 never resizes
  the slider track under the pointer.
- `scripts/dev-server.py` serves the project root with `Cache-Control:
  no-store`, so edited modules load on reload instead of the browser's
  heuristic cache.

### Fixed

- **Rounding on subdivided meshes flattened the openings.** Stage-2 face
  rings carried only the two endpoints of each internal seam, so a
  subdivided face's fillet was radially sampled on 3–7 rays — bare
  triangles and chords instead of arcs, and volume *rose* with rounding.
  Seams now keep their edge sampling; the opening outline no longer
  changes with Rounding.
- **Smooth + Rounding threw at low Smooth values** ("Failed to generate").
  Smooth 2 % leaves 0.1–0.3° creases whose rolling-ball strips are
  micrometres wide; those strips and corner caps collapsed to zero area in
  float32. Creases whose band would be narrower than 0.1 % of the
  circumradius now stay sharp; corners mixing sharp and rounded edges cap
  as separate flat wedges, and a parent edge that Smooth bent at its
  midpoint gets a mitre ribbon between the two strips instead of a
  sliver cap.

## [0.11.0] — 2026-08-17

### Added

- **Spike** (`spike`, Shape 0–4): pyramid (or dimple) on every face after
  truncate, before subdivide. Apex sits on the centroid ray at radius `t`
  (parent circumradius = 1); schema 0 skips. One triangle per side, no
  coplanar merge, then renormalize so Size still means circumdiameter.
  Origin-star-convex certificate (`assertStarShaped`); Smooth is inert when
  spiked. Rounding stays live but ridge-only (points round, valleys stay
  sharp). Additive default 0 — old hashes and projects
  normalize unchanged. Named stars are presets (stella octangula, small
  stellated dodecahedron, small triambic icosahedron, great stellated
  dodecahedron, great dodecahedron dimple), not new bases. Acceptance
  matrix: 87 STLs.

### Changed

- **Split ranking is printability, not seam size.** Enabling Split scores
  orientations by projected overhang of a mid-band cut and picks the
  best that seals — the canonical resting face is a candidate, not the
  default. Once a pose is chosen, planes rank by larger cut area, then
  seam, then nearer mid. The HUD shows a relative support readout per
  half; reorient cycles the ranked list; a cut-height slider snaps to
  valid gaps only (shape, not a second overhang ranking).

## [0.10.0] — 2026-08-04

### Added

- **Truncate** (`truncate`, Shape 0–50%): vertex-truncation skeleton
  operator — edge points at t/1−t re-hulled with coplanar merge, unit
  circumradius restored. Cube at 50 = cuboctahedron, icosahedron at 33 =
  the soccer ball, dodecahedron at 50 = icosidodecahedron; composes with
  jitter, subdivide (both patterns), smooth, rounding, and split. Additive
  default 0 — old hashes and projects normalize unchanged. Acceptance
  matrix: 75 STLs (+ the soccer ball).

### Changed

- **Smooth melt phase**: above soften 50 the remaining deep flats of
  mixed-plane-distance solids (icosidodeca, Catalans) clip spherically
  toward the inscribed ball, so soften 100 reaches the ball on every base
  (previously the fillet capped at the shallowest plane and deep faces
  survived as flats). A no-op on uniform solids and below 50 — the fillet
  regime and cube anchors are untouched.

### Fixed

- **Rounding on subdivided meshes**: Stage-2 follows the parent-face graph
  instead of treating coplanar 4:1 seams as zero-radius edges. Icosahedron /
  tetrahedron / octahedron with Subdivide Once or Twice now round the original
  dihedrals (watertight, midpoints leave the sharp parent edges). Tiny
  rounding values below a scale-aware floor are a no-op instead of minting
  degenerate triangles; an internal generate failure keeps the last valid
  preview and names the error.

## [0.9.0] — 2026-08-03

### Added

- **Subdivide Pattern** (`subdivStyle`): *Radial* (default, the previous
  behavior — centroid fans, 8 openings per cube side at Once) or *Grid*
  (corner quads — 4 per cube side at Once, 16 at Twice). Triangles split
  4:1 in both. Smooth is a Radial-only companion (the sphere clip would
  bend Grid's flat quads out of plane): inert and ignored under Grid.
  Additive default — old hashes and projects normalize unchanged.

### Changed

- **Smooth is a true edge fillet**: soften sets a rounding radius (fraction
  of the parent inradius) and vertices project onto the rounded parent
  solid (inset + Minkowski expand). Edges and corners round from the first
  step — the old sphere clip left a cube's edges at 90° until soften ≈ 0.7
  and made two-radius Catalan creases SHARPER; both fixed. Cube corners
  follow the identical trajectory as before, so shared cubes look the same.
- **Split on dense meshes**: candidate planes are banded (a subdivided
  globe could get a cut at 96% height when no mid gap cleared the vertex
  clearance) with tighter clearance tiers, and enabling split falls back
  through the ranked axis alignments when the canonical resting orientation
  has no valid cut.
- **Border is relative by default** (`borderFraction`, Form %): scales with
  each face so subdiv/globe/mixed openings no longer hard-fail on the
  smallest strut. Applied mm range stays in the status strip. Constant
  `borderMm` remains valid for legacy links, projects, and `--border=`
  acceptance fits. Default fraction `0.36` ≈ the old 3.2 mm on the
  smallest icosidodeca face; parity fixtures still pass `borderMm: 3.2`.

### Fixed

- Pattern switches re-run wall/border adaptation (same as Subdivide itself),
  so Grid→Radial no longer leaves an oversized border invalid.
- Rounding slider ceiling under Subdivide uses the pre-subdivision solid
  (same rescue as Fillet) — both soft-clamp per feature in the shell.

## [0.8.0] — 2026-08-02

Stage-1 rim rounding plus a session-only model split for bed-ready STL halves.

### Added

- **Rounding** (`roundingMm`, Form): true rolling-ball fillets on opening
  rims (outer and inner lips) AND on every dihedral edge and corner, with
  `roundingMm` as the physical radius — circular-arc strips on the tangent
  cylinder of each edge (tangency band `r·cot(ω/2)`), corner caps sampled
  from the envelope of the corner's tangent sphere and those cylinders
  (a rounded cube is a die; platonic solids verify against the Minkowski
  ideal to 1e-14 mm). Applies to every depth/face mode; default `0` is a
  byte-identical no-op. **Proportional per-feature clamping**: each edge
  and rim clamps to its own faces' local allowances, so one small feature
  never caps the whole model; `metrics.roundingMm` reports the applied
  {min,max}. The slider ceiling is the largest useful value.
- **Split** (viewport HUD, session-only): cut plane prefers **natural
  seams** (z levels where a skeleton edge ring lies — the cuboctahedron's
  girdle, the rhombic equators), else the minimal-material-cut plane near
  mid-height; ranked candidates are tried until one seals. Preview with
  half A lifted, panel locked while on; a **reorient** button (⟳) cycles
  session-only axis alignments ranked by seam quality — construction axis
  (globe poles, the Sphere's lattice axis), face and vertex axes — without
  touching canonical state. One Export STL click downloads
  `${stem}_half-a.stl` and `${stem}_half-b.stl` (B flipped cut-face-down).
  Not in URL/state; regenerate and Back clear it. SVG stays unsplit.
- Headless `export-stl.mjs --split` writes the same two halves (same seam
  preference as the app).

### Changed

- Acceptance matrix: 74 STLs (65 + 3 rounding + 6 split halves).

## [0.7.0] — 2026-08-02

Four new convex bases via point generators and registry wiring only.

### Added

- **Cuboctahedron** (Archimedean): 8 triangles + 6 squares, all verts on the
  circumsphere.
- **Rhombic dodecahedron** and **rhombic triacontahedron** (Catalan): first
  bases whose vertices sit at two radii. Edge-transitive, so Edge↔Size and
  plane-perturb jitter behave like other `regular` solids.
- **Globe**: latitude/longitude point cloud. Density is meridian count
  (clamped 6–36); coplanar merge yields true lat/long band quads and pole
  triangle fans. Form pack uses a tight border (1 mm) for the small near-pole
  faces.

### Changed

- Acceptance matrix covers 12 bases (65 STLs).
- Export filenames tag `_p{points}` for every parametric base (including globe),
  and `_s{seed}` whenever the base is marked `seeded` (random) or jitter is on.
- Density slider follows each base's `pointsRange` (globe 6–36); out-of-range
  Density from hashes/projects is clamped on normalize so state matches the mesh.

## [0.6.0] — 2026-08-02

Milestone 6 remainder: section plane, scale legibility, material/mass estimate,
and print-risk overlay gated off by default.

### Added

- Preview-only **section plane** (viewport HUD, off by default): Three.js
  clipping along bed height to inspect cavities — DoubleSide walls plus an
  opaque fill cap so cuts read as cross-sections, clipping fully disabled
  until Section is engaged. Export unchanged.
- **Scale legibility**: labeled build plate and an in-view dimension callout
  over the canvas.
- **Material density presets** (PLA / PETG / ABS / TPU / Nylon) with an
  estimated mass readout (volume × density; not canonical geometry).
- **Share popover** and project JSON Export/Load actions.

### Changed

- Print-risk overlays are optional and **off by default** (viewport toggle),
  matching the SPEC “not the default appearance” rule.
- Range values show as a click-to-edit readout; seed lives under the Jitter
  cluster with a reroll glyph (↻).
- Start chooser is bases-only (Prototype TPU / Solid Dodecahedron presets
  retired); the whole header row toggles it, and picking a shape applies and
  closes. Inspect readouts merged into the status strip and Make.

### Fixed

- Wall and border slider ceilings come from the skeleton the shell actually
  solidifies; only the fillet ceiling uses the pre-subdivision solid (safe
  because the shell clamps fillet per-face). A subdivided cube could
  otherwise be offered a border the solidifier rejects.
- Onboarding never auto-opens over a shared link — the visitor came to see a
  specific shape; the header “?” still offers the tour.
- Removed major-grid mm sprites that read as grey haze / lens flare.

## [0.5.0] — 2026-08-01

Panel ergonomics: denser controls, testable control module, export hygiene.

### Added

- `src/controls.js` — pure display helpers + schema-driven control builders
  with unit tests; heavy-compile / session / history policy coverage expanded.
- One-row range controls (label · slider · editable value+unit), taller hit
  targets, label scrubbing (same commit-on-release heavy policy).
- Collapsible Shape/Form/Inspect/Make groups with remembered open state
  (`localStorage`).
- Compact Start-from strip (horizontal scroll); expand via the Start header.

### Changed

- Shared `downloadBlob` helper; Export STL/SVG reuse the last successful
  compile so the download matches the on-screen mesh.

## [0.4.1] — 2026-08-01

Usability chrome: app header and first-visit onboarding.

### Added

- Slim app header with title, version, GitHub link, and a “?” help control.
- First-visit onboarding modal (native `<dialog>`) teaching the core loop —
  pick a start, adjust, click a face to rest, export — gated by a
  `localStorage` seen-flag (the app’s first persistent local state; not
  session recovery). Reopen from the header “?”.

### Changed

- Version display moved from the panel foot into the header.

## [0.4.0] — 2026-08-01

Milestone 5 close-out (distort and invent) plus the first Milestone 6 share
slice: hardened irregular acceptance, locked millimetre borders, session UX
polish, unit-aware SVG export, and print-risk overlays.

### Added

- **Sphere base** (`src/points/sphere.js`): deterministic fibonacci-lattice
  points; density sets how faceted the sphere is, seed only matters under
  jitter. Appears in the start chooser with its own wireframe thumbnail;
  Form pack matches the random hull (border 1, fillet 1.5).
- **Subdivide** (`src/subdivide.js`): spherified surface subdivision, levels
  0/1/2, canonical `subdiv` key. Triangles split 4:1, polygons fan over
  midpoint-split edges (mixed-face solids stay closed); new vertices land on
  the circumsphere. Applied after jitter (order is jitter → subdivide →
  smooth) so subdivision resolves the already-distorted solid.
- **Jitter Direction** (surface / radial / both): radial randomizes the
  center-to-surface distance — point radii on parametric bases (swallowed
  points vanish gradually, cloud renormalized to keep Size honest), plane
  offsets on regulars. All modes share one random sequence per seed.
- **Smooth** (0–100%) on subdivision: an outer-edge fillet by sphere clip —
  corners and edges round onto a shrinking sphere while flat face interiors
  keep their planes, so overall dimensions hold (a smoothed cube is a die,
  not a scaled balloon). 100 reaches the inscribed ball. Subdivision itself
  splits flat, so level alone only adds opening resolution. Sliver faces
  produced by extreme perturbation drop their hole fillet per-face instead
  of failing to compile.
- **SVG export** (`src/export/svg.js`): a clean hidden-line drawing of the
  mesh from the live viewer camera — perspective projection, only the
  visible silhouette and crease segments (no occlusion masks, no scale
  annotations); Export SVG sits beside Export STL.
- **Print-risk overlays**: near-horizontal bridge edges and overhang faces
  computed with the other placed metrics (`src/metrics.js`, exposed as
  `metrics.printRisk`), drawn in the viewer. Bed-contact geometry is
  supported by the plate and never flagged.
- M5 acceptance extremes and a cheap compile matrix
  (`scripts/acceptance.sh` 49 STLs; `test/m5-matrix.test.js`).

### Changed

- Operation order fixed and documented as **jitter → subdivide → smooth**:
  jitter distorts the simple base form, subdivision adds resolution to it,
  smooth fillets its edges. Previously plane perturbation ran after
  subdivision, where the near-coplanar sub-face planes it perturbed mostly
  stopped binding — turning on jitter silently discarded subdivision and
  smoothing.
- Millimetre borders retained after irregular-hull evidence
  (`docs/BORDER_EVIDENCE.md`); adaptation warnings add printability guidance
  when a clamped border lands below ~2.5 mm.
- Session Undo restores project name and clean baseline via `history.state`
  (hash still carries authoring geometry only).
- Form Wall / Border / Fillet use `inertWhen` (dim) instead of hiding.
- Copy Link reports success or failure on the button (no silent failure).
- Headless export accepts `--subdiv`, `--soften`, and `--jitter-mode`.
- Camera framing fits the bounding sphere instead of the box max-dimension,
  so a cube no longer renders far larger than round solids of the same
  circumdiameter.
- Persistent status bar under the view: dimension/mesh stats, the busy
  badge, and Export STL moved out of the panel; the panel itself is more
  compact (less vertical scrolling).
- Removed retired UI machinery: density chip levels and the unused select
  control path.
- Border clamping can no longer strand the session at 0 mm: adaptation
  clamps with sub-0.1 mm precision instead of flooring to zero, heals a
  non-positive border on the next edit of any kind, and the wall/border/
  fillet slider ranges auto-adjust their minimums when tiny faces push the
  ceiling below the default floor.
- The busy badge covers the whole heavy edit: cost is predicted before the
  adaptation probe (doubled for reshape edits, which pay probe + compile),
  so the badge paints before any blocking work instead of after the probe.
- Interactive-performance policy (`src/perf.js`): compiles are timed; above
  a 100 ms threshold sliders switch to commit-on-release (the number readout
  stays live during the drag) and a busy badge is painted before the
  blocking compile starts. Subdivision clicks are predicted heavy from the
  projected face count, and deferred runs launch via rAF with a timeout
  backstop so hidden tabs never hang.
- Session model: Base and named presets hard-reset the full recipe (start-from);
  Browse / Edit chrome; no confirm when switching starts; Undo gated to
  same-document history.
- Start-from chooser: built-in point packs and named presets appear as
  thumbnail cards (SVG wireframes projected from each start's skeleton);
  Shape no longer has a Base dropdown (starts load points to modify).
- Jitter allowed on every base, always visible, soft amplitude; density/seed
  dim when inert; no camera reframe on jitter/seed-only edits.
- Density is a direct point-count slider (4–60 pts) for parametric bases;
  separation derives from the count (retired Sparse/Medium/Dense anchors
  preserved at 12/24/48). Jitter range extended to 0–50%; at extreme
  amplitudes on regular bases a fully-cut face vanishes gracefully instead
  of failing the compile.
- Plane-perturbation jitter on regular bases (`src/plane-perturb.js`): face
  planes tilt/offset and vertices rebuild via the dual hull, so faces stay
  planar convex polygons — a jittered cube is six wobbly quads and the
  icosidodecahedron keeps its 32 faces. High-valence vertices split into
  short edges that grow gradually from zero. The random base keeps on-sphere
  point jitter (already triangulated).
- Fillets hold under jitter: the 2D opening path collapses vertex-split micro
  edges before filleting (arc rounds across the virtual corner) and the face
  frame origin is the polygon *area* centroid, immune to split-vertex ring
  multiplicity. Previously the first jitter step clamped a face's fillet and
  the fillet slider ceiling to ~1.5× a micro edge (≈0.01 mm).
- Binding docs updated for browse→edit, jitter scope, and refactor backlog
  (`SPEC.md`, `ROADMAP.md`).

### Notes

- Mesh quality / tessellation presets (Draft / Normal / Fine → `edgeDiv`
  4/10/20) are shipped and verified — Milestone 4 exit criteria met.
- Milestone 5 exit criteria met; separate jitter seed and amplitude
  calibration stay Later. User presets (“Yours”) stay Later. M6 mass /
  material-density presets remain open.

## [0.3.0] — 2026-07-31

Milestone 3: change the family. Regular Platonic bases and the icosidodecahedron
share one hull → merge → face-identity → shell pipeline.

### Added

- Vendored QuickHull (`vendor/quickhull3d/`) behind `src/hull.js` with adjacency
  coplanar merge, named tolerances, and deterministic face identity.
- `assertSkeleton()` at the hull boundary in production.
- Normalized point generators for five Platonic solids + icosidodecahedron;
  flat `BASES` registry; pipeline caches points / hull / solid (size changes
  do not re-run QuickHull).
- Combinatorial `icosidodecahedronDirect()` kept as geometric oracle; production
  uses the hull path and still hits the v0.2 reference volume / triangle count.
- Base-change adaptation (`adaptStateForBase`) with one-line warning; resting
  face resets; wall/border clamp only when invalid; fillet never auto-clamped.
- Compact face stepper (family + k of N); screen-space edge pick threshold.
- Versioned `presets.json` (Prototype TPU + Solid Dodecahedron) applied through
  the project-open path.
- Acceptance matrix: 6 bases × 3 shell combos + 6 stress opens = 24 STLs.

### Changed

- Face sort is sides-ascending first (triangles then pentagons on the
  icosidodecahedron). Saved `faceIndex` values from v0.2 may rest on a different
  face within the same family after upgrade — no migration (changelog note only).
- Default resting face is max area (then most sides).
- Export filenames use `${base}_${size}mm.stl`.

## [0.2.0] — 2026-07-30

Milestone 2: measure, save, and continue. The Phase 1 demonstration becomes a
design tool with a live parameter panel, project files, URL state, and edge
inspection.

### Added

- Instrument-style Shape / Form / Inspect / Make panel driving `compile()` live
  (size, shell, wall, openings, border, fillet) with dynamic slider limits.
- Vendored Archivo + IBM Plex Mono fonts; title-block group headers, caliper
  sliders, panel-bottom dimension strip.
- `metrics.limits` — proactive wall / border / fillet ceilings from the skeleton.
- `schema.js` canonical codec (`normalizeState` / `serializeState`) shared by
  projects, URL hash, and dirty tracking.
- `.shapemaker.json` Save / Open (project format v1) with round-trip tests.
- Versioned URL hash, replace-on-drag / push-on-commit history, Copy Link.
- Skeleton edge hover/select with exact length in Inspect.
- Mean edge length as a linked uniform-scale input for the regular base.

### Changed

- Canonical authoring state no longer includes `borderFraction` (millimetres
  only). The solidifier still accepts a fraction for tests and legacy partials.
- Copy Link moved from the Milestone 5 list into Milestone 2 (with URL state).
- Local session recovery and File System Access API remain out of scope.

### Verified

- Project fixtures: load minimal/full v1, refuse unsupported v99, save-load
  canonical state.
- Hash codec round-trip and equal-state ⇒ equal-hash.
- Existing geometry parity and acceptance suite still pass.

## [0.1.0] — 2026-07-30

First working milestone. The Python prototype's shell construction is ported
to a static browser app and validated against the original.

### Added

- `compile(state)` — the single regeneration API shared by the UI, exports,
  and tests. Runs headless; no geometry module imports Three.js.
- Icosidodecahedron frame at the prototype's defaults, resting on a face,
  with an orbiting camera on a millimetre build plate.
- Binary STL export in millimetres, oriented to the chosen resting face.
- Structured validation: invalid input returns messages naming the parameter
  at fault rather than throwing or producing a broken mesh.
- Shape-agnostic `skeleton.js` and `faceframe.js`, so later shape families do
  not require changes to the solidifier.
- Continuous integration: unit and parity tests, deployment path rules, and
  mesh acceptance against the Python reference.

### Verified

- Parity with the prototype at default settings: 7,200 triangles,
  16.150 cm³, pentagon-down height 85.07 mm.
- Eight exported meshes pass watertightness, winding, degeneracy, volume, and
  self-intersection checks.

[Unreleased]: https://github.com/somebox/shapemaker/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/somebox/shapemaker/releases/tag/v0.2.0
[0.1.0]: https://github.com/somebox/shapemaker/releases/tag/v0.1.0
