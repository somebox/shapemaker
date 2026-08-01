# Border authoring on irregular hulls — evidence memo (v0.4)

This memo records irregular-hull evidence gathered during Milestone 5.
**Decision (v0.4): keep millimetre authoring** — locked in the ROADMAP
decision log.

## Measurements (Ø100 mm, 5 seeds per density: 1, 7, 42, 1337, 90210)

Maximum border that fits the seed's smallest face (`limits.borderMmMax`):

| density | N | caps across seeds (mm) | worst |
|---|---|---|---|
| sparse | 12 | 2.75 · 5.31 · 5.52 · 7.29 · 4.21 | **2.75** |
| medium | 24 | 1.73 · 1.73 · 1.81 · 2.75 · 2.37 | **1.73** |
| dense | 48 | 1.43 · 1.08 · 0.83 · 0.82 · 1.02 | **0.82** |

Spread on a single shape (medium, seed 1337, authored 2.0 mm): border runs
**2.0 → 7.37 mm** across faces — the authored value is the guaranteed
minimum at each face's narrowest edge; wide faces carry much more material.

Reference floor from the prototype's print experience: below ~2.5 mm
(≈ 6 lines at a 0.4 mm nozzle) frames go limp; the practical FDM floor is
roughly 2–2.5 mm.

## What this means

1. **Sparse random hulls print fine with mm borders.** Every sparse seed
   accepts ≥ 2.75 mm — at or above the printable floor.
2. **Medium is marginal, dense is below the floor at Ø100.** Most medium
   seeds cap below 2.5 mm; dense caps at ~0.8–1.4 mm. A dense lace ball at
   Ø100 cannot have printable borders *regardless of authoring model* —
   proportional authoring would not change the physics, only the units on
   the slider.
3. **The failure mode is size, not representation.** A dense hull becomes
   printable by scaling up (caps scale linearly: dense at Ø300 → ~2.5–4.3 mm)
   or by choosing fewer points — not by re-expressing the border as a
   fraction.
4. **Behavior shipped in v0.4**: skeleton-changing edits (base, seed,
   density, jitter) auto-clamp the border down to fit, with a one-line
   warning. Constant-mm remains the guaranteed *minimum* per face; Inspect
   shows the per-shape range.

## Recommendation — accepted in v0.4

**Keep millimetre authoring.** The evidence says proportional authoring
would not rescue the problematic cases (physics, not units), while mm keeps
the fabrication-first promise: the number on the slider is material width.

Shipped follow-up: when adaptation clamps the border below ~2.5 mm, the
warning adds "scale up or reduce density to print this"
(`adaptStateForBase` — single emitting site).

Still open if a future workflow wants "openness" as creative intent: add
proportional as a *display/readout* first, not a second authoring model.
