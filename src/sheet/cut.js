/**
 * Cut mode: rigid sheet panels joined by clips, zip-tie holes or tabs.
 *
 * Geometry follows docs/LASER_RESEARCH.md §3 and §7. The skeleton is the
 * *inner* surface and the sheet grows outward, so at a convex edge the two
 * panels' inner corners meet and the face polygon is the panel outline. A
 * reflex (valley) edge would make the outer halves collide, so both panels
 * step back by −t·cot(θ/2) there.
 *
 * Every along-edge position is symmetric about the edge midpoint, so the two
 * panels of a joint agree on where its slots and holes go without knowing
 * which end the other one started from.
 *
 * Panels are emitted seen from inside: the sheet's top face, where labels
 * are engraved, ends up inside the model.
 */

import {
  add, sub, mul, dot, unit, leftNormal, offsetEdges, offsetPolygon, area,
  edgeRect, centroid, len,
} from "./geom2.js";
import { insideView, panelOpenings } from "./panels.js";
import { strokeText, textWidth } from "./font.js";

const D2R = Math.PI / 180;

/** Tabs only where a square-cut slot leaves little play (|cot θ| ≤ 0.6). */
const TAB_PLAY_MAX = 0.6;

/**
 * @typedef {{ layer: 'cut'|'score'|'valley'|'mountain'|'mark', pts: number[][], closed: boolean }} SheetPath
 * @typedef {{ name: string, kind: string, paths: SheetPath[] }} SheetPart
 */

/**
 * @param {{ panels: object[], joints: object[] }} extracted  from extractPanels
 * @param {{
 *   sheetMm: number,
 *   join: 'clips'|'ties'|'tabs',
 *   clearanceMm?: number,
 *   kerfMm?: number,
 *   tieHoleMm?: number,
 *   labels?: boolean,
 *   openings?: { generator: object, borderFraction: number, filletMm: number } | null,
 * }} opts
 */
