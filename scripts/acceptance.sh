#!/usr/bin/env bash
# Acceptance: headless STL export → prototype/meshcheck.py.
#
# Topological checks alone are not enough — the prototype shipped a mesh that
# was watertight, winding-consistent and genus-correct while 1542 triangle
# pairs passed through each other. So this gate fails on ALL of:
#   watertight · winding consistent · single body · no degenerate faces ·
#   positive volume · zero self-intersections
#
# Requires: node, and .venv with prototype/requirements.txt installed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY="${ROOT}/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "error: .venv missing — run: uv venv .venv && uv pip install --python .venv/bin/python -r prototype/requirements.txt" >&2
  exit 1
fi

OUT="${ROOT}/test/out/acceptance"
rm -rf "$OUT"
mkdir -p "$OUT"
EXPORT=(node scripts/export-stl.mjs)

echo "== defaults =="
"${EXPORT[@]}" "$OUT/defaults.stl"

echo "== thick wall =="
"${EXPORT[@]}" "$OUT/thick_wall.stl" --wall=2.5

echo "== large fillet =="
"${EXPORT[@]}" "$OUT/large_fillet.stl" --fillet=8

echo "== fillet 0 =="
"${EXPORT[@]}" "$OUT/fillet0.stl" --fillet=0

echo "== border near clamp (8.5 mm; triangles cap ~8.92 @ Ø100) =="
"${EXPORT[@]}" "$OUT/border_near_clamp.stl" --border=8.5

echo "== edge_div 2 =="
"${EXPORT[@]}" "$OUT/edge_div2.stl" --edge-div=2

echo "== solid, closed faces =="
"${EXPORT[@]}" "$OUT/solid_closed.stl" --depth=solid --openings=false

echo "== hollow, closed faces =="
"${EXPORT[@]}" "$OUT/hollow_closed.stl" --openings=false

echo
echo "== meshcheck =="
fail=0
for stl in "$OUT"/*.stl; do
  name="$(basename "$stl")"
  # A hollow shell with no openings is two nested closed surfaces, so it is
  # legitimately 2 bodies; everything else must be a single body.
  if [[ "$name" == "hollow_closed.stl" ]]; then expect_bodies=2; else expect_bodies=1; fi

  if ! STL="$stl" NAME="$name" EXPECT_BODIES="$expect_bodies" "$PY" - <<'PY'; then
import os, sys
sys.path.insert(0, 'prototype')
import meshcheck, trimesh

path, name = os.environ['STL'], os.environ['NAME']
expect_bodies = int(os.environ['EXPECT_BODIES'])
m = trimesh.load(path, process=True)

res = meshcheck.self_intersections(m)
nbad = 0 if res == [] else res[1]
degenerate = int((m.area_faces < 1e-9).sum())

checks = {
    'watertight':         bool(m.is_watertight),
    'winding consistent': bool(m.is_winding_consistent),
    f'bodies == {expect_bodies}': int(m.body_count) == expect_bodies,
    'no degenerate tris': degenerate == 0,
    'positive volume':    m.volume > 0,
    'no self-intersect':  nbad == 0,
}
bad = [k for k, ok in checks.items() if not ok]
status = 'FAIL' if bad else 'ok'
print(f"{name:24s} {status:4s}  {len(m.faces):6d} tris  {m.volume/1000:8.2f} cm^3  "
      f"bodies={m.body_count} degenerate={degenerate} self-int={nbad}")
if bad:
    print(f"  failed: {', '.join(bad)}", file=sys.stderr)
sys.exit(1 if bad else 0)
PY
    echo "FAIL: $name did not meet mesh requirements" >&2
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "acceptance FAILED" >&2
  exit 1
fi
echo "acceptance OK — all STLs meet every mesh requirement"
