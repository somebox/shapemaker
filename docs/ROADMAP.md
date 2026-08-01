# Shapemaker roadmap

This roadmap tracks priorities beyond the binding behavior in
[`SPEC.md`](SPEC.md). Items move into the specification only when their user
need and acceptance criteria are clear.

## Priority definitions

- **Now:** next milestone; required for a coherent usable workflow.
- **Next:** committed direction after Now, subject to lessons from actual use.
- **Later:** valuable idea with a plausible use case but no scheduled release.
- **Backlog:** exploratory; do not design architecture around it yet.

## Now — Milestone 2: measure, save, and continue

Goal: turn the Phase 1 demonstration into a design tool users can leave and
return to.

Delivery is staged so the panel can be reviewed before persistence machinery
encodes its layout:

- **A — Living mockup.** Hand-wired Shape / Form / Inspect / Make panel over
  the existing `compile()` API; real Form controls and Save serializer; no
  schema, hash, undo, or Open yet.
- **B — Review checkpoint.** Screenshots and playtest (including narrow
  viewports and zoom) decide control density, measurement placement, and
  validation UX before Stage C.
- **C1 — Canonical state and projects.** `schema.js`, one canonical codec,
  project parse/migration/Open, dynamic bounds through schema.
- **C2 — History and sharing.** Versioned URL hash, browser-history undo/redo,
  Copy Link.
- **C3 — Edge inspection and checkpoint.** Hover/select exact edge length;
  polish; v0.2 exit criteria.

### Scope

- Schema-driven controls for scale, wall, openings, border, and fillet.
- Uniform free scaling with live bounding dimensions.
- Edge minimum/mean/maximum and hover/select exact edge measurement.
- Regular-shape edge length as an alternate uniform-scale input.
- Dynamic geometry bounds and inline validation.
- `.shapemaker.json` project open/save using project format version 1.
- Project migration and canonical round-trip tests.
- Current project name, dirty/unsaved indicator, and Save/Open actions.
- Canonical versioned URL state, browser-history undo/redo, and Copy Link.
- Preserve camera position during ordinary parameter changes.

### Cut from Milestone 2

- Optional local recovery of the latest unsaved session.
- File System Access API progressive enhancement for repeated saves.

Neither moves the checkpoint; both remain later polish.

### Milestone 2 exit criteria

- A user can create a variation, save it, reload the page, open the project,
  and continue with equivalent geometry and settings.
- Project files round-trip canonically and reject unsupported future versions
  without data loss.
- Measurements update during scaling and match exported geometry.
- Invalid edits keep the last valid preview and cannot be exported.

### Stage B review questions

1. Slider+numeric per control, or numeric-on-click?
2. Measurements: Inspect group vs dimension strip (fabrication vs mesh diagnostics)?
3. Does validation highlight+message anchoring work?
4. Project name / dirty placement?
5. Panel overflow (independent scroll; status visibility)?
6. Keyboard: labels, focus, arrow-key increments?
7. Disabled-with-explanation vs hidden for future controls?
8. Cut anything that does not earn its place.

## Done — Milestone 3: change the family (v0.3.0)

Goal: reuse the trusted shell workflow across regular shape families.

- Platonic base generators + icosidodecahedron through shared hull path.
- Vendored QuickHull, adjacency coplanar merge, deterministic face identity.
- `assertSkeleton()` at the hull boundary; analytic + one SciPy hull fixture.
- Compact face stepper; base-change adaptation; versioned presets.
- Acceptance: 6 bases × 3 shell combos + 6 stress opens (24 STLs).

## Shipped in tree — Milestone 4: mesh quality

Goal: let users choose how finely the shell is tessellated so smoother-looking
fillets and frames are real geometry in both the preview and the STL — not a
shading trick.

STL carries triangles only; slicers do not honour smooth vertex normals. The
viewer therefore stays flat-shaded so preview ≡ export. “Smoother” means denser
facets via existing solidifier knobs (`edgeDiv`, fillet arc segments), exposed
as a small preset rather than raw internals.

- Mesh quality / smoothness preset (e.g. Draft / Normal / Fine) in Make (or
  Form), stored in canonical state and project files.
