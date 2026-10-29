/**
 * Cut mode: rigid sheet panels joined by clips, zip-tie holes or finger
 * joints.
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
 * Joints and openings follow one rule: each joint has a footprint on its
 * panels (slot, clip arm, tie hole, plus a bridge of sheet), and a face
 * whose opening would cross a footprint is cut closed instead.
 *
 * Panels are emitted seen from inside: the sheet's top face, where labels
 * are engraved, ends up inside the model.
 */

import {
  add, sub, mul, dot, unit, leftNormal, offsetEdges, offsetPolygon, area,
  edgeRect, centroid, len, filletCorners,
} from "./geom2.js";
import { insideView, panelOpenings } from "./panels.js";
import { strokeText, textWidth } from "./font.js";

const D2R = Math.PI / 180;

/** Fingers only where square-cut ends leave little play (|cot θ| ≤ 0.6). */
const FINGER_PLAY_MAX = 0.6;
/** Widest Border the app allows (schema borderFraction max), as a fraction. */
export const MAX_BORDER = 0.9;
const fmt = (n) => String(Math.round(n * 10) / 10);

/**
 * Clip proportions by size, from the sheet thickness t: w is the tab that
 * goes through the slot, reach how far the arm runs past it, D the depth of
 * the clip's body behind the arms.
 */
export const CLIP_SIZES = Object.freeze({
  small: (t) => ({ w: Math.max(1.5 * t, 4), reach: Math.max(0.5 * t, 1.5), D: Math.max(1.5 * t, 4.5) }),
  medium: (t) => ({ w: Math.max(2 * t, 5), reach: Math.max(t, 3), D: Math.max(2 * t, 6) }),
  large: (t) => ({ w: Math.max(3 * t, 7), reach: Math.max(1.5 * t, 4), D: Math.max(3 * t, 8) }),
});

/**
 * @typedef {{ layer: 'cut'|'score'|'valley'|'mountain'|'mark', pts: number[][], closed: boolean }} SheetPath
 * @typedef {{ name: string, kind: string, paths: SheetPath[] }} SheetPart
 */

/**
 * @param {{ panels: object[], joints: object[] }} extracted  from extractPanels
 * @param {{
 *   sheetMm: number,
 *   join: 'clips'|'ties'|'fingers',
 *   clipsBy?: 'cut'|'print',
 *   clipSize?: 'auto'|'small'|'medium'|'large',
 *   clipsPerEdge?: 'auto'|number,
 *   clipPlace?: 'middle'|'corners',
 *   clipWidthMm?: number,  printed clips only; laser clips are the sheet's thickness
 *   clearanceMm?: number,
 *   kerfMm?: number,
 *   tieHoleMm?: number,
 *   labels?: boolean,
 *   openings?: { generator: object, borderFraction: number, filletMm: number } | null,
 * }} opts
 */
export function buildCut(extracted, opts) {
  const want = opts.clipSize ?? "auto";
  // Auto takes the largest clip whose footprint clears every opening; when
  // even the small one doesn't, the clashing faces are closed.
  const tries = want !== "auto" ? [want] : opts.openings && opts.join !== "ties" ? ["large", "medium", "small"] : ["medium"];
  let best = null;
  for (const size of tries) {
    const res = cutWith(extracted, opts, size);
    // Fewest closed faces; on a tie, the clip that needs the narrower
    // Border, so the fix offered for them is the smallest one.
    const better = !best || res.stats.filledPanels < best.stats.filledPanels ||
      (res.stats.filledPanels === best.stats.filledPanels && res.stats.minBorderFraction < best.stats.minBorderFraction - 1e-9);
    if (better) best = res;
    if (!res.stats.filledPanels) break;
  }
  // Closed faces come first: they are what the app offers a fix for.
  const { filledPanels: n, minBorderFraction: need, clipSize } = best.stats;
  if (n) {
    const smaller = want !== "auto" && clipSize !== "small" && best.stats.joints > best.stats.ties;
    best.warnings.unshift(
      need <= MAX_BORDER
        ? `${n} faces are cut closed so their openings stay clear of the joints: raise Border to ${Math.ceil(need * 100)}% to open them`
        : `${n} faces are cut closed so their openings stay clear of the joints${smaller ? "; smaller clips may open some" : ""}`,
    );
  }
  return best;
}

