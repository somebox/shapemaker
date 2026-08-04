# Shapemaker roadmap

Priorities beyond the binding behavior in [`SPEC.md`](SPEC.md). Items move
into the specification only when their user need and acceptance criteria are
clear. Shipped work lives in [`CHANGELOG.md`](CHANGELOG.md).

## Priority definitions

- **Later:** valuable idea with a plausible use case but no scheduled release.
- **Backlog:** exploratory; do not design architecture around it yet.

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

Shipped in 0.7.0: cuboctahedron, rhombic dodecahedron, rhombic triacontahedron,
and a lat/long globe (Density → meridians). Further vocabulary ideas:

- Additional opening generators such as circle or mirrored-face openings.
- Skeleton operators still open: truncate and dual (subdivide + smooth already
  ship). Possible follow-ups: higher subdivision levels behind a performance
  check; a geodesic (outward spherify) mode if wanted — the Sphere base covers
  most of that ground.
- Scale-to-target mean edge for irregular forms.
- Separate jitter seed.
- User preset store (“Yours”) separate from immutable built-ins; Save-as-preset
  and delete only for user presets.

There will be no editable operator stack unless a compelling workflow appears.

## Later — edge rounding follow-through

Rim roundovers (Stage 1), dihedral edge/corner rounding (Stage 2, with
proportional per-feature clamping), and the model split shipped in 0.8.0 —
see [`CHANGELOG.md`](CHANGELOG.md). Remaining ideas:

- Inner-shell (cavity) dihedral edges are mirrored by the uniform inner
  scale but could get independent treatment if cavity feel ever matters.
- Corner patches are apex fans (exact sphere octants on uniform corners);
  a geodesic subdivision would smooth high-valence corners (globe poles)
  if the faceting reads as coarse.


## Refactor backlog

Consistency and maintainability; none change current product behavior.

### From the start-from session model

- Calibrate or replace `JITTER_AMPLITUDE_SCALE`.
- Stable orientation under distort (resting face / focus across face-identity
  reorder; merge-skip remains on the random base).
- Retire or narrow `adaptStateForBase` preserve-Form path (starts own reset;
  adaptation remains for wall/border clamp on reshape).
- Align or supersede older Phase 4 plan units with this model.

### From the 0.7.0 four-bases review

- Wire `icosidodeca.js` to the shared platonic vertex helpers — `platonic.js`
  now exports `PHI` / `cubeVerts()` / `icosahedronVerts()` (rhombic.js uses
  them); icosidodeca.js still carries its own copies of both.
- Decide the start-chip shortLabel scheme for multi-word solids: “Rhomb 12” /
  “Rhomb 30” are digit-suffixed while every other chip is a single truncated
  word (Tetra, Cubocta, Icosi). Chip text only; no persisted state.
- Share the `radiiMultiset` test helper — `bases.test.js` (9 digits) and
  `rhombic.test.js` (12 digits) each define it; a normalization regression
  near 1e-10 would fail one suite and pass the other.

### From the v0.4 review

- Pick one 2D point form (`Float64Array` flat vs `number[][]`) inside
  `buildShell` / `poly2` (today ~5 shapes with `toPairs`/`flatten` bridges).
- Make `edgeKey` the only edge-key encoding (inline `a*0x100000+b` or strings
  remain in ~5 files; packing silently collides past 2²⁰ verts).
- Extract a shared `vec3` helper — Newell is centralized in `skeleton.js`
  since 0.4.0, but cross/normalize/basis math is still inlined in ~5 places
  (`faceframe`, `orient`, `export/svg`, `viewer`).
- `predictedCompileMs(...)` → options object (match `nextHistoryAction`).
- `subdivideSkeleton(skeleton, level, soften)` →
  `subdivideSkeleton(skeleton, { level, soften })`.
- `exportSvg` → `writeSvg` (symmetry with `writeBinaryStl`).
- Named constants for safety factors `0.95` / `0.999`, packing `0x100000`,
  jitter/plane stream IDs.
- Silent URL-hash rewrite when decode fails — surface a warning instead of
  quietly replacing.
- Optional JSDoc imports for `types.js` so the SPEC contract module cannot
  drift (it stays unimported on purpose today).
- Direct tests for `face-families`.
- Full headless DOM coverage for `main.js` / `ui.js` flows (beyond pure
  helpers already extracted for panel ergonomics).
- Plane-perturb at jitter 20–50 can escape `compile()` as uncaught errors and
  contradict SPEC's "degrade gradually" — needs a fuzz test + graceful
  degradation policy.

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
- Resin drain-hole design.
- General booleans or concave modeling.
- Backend accounts or cloud storage.
- Optional local session recovery.
- File System Access API for repeated project saves.

## Decision log

- **Physical fabrication is the primary context, not 3D printing alone.** Real
  dimensions and edge inspection are first-class.
- **Free uniform scaling is the default.** Edge-length constraints are optional
  workflows, not a competing size model.
- **Border is authored as a relative fraction for version 1+.** Constant
  millimetres remain a supported legacy/API spelling. Relative authoring
  scales frames with face size (subdiv, globe, irregular hulls); printability
  warnings still guide scale-up when the thinnest applied border falls below
  ≈2.5 mm. See [`BORDER_EVIDENCE.md`](BORDER_EVIDENCE.md).
- **Projects are portable files.** URL state is for sharing; local recovery is
  convenience; neither replaces `.shapemaker.json`.
- **Mesh “smoothness” is tessellation, not shading.** Preview stays flat-shaded
  so it matches STL; quality presets only increase facet density.
- **True struts remain backlog.** No geometry dependency is chosen without a
  demonstrated use case.
- **First `localStorage` use is onboarding (and collapsible panel groups), not
  session recovery.** The seen-flag / group-open keys are convenience UI state;
  portable projects and URL hash remain the recovery paths. Optional local
  session recovery stays deliberately unscheduled.