export function buildCut(extracted, opts) {
  const t = opts.sheetMm;
  const c = opts.clearanceMm ?? 0;
  const kerf = opts.kerfMm ?? 0;
  const tieD = opts.tieHoleMm ?? 4;
  const labels = opts.labels ?? true;
  const web = Math.max(t, 2);
  const w = Math.max(2 * t, 5);
  const { panels, joints } = extracted;
  const warnings = [];

  // Per-joint plan: the join actually used, offsets and positions.
  let tabFallbacks = 0, hingingTies = 0;
  const plans = joints.map((j) => {
    const th = j.dihedralDeg * D2R;
    const trim = j.reflex ? -t / Math.tan(th / 2) : 0;
    let kind = opts.join;
    if (kind === "tabs" && (j.reflex || Math.abs(1 / Math.tan(th)) > TAB_PLAY_MAX)) {
      kind = "clips";
      tabFallbacks++;
    }
    if (kind === "ties" && (j.dihedralDeg < 130 || j.dihedralDeg > 230)) hingingTies++;
    const L = j.lengthMm;
    const n = kind === "ties" ? Math.max(1, Math.round(L / 45)) : L >= 70 ? 2 : 1;
    const at = kind === "ties"
      ? Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * L)
      : n === 1 ? [L / 2] : [L / 4, (3 * L) / 4];
    const plan = { joint: j, kind, th, trim, at };
    if (kind === "tabs") {
      const sa = Math.sin(th), ca = Math.cos(th);
      const xs = [0, (t * ca) / sa, t / sa, t / Math.tan(th / 2)];
      plan.smin = Math.min(...xs);
      plan.smax = Math.max(...xs);
      plan.lip = plan.smax + web;
      plan.gp = Math.max(0, (-t * ca) / sa);
      plan.tip = Math.min(-t / sa, (-t * (1 + ca)) / sa);
    }
    return plan;
  });
  const planBySide = new Map();
  plans.forEach((p) => {
    planBySide.set(`${p.joint.a}:${p.joint.ea}`, { plan: p, role: "a" });
    planBySide.set(`${p.joint.b}:${p.joint.eb}`, { plan: p, role: "b" });
  });

  // Clip classes by angle, lettered A, B, … in angle order.
  const classOf = new Map();
  const classKeys = [...new Set(plans.filter((p) => p.kind === "clips").map((p) => clipKey(p.joint)))].sort((x, y) => x - y);
  classKeys.forEach((k, i) => classOf.set(k, classLetter(i)));

  const parts = [];
  let openingClashes = 0, labelsSkipped = 0, thinPanels = 0, needBorder = 0;
  let smallestSide = Infinity;

  for (const panel of panels) {
    const view = insideView(panel);
    const M = view.outline, n = M.length;
    const sides = M.map((p0, k) => {
      const p1 = M[(k + 1) % n], u = unit(sub(p1, p0));
      const sp = planBySide.get(`${panel.id}:${view.sideOf(k)}`);
      return { p0, p1, u, m: leftNormal(u), L: len(sub(p1, p0)), ...sp };
    });
    const d = [], holes = [], tabs = [], marks = [];
    for (const [k, s] of sides.entries()) {
      smallestSide = Math.min(smallestSide, s.L);
      const f = sideFeatures(s, { t, c, w, web, tieD, classOf });
      d.push(f.offset);
      holes.push(...f.holes);
      for (const tab of f.tabs) tabs.push({ k, ...tab });
      s.depth = f.depth;
      s.busy = f.busy;
      s.labelAt = f.labelAt;
    }

    let outline = offsetEdges(M, d);
    if (area(outline) <= 0) thinPanels++;
    outline = spliceTabs(outline, sides, d, tabs);

    // The border an opening needs to clear this panel's joints by a bridge,
    // as a fraction of each face's narrowest centroid-to-edge distance.
    const bridge = Math.max(1, 0.5 * t);
    const need = Math.max(...sides.map((s) => s.depth)) + bridge;
    for (const ring of panel.faceRings2d) needBorder = Math.max(needBorder, need / edgeDistMin(ring));

    let openings = [];
    if (opts.openings) {
      openings = panelOpenings(panel, opts.openings.generator, opts.openings.borderFraction, opts.openings.filletMm)
        .map(view.flipPoly);
      const clash = sides.some((s) =>
        openings.some((o) => o.some((q) => depthOf(s, q) < s.depth + bridge && inSpan(s, q))),
      );
      if (clash) openingClashes++;
    }

    if (labels) {
      for (const s of sides) {
        if (!s.plan) continue;
        const text = String(s.plan.joint.id);
        const placed = placeLabel(s, text, openings);
        if (placed) marks.push(...placed);
        else labelsSkipped++;
      }
      if (!openings.length) {
        const id = panelIdLabel(`P${panel.id + 1}`, outline, sides);
        if (id) marks.push(...id);
      }
    }

    parts.push({
      name: `P${panel.id + 1}`,
      kind: "panel",
      panel: panel.id,
      paths: [
        { layer: "cut", closed: true, pts: offsetPolygon(outline, kerf / 2) },
        ...[...holes, ...openings].map((h) => ({ layer: "cut", closed: true, pts: offsetPolygon(h, -kerf / 2) })),
        ...marks.map((pts) => ({ layer: "mark", closed: false, pts })),
      ],
    });
  }

  // One clip part per clip instance, grouped by class.
  const clipCounts = {};
  for (const p of plans) {
    if (p.kind !== "clips") continue;
    const letter = classOf.get(clipKey(p.joint));
    clipCounts[letter] = (clipCounts[letter] ?? 0) + p.at.length;
    for (const at of p.at) parts.push({ ...clipPart(p, letter, { t, c, w, web, kerf, labels }), joint: p.joint.id, at });
  }

  if (tabFallbacks) warnings.push(`${tabFallbacks} edges are too far from 90° for tabs and use clips`);
  if (hingingTies) warnings.push(`${hingingTies} edges are sharper than 130° or deeper than 230°: ties will hinge there, add glue`);
  if (openingClashes) {
    warnings.push(
      `Openings cut into the joints on ${openingClashes} panels: raise Border to ${Math.ceil(needBorder * 100)}% (now ${Math.round(opts.openings.borderFraction * 100)}%)`,
    );
  }
  if (labelsSkipped) warnings.push(`${labelsSkipped} edge labels didn't fit on their panels`);
  if (thinPanels) warnings.push(`${thinPanels} panels vanish after the valley insets`);

  return {
    parts,
    warnings,
    // What each joint got, for the 3D assembly view.
    joins: plans.map((p) => ({ joint: p.joint, kind: p.kind, at: p.at, trim: p.trim, th: p.th })),
    dims: { t, c, w, web, tieD },
    stats: {
      panels: panels.length,
      joints: joints.length,
      clips: clipCounts,
      ties: plans.filter((p) => p.kind === "ties").reduce((s, p) => s + p.at.length, 0),
      tabs: plans.filter((p) => p.kind === "tabs").reduce((s, p) => s + p.at.length, 0),
      smallestSideMm: smallestSide,
      minBorderFraction: needBorder,
      dihedralDeg: [Math.min(...joints.map((j) => j.dihedralDeg)), Math.max(...joints.map((j) => j.dihedralDeg))],
    },
  };
}

