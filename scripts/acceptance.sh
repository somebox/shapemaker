#!/usr/bin/env bash
# Acceptance: headless STL export → prototype/meshcheck.py.
#
# Matrix: 13 bases × 4 entries (3 shell combos + stress) = 52, plus
# Draft/Fine on the default solid (2) + jittered random (1) + 3 random
# seeds × Draft/Fine (6) + M5 irregular extremes (8) = 69, plus rounding,
# truncate, split halves, subdiv+rounding, and spike cases. Count is
# EXPECTED below.
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
EXPECTED=91

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

/** The one border-fit formula: 85% of the probed ceiling, floor 0.8 mm. */
function fitBorder(borderMmMax) {
  return Math.max(0.8, Math.floor(borderMmMax * 0.85 * 10) / 10);
}

/** Probe hollow_open limits and return a fitted border. */
function probedBorder(opts) {
  clearPipelineCache();
  const probe = compile({
    depth: "hollow",
    openings: true,
    borderMm: 0.8,
    filletMm: 2,
    ...opts,
  });
  if (!probe.validation.ok) {
    console.error("probe failed", opts, probe.validation.errors);
    process.exit(1);
  }
  return fitBorder(probe.metrics.limits.borderMmMax);
}

/** Canonical state keys forward generically — kebab-cased to CLI flags. */
const kebab = (k) => k.replace(/([A-Z])/g, "-$1").toLowerCase();

function emitHollowOpen(name, opts) {
  const border = probedBorder(opts);
  const flags = Object.entries({ depth: "hollow", openings: true, ...opts })
    .map(([k, v]) => `--${kebab(k)}=${v}`);
  const extra = [`--border=${border}`];
  if (opts.filletMm == null) extra.push("--fillet=2");
  console.log([name, ...flags, ...extra].join("\t"));
}

