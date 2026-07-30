# Shapemaker — spec

A browser app for designing printable 3D shapes interactively: pick a base
shape, tweak it with sliders, examine it resting on a build plate, export STL
(or an SVG projection). Successor to the Python prototype in `prototype/`.

Main use cases: 3D printing and art projects. Creative range comes from a few
levers that recombine — generators × density × jitter × lace × seed × resting
face × presets — not from a growing modeling language.

## The contract (law — everything else is illustration)

```ts
compile(state) → { skeleton, mesh, metrics, validation, orientation }
Skeleton    { positions: Float64Array, faces: number[][], edges: [i,j][] }   // convex
Mesh        { positions: Float32Array, indices: Uint32Array, faceId: Uint32Array }
orientation { faceIndex, matrix }   // applied at draw + export, computed once
```

- `compile` is the **only** regeneration API; UI, hash, exports, tests call it.
- Dependency rule: `points → hull → skeleton → solid → mesh`; viewer/ui
  consume outputs only; **no geometry module imports Three.js**.
- Schema is the single source of truth for defaults, bounds, visibility, and
  the hash codec.
- v1 excludes: operators UI, opening styles beyond inset+fillet, struts,
  concave shapes, scored orientation, 3D edge fillets (see Non-goals).

## Goals

- **Interactive design.** Sliders drive live regeneration; export is a
  separate, explicit step.
- **Printing-aware preview.** The shape is a static object resting on a base
  plane; the *camera* moves, the model never spins freely. The user picks the
  resting face by clicking it. Overhang risk and near-horizontal edges can be
  overlaid (approximate, honestly labeled).
- **Print-ready export.** Binary STL that slices cleanly: watertight,
  consistent winding, no self-intersections. Plus SVG projection (current
  camera) for art / documentation.
- **Real units.** Every length, readout, and export is millimetres. STL drops
  into a slicer at true size.