const clipKey = (j) => Math.round(j.dihedralDeg * 2) / 2;
const classLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);

/** Inward depth of point q from side s's skeleton line. */
const depthOf = (s, q) => dot(sub(q, s.p0), s.m);
const alongOf = (s, q) => dot(sub(q, s.p0), s.u);
const inSpan = (s, q) => { const a = alongOf(s, q); return a > 0 && a < s.L; };

/**
 * Offset, holes, outward tabs, feature depth and occupied along-edge
 * intervals for one panel side.
 */
function sideFeatures(s, { t, c, w, web, tieD, classOf }) {
  const out = { offset: 0, holes: [], tabs: [], depth: 0, busy: [], labelAt: 1 };
  if (!s.plan) return out;
  const p = s.plan, { p0, p1 } = s;
  out.offset = p.trim;
  // Labels sit beside the joint features, just inside the cut edge.
  out.labelAt = Math.max(0, p.trim) + 1;
  if (p.kind === "clips") {
    const hc = p.trim + web;
    for (const a of p.at) {
      out.holes.push(edgeRect(p0, p1, a - (t + c) / 2, a + (t + c) / 2, hc, hc + w + c));
      out.busy.push([a - web - 3, a + web + 3]);
    }
    out.depth = hc + w + c;
    out.letter = classOf.get(clipKey(p.joint));
  } else if (p.kind === "ties") {
    const h = p.trim + web + tieD / 2;
    for (const a of p.at) {
      out.holes.push(circle(add(add(p0, mul(s.u, a)), mul(s.m, h)), tieD / 2));
      out.busy.push([a - tieD, a + tieD]);
    }
    out.depth = h + tieD / 2;
  } else if (s.role === "a") {
    out.offset = -p.lip;
    for (const a of p.at) {
      out.holes.push(edgeRect(p0, p1, a - (w + c) / 2, a + (w + c) / 2, -p.smax - c / 2, -p.smin + c / 2));
      out.busy.push([a - w / 2 - 2, a + w / 2 + 2]);
    }
    out.depth = Math.max(0, -p.smin + c / 2);
  } else {
    out.offset = p.gp;
    for (const a of p.at) {
      out.tabs.push({ a0: a - w / 2, a1: a + w / 2, out: p.gp - p.tip });
      out.busy.push([a - w / 2 - 2, a + w / 2 + 2]);
    }
    out.depth = p.gp;
    out.labelAt = p.gp + 1;
  }
  return out;
}

/** Insert outward tabs into the offset outline, in order along each side. */
function spliceTabs(outline, sides, d, tabs) {
  if (!tabs.length) return outline;
  const res = [];
  outline.forEach((pt, k) => {
    res.push(pt);
    const s = sides[k];
    for (const tab of tabs.filter((x) => x.k === k).sort((x, y) => x.a0 - y.a0)) {
      const base = (a) => add(add(s.p0, mul(s.u, a)), mul(s.m, d[k]));
      const q0 = base(tab.a0), q1 = base(tab.a1), o = mul(s.m, -tab.out);
      res.push(q0, add(q0, o), add(q1, o), q1);
    }
  });
  return res;
}

function circle(cen, r, n = 24) {
  return Array.from({ length: n }, (_, i) => {
    const g = (2 * Math.PI * i) / n;
    return [cen[0] + r * Math.cos(g), cen[1] + r * Math.sin(g)];
  });
}

/**
 * Engrave the joint number beside a side, away from its slots and clear of
 * openings; tries a few heights and positions, null when nothing fits.
 */
function placeLabel(s, text, openings) {
  for (const h of [4, 3, 2.5]) {
    const wd = textWidth(text, h), depth = s.labelAt + h / 2;
    for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const a = f * s.L;
      if (a - wd / 2 < depth || a + wd / 2 > s.L - depth) continue;
      if (s.busy.some(([b0, b1]) => a + wd / 2 > b0 && a - wd / 2 < b1)) continue;
      const box = [[a - wd / 2, depth - h / 2], [a + wd / 2, depth - h / 2], [a + wd / 2, depth + h / 2], [a - wd / 2, depth + h / 2]]
        .map(([x, y]) => add(add(s.p0, mul(s.u, x)), mul(s.m, y)));
      if (openings.some((o) => box.some((q) => pointInPoly(q, o)) || o.some((q) => pointInPoly(q, box)))) continue;
      return strokeText(text, h, add(add(s.p0, mul(s.u, a)), mul(s.m, depth)), s.u, s.m);
    }
  }
  return null;
}

