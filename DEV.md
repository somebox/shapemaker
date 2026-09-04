# Shapemaker — developer notes

User-facing overview and usage: [`README.md`](README.md). Binding product
behavior: [`docs/SPEC.md`](docs/SPEC.md).

## Requirements

- **Node.js** 20+ (`node --test`, headless STL export; CI covers 20/22/24)
- **Python 3.10+** for the prototype (fixture generation and mesh acceptance)
- A local HTTP server (ES modules do not load from `file://`)

## Setup

```bash
# Runtime needs no npm install — package.json is for tests and metadata.

# Python prototype — reference for meshcheck / fixtures
uv venv .venv
uv pip install --python .venv/bin/python -r prototype/requirements.txt
```

Serve locally (prefer parent-directory serve to match GitHub Pages subpaths):

```bash
cd ..
python3 -m http.server 8000
# open http://localhost:8000/shapemaker/
```

Or serve the project root without caching (plain `http.server` sends no
cache headers, so an edited module can stay stale across reloads):

```bash
python3 scripts/dev-server.py 8000
# open http://localhost:8000/
```

## Tests

| Tier | Command | Needs Python? |
|---|---|---|
| Unit + parity | `npm test` | No |
| Acceptance | `bash scripts/acceptance.sh` | Yes (`.venv`) |

Acceptance exports STLs through the same `compile()` the browser uses, then
requires each to be watertight, winding-consistent, degeneracy-free,
positive-volume, and free of self-intersections (see `prototype/README.md`).

`hollow_closed.stl` is expected to report **two bodies**: a hollow closed shell
is one material volume bounded by two disconnected watertight surfaces.

Regenerate geometry fixtures after changing the Python helpers:

```bash
.venv/bin/python prototype/emit_fixtures.py
```

North-star numbers (Ø100 prototype defaults): **7200 triangles**,
**≈16.15 cm³**, pentagon-down height **≈85.07 mm**.

### Headless export

```bash
node scripts/export-stl.mjs out.stl
node scripts/export-stl.mjs out.stl --wall=2.0 --border=4 --fillet=4.5
node scripts/export-stl.mjs out.stl --base=dodecahedron --depth=solid --openings=false
```

## Canonical state

Authoring state lives in [`src/schema.js`](src/schema.js) (`DEFAULT_STATE`,
`STATE_KEYS`, control definitions). The same codec round-trips through project
files, the URL hash, and dirty tracking.

| key | default | meaning |
|---|---|---|
| `base` | `icosidodeca` | shape family id (`BASES` in `src/bases.js`) |
| `circumdiameterMm` | 100 | outer diameter across opposite vertices |
| `borderFraction` | 0.36 | frame width ÷ face apothem (Form %); legacy `borderMm` via `--border=` |
| `wallMm` | 1.4 | minimum wall thickness |
| `filletMm` | 4.5 | requested opening corner radius; clamped per face |
| `jitter` | 0 | distort amount |
| `truncate` | 0 | vertex cut % (re-hull) |
| `spike` | 0 | apex radius in parent circumradius units (0 skips) |
| `subdiv` / `soften` | 0 | subdivision level and smooth |
| `edgeDiv` | 10 | tessellation density (**Quality** control) |
| `faceIndex` | auto (−1) | resting face; default is max-area face |

### Quality (tessellation)

The **Quality** control writes `edgeDiv`; fillet arc segments derive from it
(`round(edgeDiv × 6.4)`). Preview stays flat-shaded so it matches the STL.

| level | `edgeDiv` | arc segments | triangles* | regen* |
|---|---|---|---|---|
| Draft | 4 | 26 | 2,880 | ~5 ms |
| **Normal** (default) | 10 | 64 | 7,200 | ~12 ms |
| Fine | 20 | 128 | 14,400 | ~31 ms |

\* default icosidodecahedron, hollow + open, Apple Silicon. Worst measured case
(random hull at the 60-point cap): Draft ~14 ms, Normal ~33 ms, Fine ~79 ms.

## Project structure

```
index.html          entry (import map → ./vendor/…, vendored fonts, tokens)
vendor/three/       Three.js r170 ESM + OrbitControls
vendor/quickhull3d/ QuickHull ESM bundle (MIT)
vendor/fonts/       Archivo + IBM Plex Mono WOFF2 subsets
presets.json        versioned preset recipes (named stars)
src/
  main.js           session owner: draft state, history, save/open, export
  ui.js             panel — owns DOM, emits patches, never owns state
  controls.js       schema-driven control builders + pure display helpers
  onboarding.js     header chrome + first-visit dialog / seen-flag
  schema.js         DEFAULT_STATE, control defs, canonical codec
  bases.js          flat BASES registry
  hull.js           QuickHull wrapper + coplanar merge + face identity
  compile.js        THE regeneration API — never throws for bad input
  pipeline.js       points → jitter → truncate → spike → subdivide → scale → shell
  skeleton.js       edgeList, inradiusRange, assertSkeleton, assertStarShaped
  faceframe.js      toFaceFrame / fromFaceFrame
  points/           platonic, icosidodeca, cuboctahedron, rhombic, globe, sphere, random, jitter
  geom/             poly2, edgesub, annulus
  solid/shell.js    depth × OpeningGenerator
  solid/spike.js    face pyramids / dimples (origin-star-convex)
  export/stl.js     binary STL writer
  export/svg.js     camera-projected SVG
  viewer.js         only module that imports Three.js
prototype/          Python reference (meshcheck, original generator)
test/               node --test + fixtures
scripts/            export-stl.mjs, acceptance.sh
```

`solid/shell.js` learns the polyhedron only through `skeleton.js` and
`faceframe.js`, so adding bases or jitter does not touch the solidifier.

## Continuous integration

| Workflow | Trigger | What it does |
|---|---|---|
| [`ci.yml`](.github/workflows/ci.yml) | every push and PR | tests on Node 20/22/24; path rules; headless `compile()`; mesh acceptance |
| [`pages.yml`](.github/workflows/pages.yml) | push to `main` | tests, assemble site, publish to GitHub Pages |

CI rules that are easy to break: no root-absolute paths in `index.html`, every
import-map target resolves, and no module outside `viewer.js` imports Three.js.

## Deployment

Static hosting only:

- Every path is `./`-relative — no leading `/`
- `.nojekyll` at the repo root so Pages does not run Jekyll on `vendor/`
- Published artifact: `index.html`, `src/`, `vendor/`, `.nojekyll` (~1.4 MB)

**Pages source must be "GitHub Actions"** (*Settings → Pages*), not "Deploy
from a branch" — `docs/` is documentation, not the site root.

## Contracts

- Geometry modules must not import Three.js; the pipeline runs under
  `node --test`.
- `compile(state)` is the only regeneration API.
- Product razor: a change should improve physical design, fabrication handoff,
  or the experience of creating interesting forms; otherwise it waits.

## Further docs

- [`docs/SPEC.md`](docs/SPEC.md) — product behavior and architecture
- [`docs/PROJECT_FORMAT.md`](docs/PROJECT_FORMAT.md) — portable projects
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — future work
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — releases
