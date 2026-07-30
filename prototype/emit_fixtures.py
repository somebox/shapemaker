#!/usr/bin/env python3
"""Emit numeric fixtures from the Python geometry helpers for JS parity tests.

    python3 prototype/emit_fixtures.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from icosidodecahedron import edge_params, fillet_polygon, radial_sample

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test" / "fixtures"


def _round_list(arr, nd=12):
    return np.asarray(arr, dtype=float).round(nd).tolist()


def emit_edge_params():
    cases = {}
    for k in (0, 1, 2, 5, 10, 16):
        cases[str(k)] = _round_list(edge_params(k))
    return cases


def emit_fillet_polygon():
    # Regular pentagon (apothem-friendly) and irregular convex quad
    cases = []

    n = 5
    R = 10.0
    pent = np.array(
        [[R * math.cos(2 * math.pi * i / n + math.pi / 2),
          R * math.sin(2 * math.pi * i / n + math.pi / 2)]
         for i in range(n)],
        dtype=float,
    )
    for radius in (0.0, 1.0, 4.5, 100.0):
        poly, r_used = fillet_polygon(pent.copy(), radius, segments=64)
        cases.append({
            "name": f"regular_pentagon_r{radius}",
            "poly": _round_list(pent),
            "radius": radius,
            "segments": 64,
            "r_used": float(round(r_used, 12)),
            "result": _round_list(poly),
        })

    quad = np.array([[0.0, 0.0], [8.0, 0.0], [7.0, 5.0], [1.0, 4.0]], dtype=float)
    for radius in (0.0, 0.5, 2.0):
        poly, r_used = fillet_polygon(quad.copy(), radius, segments=64)
        cases.append({
            "name": f"convex_quad_r{radius}",
            "poly": _round_list(quad),
            "radius": radius,
            "segments": 64,
            "r_used": float(round(r_used, 12)),
            "result": _round_list(poly),
        })
    return cases


def emit_radial_sample():
    # Unit square about origin (star-shaped), and a filleted pentagon inset
    cases = []
    square = np.array([[1, 1], [-1, 1], [-1, -1], [1, -1]], dtype=float)
    angles = np.linspace(0, 2 * math.pi, 16, endpoint=False)
    cases.append({
        "name": "unit_square",
        "polyline": _round_list(square),
        "angles": _round_list(angles),
        "radii": _round_list(radial_sample(square, angles)),
    })

    n = 5
    R = 10.0
    pent = np.array(
        [[R * math.cos(2 * math.pi * i / n + math.pi / 2),
          R * math.sin(2 * math.pi * i / n + math.pi / 2)]
         for i in range(n)],
        dtype=float,
    )
    opening, _ = fillet_polygon(pent * 0.7, 1.5, segments=64)
    # Sample at angles matching a subdivided outer boundary (edge_div=4 style)
    # Use angles of the opening's own points plus a few mid-angles
    ang = np.arctan2(opening[:, 1], opening[:, 0])
    # Sort angles for a clean fixture; radial_sample doesn't require sorted
    cases.append({
        "name": "filleted_pentagon_inset",
        "polyline": _round_list(opening),
        "angles": _round_list(ang),
        "radii": _round_list(radial_sample(opening, ang)),
    })

    # Extra: angles that are NOT on vertices (mid-edge rays)
    mid_angles = ang + (np.roll(ang, -1) - ang + math.pi) % (2 * math.pi) - math.pi
    mid_angles = (ang + mid_angles) / 2.0  # not quite right for wrap — use linspace
    mid_angles = np.linspace(-math.pi, math.pi, 24, endpoint=False)
    cases.append({
        "name": "filleted_pentagon_linspace",
        "polyline": _round_list(opening),
        "angles": _round_list(mid_angles),
        "radii": _round_list(radial_sample(opening, mid_angles)),
    })
    return cases


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    fixtures = {
        "edge_params": emit_edge_params(),
        "fillet_polygon": emit_fillet_polygon(),
        "radial_sample": emit_radial_sample(),
    }
    path = OUT / "geom.json"
    path.write_text(json.dumps(fixtures, indent=2) + "\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
