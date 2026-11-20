# Smooth and Rounding — geometry analysis and implementation plan

Analysis and design plan for separating and fixing **Smooth** (`soften`, Shape
stage) and **Rounding** (`roundingMm`, Build stage). What currently ships is
documented in [SPEC.md](../SPEC.md); once implemented and verified against the
mesh acceptance suite, `SPEC.md` will be updated to match.

---

## 1. Intended roles vs. current behaviour

Shapemaker's pipeline already places the two controls at the right stages:

```text
Shape stage (unit skeleton — changes overall form):
  base -> jitter -> dual -> truncate -> spike -> subdivide / smooth (src/subdivide.js)

Build stage (mm solidifier — fillets hard edges without changing form):
  scale -> Stage-2 dihedral edge rounding (src/solid/edgeround.js)
        -> Stage-1 opening-rim roundovers (src/solid/shell.js)
```

| Operator | Tab / Key | Intended geometry | What happens today |
|---|---|---|---|
| **Smooth** | `Shape` / `soften` (`0–100%`) | Global form fairing with added surface definition: hard corners, ridges, and concave spike valleys soften into flowing surfaces. | Disabled by default (`subdiv = 0`), disabled whenever `spike > 0` or `subdivStyle = "grid"`, and implemented as a convex-halfspace Minkowski clip that duplicates `Rounding` on convex solids and amputates spikes on stars. |
| **Rounding** | `Build` / `roundingMm` (`mm`) | Physical-radius rolling-ball fillets on sharp convex edges, corners, and opening lips ("sanding down a sculpture" while keeping flat faces and overall geometry fixed). | Clamps ball radius `r` directly to face-band budgets (`w`), over-clamps corners at `0.2 * edgeLen`, leaves 30–62% of the slider track inert, flattens mixed valley/ridge corners, and uses only 3 arc facets at Normal quality. |

---

## 2. Diagnosis of `Smooth`

### 2.1 UI and pipeline lockouts

In `src/schema.js:301` and `src/pipeline.js:49`, `soften` is gated by:

```js
inertWhen: (s) => !(s.subdiv > 0) || s.subdivStyle === "grid" || s.spike > 0
```

1. **Inert on every default shape (`subdiv === 0`)**: Every base and start
   preset begins with `Subdivide = None`. Because `.control[data-inert="1"]`
   (`index.html:637`) applies `opacity: 0.38; pointer-events: none` with no
   explanatory note—and dragging `Smooth` cannot auto-enable mesh refinement—the
   control appears permanently disabled.
2. **Permanently locked when `spike > 0`**: Even after setting `Subdivide` to
   `Once` or `Twice`, any spiked primitive or Star preset disables `Smooth` in
   the UI and strips `soften` from `generatorParams()` (`src/pipeline.js:49`).
3. **Locked under `Pattern = Grid`**: `subdivStyle === "grid"` emits quads on
   $k$-gons ($k \ge 4$). Moving vertices bends quads out of plane and trips
   `assertSkeleton`'s planarity check (`src/skeleton.js:128`), so `Smooth` is
   disabled rather than splitting non-planar quads.

### 2.2 Convex-halfspace Minkowski clip (`src/subdivide.js:71–125`)

Even when active (`subdiv > 0`, `radial`, `spike === 0`), `subdivideSkeleton`
does not perform surface fairing or subdivision smoothing. Instead, given parent
face planes $\{ (n_f, d_f) \}$ with $r_{\text{end}} = \min_f d_f$ and
$R = s \cdot r_{\text{end}}$, it projects each subdivided vertex $p$ onto the
inset halfspace intersection via Dykstra's alternating projection:

$$
K_R = \{ q \in \mathbb{R}^3 : n_f \cdot q \le d_f - R \;\; \forall f \}, \qquad
p' = q + R \frac{p - q}{\|p - q\|} \quad (\text{when } \|p - q\| > R)
$$

followed for $s > 0.5$ by a spherical clip $\|p'\| \le 1 - 2(s - 0.5)(1 - r_{\text{end}})$.

This formulation has three structural problems:

1. **Duplicates `Rounding` on convex shapes**: For $0 < s \le 0.5$, the locus
   $\{ \operatorname{dist}(p, K_R) \le R \}$ is the exact rolling-ball edge
   fillet of the parent convex polyhedron—face interiors remain flat fixed
   points while edges bevel coarsely across 1 or 3 subdivision rings.
2. **Destroys non-convex / spiked shapes**: Representing a solid as
   $\bigcap_f \{ n_f \cdot q \le d_f \}$ is valid only for convex polyhedra. On
   a spiked star, each pyramid's flank planes slice across neighbouring spikes,
   so $\bigcap_f \{ n_f \cdot q \le d_f \}$ reduces to the inner halfspace
   **kernel**. Calling `subdivideSkeleton(stellaOctangula, 2, 0.5)` collapses
   spike tips from $r_{\max} = 1.000$ down to $0.455$, amputating all eight
   spikes.
3. **Zero valley relaxation & conflation with `Openings`**: Halfspace clipping
   only trims protrusions; it never relaxes concave valleys into smooth saddle
   transitions. Meanwhile, because `Subdivide` splits faces 1:1 with openings
   when `Faces = Open`, setting `Subdivide = Twice` just to give `Smooth`
   vertices turns a 60-face star into 960 tiny openings with unprintable struts.

---

## 3. Diagnosis of `Rounding`

### 3.1 Measured behaviour across shapes (`compile()` at Ø100 mm)

Setting `roundingMm` to the UI slider ceiling (`limits.roundingMmMax`) on Ø100 mm
models shows both how shallow the applied rounding is and how much of the slider
track is dead:

| Case (Ø100 mm) | Slider Max | Applied `r` | Corner Shave | Dead Slider Zone |
|---|---:|---:|---:|---:|
| Default Icosidodeca (open, hollow) | `4.59 mm` | `0.70 .. 1.93 mm` | `0.23 mm` | **58%** (`1.93 -> 4.59`) |
| Icosidodeca (closed, solid) | `9.57 mm` | `4.01 mm` | `0.47 mm` | **58%** (`4.01 -> 9.57`) |
| Icosahedron (closed, solid) | `6.83 mm` | `6.83 mm` | `1.76 mm` | 0% |
| Dodecahedron (closed, solid) | `11.05 mm` | `10.98 mm` | `2.84 mm` | 1% |
| Cube (open, hollow) | `6.24 mm` | `0.70 .. 6.24 mm` | `4.56 mm` | 0% |
| Cube (closed, solid) | `12.99 mm` | `11.55 mm` | `8.45 mm` | **11%** (`11.55 -> 12.99`) |
| Tetrahedron (closed, solid) | `10.61 mm` | `7.50 mm` | `15.00 mm` | **29%** (`7.50 -> 10.61`) |
| Stella Octangula (closed, solid) | `5.30 mm` | `3.75 mm` | `7.50 mm` | **29%** (`3.75 -> 5.30`) |
| Great Stellated Dodeca (closed, solid) | `5.09 mm` | `1.94 mm` | `8.42 mm` | **62%** (`1.94 -> 5.09`) |

### 3.2 Five bottlenecks in the rounding math

1. **Ball-radius vs. tangency-width unit mismatch (`src/solid/shell.js:334–340`)**:
    across a convex edge of interior dihedral angle $\omega$, a rolling ball of
   physical radius $r$ consumes tangency width $w$ on each adjacent face and
   shaves radial crest depth $\delta$:

   $$
   w = r \cot\!\left(\frac{\omega}{2}\right), \qquad
   \delta = r \left(\csc\!\left(\frac{\omega}{2}\right) - 1\right)
   $$

   In `shell.js:326`, `allow` (`0.6 * frac * width` when open, `0.45 * width`
   when closed) is a **face-plane band budget** $w_{\max}$, which
   `edgeround.js:176` already enforces via `if (r * cotHalf > budget) r = budget / cotHalf`.
   However, `shell.js:335` *also* clamps `r = Math.min(roundingMm, a)`. On
   obtuse polyhedra ($\omega > 90^\circ \implies \cot(\omega/2) \ll 1$), this
   caps $r$ roughly **$3\times$ too small**: on the Ø100 mm icosidodecahedron
   ($\omega = 142.6^\circ$, $\cot(\omega/2) = 0.338$), clamping $r \le 4.01\text{ mm}$
   yields a strip only $1.35\text{ mm}$ wide and shaves just $0.47\text{ mm}$
   off a $100\text{ mm}$ solid ($0.23\text{ mm}$ when open).