- Map presets to `edgeDiv` and fillet-arc segment counts; keep flat shading.
- Preview and Export STL use the same compiled mesh (no separate LOD for save).
- Document triangle-count / performance expectations per preset; Fine must
  remain interactive on a typical laptop at the default icosidodecahedron.
- Acceptance: each preset exports watertight; Normal remains the default and
  keeps current parity anchors unless explicitly re-baselined.

### Milestone 4 exit criteria — met

All verified in tree (`test/quality.test.js` + live playtest): Draft / Normal
/ Fine map to `edgeDiv` 4 / 10 / 20 with derived fillet-arc segments; each
preset compiles watertight at the expected density (icosidodeca ~×0.4 / ×1 /
×2 triangles, sphere-48 6.6k / 16.6k / 33k tris, interactive); Normal keeps
the parity anchors; flat shading everywhere; `edgeDiv` round-trips through
project files and URL state.

## Done — Milestone 5: distort and invent (v0.4.0)

Goal: provide expressive irregular forms without adding a modeling language.

**Locked from UX start-from playtest (browse → edit):**

- Choosing a start (base or named preset) **hard-resets** the full recipe;
  Browse vs Edit chrome; no confirm on switch; Undo is the safety net.
- Jitter is **allowed on all bases**; soft amplitude; no camera reframe on
  jitter/seed-only edits. Regular bases now use **plane-perturbation** (faces
  stay polygons); the random base keeps on-sphere point jitter.
- Density / seed / jitter stay visible; inert knobs dim rather than hide.
- User preset Save/delete (“Yours”) is later; project Save stays project files.

### Milestone 5 exit criteria — met

- Seeded random-on-sphere point generation; density as a direct point-count
  slider (4–60); Sparse/Medium/Dense chips retired.
- Per-face opening, border, and fillet metrics for non-congruent faces.
- Irregular-hull acceptance matrix across representative seeds and extremes
  (`scripts/acceptance.sh` 49 STLs + `test/m5-matrix.test.js`).
- Fixed millimetre borders retained after evidence
  ([`BORDER_EVIDENCE.md`](BORDER_EVIDENCE.md)); clamp warnings guide scale-up
  / reduce-density when below ~2.5 mm.

## Next — Milestone 6: share, draw, and judge

Goal: improve communication and downstream fabrication handoff.

- Camera-matched SVG line drawing — **shipped** in v0.4
  (`src/export/svg.js`): perspective hidden-line export of the visible
  silhouette/crease edges; scale annotations dropped after playtest.
- Approximate overhang and near-horizontal-edge overlays — **shipped** in
  v0.4 (`src/metrics.js`, `metrics.printRisk`).
- Export naming that includes relevant seed and size information — **shipped**
  for STL and SVG.
- Material-density presets and mass estimate (remaining).
- Section plane along the bed axis (remaining): a render-only clipping plane
  the user sweeps up Z to inspect wall structure and cavities alongside the
  overhang overlay. Preview-only (Three.js clipping) — no mesh booleans,
  export unchanged. Open cross-sections on hollow shells are accepted;
  capping is not in scope.
- Scale legibility in the viewer (remaining): millimetre labels on the plate
  grid's major lines, and a prominent in-view dimension callout near the
  model while Size (or any size-affecting control) is adjusted. Today the
  grid is unlabeled and dimensions appear only in the Inspect panel.

## Later — fabrication workflows

These need concrete examples before their file formats and constraints are
specified.

### Locked scale or target edge constraints

Potential use cases include matching stock lengths, laser-cut connectors, or
PCB edges.

Possible forms:

- lock mean edge length while changing a regular shape;
- lock one selected edge and rescale uniformly;
- filter generated shapes by an edge-length range;
- report edge-length classes and counts for fabrication planning.

Open issue: irregular shapes cannot generally make every edge equal through
uniform scaling. The UI must distinguish a global scale constraint from a shape
search or optimization problem.

### Fabrication reports

Possible project/export companion data:

- unique edge-length classes and quantities;
- face dimensions and counts;
- labels linking faces and edges across drawings;
- cut lists or assembly maps;
- material area and approximate mass.

