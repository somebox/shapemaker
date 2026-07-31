#!/usr/bin/env bash
# Acceptance: headless STL export → prototype/meshcheck.py.
#
# Matrix (Milestone 3): 6 bases × 3 supported shell combos = 18 core, plus
# one near-limit hollow-open stress case per base = 24 STLs.
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

while IFS=$'\t' read -ra parts; do
  [[ ${#parts[@]} -gt 0 ]] || continue
  name="${parts[0]}"
  flags=("${parts[@]:1}")
  echo "== $name =="
  "${EXPORT[@]}" "$OUT/$name" "${flags[@]}"
done < <(node --input-type=module - <<'JS'
import { compile } from "./src/compile.js";
import { clearPipelineCache } from "./src/pipeline.js";
import { BASE_IDS } from "./src/bases.js";

const combos = [
  { tag: "solid_closed", depth: "solid", openings: false },
  { tag: "hollow_closed", depth: "hollow", openings: false },
  { tag: "hollow_open", depth: "hollow", openings: true },
];

for (const base of BASE_IDS) {
  for (const c of combos) {
    const name = `${base}__${c.tag}.stl`;
    console.log(
      [name, `--base=${base}`, `--depth=${c.depth}`, `--openings=${c.openings}`].join("\t"),
    );
  }
  clearPipelineCache();
  const probe = compile({ base, depth: "hollow", openings: true });
  if (!probe.validation.ok) {
    console.error("probe failed", base, probe.validation.errors);
    process.exit(1);
  }
  const border =
    Math.floor(probe.metrics.limits.borderMmMax * 0.92 * 10) / 10;
  const name = `${base}__stress_open.stl`;
  console.log(
    [
      name,
      `--base=${base}`,
      `--depth=hollow`,
      `--openings=true`,
      `--border=${border}`,
    ].join("\t"),
  );
}
JS
)

echo
echo "== meshcheck =="
fail=0
count=0
for stl in "$OUT"/*.stl; do
  name="$(basename "$stl")"
  count=$((count + 1))
  if [[ "$name" == *hollow_closed* ]]; then expect_bodies=2; else expect_bodies=1; fi

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
print(f"{name:40s} {status:4s}  {len(m.faces):6d} tris  {m.volume/1000:8.2f} cm^3  "
      f"bodies={m.body_count} degenerate={degenerate} self-int={nbad}")
if bad:
    print(f"  failed: {', '.join(bad)}", file=sys.stderr)
sys.exit(1 if bad else 0)
PY
    echo "FAIL: $name did not meet mesh requirements" >&2
    fail=1
  fi
done

if [[ "$count" -ne 24 ]]; then
  echo "acceptance FAILED — expected 24 STLs, got $count" >&2
  exit 1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "acceptance FAILED" >&2
  exit 1
fi
echo "acceptance OK — all 24 STLs meet every mesh requirement"
