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
| **Smooth** | `Shape` / `soften` (`0–100%`) | Global form fairing with added surface definition: a simple cube becomes filleted and progressively sphere-like; on a spiked star like Stella Octangula, sharp spikes turn into soft bumps/lobes and concave inner joints relax into rounded saddle transitions. | Disabled by default (`subdiv = 0`), disabled whenever `spike > 0` or `subdivStyle = "grid"`, and implemented as a convex-halfspace Minkowski clip that duplicates `Rounding` on convex solids and amputates spikes on stars. |
| **Rounding** | `Build` / `roundingMm` (`mm`) | Physical-radius rolling-ball fillets on sharp convex edges, corners, and opening lips ("sanding and filing down edges so the model is easier to handle" while keeping flat faces, concave valleys, and overall geometry fixed). | Clamps ball radius `r` directly to face-band budgets (`w`), over-clamps corners at `0.2 * edgeLen`, leaves 29–62% of the slider track inert (and preserves pre-subdivision ceiling overrides in `compile.js`), produces 4-pointed star artefacts on 4-valent corners at wide radii, flattens mixed valley/ridge corners, and uses only 3 arc facets at Normal quality. |

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
3. **Zero valley relaxation & unscaled refinement on open stars**: Halfspace
   clipping only trims protrusions; it never relaxes concave valleys into smooth
   saddle transitions. Meanwhile, because `buildShell` constructs each opening in
   a planar `FaceFrame` (`1` opening per planar skeleton face), manually setting
   `Subdivide = Twice` on a 60-face star forces a $16\times$ split ($960$ faces)
   while `spike > 0` still locks `Smooth` out.

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

### 3.2 Six bottlenecks in the rounding math

1. **Ball-radius vs. tangency-width unit mismatch (`src/solid/shell.js:334–340`)**:
   Across a convex edge of interior dihedral angle $\omega$, a rolling ball of
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

3. **Single-face slider ceiling (`src/limits.js:123, 142`) and pre-subdivision override (`src/compile.js:90–100`)**:
   - `computeLimits` computes `roundingMmMax` as $\max_f (0.45 \cdot \text{edgeDistMax}_f)$,
     ignoring that each edge is bounded by $\min(a_{f_1}, a_{f_2}) / \cot(\omega/2)$
     and corner trim. On mixed-face solids like the icosidodecahedron, pentagons
     set the slider ceiling (`9.57 mm`) while every edge touches a triangle
     (`4.01 mm`), making the upper 58% of the slider a no-op.
   - In addition, `limitsFor()` in `src/compile.js:98–100` overrides
     `limits.roundingMmMax` on subdivided shapes with
     `Math.max(limits.roundingMmMax, preSub.roundingMmMax)`. When `subdiv > 0`
     with `openings = true`, micro-face border allowances are smaller than the
     unsubdivided parent's, so this override re-introduces dead slider travel
     even after `computeLimits()` is fixed.

4. **4+-valent corner-cap cylinder union & unclipped wide-face corners (`src/solid/edgeround.js:465–545, 998–1075`)**:
   - At degree $\ge 4$ vertices where faces of different inradii meet (e.g., the
     4-valent vertices of the icosidodecahedron, cuboctahedron, or
     rhombicosidodecahedron), the offset planes $\{ n_f \cdot q = d_f - r \}$ do
     not share a single equidistant sphere centre $X$. Solving a single
     least-squares centre `solve3(A, rhs)` and taking the **union** (`max`) of
     the 4 incident edge cylinders in `envelope(d)` causes the cylinders to
     poke out across the corner cap as a 4-pointed star ridge once larger radii
     are unlocked.
   - Simultaneously, `perFace[m] = trimAt(e, v, m)` computes each face's corner
     trim from its own corner angle $\gamma_m$ alone (`0.727 * w` on a pentagon
     vs. `1.732 * w` on the adjacent triangle), leaving the pentagon's flat
     inset corner sticking out past the triangle's offset plane as a dog-ear
     step.

5. **Mixed sharp/rounded corners at spike bases (`src/solid/edgeround.js:943`)**:
   Skipping reflex spike valleys (`r = 0`) keeps gutters sharp, matching
   ridge-only sanding. However, at every spike-base vertex where rounded ridges
   meet a `r = 0` valley spoke, `spokes.some(sp => !(edges[sp.ei].r > 0))`
   branches to `capPinched`, filling the junction with a flat planar wedge
   rather than smoothly tapering the ridge fillet.

