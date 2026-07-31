# Vendored dependencies

Vendored rather than loaded from a CDN so the app works offline, pins exact
behaviour (picking and controls are version-sensitive), and keeps GitHub Pages
deployment to "copy the tree". Nothing here is modified from upstream.

## three.js

| | |
|---|---|
| version | **0.170.0** (r170) |
| upstream | https://github.com/mrdoob/three.js |
| license | MIT — see [`three/LICENSE`](three/LICENSE) |

Files copied from the release:

| local path | upstream path |
|---|---|
| `three/three.module.js` | `build/three.module.js` |
| `three/addons/controls/OrbitControls.js` | `examples/jsm/controls/OrbitControls.js` |

The `addons/` directory mirrors upstream's `examples/jsm/` layout so the
import map's trailing-slash mapping (`"three/addons/"`) matches the paths used
in three.js documentation.

### Updating

1. Download the new release; copy the two files above, preserving paths.
2. Update `three/VERSION`, the version in this file, and `three/LICENSE`.
3. Re-run `npm test` (geometry is Three-independent, so this should be a no-op)
   and reload the app: orbit, pick several faces, export an STL.

Import-map entries must stay `./`-relative — see SPEC.md § Deployment.

## quickhull3d

| | |
|---|---|
| version | **3.1.2** |
| upstream | https://github.com/mauriciopoppe/quickhull3d |
| license | MIT — see [`quickhull3d/LICENSE`](quickhull3d/LICENSE) |

Single-file ESM bundle at `quickhull3d/quickhull3d.js` (see
[`quickhull3d/README.md`](quickhull3d/README.md)). Only `src/hull.js` imports it.

## Fonts

Latin WOFF2 subsets only (no CDN). Declared in `index.html` via `@font-face`.

### Archivo

| | |
|---|---|
| weights | 400, 600 (normal) |
| upstream | https://github.com/Omnibus-Type/Archivo via [@fontsource/archivo](https://fontsource.org/fonts/archivo) 5.2.5 |
| license | OFL — see [`fonts/archivo/OFL.txt`](fonts/archivo/OFL.txt) |

| local path | role |
|---|---|
| `fonts/archivo/archivo-latin-400-normal.woff2` | labels, body |
| `fonts/archivo/archivo-latin-600-normal.woff2` | headers, buttons |

### IBM Plex Mono

| | |
|---|---|
| weights | 400, 500 (normal) |
| upstream | https://github.com/IBM/plex via [@fontsource/ibm-plex-mono](https://fontsource.org/fonts/ibm-plex-mono) 5.2.5 |
| license | OFL — see [`fonts/plex-mono/OFL.txt`](fonts/plex-mono/OFL.txt) |

| local path | role |
|---|---|
| `fonts/plex-mono/ibm-plex-mono-latin-400-normal.woff2` | measurements, inputs |
| `fonts/plex-mono/ibm-plex-mono-latin-500-normal.woff2` | emphasized numerics |

### Updating

1. `npm pack` the new `@fontsource/*` release; copy the latin `*-normal.woff2` files above.
2. Refresh `OFL.txt` from the package `LICENSE` and the versions in this file.
3. Keep total WOFF2 payload under ~150 KB.