for (const base of BASE_IDS) {
  // Parametric bases can have faces where the default 3.2 mm border does
  // not fit — probe limits first and fit every open combo.
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
  const fitted = parametric ? fitBorder(probe.metrics.limits.borderMmMax) : null;

  for (const c of combos) {
    const name = `${base}__${c.tag}.stl`;
    const flags = [`--base=${base}`, `--depth=${c.depth}`, `--openings=${c.openings}`];
    if (c.openings && fitted != null) flags.push(`--border=${fitted}`, "--fillet=2");
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

// Jitter applies to any base (plane-perturb on regulars, point jitter on
// parametric). Keep one seeded random case as a stability anchor.
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

// Random hulls: three fixed seeds, hollow-open, Draft + Fine each.
for (const seed of [1, 1337, 90210]) {
  const border = probedBorder({ base: "random", seed });
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

// M5 irregular extremes — all hollow_open with probed border.
emitHollowOpen("cube_s1337_j10__hollow_open.stl", {
  base: "cube", seed: 1337, jitter: 10,
});
emitHollowOpen("icosidodeca_s1337_j10__hollow_open.stl", {
  base: "icosidodeca", seed: 1337, jitter: 10,
});
emitHollowOpen("sphere_s1337_j10__hollow_open.stl", {
  base: "sphere", seed: 1337, jitter: 10,
});
emitHollowOpen("random_s1337_j10_radial__hollow_open.stl", {
  base: "random", seed: 1337, jitter: 10, jitterMode: "radial",
});
emitHollowOpen("random_s1337_j10_both__hollow_open.stl", {
  base: "random", seed: 1337, jitter: 10, jitterMode: "both",
});
emitHollowOpen("cube_subdiv1__hollow_open.stl", {
  base: "cube", subdiv: 1, soften: 0,
});
emitHollowOpen("cube_subdiv2_soften100__hollow_open.stl", {
  base: "cube", subdiv: 2, soften: 100,
});
emitHollowOpen("cube_s1337_j10_subdiv1__hollow_open.stl", {
  base: "cube", seed: 1337, jitter: 10, subdiv: 1, soften: 0,
});

// Rounding: rims (Stage 1) + dihedral edges/corners (Stage 2).
console.log(
  [
    "cube_rounding2__solid_closed.stl",
    "--base=cube",
    "--depth=solid",
    "--openings=false",
    "--rounding-mm=2",
  ].join("\t"),
);
emitHollowOpen("icosidodeca_rounding06__hollow_open.stl", {
  base: "icosidodeca", roundingMm: 0.6,
});
emitHollowOpen("sphere_rounding04__hollow_open.stl", {
  base: "sphere", roundingMm: 0.4, points: 24, borderMm: 1, filletMm: 1.5,
});
emitHollowOpen("icosahedron_subdiv1_rounding05__hollow_open.stl", {
  base: "icosahedron", subdiv: 1, roundingMm: 0.5,
});

// Truncation — the soccer ball (icosahedron at 33%).
emitHollowOpen("icosahedron_t33__hollow_open.stl", {
  base: "icosahedron", truncate: 33,
});

// Spike — origin-star-convex pyramids (named stellations + composition).
emitHollowOpen("octahedron_spike_stella__hollow_open.stl", {
  base: "octahedron", spike: Math.sqrt(3), filletMm: 1.5,
});
emitHollowOpen("octahedron_spike_stella_rounding15__hollow_open.stl", {
  base: "octahedron", spike: Math.sqrt(3), roundingMm: 1.5, filletMm: 1.5,
});
emitHollowOpen("dodecahedron_spike_ssd__hollow_open.stl", {
  base: "dodecahedron", spike: 1.776901418668612, filletMm: 1.5,
});
emitHollowOpen("icosahedron_spike_sti__hollow_open.stl", {
  base: "icosahedron", spike: 1.0661408512011672, filletMm: 1.5,
});
emitHollowOpen("icosahedron_spike_gsd__hollow_open.stl", {
  base: "icosahedron", spike: 2.383963416875298, filletMm: 1.5,
});
emitHollowOpen("icosahedron_spike_gd__hollow_open.stl", {
  base: "icosahedron", spike: 0.5627774222552397, filletMm: 1.5,
});
emitHollowOpen("icosahedron_t33_spike__hollow_open.stl", {
  base: "icosahedron", truncate: 33, spike: 1.4, filletMm: 1.5,
});
emitHollowOpen("octahedron_spike_subdiv1__hollow_open.stl", {
  base: "octahedron", spike: Math.sqrt(3), subdiv: 1, filletMm: 1.5,
});
emitHollowOpen("sphere_spike__hollow_open.stl", {
  base: "sphere", spike: 1.4, filletMm: 1.5,
});

// Model split — each --split run emits two half-STLs (counted by meshcheck).
function emitSplit(name, opts) {
  const flags = Object.entries(opts)
    .map(([k, v]) => `--${kebab(k)}=${v}`);
  console.log([name, ...flags, "--split"].join("\t"));
}
emitSplit("icosidodeca__split_solid.stl", {
  base: "icosidodeca", depth: "solid", openings: false,
});
emitSplit("cube__split_open.stl", {
  base: "cube", depth: "hollow", openings: true, borderMm: 3, filletMm: 2,
});
// Hollow closed shell — name must NOT contain "hollow_closed" (body-count rule).
emitSplit("icosidodeca__split_shell.stl", {
  base: "icosidodeca", depth: "hollow", openings: false, wallMm: 1.4,
});
emitSplit("octahedron_spike_stella__split_open.stl", {
  base: "octahedron", spike: Math.sqrt(3), depth: "hollow", openings: true,
  filletMm: 1.5,
});
JS
)

echo
echo "== meshcheck =="
fail=0
count=0
for stl in "$OUT"/*.stl; do
  name="$(basename "$stl")"
  count=$((count + 1))
  if [[ "$name" == *_half-* ]]; then expect_bodies=1
  elif [[ "$name" == *hollow_closed* ]]; then expect_bodies=2
  else expect_bodies=1; fi

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

if [[ "$count" -ne "$EXPECTED" ]]; then
  echo "acceptance FAILED — expected $EXPECTED STLs, got $count" >&2
  exit 1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "acceptance FAILED" >&2
  exit 1
fi
echo "acceptance OK — all $EXPECTED STLs meet every mesh requirement"
