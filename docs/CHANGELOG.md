# Changelog

Notable changes to Shapemaker. Versions follow [semantic versioning](https://semver.org/).

While the project is pre-1.0 this file is kept deliberately light: the public
surface is still moving, and git history is the detailed record. From **1.0**
onward every release gets a full entry here, and breaking changes to the
[project format](PROJECT_FORMAT.md) get a migration note.

## [Unreleased]

### Notes

- Fillet remains authored as `filletMm` (millimetres) in project format v1.
  Relative fillet was explored briefly and rejected without a format bump.
- Mesh quality / tessellation presets are scheduled as Milestone 4.

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