### More specialized 2D outputs

Potential outputs include per-face templates, tabs, kerf allowances, or PCB
outline helpers. These are not equivalent to the current camera-projected SVG
and require a defined assembly workflow before implementation.

## Later — shape vocabulary

- **Plane-perturbation jitter follow-through.** The mechanism is shipped
  (`src/plane-perturb.js`): perturbed face planes re-intersected via the dual
  hull; faces stay planar convex polygons and face count survives. Vertices
  with 4+ faces split into short edges — kept in the skeleton (exact
  planarity), swallowed in the 2D opening path so fillets round across the
  virtual corner; face frames use the area centroid so split rings don't
  off-center openings. Remaining: calibrate the shared soft amplitude.
- Additional opening generators such as circle or mirrored-face openings.
- Fixed-order skeleton operators: **subdivide is shipped**
  (`src/subdivide.js`, levels 0–2, applied after jitter — order is
  jitter → subdivide → smooth) with
  Smooth — an outer-edge fillet by sphere clip (0 exact flat split, 100
  inscribed ball; flats hold their planes so dimensions never change);
  truncate and dual remain. Possible follow-up: higher levels behind a
  performance check; a geodesic (outward spherify) mode if wanted — the
  Sphere base covers most of that ground.
- Scale-to-target mean edge for irregular forms.
- Separate jitter seed.
- **Radial jitter is shipped** as the jitter Direction mode
  (surface/radial/both); swallowed parametric points vanish gradually
  (accepted), and radial clouds renormalize to keep Size = circumdiameter.
- User preset store (“Yours”) separate from immutable built-ins; Save-as-preset
  and delete only for user presets.

There will be no editable operator stack unless a compelling workflow appears.

## Refactor backlog (from start-from lock)

Driven by the locked session model; not blocking the thin slice already in tree.

- Calibrate or replace `JITTER_AMPLITUDE_SCALE` (plane-perturbation shipped).
- Stable orientation under distort (resting face / focus across face-identity
  reorder; merge-skip remains on the random base).
- Retire or narrow `adaptStateForBase` preserve-Form path (starts own reset;
  adaptation remains for wall/border clamp on reshape).
- Align or supersede older Phase 4 plan units with this model.

## Backlog — true struts and node joints

**Status:** idea retained; no current use case and no planned milestone.

True round beams would require a different solidifier from the current flat
frame shell. Candidate approaches:

- `manifold-3d` WebAssembly for robust unions and smooth rod-and-node forms;
- lightweight convex node hulls for a smaller, faceted implementation.

Do not choose a dependency or pre-design this feature yet. Revisit only when a
user workflow requires actual round struts rather than frame shells. At that
point, document the needed beam profiles, joint behavior, fabrication method,
performance budget, and export guarantees before promoting it from backlog.

## Backlog — deliberately unscheduled

- Automatic print-orientation scoring.
- Hidden-line SVG removal.
- Resin drain-hole design.
- True dihedral edge fillets.
- General booleans or concave modeling.
- Backend accounts or cloud storage.
- Optional local session recovery.
- File System Access API for repeated project saves.

## Decision log

- **Physical fabrication is the primary context, not 3D printing alone.** Real
  dimensions and edge inspection are first-class.
- **Free uniform scaling is the default.** Edge-length constraints are optional
  workflows, not a competing size model.
- **Border is authored in millimetres for version 1.** Relative openness is a
  readout. **Retained after irregular-hull evidence (v0.4):** proportional
  authoring would not rescue dense Ø100 lace balls (physics, not units);
  clamp warnings guide scale-up or lower density when the fitted border falls
  below ~2.5 mm. See [`BORDER_EVIDENCE.md`](BORDER_EVIDENCE.md).
- **Projects are portable files.** URL state is for sharing; local recovery is
  convenience; neither replaces `.shapemaker.json`.
- **Copy Link is part of Milestone 2** (with URL state), not Milestone 6.
- **Mesh “smoothness” is tessellation, not shading.** Preview stays flat-shaded
  so it matches STL; quality presets only increase facet density (Milestone 4).
- **True struts remain backlog.** No geometry dependency is chosen without a
  demonstrated use case.