function cutWith(extracted, opts, size) {
  const t = opts.sheetMm;
  const c = opts.clearanceMm ?? 0;
  const kerf = opts.kerfMm ?? 0;
  const tieD = opts.tieHoleMm ?? 4;
  const labels = opts.labels ?? true;
  const printed = opts.clipsBy === "print";
  // A printed clip can be wider than the sheet; its slots follow it.
  const tw = printed ? Math.max(t, opts.clipWidthMm ?? t) : t;
  const place = opts.clipPlace ?? "middle";
  const web = Math.max(t, 2);
  const { w, reach, D } = CLIP_SIZES[size](t);
  const bridge = Math.max(1, 0.5 * t);
  // Shorter edges have no room for a slot or hole clear of the corners;
  // they are glued (the valley inset still applies).
  const minJoinMm = 2 * w + 2 * t;
  const { panels, joints } = extracted;
  const warnings = [];

  // Corner angles at each end of each panel side, for corner placement.
  const cornerAngles = new Map();
  for (const panel of panels) {
    const P = panel.outline, n = P.length;
    const angleAt = (k) => {
      const a = unit(sub(P[(k - 1 + n) % n], P[k])), b = unit(sub(P[(k + 1) % n], P[k]));
      return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    };
    for (let k = 0; k < n; k++) cornerAngles.set(`${panel.id}:${k}`, [angleAt(k), angleAt((k + 1) % n)]);
  }

  // Per-joint plan: the join actually used, offsets and positions.
  let fingerFallbacks = 0, hingingTies = 0, glued = 0, cornersToMiddle = 0;
  const plans = joints.map((j) => {
    const th = j.dihedralDeg * D2R;
    const trim = j.reflex ? -t / Math.tan(th / 2) : 0;
    const L = j.lengthMm;
    if (L < minJoinMm) {
      glued++;
      return { joint: j, kind: "glue", th, trim, at: [] };
    }
    let kind = opts.join;
    if (kind === "fingers" && (j.reflex || Math.abs(1 / Math.tan(th)) > FINGER_PLAY_MAX)) {
      kind = "clips";
      fingerFallbacks++;
    }
    if (kind === "ties" && (j.dihedralDeg < 130 || j.dihedralDeg > 230)) hingingTies++;
    const plan = { joint: j, kind, th, trim, at: [] };
    if (kind === "ties") {
      const n = Math.max(1, Math.round(L / 45));
      plan.at = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * L);
    } else if (kind === "fingers") {
      // Finger tips reach the outer corner of the two plates.
      plan.s = t / Math.tan(th / 2);
      const m0 = Math.max(2 * t, 1.5 * plan.s);
      const span = L - 2 * m0;
      let n = Math.max(1, Math.round(span / Math.max(3 * t, 8)));
      if (n % 2 === 0) n++;
      plan.fingers = Array.from({ length: n }, (_, i) => [m0 + (i * span) / n, m0 + ((i + 1) * span) / n]);
    } else {
      // Clips: in the middle, or near each corner just clear of the
      // neighbouring sides' clips (printed clips may overlap there, since
      // they can be welded; only the slots must stay apart).
      const per = opts.clipsPerEdge ?? "auto";
      if (place === "corners") {
        const hc = trim + web, R = printed ? hc + w + c : hc + w + reach;
        const angles = [...(cornerAngles.get(`${j.a}:${j.ea}`) ?? []), ...(cornerAngles.get(`${j.b}:${j.eb}`) ?? [])];
        const g = Math.max(...angles.map((phi) => {
          const sp = Math.max(Math.sin(phi), 0.2);
          return (R * (1 + Math.cos(phi)) + t) / sp + (tw + c) / 2;
        }));
        let n = per === "auto" ? (L - 2 * g > 70 ? 3 : 2) : per;
        if (L < 2 * g + tw + c + t) {
          n = 1;
          cornersToMiddle++;
        }
        plan.at = n === 1 ? [L / 2] : [g, ...Array.from({ length: n - 2 }, (_, i) => g + ((i + 1) * (L - 2 * g)) / (n - 1)), L - g];
        plan.cornerGap = g;
      } else {
        const n = per === "auto" ? (L >= 70 ? 2 : 1) : per;
        plan.at = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * L);
      }
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

  const dims = { t, c, w, web, reach, D, tw, tieD, size };
  const parts = [];
  let filledPanels = 0, labelsSkipped = 0, thinPanels = 0, needBorder = 0;
  let smallestSide = Infinity;

  for (const panel of panels) {
    const view = insideView(panel);
    const M = view.outline, n = M.length;
    const sides = M.map((p0, k) => {
      const p1 = M[(k + 1) % n], u = unit(sub(p1, p0));
      const sp = planBySide.get(`${panel.id}:${view.sideOf(k)}`);
      return { p0, p1, u, m: leftNormal(u), L: len(sub(p1, p0)), ...sp };
    });
    const d = [], holes = [], tabs = [], marks = [], footprints = [];
    for (const [k, s] of sides.entries()) {
      smallestSide = Math.min(smallestSide, s.L);
      const f = sideFeatures(s, dims, classOf);
      d.push(f.offset);
      holes.push(...f.holes);
      for (const tab of f.tabs) tabs.push({ k, ...tab });
      footprints.push(...f.footprints.map(([a0, a1, d1]) => edgeRect(s.p0, s.p1, a0 - bridge, a1 + bridge, -1, d1 + bridge)));
      s.depth = f.depth;
      s.reach = f.reach;
      s.busy = f.busy;
      s.labelAt = f.labelAt;
    }

    let outline = offsetEdges(M, d);
    if (area(outline) <= 0) thinPanels++;
    outline = spliceTabs(outline, sides, d, tabs);

    let openings = [];
    if (opts.openings) {
      const { generator, borderFraction, filletMm } = opts.openings;
      const openingsAt = (b) => panelOpenings(panel, generator, b, filletMm).map(view.flipPoly);
      const clashes = (ops) => ops.some((o) => footprints.some((f) => polysOverlap(o, f)));
      openings = openingsAt(borderFraction);
      // One rule everywhere: an opening that would cross a joint's
      // footprint closes the whole face, never just part of it.
      if (clashes(openings)) {
        openings = [];
        filledPanels++;
        // The Border that would open it, by the same test (to 1%); past
        // the app's widest, it can't be opened.
        let lo = borderFraction, hi = MAX_BORDER;
        if (clashes(openingsAt(hi))) needBorder = Infinity;
        else {
          while (hi - lo > 0.01) {
            const mid = (lo + hi) / 2;
            if (clashes(openingsAt(mid))) lo = mid;
            else hi = mid;
          }
          needBorder = Math.max(needBorder, hi);
        }
      }
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
      filled: Boolean(opts.openings) && !openings.length,
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
    // Printed clips skip the kerf and the engraved letter; they leave the
    // boards for print plates grouped by letter (printclips.js).
    for (const at of p.at) {
      const part = printed
        ? { ...clipPart(p, letter, { ...dims, kerf: 0, labels: false }), print: true }
        : clipPart(p, letter, { ...dims, kerf, labels });
      parts.push({ ...part, joint: p.joint.id, at, thick: tw });
    }
  }

  if (fingerFallbacks) warnings.push(`${fingerFallbacks} edges are too far from 90° for fingers and use clips`);
  if (hingingTies) warnings.push(`${hingingTies} edges are sharper than 130° or deeper than 230°: ties will hinge there, add glue`);
  if (glued) warnings.push(`${glued} edges are shorter than ${fmt(minJoinMm)} mm, too short for a joint: glue them`);
  if (cornersToMiddle) warnings.push(`${cornersToMiddle} edges are too short for a clip at each corner and get one in the middle`);
  if (labelsSkipped) warnings.push(`${labelsSkipped} edge labels didn't fit on their panels`);
  if (thinPanels) warnings.push(`${thinPanels} panels vanish after the valley insets`);

  return {
    parts,
    warnings,
    // What each joint got, for the 3D assembly view.
    joins: plans.map((p) => ({ joint: p.joint, kind: p.kind, at: p.at, trim: p.trim, th: p.th })),
    dims,
    stats: {
      panels: panels.length,
      joints: joints.length,
      clips: clipCounts,
      clipSize: size,
      ties: plans.filter((p) => p.kind === "ties").reduce((s, p) => s + p.at.length, 0),
      fingers: plans.filter((p) => p.kind === "fingers").length,
      glued,
      filledPanels,
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
 * Offset, holes, outward tabs, slot depth, footprints (along-edge span and
 * depth of whatever sits on or in the panel there) and occupied along-edge
 * intervals for one panel side.
 */
function sideFeatures(s, { t, c, w, web, reach, tw, tieD }) {
  const out = { offset: 0, holes: [], tabs: [], depth: 0, reach: 0, footprints: [], busy: [], labelAt: 1 };
  if (!s.plan) return out;
  const p = s.plan, { p0, p1 } = s;
  out.offset = p.trim;
  // Labels sit beside the joint features, just inside the cut edge.
  out.labelAt = Math.max(0, p.trim) + 1;
  if (p.kind === "clips") {
    const hc = p.trim + web, arm = hc + w + reach;
    for (const a of p.at) {
      out.holes.push(edgeRect(p0, p1, a - (tw + c) / 2, a + (tw + c) / 2, hc, hc + w + c));
      // The clip's arm lies on the panel's inside face out to `arm`.
      out.footprints.push([a - (tw + c) / 2, a + (tw + c) / 2, arm]);
      out.busy.push([a - web - 3, a + web + 3]);
    }
    out.depth = hc + w + c;
    out.reach = arm;
  } else if (p.kind === "ties") {
    const h = p.trim + web + tieD / 2;
    for (const a of p.at) {
      out.holes.push(circle(add(add(p0, mul(s.u, a)), mul(s.m, h)), tieD / 2));
      out.footprints.push([a - tieD, a + tieD, h + tieD]);
      out.busy.push([a - tieD, a + tieD]);
    }
    out.depth = out.reach = h + tieD / 2;
  } else if (p.kind === "fingers") {
    // Alternate fingers: A takes the even ones, B the odd ones (the count
    // is odd, so the pattern reads the same from either end).
    p.fingers.forEach(([a0, a1], i) => {
      if ((i % 2 === 0) === (s.role === "a")) out.tabs.push({ a0: a0 + c / 2, a1: a1 - c / 2, out: p.s });
    });
    out.footprints.push([0, s.L, 0]);
  } else {
    // Glue: only the valley inset, nothing cut along the edge.
    out.footprints.push([0, s.L, 0]);
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

/** Whether two simple polygons overlap: a vertex inside, or edges crossing. */
function polysOverlap(P, Q) {
  if (P.some((q) => pointInPoly(q, Q)) || Q.some((q) => pointInPoly(q, P))) return true;
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    for (let j = 0; j < Q.length; j++) {
      const c = Q[j], d = Q[(j + 1) % Q.length];
      if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return true;
    }
  }
  return false;
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
function clipPart(plan, letter, { t, w, web, reach, D, kerf, labels }) {
  const a = plan.th;
  const dA = [-1, 0], nA = [0, 1], dB = [-Math.cos(a), -Math.sin(a)], nB = [Math.sin(a), -Math.cos(a)];
  const bisIn = [Math.cos(Math.PI + a / 2), Math.sin(Math.PI + a / 2)];
  const hc = plan.trim + web, b = hc + w + reach;
  const A = (s) => mul(dA, s), B = (s) => mul(dB, s);
  const Q = mul(bisIn, D / Math.sin(a / 2));
  let poly = [
    A(b), A(hc + w), add(A(hc + w), mul(nA, t)), add(A(hc), mul(nA, t)), A(hc), [0, 0],
    B(hc), add(B(hc), mul(nB, t)), add(B(hc + w), mul(nB, t)), B(hc + w), B(b),
    add(B(b), mul(nB, -D)), Q, add(A(b), mul(nA, -D)),
  ];
  // Round what shows through an opening: the arm ends' back corners and
  // the heel. Corners against the panels and the slot tabs stay square.
  poly = filletCorners(poly, poly.map((_, i) => (i === 11 || i === 13 ? D : i === 12 ? D / 3 : 0)));
  if (area(poly) < 0) poly = poly.reverse();
  const paths = [{ layer: "cut", closed: true, pts: offsetPolygon(poly, kerf / 2) }];
  if (labels) {
    const at = mul(bisIn, (0.5 * D) / Math.sin(a / 2));
    for (const pts of strokeText(letter, Math.min(3, 0.4 * D), at, [1, 0], [0, 1])) paths.push({ layer: "mark", closed: false, pts });
  }
  return { name: `clip ${letter}`, kind: "clip", paths };
}

/**
 * A fit-test strip: slots at slotMm − 0.2 … + 0.2 mm (labelled in tenths;
 * slotMm is the sheet thickness, or a printed clip's width), a tie hole,
 * and a key cut from the same sheet to push into them.
 */
export function fitCoupon({ sheetMm: t, kerfMm = 0, tieHoleMm = 4, slotMm = t }) {
  const w = Math.max(2 * t, 5), pitch = Math.max(12, w + 7);
  const deltas = [-0.2, -0.1, 0, 0.1, 0.2];
  const W = pitch * (deltas.length + 1) + 6, H = w + 18;
  const paths = [{ layer: "cut", closed: true, pts: offsetPolygon([[0, 0], [W, 0], [W, H], [0, H]], kerfMm / 2) }];
  deltas.forEach((dlt, i) => {
    const x = 6 + pitch * (i + 0.5), sw = slotMm + dlt;
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