2. **Conservative closed-face apothem cap (`0.45 * width`) and redundant corner pre-cap (`edgeround.js:207`)**:
   - On a closed convex polygon face, insetting every edge $k$ by
     $w_k = \alpha \cdot d_k$ ($d_k = \text{edgeDist}[k]$, centroid-to-edge
     apothem) scales the inner flat island by $1 - \alpha > 0$ up to
     $\alpha < 1$. Capping closed faces at `0.45 * width` (`shell.js:326`)
     leaves $55\%$ of every face radius unroundable, confusing apothem
     homothety ($\alpha < 1$) with half-edge meeting ($\le 0.5 \cdot L$).
   - Before `edgeround.js:254` solves the exact corner trim
     `trimAt <= 0.45 * e.len`, line 207 imposes an extra
     `wCap = 0.2 * e.len * Math.max(Math.sin(gamma), 0.05)`, throttling a closed
     Ø100 mm cube at `11.55 mm` (`20%` of edge length).

3. **Single-face slider ceiling (`src/limits.js:123, 142`)**:
   `computeLimits` computes `roundingMmMax` as $\max_f (0.45 \cdot \text{edgeDistMax}_f)$,
   ignoring that each edge is bounded by $\min(a_{f_1}, a_{f_2}) / \cot(\omega/2)$
   and corner trim. On mixed-face solids like the icosidodecahedron, pentagons
   set the slider ceiling (`9.57 mm`) while every edge touches a triangle
   (`4.01 mm`), making the upper 58% of the slider a no-op.

4. **Mixed sharp/rounded corners at spike bases (`src/solid/edgeround.js:943`)**:
   Skipping reflex spike valleys (`r = 0`) keeps gutters sharp, matching
   ridge-only sanding. However, at every spike-base vertex where rounded ridges
   meet a `r = 0` valley spoke, `spokes.some(sp => !(edges[sp.ei].r > 0))`
   branches to `capPinched`, filling the junction with a flat planar wedge
   rather than smoothly tapering the ridge fillet. Constant-$r$ strips also let
   narrow acute spike tips clamp $r$ all the way down the ridge.

5. **Coarse fixed arc tessellation (`src/solid/shell.js:68`)**:
   `roundingSegmentsFor(edgeDiv)` returns $\max(2, \operatorname{round}(0.3 \cdot \text{edgeDiv}))$,
   which is **`3` segments** at default Normal quality (`edgeDiv = 10`). Under
   flat shading (`SPEC.md` §Preview), 3 facets across a $90^\circ\text{–}110^\circ$
   fillet ($30^\circ+$ steps) look like a multi-bevel chamfer on wide radii.

---

## 4. Mathematical solution

### 4.1 Downstream invariants

Every downstream stage (`buildShell`, `Even` inner-wall offsets in
`src/solid/offset.js`, sheet unfolding, orientation, and STL export) relies on
two skeleton invariants in `src/skeleton.js`:

1. **`assertSkeleton`**: closed, manifold, consistently outward-wound faces,
   each strictly planar within $10^{-7} R$ (satisfied identically by any
   non-degenerate triangle mesh).
2. **`assertStarShaped`**: solid-angle cover about the origin
   $\frac{1}{4\pi} \sum_f \Omega_f = 1 \pm 10^{-6}$ (every ray from the origin
   exits the surface once, with $n_f \cdot c_f > 0$).

### 4.2 `Smooth`: blended subdivision & fairing across convex and spiked meshes

