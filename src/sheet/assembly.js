/**
 * The cut parts put back together in 3D, for pictures of how a joint works.
 *
 * Cut mode extrudes each panel's real cut outline (slots, tabs, openings
 * included) outward from its face plane by the sheet thickness, stands each
 * clip in the plane square to its edge, and loops a tie through each pair
 * of tie holes. Fold mode shows the faces as thin paper with the open edges'
 * flaps folded under the neighbour, tape across the inside, or stitches.
 *
 * Output is plain triangles and feature lines, tagged by material; any
 * renderer can draw it.
 */

import { triangulate as earcut } from "../../vendor/earcut/earcut.js";
import { fromFaceFrame } from "../faceframe.js";
import { panelOpenings } from "./panels.js";

const v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  unit: (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; },
};

/** Paper is drawn this thick, mm. */
const PAPER_MM = 0.35;

/**
 * @param {{ positions: Float64Array }} skeleton
 * @param {ReturnType<import('./index.js').buildSheet>} sheet
 * @param {{ sheetMm?: number, openings?: object|null }} [opts]
 * @returns {{ solids: { tag: string, tris: number[][][], lines: number[][][], panel?: number, joint?: number, anchor: number[] }[] }}
 */
export function buildAssembly(skeleton, sheet, opts = {}) {
  const P = (i) => [skeleton.positions[3 * i], skeleton.positions[3 * i + 1], skeleton.positions[3 * i + 2]];
  const { panels, joints } = sheet.extracted;
  const solids = [];

  // Edge frame for a joint: unit edge direction, and for each panel the
  // in-plane direction into it and its outward normal.
  const edgeFrame = (j) => {
    const p0 = P(j.v0), e = v.unit(v.sub(P(j.v1), p0));
    const side = (pid) => {
      const f = panels[pid].frame;
      let into = v.unit(v.cross(f.normal, e));
      if (v.dot(into, v.sub(f.origin, p0)) < 0) into = v.mul(into, -1);
      return { into, n: f.normal };
    };
    return { p0, e, A: side(j.a), B: side(j.b) };
  };
  // Interior bisector across the edge: A's in-plane direction turned θ/2
  // toward the inside.
  const bisectorIn = (fr, th) => v.unit(v.add(v.mul(fr.A.into, Math.cos(th / 2)), v.mul(fr.A.n, -Math.sin(th / 2))));

  if (sheet.mode === "cut") {
    const t = sheet.dims.t;
    for (const part of sheet.parts) {
      if (part.kind === "panel") {
        const f = panels[part.panel].frame;
        const to3 = ([x, y]) => fromFaceFrame(f, -x, y);
        const cut = part.paths.filter((p) => p.layer === "cut").map((p) => p.pts);
        const solid = extrude(cut[0], cut.slice(1), to3, f.normal, t, "panel");
        // Engraved numbers on the inside face.
        const lift = v.mul(f.normal, -0.05);
        for (const p of part.paths.filter((x) => x.layer === "mark")) {
          for (let i = 0; i + 1 < p.pts.length; i++) solid.lines.push([v.add(to3(p.pts[i]), lift), v.add(to3(p.pts[i + 1]), lift), "mark"]);
        }
        solids.push({ ...solid, panel: part.panel, anchor: f.origin });
      } else if (part.kind === "clip") {
        const j = joints[part.joint - 1];
        const fr = edgeFrame(j), E = v.add(fr.p0, v.mul(fr.e, part.at));
        const base = v.add(E, v.mul(fr.e, -t / 2));
        const to3 = ([x, y]) => v.add(v.add(base, v.mul(fr.A.into, -x)), v.mul(fr.A.n, y));
        const cut = part.paths.filter((p) => p.layer === "cut").map((p) => p.pts);
        solids.push({ ...extrude(cut[0], [], to3, fr.e, t, "clip"), joint: j.id, anchor: E });
      }
    }
    for (const jn of sheet.joins.filter((x) => x.kind === "ties")) {
      const fr = edgeFrame(jn.joint), { web, tieD } = sheet.dims;
      const h = jn.trim + web + tieD / 2, bis = bisectorIn(fr, jn.th);
      for (const at of jn.at) {
        const E = v.add(fr.p0, v.mul(fr.e, at));
        const hA = v.add(E, v.mul(fr.A.into, h)), hB = v.add(E, v.mul(fr.B.into, h));
        const out = (q, n) => v.add(q, v.mul(n, t + 1.2)), inn = (q, n) => v.add(q, v.mul(n, -1.2));
        const loop = [
          inn(hA, fr.A.n), out(hA, fr.A.n),
          ...bezier(out(hA, fr.A.n), v.add(E, v.mul(bis, -(h * 0.6 + t))), out(hB, fr.B.n)),
          inn(hB, fr.B.n),
          ...bezier(inn(hB, fr.B.n), v.add(E, v.mul(bis, h * 0.9)), inn(hA, fr.A.n)),
        ];
        solids.push({ ...ribbon(loop, fr.e, Math.min(2.5, 0.7 * tieD), 1, "tie"), joint: jn.joint.id, anchor: E });
      }
    }
    return { solids };
  }

  // Fold mode: thin faces, then whatever holds each open edge.
  for (const panel of panels) {
    const f = panel.frame;
    const to3 = ([x, y]) => fromFaceFrame(f, x, y);
    const holes = opts.openings
      ? panelOpenings(panel, opts.openings.generator, opts.openings.borderFraction, opts.openings.filletMm)
      : [];
    solids.push({ ...extrude(panel.outline, holes, to3, f.normal, PAPER_MM, "paper"), panel: panel.id, anchor: f.origin });
  }
  const d = sheet.dims;
  for (const jn of sheet.joins.filter((x) => !x.folded)) {
    const j = jn.joint, fr = edgeFrame(j), L = j.lengthMm, mid = v.add(fr.p0, v.mul(fr.e, L / 2));
    if (d.join === "flaps" && jn.flapPanel != null) {
      // The flap hangs off one panel and lies under the other, inside.
      const under = jn.flapPanel === j.a ? fr.B : fr.A;
      const h = Math.min(d.flapMm, 0.35 * L), e = Math.min(h, 0.4 * L);
      const at = (s, depth) => v.add(v.add(v.add(fr.p0, v.mul(fr.e, s)), v.mul(under.into, depth)), v.mul(under.n, -PAPER_MM));
      const quad = [at(0, 0), at(L, 0), at(L - e, h), at(e, h)];
      solids.push({ ...flat(quad, under.n, PAPER_MM, "flap"), joint: j.id, anchor: mid });
    } else if (d.join === "tape") {
      const w = Math.min(12, 0.4 * L), e0 = 0.08 * L;
      for (const s of [fr.A, fr.B]) {
        const at = (x, depth) => v.add(v.add(v.add(fr.p0, v.mul(fr.e, x)), v.mul(s.into, depth)), v.mul(s.n, -0.1));
        solids.push({ ...flat([at(e0, 0), at(L - e0, 0), at(L - e0, w / 2), at(e0, w / 2)], s.n, 0.1, "tape"), joint: j.id, anchor: mid });
      }
    } else if (d.join === "sew") {
      const n = Math.max(1, Math.floor((L - 2 * d.sewDepth) / d.pitch) + 1);
      const start = (L - (n - 1) * d.pitch) / 2;
      const hole = (s, side, depth) => v.add(v.add(fr.p0, v.mul(fr.e, s)), v.mul(side.into, depth));
      const pts = [];
      for (let i = 0; i < n; i++) {
        const s = start + i * d.pitch;
        // Whip stitch: over the outside, back through the inside.
        pts.push(v.add(hole(s, fr.A, d.sewDepth), v.mul(fr.A.n, -0.6)), v.add(hole(s, fr.A, d.sewDepth), v.mul(fr.A.n, 0.8)));
        pts.push(v.add(hole(s + d.pitch / 2, fr.B, d.sewDepth), v.mul(fr.B.n, 0.8)), v.add(hole(s + d.pitch / 2, fr.B, d.sewDepth), v.mul(fr.B.n, -0.6)));
      }
      solids.push({ ...ribbon(pts, fr.e, 0.8, 0.8, "thread"), joint: j.id, anchor: mid });
    }
  }
  return { solids };
}