6. **Coarse fixed arc tessellation (`src/solid/shell.js:68`)**:
   `roundingSegmentsFor(edgeDiv)` returns $\max(2, \operatorname{round}(0.3 \cdot \text{edgeDiv}))$,
   which is **`3` segments** at default Normal quality (`edgeDiv = 10`). Under
   flat shading (`SPEC.md` §Preview), 3 facets across a $90^\circ\text{–}110^\circ$
   fillet ($30^\circ+$ steps) look like a multi-bevel chamfer on wide radii.

---

## 4. Mathematical solution

### 4.1 Downstream invariants and true star-convexity certificate

Every downstream stage (`buildShell`, `Even` inner-wall offsets in
`src/solid/offset.js`, sheet unfolding in `src/sheet/panels.js`, orientation,
and STL export) relies on two skeleton invariants in `src/skeleton.js`:

1. **`assertSkeleton`**: closed, manifold, consistently outward-wound faces,
   each strictly planar within $10^{-7} R$ (satisfied identically by any
   non-degenerate triangle mesh).
2. **Strengthened `assertStarShaped` (radial injectivity, not just winding number)**:
   Currently, `starCover(skeleton)` (`src/skeleton.js:155`) checks only that the
   total signed solid angle satisfies $\frac{1}{4\pi} \sum_t \Omega_t = 1 \pm 10^{-6}$.
   By Gauss's law, any closed orientable surface enclosing the origin has total
   winding number $1$—even if a fold causes a ray from the origin to exit,
   re-enter, and exit again ($+1 - 1 + 1 = +1$).
   On a closed manifold mesh (`assertSkeleton`), the radial projection
   $\pi: M \to S^2$, $p \mapsto p / \|p\|$, is a global bijection (every ray from
   the origin intersects $M$ once, transversely) **if and only if** both:
   - $\frac{1}{4\pi} \sum_t \Omega_t = 1 \pm 10^{-6}$, and
   - **every individual fan triangle $t = [a, b, c]$ has strictly positive
     signed solid angle $\Omega_t > 10^{-12}$** (equivalently, scalar triple
     product $\det(P_a, P_b, P_c) > 0$).
   Strengthening `assertStarShaped` to enforce $\Omega_t > 10^{-12}$ per
   triangle turns it into a complete $O(F)$ certificate of star-shapedness.

### 4.2 `Smooth`: deterministic subdivision fairing across convex and spiked meshes

Replace the halfspace Minkowski clip in `src/subdivide.js` with a deterministic
5-step **blended polygonal subdivision + umbrella fairing** pipeline
parameterized by $s = \text{soften} / 100 \in [0, 1]$ and refinement level
$n \ge 1$:

1. **Exact $s = 0$ fast path**:
   When $s = 0$, run the existing flat `subdivideOnce` verbatim so both
   `radial` and `grid` topologies remain byte-identical to current anchors.

2. **Per-level step weight**:
   For $s > 0$ and $n \ge 1$, set the per-level blend factor to
   $\alpha = s^{1/n}$ so multi-level subdivision displacement scales linearly
   across the slider track rather than attenuating as $s^n$.

