# Shapemaker

A browser app for designing geometric forms for physical fabrication and art.
Choose a base shape, scale and modify it with real millimetre dimensions, rest
it on a face, and export an STL for printing or an SVG line drawing.

**Live app:** [somebox.github.io/shapemaker](https://somebox.github.io/shapemaker/)

![Shapemaker — start chooser, shape controls, and an open icosidodecahedron
frame](media/screenshot-v0.6.png)

## Try it

Open the [live app](https://somebox.github.io/shapemaker/). No install is
required. On first visit, a short tip walks through the loop:

1. **Pick a start** — choose a built-in shape from the Start from row.
2. **Adjust** — the tabs hold Shape (size, jitter, dual, truncate, spike,
   subdivide, smooth), Openings (border, fillet) and Build (hollow/solid, wall).
3. **Click a face** — set which side rests on the print bed.
4. **Export** — the Files tab has the STL for the slicer and an SVG outline.

Share a design with the **Share** control (copies a link that restores the
same settings). **Export** / **Load** under JSON Model File save and reopen
a `.shapemaker.json` project on your machine.

## Exports

| Hidden-line SVG | Oriented STL | In the slicer |
|---|---|---|
| [![Hidden-line SVG export](media/example-export.png)](media/example-export.svg) | [![Rendered STL export](media/example-stl-render.png)](media/example-export.stl) | [![Prusaslicer screenshot](media/prusa-slicer-screenshot-thumb.png)](media/prusa-slicer-screenshot.png) |

- **STL** — binary mesh in millimetres, already oriented to the resting
  face. Filenames include size (and seed / point count when those matter).
- **SVG** — camera-matched hidden-line drawing (silhouette and crease
  edges), editable in vector tools.

Optional **Print risk** and **Section** tools sit on the viewport: overhang /
flat-bridge overlays, and a height clip to inspect cavities.

## What you can change

| Area | Controls |
|---|---|
| Shape: start | Platonic solids, icosidodecahedron, cuboctahedron, rhombicosidodecahedron, rhombic 12/30/90, globe, twisted globe, sphere, random hull; named star and ring-ball presets |
| Shape: size | Overall diameter; Edge length on regular shapes |
| Shape: distort | Jitter (amount, direction, seed), dual, truncate, spike, subdivide, smooth |
| Openings | Open or closed faces, polygon or ellipse outline, border, fillet |
| Build | Hollow or solid, wall, rounding, tapered / straight / through sides, mesh quality (Draft / Normal / Fine), resting face, material / mass estimate; advanced: inner wall (even or scaled about the centre), break out |
| Files | STL, SVG and project files, geometry detail, share link |

**Ring balls.** Turn **Dual** on and set **Outline** to Ellipse: Dual swaps
faces for vertices, so a triangulated sphere becomes pentagon and hexagon
cells, and each cell opens with its largest inscribed oval. Neighbouring rings
meet along a short neck. The *Ring ball* and *Ring lantern* presets start
there; add Truncate to perforate the junctions between rings.

Quality densifies real triangles in both the preview and the STL — the view
stays flat-shaded so what you see is what you print.

## Run locally

The app is static files (no build step). Serve over HTTP — ES modules do not
load from `file://`:

```bash
# from the directory that contains shapemaker/
cd ..
python3 -m http.server 8000
# open http://localhost:8000/shapemaker/
```

Serving the repo root at `/` also works.

## License

MIT — see [`LICENSE`](LICENSE).

## Docs

| Doc | Audience |
|---|---|
| [`DEV.md`](DEV.md) | Developing, testing, CI, and project layout |
| [`docs/SPEC.md`](docs/SPEC.md) | Product behavior and architecture |
| [`docs/PROJECT_FORMAT.md`](docs/PROJECT_FORMAT.md) | `.shapemaker.json` files |
| [`docs/PRODUCTION.md`](docs/PRODUCTION.md) | Laser-cut, folded and sewn output: design and plans |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Future ideas and backlog |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Released versions |

Contributions welcome when they improve physical design, fabrication handoff,
or the experience of creating interesting forms. See [`DEV.md`](DEV.md).