/** Prism over a 2D outline with holes, placed by to3 and pushed along n by t. */
function extrude(outline, holes, to3, n, t, tag) {
  const loops = [outline, ...holes];
  const flat2 = [], starts = [];
  for (const [i, loop] of loops.entries()) {
    if (i) starts.push(flat2.length / 2);
    for (const p of loop) flat2.push(p[0], p[1]);
  }
  const all = loops.flat();
  const bot = all.map(to3), top = bot.map((p) => v.add(p, v.mul(n, t)));
  const idx = earcut(flat2, starts.length ? starts : undefined);
  const tris = [], lines = [];
  for (let i = 0; i < idx.length; i += 3) {
    tris.push([bot[idx[i]], bot[idx[i + 1]], bot[idx[i + 2]]]);
    tris.push([top[idx[i]], top[idx[i + 2]], top[idx[i + 1]]]);
  }
  let o = 0;
  for (const loop of loops) {
    const m = loop.length;
    for (let k = 0; k < m; k++) {
      const a = o + k, b = o + ((k + 1) % m);
      tris.push([bot[a], bot[b], top[b]], [bot[a], top[b], top[a]]);
      lines.push([bot[a], bot[b]], [top[a], top[b]]);
      // Vertical edge only at real corners, not along arcs.
      const pr = loop[(k - 1 + m) % m], p = loop[k], nx = loop[(k + 1) % m];
      const d0 = [p[0] - pr[0], p[1] - pr[1]], d1 = [nx[0] - p[0], nx[1] - p[1]];
      const turn = Math.abs(Math.atan2(d0[0] * d1[1] - d0[1] * d1[0], d0[0] * d1[0] + d0[1] * d1[1]));
      if (turn > 0.4) lines.push([bot[a], top[a]]);
    }
    o += m;
  }
  return { tag, tris, lines };
}