/** Narrowest distance from a ring's area centroid to its edge lines. */
function edgeDistMin(ring) {
  const c = centroid(ring);
  return Math.min(...ring.map((p, i) => {
    const u = unit(sub(ring[(i + 1) % ring.length], p));
    return Math.abs(dot(sub(c, p), leftNormal(u)));
  }));
}

/**
 * Panel number at the centroid, only where it clears the band the edge
 * labels and joints use; null when the panel is too small for it.
 */
function panelIdLabel(text, outline, sides) {
  const c = centroid(outline);
  const room = Math.min(...sides.map((s) => depthOf(s, c) - (s.plan ? s.depth + 1.5 + 4 : 0))) - 0.5;
  const h = Math.min(6, 0.5 * room);
  if (h < 3 || Math.hypot(textWidth(text, h) / 2, h / 2) > room) return null;
  return strokeText(text, h, c, [1, 0], [0, 1]);
}

export function pointInPoly(q, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The clip for one joint, drawn in the plane square to the edge: the two
 * panels' inner surfaces leave the edge point O at the dihedral θ, the clip
 * sits on the inside and sends one tab through each panel's slot.
 */
function clipPart(plan, letter, { t, c, w, web, kerf, labels }) {
  const a = plan.th;
  const dA = [-1, 0], nA = [0, 1], dB = [-Math.cos(a), -Math.sin(a)], nB = [Math.sin(a), -Math.cos(a)];
  const bisIn = [Math.cos(Math.PI + a / 2), Math.sin(Math.PI + a / 2)];
  const hc = plan.trim + web, b = hc + w + Math.max(t, 3), D = Math.max(2 * t, 6);
  const A = (s) => mul(dA, s), B = (s) => mul(dB, s);
  const Q = mul(bisIn, D / Math.sin(a / 2));
  let poly = [
    A(b), A(hc + w), add(A(hc + w), mul(nA, t)), add(A(hc), mul(nA, t)), A(hc), [0, 0],
    B(hc), add(B(hc), mul(nB, t)), add(B(hc + w), mul(nB, t)), B(hc + w), B(b),
    add(B(b), mul(nB, -D)), Q, add(A(b), mul(nA, -D)),
  ];
  if (area(poly) < 0) poly = poly.reverse();
  const paths = [{ layer: "cut", closed: true, pts: offsetPolygon(poly, kerf / 2) }];
  if (labels) {
    const at = mul(bisIn, (0.5 * D) / Math.sin(a / 2));
    for (const pts of strokeText(letter, Math.min(3, 0.4 * D), at, [1, 0], [0, 1])) paths.push({ layer: "mark", closed: false, pts });
  }
  return { name: `clip ${letter}`, kind: "clip", paths };
}

/**
 * A fit-test strip: slots at t − 0.2 … t + 0.2 mm (labelled in tenths), a
 * tie hole, and a key cut from the same sheet to push into them.
 */
export function fitCoupon({ sheetMm: t, kerfMm = 0, tieHoleMm = 4 }) {
  const w = Math.max(2 * t, 5), pitch = Math.max(12, w + 7);
  const deltas = [-0.2, -0.1, 0, 0.1, 0.2];
  const W = pitch * (deltas.length + 1) + 6, H = w + 18;
  const paths = [{ layer: "cut", closed: true, pts: offsetPolygon([[0, 0], [W, 0], [W, H], [0, H]], kerfMm / 2) }];
  deltas.forEach((dlt, i) => {
    const x = 6 + pitch * (i + 0.5), sw = t + dlt;
    const slot = [[x - sw / 2, 4], [x + sw / 2, 4], [x + sw / 2, 4 + w], [x - sw / 2, 4 + w]];
    paths.push({ layer: "cut", closed: true, pts: offsetPolygon(slot, -kerfMm / 2) });
    const lab = dlt === 0 ? "0" : `${dlt > 0 ? "+" : "-"}${Math.round(Math.abs(dlt) * 10)}`;
    for (const pts of strokeText(lab, 3.5, [x, 4 + w + 6], [1, 0], [0, 1])) paths.push({ layer: "mark", closed: false, pts });
  });
  paths.push({ layer: "cut", closed: true, pts: offsetPolygon(circle([W - pitch / 2, H / 2], tieHoleMm / 2), -kerfMm / 2) });
  const coupon = { name: "fit coupon", kind: "coupon", paths };
  const key = {
    name: "fit key",
    kind: "coupon",
    paths: [{ layer: "cut", closed: true, pts: offsetPolygon([[0, 0], [w, 0], [w, 24], [0, 24]], kerfMm / 2) }],
  };
  return [coupon, key];
}