3. **Unified Catmull–Clark / 4:1 subdivision step ($\ell = 0 \dots n-1$)**:
   - **Face centroid**: For every face $f$ with $k = |f|$ vertices,
     $F_f = \frac{1}{k} \sum_{v \in f} P_v$.
   - **Edge point**: For every undirected edge $e = (u, v)$ with midpoint
     $M_e = \frac{1}{2}(P_u + P_v)$ and incident faces $f_0, f_1$:

     $$
     E_e = (1 - \alpha) M_e + \alpha \cdot \frac{1}{4}(P_u + P_v + F_{f_0} + F_{f_1})
     $$

   - **Vertex point**: For every vertex $v$ of edge-valence $d = |N(v)|$,
     incident-face centroid mean $F_{\text{avg}}(v)$, and incident-edge midpoint
     mean $M_{\text{avg}}(v)$:

     $$
     w_{\text{self}}(d) = \min\!\left(\frac{d - 3}{d},\; 0.45\right), \qquad
     C_v = w_{\text{self}}(d)\, P_v + \big(1 - w_{\text{self}}(d)\big)\frac{F_{\text{avg}}(v) + 2 M_{\text{avg}}(v)}{3}
     $$

     $$
     V'_v = (1 - \alpha) P_v + \alpha C_v
     $$

     For $d \in \{3, 4, 5\}$, $w_{\text{self}}(d) = (d - 3)/d \le 0.4$, which is
     the exact Catmull–Clark vertex stencil; capping $w_{\text{self}}(d) \le 0.45$
     for $d \ge 6$ prevents high-valence concave spike-valley saddles (such as
     Stella Octangula's $d = 8$ inner joints) from pinning in place.
   - **Per-level topology**:
     - Triangles ($k = 3$) split `4:1` into $[V'_a, E_{ab}, E_{ca}]$,
       $[E_{ab}, V'_b, E_{bc}]$, $[E_{ca}, E_{bc}, V'_c]$, and
       $[E_{ab}, E_{bc}, E_{ca}]$ (no face centroid inserted inside triangles).
     - Polygons ($k \ge 4$) split into $k$ Catmull–Clark corner quads
       $[E_{\text{prev}}, V'_a, E_{\text{next}}, F_f]$ across all $n$ levels so
       intermediate vertices maintain regular valence $4$.

4. **Post-subdivision umbrella relaxation (2 passes)**:
   Apply 2 uniform 1-ring umbrella fairing passes with weight $\lambda = 0.35 s$:

   $$
   P_v \leftarrow P_v + \lambda \left(\frac{1}{|N(v)|} \sum_{u \in N(v)} P_u - P_v\right)
   $$

   which eliminates residual extraordinary-vertex creases at valence-3 spike
   tips and valence-8 inner valleys.

5. **Canonical symmetric quad triangulation & circumradius restoration**:
   - Split every quad $[E_{\text{prev}}, V'_a, E_{\text{next}}, F_f]$ along its
     canonical parent-corner-to-face-center diagonal $(F_f, V'_a)$ into two
     triangles $[F_f, E_{\text{prev}}, V'_a]$ and $[F_f, V'_a, E_{\text{next}}]$.
     This diagonal is invariant under the full point group (rotations and
     mirror planes) of every polyhedron and guarantees exact face planarity
     ($\text{dev} = 0$).
   - Normalize $P \leftarrow P / \max_v \|P_v\|$ so `circumdiameterMm` holds.

6. **Prototype verification (`node` against strengthened `assertStarShaped` + `buildShell` + `assertMeshInvariants`)**:

   | Shape (2 levels) | Current `s = 0.5` ($r_{\min}..r_{\max}$) | Deterministic fairing `s = 0.5` | Deterministic fairing `s = 1.0` | `assertSkeleton` + strict `assertStarShaped` + `buildShell` |
   |---|---|---|---|---|
   | Cube | `0.577 .. 0.789` (flat centres) | `0.878 .. 1.000` | `0.970 .. 1.000` (sphere-like) | Pass (solid, hollow-even, open) |
   | Icosidodecahedron | `0.909 .. 0.939` | `0.932 .. 1.000` | `0.957 .. 1.000` | Pass |
   | Spiked Cube (`t = 1.3`) | Disabled (clips spikes) | `0.800 .. 1.000` | `0.854 .. 1.000` | Pass |
   | Stella Octangula (`t = √3`) | `0.333 .. 0.455` (spikes lost) | `0.676 .. 1.000` | `0.738 .. 1.000` (soft lobes + saddles) | Pass |
   | Great Stellated Dodeca | Disabled (clips spikes) | `0.639 .. 1.000` | `0.726 .. 1.000` | Pass |
   | Jittered Cube (`25%`) | `0.577 .. 0.820` | `0.859 .. 1.000` | `0.949 .. 1.000` | Pass |

7. **Direct activation, opening semantics, and sheet-production behaviour**:
   - Remove `!(s.subdiv > 0)`, `s.subdivStyle === "grid"`, and `s.spike > 0`
     from `soften.inertWhen` (`src/schema.js:301`) and `generatorParams`
     (`src/pipeline.js:49`).
   - **Opening topology under auto-refinement**: Because `buildShell` constructs
     each opening in a planar `FaceFrame`, curving a face requires planar
     micro-facets and therefore **intentionally refines the opening lattice**
     (one opening per refined face, scaled proportionally by `borderFraction`
     with `borderPrintabilityWarning` firing whenever the thinnest applied
     border falls below `2.5 mm`). When `subdiv === 0` and `soften > 0`, size
     automatic refinement (`autoLevel`) conservatively by base face count
     (`autoLevel = faces.length <= 12 ? 2 : 1`) so coarse bases (tetrahedron,
     cube, octahedron, dodecahedron) receive 2 levels of fairing definition
     while 24–60 face shapes (Stella Octangula, Icosidodecahedron, Stellated
     Dodecahedron) refine by $4\times$ rather than $16\times$.
   - **Sheet production (`cut` and `fold` in `src/sheet/panels.js`)**:
     `extractPanels` merges coplanar neighbours (`< 0.05°`), so `soften = 0`
     subdivisions merge back into parent panels while `soften > 0` triangulations
     produce faceted geodesic panels (preserving the existing `icosahedron
     subdiv=1 soften=1` sheet fold anchor in `test/sheet.test.js:241`).
   - If a star at extreme `spike` + `soften` ever violates the strengthened
     `assertStarShaped`, surface a named validation error on `soften` with a
     `clampTo: 0` fix rather than locking the slider globally.

### 4.3 `Rounding`: physical band budgets, honest ceilings, clean corner caps, smooth arcs

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

3. **Exact macro-edge slider ceiling (`src/limits.js`) and `limitsFor()` cleanup (`src/compile.js:90–100`)**:
   - Update `computeLimits()` in `src/limits.js` to evaluate Stage-2 edge
     budgets on `buildMacroTopology(skeleton, frames)` over convex macro edges,
     using $\min(a_{f_1}, a_{f_2}) / \cot(\omega/2)$ and the corner-trim cap
     `0.45 * e.len` (plus the Stage-1 rim ceiling when `openings === true`).
   - Because macro-topology evaluation already preserves the parent-edge
     dihedral ceiling on subdivided closed shapes while respecting micro-face
     border bands on subdivided open shapes, **remove the `preSub.roundingMmMax`
     override in `limitsFor()` (`src/compile.js:98–100`)** so subdivided open
     models no longer inherit an unreachable pre-subdivision slider ceiling.

4. **Halfspace-projected corner caps on 4+-valent vertices & cleaner spike-valley corners (`src/solid/edgeround.js`)**:
   - At degree $\ge 4$ corners (e.g., icosidodecahedron, cuboctahedron), clip
     `perFace[m]` against the corner's incident offset planes and project
     corner-cap interior vertices onto the local corner rolling-ball surface
     $\{ q : n_f \cdot q \le d_f - r_f \;\forall f \in F(v) \}$ expanded by $r$,
     eliminating the 4-pointed cylinder-union star ridges and pentagon dog-ears.
   - Improve mixed sharp/rounded junctions on spiked bases (`edgeround.js:943`)
     so rounded ridge strips taper cleanly into sharp valley vertices.

5. **Adaptive arc segment count (`src/solid/shell.js:68`)**:
   - Scale strip/cap segment count $J$ with both `edgeDiv` and maximum subtended
     arc length $r \cdot (\pi - \omega)$ (targeting chord error $\lesssim 0.08\text{ mm}$
     at Normal quality, capped at $J \le 16$) so large fillets look smoothly
     sanded under flat shading while `roundingMm = 0` remains byte-identical.

### 4.4 Visual validation workflow

In addition to topological and numerical checks (`npm test` and
`scripts/acceptance.sh`), Shapemaker already ships a zero-dependency headless
z-buffered PNG renderer (`renderPng` and `fitCamera` in
`scripts/lib/render3d.mjs`) and an analytic hidden-line SVG exporter
(`exportSvg` in `src/export/svg.js`). We use these for direct visual validation
before and after implementation:

1. **Headless PNG contact sheets (`scripts/lib/render3d.mjs`)**:
   - **Cube (`Smooth` vs. `Rounding`)**:
     - `Smooth` (`soften = 50%`, `100%`): verify that a simple cube becomes
       filleted and progressively sphere-like with smooth shading transitions.
     - `Rounding` (`roundingMm = 8–12 mm`, closed & open): verify that flat cube
       faces stay flat while the 12 edges and 8 corners roll over into smooth
       cylindrical/spherical fillets (matching the CAD fillet reference).
   - **Stella Octangula (`Smooth` vs. `Rounding`)**:
     - `Smooth` (`soften = 50%`, `100%`): verify that the 8 sharp spikes turn
       into soft rounded bumps/lobes and the concave inner joints relax into
       smooth saddle transitions.
     - `Rounding` (`roundingMm = 3.5 mm`): verify that the star's triangular
       flanks and sharp inner valleys are preserved while the outer ridges and
       tips roll over as if sanded and filed down.
   - **Icosidodecahedron (`Rounding` at max slider)**:
     - Verify wide-radius rolling-ball fillets across 4-valent triangle/pentagon
       corners with zero star-ridge or dog-ear artefacts.
2. **Hidden-line SVG inspection (`src/export/svg.js`)**:
   - Render crease/silhouette line drawings (`exportSvg`) to confirm clean
     tangency seams and absence of spurious crease lines across faired surfaces
     and corner caps.

---

## 5. Implementation plan

1. **Slice 1 — Fix `Rounding` range, ceilings, corner caps, and arc density**
   - Fix `radiusForEdge` vs. `allowForEdge` in `src/solid/shell.js`, remove the
     redundant `0.2 * e.len` pre-cap in `src/solid/edgeround.js`, raise the
     closed-face band allowance to `0.80 * width`, and project 4+-valent
     corner-cap interiors onto the local corner halfspace intersection.
   - Update `computeLimits()` in `src/limits.js` to compute `roundingMmMax` from
     true macro-edge dihedral and trim budgets, and remove the
     `preSub.roundingMmMax` override in `limitsFor()` (`src/compile.js:98–100`)
     so slider max equals max applied radius across both unsubdivided and
     subdivided states.
   - Make `roundingSegmentsFor` radius/angle-aware so wide fillets are smoothly
     tessellated; keep `roundingMm = 0` byte-identical.
   - Add regression tests in `test/rounding-regressions.test.js`,
     `test/solidifier.test.js`, and `test/limits.test.js`.

2. **Slice 2 — Replace `Smooth` with deterministic subdivision fairing & unlock UI**
   - Strengthen `assertStarShaped` in `src/skeleton.js` to check per-triangle
     positive solid angle $\Omega_t > 10^{-12}$ in addition to total cover $1$.
   - Implement the 5-step deterministic subdivision + umbrella fairing pipeline
     in `src/subdivide.js` (preserving exact `soften = 0` parity for both
     `radial` and `grid`, and canonical $(F_f, V'_a)$ planar quad splitting for
     `soften > 0`).
   - Enable `Smooth` directly from `subdiv = 0` (auto-refining with
     `autoLevel = faces.length <= 12 ? 2 : 1` when `soften > 0`), unlock
     `spike > 0` and `subdivStyle = "grid"` in `src/schema.js` and
     `src/pipeline.js`, and update `src/perf.js` heavy-click prediction for
     `soften: 0 -> >0` when `subdiv = 0`.
   - Update `test/subdivide.test.js`, `test/spike.test.js`, `test/limits.test.js`
     (including border-fit and `borderPrintabilityWarning` coverage on
     auto-refined open shapes), and `test/controls.test.js`.

3. **Slice 3 — Composition, spike-corner polish, sheet checks, visual renders, and spec update**
   - Verify `Smooth + Rounding` composition (`macroFaceId` handling when parent
     dihedrals have already been faired vs. crisp `soften = 0` subdivisions),
     refine mixed sharp-valley / rounded-ridge caps on spiked meshes, and verify
     `produce()` (`cut` and `fold` in `src/sheet/panels.js`) on smoothed shapes.
   - Generate visual validation renders (`scripts/lib/render3d.mjs`) for Cube,
     Stella Octangula, and Icosidodecahedron across `Smooth` and `Rounding`.
   - Run the full unit suite (`npm test`) and Python mesh acceptance matrix
     (`bash scripts/acceptance.sh`) for watertightness, winding, and zero
     self-intersections; update `docs/SPEC.md`.