/** Thin plate over a convex 3D quad, pushed along n by t. */
function flat(quad, n, t, tag) {
  const top = quad.map((p) => v.add(p, v.mul(n, -t)));
  const tris = [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]], [top[0], top[2], top[1]], [top[0], top[3], top[2]]];
  const lines = quad.map((p, i) => [p, quad[(i + 1) % 4]]);
  return { tag, tris, lines };
}

/** A flat band along a 3D polyline, `w` wide along `across`, `th` thick. */
function ribbon(pts, across, w, th, tag) {
  const tris = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], d = v.sub(b, a);
    if (Math.hypot(...d) < 1e-6) continue;
    const k = v.unit(v.cross(d, across)), s = v.mul(across, w / 2), q = v.mul(k, th / 2);
    const c = (p, sx, qx) => v.add(v.add(p, v.mul(s, sx)), v.mul(q, qx));
    const box = [c(a, -1, -1), c(a, 1, -1), c(a, 1, 1), c(a, -1, 1), c(b, -1, -1), c(b, 1, -1), c(b, 1, 1), c(b, -1, 1)];
    for (const [p, q2, r, u] of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
      tris.push([box[p], box[q2], box[r]], [box[p], box[r], box[u]]);
    }
  }
  return { tag, tris, lines: [] };
}

function bezier(a, c, b, n = 8) {
  const out = [];
  for (let i = 1; i < n; i++) {
    const s = i / n, u = 1 - s;
    out.push([0, 1, 2].map((k) => u * u * a[k] + 2 * u * s * c[k] + s * s * b[k]));
  }
  return out;
}
