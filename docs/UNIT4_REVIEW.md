# Unit 4 review stop — family productization

> **Status: superseded (v0.3.0).** The review happened during implementation
> and Unit 5 shipped. Two questions remain open as *usage* questions rather
> than release blockers, carried to the next review cycle:
> **(3) face stepper** — is it genuinely used, or is canvas click enough? —
> and **(5) edge pick** — do through-mesh back-side hits confuse in practice?
> Both have documented fallbacks in the phase plan (drop the stepper to a
> readout; require the ray to hit the shell first). Revisit with M5's
> irregular shapes, which stress both.

Living UI is ready for review before presets/release (Unit 5).

## Checklist

1. **Base selector** — Are the six regular bases understandable? Any label
   confusion (Icosidodecahedron vs Platonic names)?
2. **Preserve vs reset** — Switching family keeps size and Form intent; wall /
   border clamp with one warning line when needed; fillet is never auto-clamped.
   Too aggressive or too timid?
3. **Face stepper** — `Face: triangle · k of N` with prev/next (and family
   toggle only when two families exist). Useful, or still prefer click-only?
4. **Panel density** — Make group + stepper + actions still manageable?
5. **Edge pick** — Screen-space ~6 px threshold; back-side hits still possible.
   Confusing in practice?

Do not start Unit 5 until this review is answered.
