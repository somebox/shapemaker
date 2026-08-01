# Shapemaker

A browser app for designing geometric forms for physical fabrication and art.
Choose a base shape, scale and modify it with real dimensions, inspect it on a
reference plane, and export geometry. The initial implementation grows out of
the printable TPU prototype in `prototype/`, but the design also targets
laser-cut, PCB, and model-making workflows.

**Live app:** [somebox.github.io/shapemaker](https://somebox.github.io/shapemaker/)

![Shapemaker v0.3 — family selector, presets, and open icosidodecahedron
frame](media/screenshot-v0.3.png)

Version **0.4.0** (Milestone 5) — start-from chooser, sphere and random bases,
jitter on every base, subdivide/smooth, irregular acceptance, unit-aware SVG
export, and print-risk overlays. See [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

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
binary STL in millimetres; **Export SVG** downloads a camera-projected outline
with a millimetre scale bar. Filenames include seed and size when the shape
depends on a seed.

### Headless export

```bash
node scripts/export-stl.mjs out.stl
node scripts/export-stl.mjs out.stl --wall=2.0 --border=4 --fillet=4.5
```

## Configuration

Canonical authoring state is defined in [`src/schema.js`](src/schema.js)
(`DEFAULT_STATE`, `STATE_KEYS`, control definitions); `src/types.js` re-exports
it for the compile boundary. The same canonical state round-trips through
project files, the URL hash, and dirty tracking:

| key | default | meaning |
|---|---|---|
| `base` | `icosidodeca` | shape family id (`BASES` in `src/bases.js`) |
| `circumdiameterMm` | 100 | outer diameter across opposite vertices |
| `borderMm` | 3.2 | frame width at edge midpoints |
| `wallMm` | 1.4 | minimum wall thickness |
| `filletMm` | 4.5 | requested opening corner radius; clamped per face |
| `jitter` | 0 | distort amount (plane-perturb on regulars; point jitter on parametric) |
| `subdiv` / `soften` | 0 | subdivision level and smooth (sphere-clip fillet) |
| `edgeDiv` | 10 | tessellation density — set by the **Quality** control |
| `faceIndex` | auto (−1) | resting face; default is max-area face |

```bash
node scripts/export-stl.mjs out.stl --base=dodecahedron --depth=solid --openings=false
```

### Quality (tessellation)

One knob: the **Quality** control writes `edgeDiv`, and fillet arc segments
derive from it (`round(edgeDiv × 6.4)`), so smoother fillets are real geometry
in both the preview and the STL — never a shading trick. The preview stays
flat-shaded so it matches the export. Values other than the three levels
(e.g. from a project file) show as *custom*.

| level | `edgeDiv` | arc segments | triangles* | regen* |
|---|---|---|---|---|
| Draft | 4 | 26 | 2,880 | ~5 ms |
| **Normal** (default) | 10 | 64 | 7,200 | ~12 ms |
| Fine | 20 | 128 | 14,400 | ~31 ms |

\* default icosidodecahedron, hollow + open, Apple Silicon dev machine.
Normal is the historical pairing, so all parity anchors are unchanged.
Worst measured case (random hull at the 60-point cap, hollow + open):
Draft ~14 ms, Normal ~33 ms, Fine ~79 ms — all inside the interaction
target, so every level is enabled for every base.

## Example

```bash
npm test                          # unit + parity (no Python)
bash scripts/acceptance.sh        # meshcheck over exported STLs (needs .venv)
```

North-star numbers (Ø100 prototype defaults): **7200 triangles**,
**≈16.15 cm³**, pentagon-down height **≈85.07 mm**.

## Project structure

```
index.html          entry (import map → ./vendor/…, vendored fonts, tokens)
vendor/three/       Three.js r170 ESM + OrbitControls (+ LICENSE, README)
vendor/quickhull3d/ QuickHull ESM bundle (MIT)
vendor/fonts/       Archivo + IBM Plex Mono WOFF2 subsets (+ OFL licences)
presets.json        versioned preset recipes (M3)
src/
  main.js           session owner: draft state, history, save/open, export
  ui.js             panel — owns DOM, emits patches, never owns state
  schema.js         DEFAULT_STATE, control defs, canonical codec
  bases.js          flat BASES registry (ids, labels, point generators)
  hull.js           QuickHull wrapper + coplanar merge + face identity
  adapt-base.js     pure base-change Form adaptation
  presets.js        presets.json envelope loader
  hashcodec.js      versioned URL hash over canonical state
  history.js        pure push/replace policy for live vs committed edits
  session.js        pure Save/Open eligibility + history restore
  project-format.js .shapemaker.json serialize / parse / migrate
  limits.js         proactive wall/border/fillet ceilings from the skeleton
  adapt-base.js     wall/border clamp + printability guidance
  compile.js        THE regeneration API — never throws for bad input
  validate.js       parameter checks; validationError() for the stages
  pipeline.js       points → jitter → subdivide → smooth → scale → shell
  types.js          Skeleton / Mesh typedefs (doc module)
  skeleton.js       edgeList, inradiusRange, assertSkeleton  ← shape-agnostic
  faceframe.js      toFaceFrame / fromFaceFrame              ← face-local 2D
  points/           platonic, icosidodeca, sphere, random, jitter
  geom/             poly2, edgesub, annulus
  solid/shell.js    depth × OpeningGenerator
  mesh.js           structural + manifold invariants
  orient.js         resting-face transform (plane normal → −Z, z_min = 0)
  metrics.js        computed once (incl. limits); viewer/UI never re-derive
  export/stl.js     binary STL writer
  export/svg.js     unit-aware camera-projected SVG
  viewer.js         grid, orbit, face + edge pick ← the only module importing three
prototype/          Python reference (meshcheck, original generator)
test/               node --test + fixtures + reference.json
scripts/            export-stl.mjs, acceptance.sh
```

The two shape-agnostic modules are the family/irregular seam: `solid/shell.js` learns
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

**Pages source must be "GitHub Actions"** (*Settings → Pages → Build and
deployment → Source*), not "Deploy from a branch". Branch mode would look for
the site in the repo — and `docs/` holds documentation, not the app, so the
build fails. The two modes also fight: whichever ran last wins, so leaving
branch mode enabled produces a failing build on every push.

## Project documents

All documentation lives in [`docs/`](docs/):

- [`SPEC.md`](docs/SPEC.md) defines committed product behavior and architecture.
- [`PROJECT_FORMAT.md`](docs/PROJECT_FORMAT.md) defines portable
  `.shapemaker.json` files and migration rules.
- [`ROADMAP.md`](docs/ROADMAP.md) tracks priorities and uncommitted future ideas.
- [`CHANGELOG.md`](docs/CHANGELOG.md) records released versions.

`docs/` is documentation only — it is **not** the published site root. Pages
deploys the app via the Actions workflow (see below), so nothing in `docs/`
is served.

## Contributing

Product razor: a change should improve physical design, fabrication handoff,
or the experience of creating interesting forms; otherwise it waits.

Geometry modules must not import Three.js; the pipeline runs under `node --test`.
`compile(state)` is the only regeneration API.
