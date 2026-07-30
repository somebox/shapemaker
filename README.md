# Shapemaker

A browser app for designing printable 3D shapes interactively: pick a base
shape, tweak it with sliders, examine it resting on a build plate, export STL
(or an SVG projection). Successor to the Python prototype in `prototype/`.

This repo is at **Milestone 1** — icosidodecahedron frame at prototype defaults
through `compile()`, resting on a face, with STL parity and meshcheck acceptance.
Later milestones add the full control panel, other bases, jitter, and sharing.

## Requirements

- **Node.js** 18+ (for `node --test` and headless STL export)
- **Python 3.10+** with the oracle venv (for fixture generation and acceptance)
- A local HTTP server (ES modules do not load from `file://`)

## Install

```bash
# Developer tooling (tests only — the site itself has no build step)
# package.json is already present; no npm install required for runtime.

# Python oracle (meshcheck, fixtures)
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
prototype/          Python oracle (meshcheck, original generator)
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

## Deployment

Static hosting only. Rules from the spec (verified):

- Every path is `./`-relative (import map, scripts, assets) — no leading `/`
- Add `.nojekyll` (present) so Pages does not run Jekyll on `vendor/`
- Serve from the repo root on the default branch

## Contributing

PRs welcome. Product razor: a change should make "Prototype TPU" look better
or clearer, or make spinning a seed into lace more fun — otherwise it waits.

Geometry modules must not import Three.js; the pipeline runs under `node --test`.
`compile(state)` is the only regeneration API.

See [SPEC.md](SPEC.md) for the full contract and milestone plan.