Replace the halfspace Minkowski clip in `src/subdivide.js` with **blended
polygonal subdivision fairing** parameterized by $s = \text{soften} / 100 \in [0, 1]$:

1. **Unified subdivision step (Catmull–Clark / Stam–Loop)**:
   - On general polygon skeletons (including triangles, quads, pentagons, mixed
     Archimedean solids, and spiked stars), each level computes:
     - Face centroid $F_f = \frac{1}{|f|} \sum_{v \in f} P_v$.
     - Edge point $E_e = (1 - s) M_e + s \cdot \frac{1}{4}(P_u + P_v + F_{f_0} + F_{f_1})$,
       where $M_e = \frac{1}{2}(P_u + P_v)$.
     - Updated corner $V'_v = (1 - s) P_v + s \cdot \frac{F_{\text{avg}} + 2 M_{\text{avg}} + (n - 3) P_v}{n}$
       (or valence-weighted Loop stencil on pure-triangle `4:1` splits so
       geodesic and spiked faces keep near-equilateral aspect ratios; for tall
       spikes, optional Taubin $\lambda|\mu$ pass preserves peak prominence).
   - **Planarization without symmetry bias**: When $s = 0$, existing flat
     `radial` and `grid` topologies stay byte-identical. When $s > 0$, any quad
     $[E_{\text{prev}}, V'_a, E_{\text{next}}, F_f]$ splits along its canonical
     parent-corner-to-face-center diagonal $(V'_a, F_f)$—which is invariant
     under the full point group (rotations and mirror planes) of every
     polyhedron and guarantees exact face planarity (`dev === 0`).
   - **Circumradius restoration**: Normalize $P \leftarrow P / \max_i \|P_i\|$ so
     `Size` (`circumdiameterMm`) continues to hold cleanly.

2. **Prototype check (`node` against `buildShell` + `assertMeshInvariants`)**:

   | Shape (2 levels) | Current `s = 0.5` ($r_{\min}..r_{\max}$) | Blended subdivision `s = 0.5` | Blended subdivision `s = 1.0` | `assertSkeleton` + `assertStarShaped` + `buildShell` |
   |---|---|---|---|---|
   | Cube | `0.577 .. 0.789` (flat centres) | `0.788 .. 1.000` | `0.966 .. 1.000` (near-ball) | Pass (solid, hollow-even, open) |
   | Icosidodecahedron | `0.909 .. 0.939` | `0.909 .. 1.000` | `0.937 .. 1.000` | Pass |
   | Spiked Cube (`t = 1.3`) | Disabled (clips spikes) | `0.751 .. 1.000` | `0.861 .. 1.000` | Pass |
   | Stella Octangula (`t = √3`) | `0.333 .. 0.455` (spikes lost) | `0.593 .. 1.000` | `0.769 .. 1.000` | Pass |
   | Great Stellated Dodeca | Disabled (clips spikes) | `0.554 .. 1.000` | `0.711 .. 1.000` | Pass |
   | Jittered Cube (`25%`) | `0.577 .. 0.82` | `0.767 .. 1.000` | `0.939 .. 1.000` | Pass |

3. **Direct activation & auto-definition**:
   - Remove `!(s.subdiv > 0)`, `s.subdivStyle === "grid"`, and `s.spike > 0`
     from `soften.inertWhen` (`src/schema.js:301`) and `generatorParams`
     (`src/pipeline.js:49`).
   - When `soften > 0` and `subdiv === 0`, automatically refine the skeleton
     (`autoLevel = faces.length > 100 ? 1 : 2`) so dragging `Smooth` immediately
     adds definition and flows the surface without requiring `Subdivide` first.
   - If a star at extreme `spike` + `soften` ever violates `assertStarShaped`,
     surface a named validation error on `soften` with a `clampTo` fix rather
     than locking the slider globally.

### 4.3 `Rounding`: physical band budgets, honest ceilings, smooth arcs

1. **Let `allowForEdge` govern strip width (`src/solid/shell.js:334–340`)**:
   Pass `roundingMm` as the requested ball radius in `radiusForEdge` and let
   `edgeround.js` clamp $w = r \cot(\omega/2) \le \text{allow}$. Measured
   immediately on Ø100 mm models (before changing face allowances):
   - Default icosidodeca (open): $r_{\max}$ rises `1.93 -> 5.70 mm` (**2.96×**).
   - Icosidodeca (closed): `4.01 -> 11.87 mm` (**2.96×**).
   - Icosahedron (closed): `6.83 -> 17.88 mm` (**2.62×**).
   - Rhombic triacontahedron (closed): `6.22 -> 17.01 mm` (**2.74×**).

2. **Remove the `0.2 * e.len` pre-cap and widen closed-face allowance**:
   - Drop `wCap = 0.2 * e.len * sin(gamma)` in `src/solid/edgeround.js:207` so
     the iterative `trimAt <= 0.45 * e.len` corner solver is the single
     along-edge constraint.
   - Raise closed-face band budget in `shell.js:326` from `0.45 * width` to
     `0.80 * width` (safe under centroid homothety $\alpha < 1$), allowing
     closed solids like a cube or dodecahedron to sand down deeply without
     collapsing face rings.

3. **Exact edge-derived slider ceiling (`src/limits.js`)**:
   Compute `roundingMmMax` over actual convex skeleton edges from
   $\min(a_{f_1}, a_{f_2}) / \cot(\omega/2)$ bounded by the corner-trim cap
   (plus Stage-1 rim ceiling when `openings` is true), eliminating dead slider
   zones.

4. **Adaptive arc segment count & cleaner mixed-valley corners**:
   - Scale strip/cap segment count $J$ with both `edgeDiv` and maximum subtended
     arc length $r \cdot (\pi - \omega)$ (targeting chord error $\lesssim 0.08\text{ mm}$
     at Normal quality, capped reasonably) so large fillets look smoothly sanded
     under flat shading while `roundingMm = 0` remains byte-identical.
   - Improve mixed sharp/rounded junctions on spiked bases (`edgeround.js:943`)
     so rounded ridge strips taper cleanly into sharp valley vertices.

---

## 5. Implementation plan

1. **Slice 1 — Fix `Rounding` range, ceilings, and arc density**
   - Fix `radiusForEdge` vs. `allowForEdge` in `src/solid/shell.js`, remove the
     redundant `0.2 * e.len` pre-cap in `src/solid/edgeround.js`, and raise the
     closed-face band allowance.
   - Update `computeLimits()` in `src/limits.js` to compute `roundingMmMax` from
     true per-edge dihedral and trim budgets so slider max equals max applied
     radius.
   - Make `roundingSegmentsFor` radius/angle-aware so wide fillets are smoothly
     tessellated; keep `roundingMm = 0` byte-identical.
   - Add regression tests in `test/rounding-regressions.test.js` and
     `test/limits.test.js`.

2. **Slice 2 — Replace `Smooth` with true subdivision fairing & unlock UI**
   - Implement blended subdivision fairing in `src/subdivide.js` (preserving
     exact `soften = 0` parity for both `radial` and `grid`, symmetric planar
     quad splitting for `soften > 0`, and star-convexity checks).
   - Enable `Smooth` directly from `subdiv = 0` (auto-refining when
     `soften > 0`), unlock `spike > 0` and `subdivStyle = "grid"` in
     `src/schema.js` and `src/pipeline.js`, and update `src/perf.js` heavy-click
     prediction for `soften: 0 -> >0` when `subdiv = 0`.
   - Update `test/subdivide.test.js`, `test/spike.test.js`, and
     `test/controls.test.js`.

3. **Slice 3 — Composition, spike-corner polish, docs, and acceptance**
   - Verify `Smooth + Rounding` composition (`macroFaceId` handling when parent
     dihedrals have already been faired vs. crisp `soften = 0` subdivisions) and
     refine mixed sharp-valley / rounded-ridge caps on spiked meshes.
   - Run the full unit suite (`npm test`) and Python mesh acceptance matrix
     (`bash scripts/acceptance.sh`) for watertightness, winding, and zero
     self-intersections; update `docs/SPEC.md`.
