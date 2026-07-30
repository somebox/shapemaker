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