- **Reproducible, with undo.** Full state lives in the URL hash with a
  canonical, versioned encoding (`#v1:…`, stable key order, fixed precision —
  equal shapes give equal URLs). Committed changes (slider release, not drag
  ticks) push history entries: browser back/forward, ⟲/⟳ buttons, Ctrl+Z all
  restore full state. A copy-link button makes sharing explicit. Canonical
  equality is the history gate: if the encoded hash is unchanged, nothing is
  pushed (no-op compiles and preset re-clicks don't spam history).
- **Starting points, not blank canvas.** 6–10 named presets (full state
  recipes, stored as data in `presets.json`) — living documentation of good
  parameter ranges. They arrive with M3, alongside the first alternative base
  that makes a *choice* of starting point meaningful; M1 hardcodes the
  prototype defaults in `types.js`.
  Presets carry a material density so the ~grams readout is meaningful
  without a materials system. A preset chip shows an "edited" state once the
  user diverges; clicking it again resets to the preset. First load opens on
  the prototype icosidodecahedron frame at its proven defaults, resting on a
  face — the emotional object, not a debug cube.
- **Protect the default object.** Product razor for every future change: it
  should make "Prototype TPU" look better or clearer — or make spinning a
  seed into lace more fun. If it does neither, it waits.
- **Zero-install.** Static site — GitHub Pages or `python3 -m http.server`.
  No build step, no backend, all dependencies vendored.

## Non-goals (v1)

- General CAD / boolean modeling; concave shapes (pipeline guarantees convex).
- Slicing or scored orientation (`bridges.py` stays the offline ground truth);
  no synthetic printability score a user might trust over their slicer.
- **Skeleton operators UI** (truncate/subdivide) and **opening styles beyond
  inset+fillet** — the seams exist (below) but get no v1 chrome. One hole
  language done superbly beats three shallow ones.
- **Struts solidifier** — v1.1; the frame shell already gives the
  strut-network look ("frame shells on random hulls *are* space frames").
- True 3D dihedral-edge fillets — never; truncate/subdivide (v1.1) cover the
  aesthetic without breaking construction guarantees.
- Escape holes for hollow closed shells (resin drainage) — documented only.
- Mobile-first UI.

## The pipeline

Internally a chain of pure stages — pure by convention: outputs are *treated
as immutable* and never mutated after a stage returns, but typed-array buffers
are not literally frozen (freezing them would cost defensive copies for no
practical gain). **Users see only two forms of the object**:

| form | what it is | who consumes it |
|---|---|---|
| **Polyhedron** (`Skeleton`) | convex V/E/F + metrics | wireframe, SVG, edge stats, orient |
| **Solid** (`Mesh`) | triangles + `faceId` | preview, overhang shading, STL |

Stage vocabulary stays in `pipeline.js`, never in the UI.

```
 base points → jitter → hull → skeleton → shell → orient → export
```

1. **Base points** — on a sphere of circumradius r: platonic solids
   (tetra/cube/octa/dodeca/icosa), icosidodecahedron (default), or
   random-on-sphere (N points, seeded PRNG, Poisson-disk-style min
   separation). Seed is visible and editable; reroll is a button. N defaults
   to 24, max ~60 until preview LOD cost is measured (hollow + openings
   multiplies triangles fast).
2. **Jitter** — seeded displacement along the sphere surface, **expressed as
   % of circumradius** (0–20 %) — mean edge length isn't known until after
   the hull, so it cannot be the unit without a hidden pre-pass. On-sphere
   jitter keeps every point extreme, so all N points survive as hull
   vertices. **One seed** drives both random placement and jitter (decided:
   simpler state and URLs; a separate jitter seed is a v1.1 option defaulting
   to `seed`).
3. **Hull** — quickhull + coplanar-facet merge with size-relative tolerance
   (`~1e-7 × circumradius`), so a dodecahedron keeps 12 pentagons and a
   jittered cube doesn't shatter. **Merge caution:** near-regular jitter
   produces near-coplanar facets; a generous epsilon can silently over-merge
   and flip topology mid-drag. Full merge applies only at jitter = 0; once
   jitter > ε the tolerance tightens so intended small facets survive.
4. **Skeleton** — the hub. Size = **circumdiameter in mm**, one underlying
   param. Edge lengths are a readout (min/mean/max); for regular bases an
   edge-length field is a second *view* of the same key — editing either
   writes the one size param through the exact bijection (kept deliberately:
   cheap, unambiguous, repeatedly requested). **When jitter > 0 or the base
   is random, the edge field turns read-only** — the bijection is gone, and
   two writable size sources would be a dual-source bug.
5. **Shell** — depth and openings, with one restriction: **openings require a
   hollow shell in v1.** The annulus closes against the inner surface, so a
   solid body with through-holes is a different construction (v1.1). The three
   supported combinations are solid+closed, hollow+closed, hollow+open.
   - **Depth**: *solid*, or *hollow* with wall thickness in mm
     (uniform-scale inner shell, all vertices shared, trivially watertight;
     thickness = minimum wall, actual min–max reported).
   - **Openings**: *closed*, or a hole per face — the face inset, corners
     filleted (`fillet_polygon` port: radius auto-clamps, border exact at
     edge midpoints). **Border is authored as a fraction of face apothem**
     (0–0.45) so one slider stays meaningful across sizes, jitter, and
     irregular hulls where a single mm value would seal small faces while
     starving large ones; the resulting **mm range is always shown** (and
     "≈ n lines @ 0.4 mm nozzle"), with a warning when the minimum drops
     below printable. Fillet in mm, auto-clamped per face. Known residual:
     on highly irregular hulls one fraction still yields visibly uneven lace
     weight — accepted for v1 (it's honest); presets stick to mild jitter,
     and per-face border is deliberately not invented.
6. **Orient** — computed **once, in compile, from the skeleton**:
   `orientation = { faceIndex, matrix }` (face normal → −Z, z_min = 0).
   Skeleton and mesh positions stay unoriented; the matrix is applied at
   draw time and at export — one transform, applied in two places, never
   computed in two places. The viewer only *emits* `faceIndex` (raycast
   picking); hash restoration reproduces the pose without a WebGL context.
7. **Export** — explicit: binary STL (mm, oriented via the matrix);
   filename `«shape»_«size»mm.stl`, with the seed included when the shape
   depends on one (`lace_s1337_100mm.stl`) so files are reproducible without
   the URL. SVG of skeleton edges from the current camera.

## Extension seams (v1.1 — in the text, out of the chrome)

- **OpeningGenerator interface from day one, one implementation**
  (`insetFillet`). The annulus construction needs only a star-shaped-about-
  centroid hole inside the face, so *circle* and *mirror* (180°-rotated face
  copy) become drop-in 2D generators later — no solidifier changes.
- **Skeleton operators** (`Skeleton → Skeleton`, convexity-preserving):
  *truncate(t)* — progressive gem cutting from any base (icosahedron at the
  classic depth = soccer ball); *subdivide(ν)* with a *spherify blend (0–1)*
  — blend 1 is geodesic spheres / shape smoothing, blend 0 tessellates the
  existing form with a finer face grid (unprojected sub-vertices bypass
  re-hulling); *dual* — faces ↔ vertices, the route to hexagon-dominant
  Goldberg spheres ("sphere with hex holes"; topology always keeps 12
  pentagons). Applied once each in fixed order; **no operator stack**
  (decided). Smoothing lives in the skeleton, never as post-hoc mesh
  relaxation.
- **Struts** — round beams + node joints, via manifold-3d (WASM) or convex
  node hulls, not a hand-rolled boolean.

## What the prototype provides (review)

**`icosidodecahedron.py` — the geometry ports to JS**, as pure, testable
nuggets: `fillet_polygon` (tangent-arc rounding, radius auto-clamped, border
preserved — already general over convex polygons); `radial_sample` (centroid
ray-cast, the core of the can't-self-intersect construction, valid for all
convex faces); `edge_params` (reversal-symmetric subdivision — shared-edge
faces emit identical points); uniform-scale inner shell. Its ConvexHull face
recovery is our hull→skeleton stage. **Not ported:** numpy/trimesh
scaffolding (winding correct by construction, no repair pass),
`LOW_BRIDGE_AXIS`, orientation search.

**`meshcheck.py` — stays Python, is the acceptance suite.** Möller–Trumbore
self-intersection scan; its lesson (topology ≠ geometry: watertight meshes
can have 1500+ crossing triangle pairs) gates every solidifier change via a
test script over exported STLs (defaults, extremes, jitter seeds).

**`bridges.py` — stays Python, ground truth for orientation.** The app shows
only the honest geometric proxy.

## Tech

| area | pick | why |
|---|---|---|
| Rendering | Three.js vendored ESM; `OrbitControls`, `Raycaster` | don't write camera math or picking |
| Hull | vendored small quickhull (e.g. mauriciopoppe/quickhull3d), golden-tested vs scipy | hull isn't the differentiator; coplanar merge is our code |
| RNG | seedable `sfc32` | reproducible shapes from a URL |
| Vec math | thin own `vec3` module | testable geometry, no ad-hoc arrays |
| Triangulation | fan per face | faces are convex |
| Export | own binary STL + SVG writers | trivial formats, full control |
| Framework | none — vanilla ES2022 | a `state` object + `compile()` is enough |

## Architecture

```
`✓` exists today (M1). Everything else is planned — listed so the seams are
agreed before the code arrives, not to imply it is written.

```
index.html                         ✓
vendor/three/                      ✓  pinned ESM + LICENSE + provenance README
vendor/quickhull3d/                   M3
presets.json                          M3  named full-state recipes (data, not buttons)
src/
  main.js            ✓  adapter only: events → state → compile → viewer/ui
  compile.js         ✓  THE entrypoint → {skeleton, mesh, metrics, validation, orientation}
  pipeline.js        ✓  stage runner + per-stage cache (key = hash of stage params)
  validate.js        ✓  pure param checks + validationError() used by the stages
  types.js  vec3.js  ✓
  skeleton.js        ✓  edgeList, inradiusRange, assertSkeleton — shape-agnostic
  faceframe.js       ✓  toFaceFrame / fromFaceFrame — the face-local 2D boundary
  points/
    icosidodeca.js   ✓  combinatorial faces, no hull
    platonic.js         M3
    randomsphere.js     M4
  hull.js               M3  quickhull wrapper + coplanar merge → Skeleton
  geom/
    poly2.js         ✓  inset, fillet, radialSample   (pure 2D, heavily tested)
    edgesub.js       ✓  symmetric edge params + global stitch keys
    annulus.js       ✓  rings → quads → tris          (no Three, no schema)
  solid/shell.js     ✓  policy only: depth × OpeningGenerator → calls geom/*
  mesh.js            ✓  structural + manifold invariants, winding via volume sign
  orient.js          ✓  pure resting-face transform
  metrics.js         ✓  bbox, edge stats, wall/border/fillet ranges, per-face metrics
  export/stl.js      ✓        export/svg.js   M5
  viewer.js          ✓  scene, plate, orbit, face pick, setFocusFaces(ids)
  schema.js             M2  param definitions: keys, bounds, units, visibility
  hashcodec.js          M2  URL codec derived from schema + version prefix
  ui.js                 M2  schema-driven panel + presets strip + status
```

Rules that keep it honest:

- **`compile(state)` is the only regeneration API.** UI, hash parsing, export
  buttons, and tests all call it. If `main.js` ever branches on stages,
  modularity has leaked.
- **Schema is the single source of truth** for defaults, bounds, visibility,
  and the hash codec — sliders and URLs cannot drift apart.
- **`metrics` is computed once** in compile; viewer and UI never re-derive.
- **No geometry module imports Three.js** — the pipeline runs headless under
  `node --test`.
- **Correct by construction, not repair**: prototype invariants preserved as
  assertions; no `fix_normals` pass. No genus computation in-browser.
- **Validation as data**: `{ok, errors: [{stage, key, message, clampTo?,
  faceIds?}], warnings}`. `faceIds` feeds the viewer's generic
  `setFocusFaces()` highlight channel — the same one face-picking uses — so a
  violated constraint *shows* the limiting faces instead of only printing
  copy.
- **Preview ≠ export quality**: dragging may use coarse `edge_div` /skipped
  fillets (internal LOD, never a user toggle); Export regenerates at full
  quality through the same code.

## Deployment (verified, not assumed)

Static hosting only — no app server, no API, no WebSocket. But **ES modules
and import maps do not work from `file://`**; the app must be served over
HTTP(S): `python3 -m http.server` locally, GitHub Pages in production.

The trap: a Pages **project site** serves at `https://<user>.github.io/<repo>/`,
not at `/`. Anything absolute-rooted works locally and 404s in production.
Tested against a subpath-served tree (Chrome, local server):

| Import-map value | At `/` (local) | At `/shapemaker/` (Pages) |
|---|---|---|
| `"three": "./vendor/three/three.module.js"` | ✅ | ✅ resolves to `/shapemaker/vendor/…` |
| `"three": "/vendor/three/three.module.js"` | ✅ | ❌ **404, module never executes** |

Rules that follow:

- **Every path is `./`-relative** — import-map values, `<script src>`,
  `presets.json` fetches, assets. No leading `/` anywhere.
- Import-map values resolve against the **document base URL**, so a bare
  specifier used inside `src/viewer.js` still resolves to
  `«base»/vendor/…`, *not* relative to `src/`. Verified — nested modules and
  the trailing-slash prefix form (`"three/addons/": "./vendor/three/addons/"`)
  both work unchanged under a subpath.
- **Serve from the repo root** on the default branch (Pages offers root or
  `/docs`; our `index.html`, `src/`, `vendor/` are already root-level, so no
  `docs/` duplication).
- **Add `.nojekyll`** at the root. Pages runs Jekyll by default, which drops
  underscore-prefixed paths and excludes `node_modules` and `vendor/bundle|
  cache|gems|ruby`. Our `vendor/three/` would survive today, but the file
  costs nothing and removes the whole class of surprise.
- **Pages is case-sensitive; macOS usually isn't.** A wrong-case import
  passes locally and 404s in production — so the local dev command should
  reproduce the subpath: serve the *parent* directory and open
  `http://localhost:8000/shapemaker/`. That is exactly the Pages base path,
  and it catches both bugs before deploy.

## Testing

- **Numeric parity**: `poly2`/`edgesub`/`radial_sample` vs dumps from the
  Python originals.
- **Golden file / north-star demo**: icosidodecahedron at prototype defaults →
  triangle count, bbox, volume within ε of the reference STL.
- **Acceptance**: exported STLs (defaults, extremes, several seeds) →
  `prototype/meshcheck.py` reports zero self-intersections. The offline
  scripts are the oracle.
- **Properties**: convex faces ⇒ star-shaped openings; impossible params ⇒
  clean Validation, never a mesh.

## UI

Three blocks, not a stage stack. Canvas is the primary UI; the panel is
support.

```
┌────────────────────────────────────┬──────────────────────┐
│  [Prototype TPU][Solid gem][Lace…] │ SHAPE                │
│                                    │  base [icosidode ▾]  │
│         3D preview                 │  (N ──o 24  seed     │
│    object resting on grid          │   [1337] ⟳  sep ─o─) │
│                                    │  jitter o──── 0 %    │
│    click face  = rest on it        │  size ──o── 100 mm   │
│    hover face  = sides/apothem tip │   · edge 30.9 mm     │
│    dbl-click   = reset camera      │ FORM                 │
│    keys 1/2/3  = top/front/iso     │  depth [hollow ▾]    │
│                                    │  wall ─o── 1.4 mm    │
│                                    │  openings [on]       │
│                                    │  border ──o─ 0.28    │
│                                    │   · 3.2 mm ≈ 8 lines │
│                                    │  fillet ─o── 4.5 mm  │
│                                    │ MAKE                 │
│                                    │  rest: pentagon ▾ ◀▶ │
│                                    │  view [∅|hang|edges] │
│                                    │  [STL] [SVG] [⧉ link]│
├────────────────────────────────────┴──────────────────────┤
│ print  95×95×92 mm · wall 1.4–1.55 · longest flat 31 mm   │
│ mesh   12 480 tris · watertight ✓ · 16 cm³ · ~19 g TPU    │
└───────────────────────────────────────────────────────────┘
```

- **Canvas gestures**: click a face to rest on it (with a flash via
  `setFocusFaces`); hover shows side-count/apothem tooltip; double-click
  empty resets to ¾ view; keys 1/2/3 snap top/front/iso (feeds SVG and print
  reasoning). Picking resolves through `faceId` to a **skeleton face** —
  never a rim or chamfer triangle; assert this on lacy shells.
- **The plate grid is real mm** (10 mm squares, bolder line each 50 mm) —
  the cheapest possible way to sell true units.
- **Resting face picker**: grouped by face family (e.g. "pentagon (12) /
  triangle (20)"), not bare indices; ◀ ▶ stepper as accessibility backup.
- **Dynamic slider bounds beat error messages**: border/fillet/wall maxima
  are functions of the current skeleton (smallest apothem, min inradius) and
  move when base/jitter changes. Validation copy is the fallback, not the
  first line of defense.
- **Seed UX invites play**: visible editable seed, ⟳ reroll, copy-link
  button. Undo entries are labeled ("border 0.28 → 0.31"). Random shapes get
  **density chips** (sparse / medium / dense) that set N + separation
  together, so the two coupled knobs aren't the first thing a user meets.
- **Print overlays are tools, not the brand look**: one View menu
  (∅ / overhang / horizontal edges / both), threshold under a disclosure,
  **default ∅** — the object should look desirable first. Overlays are one
  click away and never color-alone (pattern/icon accompanies red/amber).
- **Status is two fixed lines** (print / mesh), monospaced numbers, mm
  everywhere, pinned so it never scrolls away. Mass estimate from a small
  density preset (TPU/PLA/PETG). Openings row adds min free diameter ("will
  a finger/LED fit").
- **Presets strip**: chips above the canvas; one click = full state replace +
  history entry.
- Not built: pipeline diagrams, cache indicators, node graphs, operator
  stacks, bridge scores.

## Milestones — the expressive loop

0. **Engineering walk** (internal): vendored Three.js, box on grid, orbit,
   STL writer. In parallel: port `poly2` / `edgesub` / `annulus` against
   Python dumps under `node --test` — the hard geometry proves out before
   Three.js is more than a box. Never the public face.
1. **Place & export**: icosidodecahedron frame at prototype defaults through
   the real pipe (`compile`), resting on a face, STL parity with the
   reference + `meshcheck.py` wired as the acceptance script. **Gate: the
   platonic menu stays shut until this is boringly correct.**
2. **Trust the mesh**: size / wall / openings / relative border / fillet with
   dynamic bounds; metrics lines; hash state + undo.
3. **Change the family**: platonic menu — same solidifier; face-family rest
   picker; presets strip.
4. **Distort & invent**: jitter + random-on-sphere with seed UX — the
   flexibility engine over the proven quality engine; acceptance over seeds.
5. **Share, draw, judge**: copy-link, SVG (current camera), honest overlays +
   threshold.

v1.1: struts, opening styles (circle/mirror), truncate/subdivide, scale-to-
mean-edge, radial jitter.

## Open questions

- Strut solidifier (v1.1): manifold-3d WASM vs convex-node-hull construction —
  decide when the frame shell's coverage of the aesthetic is known.
- **Border authoring — now with evidence, still open.** Both spellings exist
  (`borderMm`, `borderFraction`); exactly one may be set, and `compile()`
  rejects both together rather than silently preferring one. Measured on the
  M1 solid at Ø100: a constant **3.2 mm** gives every face the same frame
  width, while a constant fraction **0.28** yields 2.50 mm on triangles and
  5.95 mm on pentagons — a 2.4× spread, with the thin end below the ~2.5 mm
  printability floor the prototype README documents. So relative-primary is
  *not* obviously right even on regular solids; the case for it was irregular
  hulls, where one mm value can exceed a small face's width. Decide at M4 with
  jittered examples in hand, not before. (Constant-mm now means the
  **narrowest** border on each face, since the inset scale is sized from the
  smallest centroid-to-edge distance.)
