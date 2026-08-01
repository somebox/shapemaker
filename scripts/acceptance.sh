#!/usr/bin/env bash
# Acceptance: headless STL export → prototype/meshcheck.py.
#
# Matrix: 8 bases × 3 supported shell combos (24) + one near-limit stress
# open per base (8) + Draft/Fine quality on the default solid (2, M4) +
# jittered random (1) + 3 random seeds × Draft/Fine (6, M5) = 41 STLs.
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
import { BASE_IDS, BASES } from "./src/bases.js";

const combos = [
  { tag: "solid_closed", depth: "solid", openings: false },
  { tag: "hollow_closed", depth: "hollow", openings: false },
  { tag: "hollow_open", depth: "hollow", openings: true },
];

for (const base of BASE_IDS) {
  // Parametric bases (random) can have faces where the default 3.2 mm border
  // does not fit — probe limits first and fit every open combo.
  const parametric = Boolean(BASES[base].parametric);
  clearPipelineCache();
  const probe = compile({
    base,
    depth: "hollow",
    openings: true,
    ...(parametric ? { borderMm: 0.8, filletMm: 2 } : {}),
  });
  if (!probe.validation.ok) {
    console.error("probe failed", base, probe.validation.errors);
    process.exit(1);
  }
  const fitBorder = parametric
    ? Math.max(0.8, Math.floor(probe.metrics.limits.borderMmMax * 0.85 * 10) / 10)
    : null;

  for (const c of combos) {
    const name = `${base}__${c.tag}.stl`;
    const flags = [`--base=${base}`, `--depth=${c.depth}`, `--openings=${c.openings}`];
    if (c.openings && fitBorder != null) flags.push(`--border=${fitBorder}`, "--fillet=2");
    console.log([name, ...flags].join("\t"));
  }

  const stressBorder =
    Math.floor(probe.metrics.limits.borderMmMax * 0.92 * 10) / 10;
  console.log(
    [
      `${base}__stress_open.stl`,
      `--base=${base}`,
      `--depth=hollow`,
      `--openings=true`,
      `--border=${stressBorder}`,
      ...(parametric ? ["--fillet=2"] : []),
    ].join("\t"),
  );
}

// Quality levels (M4): Draft and Fine on the default solid. Normal is every
// other case in this matrix, so it needs no extra entry.
for (const [tag, edgeDiv] of [["draft", 4], ["fine", 20]]) {
  console.log(
    [
      `icosidodeca__quality_${tag}.stl`,
      "--base=icosidodeca",
      "--depth=hollow",
      "--openings=true",
      `--edge-div=${edgeDiv}`,
    ].join("\t"),
  );
}

// Jittered random hull (M5). Jitter is scoped to the random base in v0.4 —
// on merged regular bases point-jitter is a topology cliff, not gradual.
console.log(
  [
    "random_s1337_j10__hollow_open.stl",
    "--base=random",
    "--jitter=10",
    "--seed=1337",
    "--depth=hollow",
    "--openings=true",
    "--border=0.8",
    "--fillet=1.5",
  ].join("\t"),
);

// Random hulls (M5): three fixed seeds, hollow-open, Draft + Fine each.
// Border probed per seed — small irregular faces can cap it under 2 mm.
for (const seed of [1, 1337, 90210]) {
  clearPipelineCache();
  const probe = compile({
    base: "random", seed, depth: "hollow", openings: true, borderMm: 0.8, filletMm: 2,
  });
  if (!probe.validation.ok) {
    console.error("random probe failed", seed, probe.validation.errors);
    process.exit(1);
  }
  const border = Math.max(
    0.8,
    Math.floor(probe.metrics.limits.borderMmMax * 0.85 * 10) / 10,
  );
  for (const [tag, edgeDiv] of [["draft", 4], ["fine", 20]]) {
    console.log(
      [
        `random_s${seed}__${tag}.stl`,
        "--base=random",
        `--seed=${seed}`,
        "--depth=hollow",
        "--openings=true",
        `--border=${border}`,
        "--fillet=2",
        `--edge-div=${edgeDiv}`,
      ].join("\t"),
    );
  }
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

if [[ "$count" -ne 41 ]]; then
  echo "acceptance FAILED — expected 41 STLs, got $count" >&2
  exit 1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "acceptance FAILED" >&2
  exit 1
fi
echo "acceptance OK — all 41 STLs meet every mesh requirement"
