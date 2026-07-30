# Shapemaker

A browser app for designing geometric forms for physical fabrication and art.
Choose a base shape, scale and modify it with real dimensions, inspect it on a
reference plane, and export geometry. The initial implementation grows out of
the printable TPU prototype in `prototype/`, but the design also targets
laser-cut, PCB, and model-making workflows.

This repo is at **Milestone 1** — icosidodecahedron frame at prototype defaults
through `compile()`, resting on a face, with STL parity and meshcheck acceptance.
Milestone 2 adds dimensional controls, edge inspection, portable project files,
URL state, and undo/redo.

## Requirements

- **Node.js** 20+ (for `node --test` and headless STL export; CI covers 20/22/24)
- **Python 3.10+** to run the prototype (for fixture generation and acceptance)
- A local HTTP server (ES modules do not load from `file://`)

## Install

```bash
# Developer tooling (tests only — the site itself has no build step)
# package.json is already present; no npm install required for runtime.

# Python prototype — the reference the JS port is checked against
# (meshcheck, fixtures)
uv venv .venv
uv pip install --python .venv/bin/python -r prototype/requirements.txt
```

## Usage

Serve over HTTP. For a setup that matches GitHub Pages project-site paths,
serve the **parent** directory and open the repo as a subpath:

```bash
# from the directory that contains shapemaker/
cd ..
python3 -m http.server 8000
# open http://localhost:8000/shapemaker/
```

Serving the repo root at `/` also works locally, but hides absolute-path and
case-sensitivity bugs that break on Pages (`/username.github.io/shapemaker/`).

Click a face on the model to rest on it. **Export STL** downloads an oriented
binary STL in millimetres.

### Headless export

```bash
node scripts/export-stl.mjs out.stl
node scripts/export-stl.mjs out.stl --wall=2.0 --border=4 --fillet=0
```

## Configuration

M1 state is hardcoded in [`src/types.js`](src/types.js) (`DEFAULT_STATE`):

| key | default | meaning |
|---|---|---|
| `circumdiameterMm` | 100 | outer diameter across opposite vertices |
| `borderMm` | 3.2 | frame width at edge midpoints |
| `wallMm` | 1.4 | minimum wall thickness (pentagons) |
| `filletMm` | 4.5 | opening corner radius (clamped per face) |
| `edgeDiv` | 10 | segments per polyhedron edge |
| `faceIndex` | first pentagon | resting face |

Schema-driven sliders and URL hash arrive in Milestone 2.

## Example

```bash
npm test                          # unit + parity (no Python)
bash scripts/acceptance.sh        # meshcheck over exported STLs (needs .venv)
```

North-star numbers (Ø100 prototype defaults): **7200 triangles**,
**≈16.15 cm³**, pentagon-down height **≈85.07 mm**.

## Project structure

```
index.html          entry (import map → ./vendor/…)
vendor/three/       Three.js r170 ESM + OrbitControls (+ LICENSE, README)
src/
  main.js           events → state → compile → viewer/export
  compile.js        THE regeneration API — never throws for bad input
  validate.js       parameter checks; validationError() for the stages
  pipeline.js       stage runner + per-stage cache instance
  types.js          Skeleton / Mesh / DEFAULT_STATE
  skeleton.js       edgeList, inradiusRange, assertSkeleton  ← shape-agnostic
  faceframe.js      toFaceFrame / fromFaceFrame              ← face-local 2D
  points/           icosidodeca (platonic M3, random M4)
  geom/             poly2, edgesub, annulus
  solid/shell.js    depth × OpeningGenerator
  mesh.js           structural + manifold invariants
  orient.js         resting-face transform (plane normal → −Z, z_min = 0)
  metrics.js        computed once; viewer/UI never re-derive
  export/stl.js     binary STL writer
  viewer.js         grid, orbit, face pick   ← the only module importing three
prototype/          Python reference (meshcheck, original generator)
test/               node --test + fixtures + reference.json
scripts/            export-stl.mjs, acceptance.sh
```

The two shape-agnostic modules are the M3/M4 seam: `solid/shell.js` learns
everything about the polyhedron through `skeleton.js` and `faceframe.js`, so
adding platonic bases or jitter does not touch the solidifier.

## Tests

| Tier | Command | Needs Python? |
|---|---|---|
| Unit + parity | `npm test` | No |
| Acceptance | `bash scripts/acceptance.sh` | Yes (`.venv`) |

Acceptance exports STLs headlessly through the same `compile()` the browser
uses, then requires every one to be watertight, winding-consistent,
degeneracy-free, positive-volume and **free of self-intersections** — the last
being the check topology alone cannot make (see `prototype/README.md`).

One nuance: `hollow_closed.stl` is expected to report **two bodies**. A hollow
shell with no openings is one material shell bounded by two disconnected
watertight surfaces (outer and inner), so `trimesh.body_count == 2` is
correct there and 1 everywhere else.

Regenerate geometry fixtures after changing the Python helpers:

```bash
.venv/bin/python prototype/emit_fixtures.py
```

## Continuous integration

| Workflow | Trigger | What it does |
|---|---|---|
| [`ci.yml`](.github/workflows/ci.yml) | every push and PR | tests on Node 20/22/24; deployment path rules; headless `compile()`; mesh acceptance against the Python reference |
| [`pages.yml`](.github/workflows/pages.yml) | push to `main` | runs tests, assembles the site, publishes to GitHub Pages |

`ci.yml` enforces three rules that are easy to break and expensive to notice
late: no root-absolute paths in `index.html` (they work locally and 404 under
a Pages project-site subpath), every import-map target resolves to a file that
exists, and no module outside `viewer.js` imports Three.js — rule 2 of the
application contract. Acceptance uploads the exported STLs as an artifact, so
a failure can be inspected rather than guessed at.

## Deployment

Static hosting only. Rules from the spec (verified):

- Every path is `./`-relative (import map, scripts, assets) — no leading `/`
- Add `.nojekyll` (present) so Pages does not run Jekyll on `vendor/`
- The published artifact is `index.html`, `src/`, `vendor/`, `.nojekyll` —
  about 1.4 MB, nearly all vendored Three.js. The Python reference, tests, and
  fixtures are not published. This is a copy, not a build: the app still runs
  directly from the repo root locally.

**First-time setup:** push `main`, then set *Settings → Pages → Build and
deployment → Source* to **GitHub Actions** (not "Deploy from a branch"). The
workflow needs that mode; until it is selected, the deploy step fails with a
permissions error while everything else passes.

## Project documents

- [`SPEC.md`](SPEC.md) defines committed product behavior and architecture.
- [`PROJECT_FORMAT.md`](PROJECT_FORMAT.md) defines portable
  `.shapemaker.json` files and migration rules.
- [`ROADMAP.md`](ROADMAP.md) tracks priorities and uncommitted future ideas.

## Contributing

Product razor: a change should improve physical design, fabrication handoff,
or the experience of creating interesting forms; otherwise it waits.

Geometry modules must not import Three.js; the pipeline runs under `node --test`.
`compile(state)` is the only regeneration API.
