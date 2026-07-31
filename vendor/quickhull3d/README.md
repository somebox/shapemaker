# quickhull3d (vendored)

| | |
|---|---|
| version | **3.1.2** |
| upstream | https://github.com/mauriciopoppe/quickhull3d |
| license | MIT — see [`LICENSE`](LICENSE) |

`quickhull3d.js` is a single-file ESM bundle of the published package (esbuild,
browser platform) so the static site has no npm runtime and no bare-specifier
resolution. Only [`src/hull.js`](../../src/hull.js) imports this module.

### Local modification

One deliberate patch, marked `[shapemaker patch]` in the bundle: the
`localstorage()` helper inside the bundled `debug` dependency is stubbed to
return `undefined`. Upstream probes the global `localStorage`, which triggers
Node's `ExperimentalWarning: localStorage is not available` in every test and
acceptance run; debug logging is unused by this app. A regression test
(`test/hull-capability.test.js`) fails if the warning ever returns.

### Updating

1. `npm pack quickhull3d@VERSION` and bundle `dist/index.js` with esbuild
   (`--bundle --format=esm --platform=browser`).
2. Replace `quickhull3d.js`, refresh `LICENSE` / `VERSION`, update this table.
3. **Reapply the `[shapemaker patch]` localStorage stub above** (or bundle
   with `--alias:debug=<no-op stub>` to avoid needing it).
4. Run `npm test` (includes the hull capability harness and the
   no-warning regression).
