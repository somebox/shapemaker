/**
 * Fold mode: thin stock unfolded into nets.
 *
 * A net grows breadth-first from its largest panel, hinging each neighbour
 * about their shared edge, and refuses a neighbour that would overlap the
 * net or push it past the board; whatever is left starts the next net. Edges
 * inside a net are fold lines; edges between nets (or refused) stay open and
 * get glue flaps, seams or nothing (tape), plus matching numbers.
 *
 * Sewn edges are seams, as in clothing: both pieces get a seam allowance
 * past the edge, the edge itself is the stitch line, and the two allowances
 * are stitched face to face from the inside, where they stay as a fin. The
 * allowance ends are cut back at half the corner's angle, so allowances of
 * seams that meet at a corner don't pile up (and in a notch between two
 * petals of a net, they meet without overlapping when the shape allows).
 * Valley edges are always seams, so a star comes apart into one cone per
 * point. Where a notch or slit in a net is too narrow for two allowances (a nearly
 * flat corner, as on a geodesic; gores side by side, as on a globe), the
 * gap stays in the net as a dart: folded in half and stitched along both
 * edges, it is the allowance.
 *
 * Nets are built seen from inside (as Cut panels are), so marks on the
 * sheet's top face end up hidden. From that side a convex edge folds away
 * from you (a valley fold as cut) and a valley of the model folds toward
 * you (a mountain fold as cut).
 */

import {
  add, sub, mul, unit, leftNormal, convexOverlap, alignSegment, apply,
  minAreaAngle, rotate, bbox, len,
} from "./geom2.js";
import { insideView, panelOpenings } from "./panels.js";
import { strokeText, textWidth } from "./font.js";
import { pointInPoly } from "./cut.js";

/**
 * @param {{ panels: object[], joints: object[] }} extracted
 * @param {{
 *   join: 'tape'|'flaps'|'sew',
 *   foldStyle?: 'score'|'perforate'|'mark',
 *   board: { w: number, h: number }, marginMm?: number,
 *   flapMm?: number, seamMm?: number, sewHoles?: boolean, sewHoleMm?: number, sewPitchMm?: number,
 *   labels?: boolean, rootFace?: number,
 *   openings?: { generator: object, borderFraction: number, filletMm: number } | null,
 * }} opts
 */
export function buildFold(extracted, opts) {
  const { panels, joints } = extracted;
  const style = opts.foldStyle ?? "score";
  const margin = opts.marginMm ?? 5;
  const fitW = opts.board.w - 2 * margin, fitH = opts.board.h - 2 * margin;
  // Seams add an allowance round a net's outline: lay nets out with room for it.
  const grow = opts.join === "sew" ? 2 * (opts.seamMm ?? 6) : 0;
  const labels = opts.labels ?? true;
  const warnings = [];

  const views = panels.map((p) => insideView(p));
  const sideIndex = (pid, origSide) => views[pid].sideOf(origSide);
  const jointsOf = panels.map(() => []);
  for (const j of joints) {
    jointsOf[j.a].push({ j, other: j.b });
    jointsOf[j.b].push({ j, other: j.a });
  }

  const placedTf = new Array(panels.length).fill(null);
  const netOf = new Array(panels.length).fill(-1);
  const nets = [];
  const folded = new Set();
  const order = panels.map((p) => p.id).sort((a, b) => polyArea(views[b].outline) - polyArea(views[a].outline));
  // A chosen face centres the first net; otherwise the largest panel does.
  const rootPanel = Number.isInteger(opts.rootFace) ? panels.findIndex((p) => p.faces.includes(opts.rootFace)) : -1;
  if (rootPanel >= 0) order.unshift(...order.splice(order.indexOf(rootPanel), 1));

  for (const root of order) {
    if (netOf[root] >= 0) continue;
    const net = { id: nets.length, members: [root], polys: [views[root].outline], pts: [...views[root].outline] };
    nets.push(net);
    netOf[root] = net.id;
    placedTf[root] = { a: 0, t: [0, 0] };
    // Grow compactly: of all faces that could hinge on next, take the one
    // whose centre lands nearest the root's, so nets come out as flowers
    // and strips rather than sprawling trees.
    const centre = polyCentre(net.polys[0]);
    const frontier = [];
    const offer = (pid) => {
      for (const { j, other } of jointsOf[pid]) {
        if (netOf[other] >= 0) continue;
        // Sewn: valleys are seams, so a star comes apart into one cone per
        // point, the way it would be patterned in cloth.
        if (opts.join === "sew" && j.reflex) continue;
        // Hinge `other` onto pid's placed copy of the shared edge.
        const sp = side(views[pid].outline, sideIndex(pid, pid === j.a ? j.ea : j.eb));
        const so = side(views[other].outline, sideIndex(other, other === j.a ? j.ea : j.eb));
        const tfP = placedTf[pid];
        const tf = alignSegment(so[0], so[1], apply(tfP, sp[1]), apply(tfP, sp[0]));
        const poly = views[other].outline.map((p) => apply(tf, p));
        const c = polyCentre(poly);
        frontier.push({ j, other, tf, poly, dist: Math.hypot(c[0] - centre[0], c[1] - centre[1]) });
      }
    };
    offer(root);
    while (frontier.length) {
      frontier.sort((x, y) => x.dist - y.dist);
      const cand = frontier.shift();
      if (netOf[cand.other] >= 0) continue;
      if (net.polys.some((q) => convexOverlap(cand.poly, q, 1e-3))) continue;
      if (!fits([...net.pts, ...cand.poly], fitW - grow, fitH - grow)) continue;
      net.members.push(cand.other);
      net.polys.push(cand.poly);
      net.pts.push(...cand.poly);
      placedTf[cand.other] = cand.tf;
      netOf[cand.other] = net.id;
      folded.add(cand.j.id);
      offer(cand.other);
    }
  }

  // Placed side geometry for a panel's original side index.
  const placedSide = (pid, origSide) => {
    const [p0, p1] = side(views[pid].outline, sideIndex(pid, origSide));
    const q0 = apply(placedTf[pid], p0), q1 = apply(placedTf[pid], p1), u = unit(sub(q1, q0));
    return { p0: q0, p1: q1, u, m: leftNormal(u), L: len(sub(q1, q0)) };
  };

  const netPaths = nets.map(() => []);
  // Flaps and seam allowances, which must clear the faces and each other.
  const flapPolys = nets.map(() => []);
  const foldLayer = (j) => (style === "mark" ? "mark" : j.reflex ? "mountain" : "valley");
  const emitFold = (net, a, b, j) => {
    if (style === "perforate") {
      for (const seg of dashes(a, b, 3, 1.5)) netPaths[net].push({ layer: "cut", closed: false, pts: seg });
    } else {
      netPaths[net].push({ layer: foldLayer(j), closed: false, pts: [a, b] });
    }
  };

  let flapFallbacks = 0, seamFallbacks = 0, seamsNarrowed = 0, labelsSkipped = 0;
  const open = [];
  const flapMm = opts.flapMm ?? 8;
  const seamMm = opts.seamMm ?? 6, sewHoles = opts.sewHoles ?? false;
  const sewD = opts.sewHoleMm ?? 1.5, pitch = opts.sewPitchMm ?? (opts.join === "sew" ? 5 : 6), sewDepth = Math.max(3, 2 * sewD);
  const labelDepth = new Map();
  const free = (net, poly) =>
    !nets[net].polys.some((q) => convexOverlap(poly, q, 1e-3)) && !flapPolys[net].some((q) => convexOverlap(poly, q, 1e-3));
  // Interior angle of a panel's (inside-view) outline at corner k.
  const cornerAngle = (pid, k) => {
    const o = views[pid].outline, n = o.length, p = o[k];
    const a = unit(sub(o[(k + 1) % n], p)), b = unit(sub(o[(k - 1 + n) % n], p));
    return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
  };

  /**
   * Seam allowances for an open edge, the same on both sides so the two
   * layers match: full width with the ends at half the corner angle (at
   * most 45°) first, then steeper ends and narrower strips where a
   * neighbour is in the way. A's p0 is B's p1 (the edge's v1).
   */
  const seamFor = (j, A, B, tries) => {
    const kA = sideIndex(j.a, j.ea), kB = sideIndex(j.b, j.eb), nA = views[j.a].outline.length, nB = views[j.b].outline.length;
    const half = (x, y) => Math.min(Math.PI / 4, Math.min(x, y) / 2);
    const atV1 = half(cornerAngle(j.a, kA), cornerAngle(j.b, (kB + 1) % nB));
    const atV0 = half(cornerAngle(j.a, (kA + 1) % nA), cornerAngle(j.b, kB));
    for (const [sc, ws] of tries) {
      const cot1 = 1 / Math.tan(sc * atV1), cot0 = 1 / Math.tan(sc * atV0);
      const w = Math.min(seamMm * ws, (0.9 * j.lengthMm) / (cot0 + cot1));
      if (w < Math.min(2, 0.5 * seamMm)) continue;
      const pa = trapezoid(A, w, cot1, cot0), pb = trapezoid(B, w, cot0, cot1);
      const na = netOf[j.a], nb = netOf[j.b];
      if (!free(na, pa) || !free(nb, pb) || (na === nb && convexOverlap(pa, pb, 1e-3))) continue;
      if (!fits([...nets[na].pts, ...pa, ...(na === nb ? pb : [])], fitW, fitH) || !fits([...nets[nb].pts, ...pb], fitW, fitH)) continue;
      const L = j.lengthMm;
      return { w, profile: [[0, 0], [L, 0], [L - w * cot1, w], [w * cot0, w]], cotV0: cot0, cotV1: cot1, polys: [pa, pb], narrowed: w < seamMm - 1e-6 };
    }
    return null;
  };
  const SEAM_FULL = [[1, 1], [1, 0.7]];
  const SEAM_REST = [[0.6, 1], [0.6, 0.7], [0.35, 1], [0.35, 0.7], [0.2, 0.7], [0.2, 0.5]];

  /**
   * A dart: the open edge's two sides face each other across a gap in the
   * same net, either meeting at one corner (a wedge of at most 90°) or
   * running side by side a slit apart (no wider than two allowances). The
   * gap stays as material, folded in half and stitched along both edges.
   * Its profile is one half of it, in the edge's coordinates from v0.
   */
  const dartFor = (j, A, B) => {
    const net = netOf[j.a];
    if (netOf[j.b] !== net) return null;
    const gap1 = len(sub(A.p0, B.p1)), gap0 = len(sub(A.p1, B.p0));
    const tip = Math.min(gap0, gap1) < 1e-4;
    if (tip) {
      const [V, FA, FB] = gap1 < gap0 ? [A.p0, A.p1, B.p0] : [A.p1, A.p0, B.p1];
      const a = unit(sub(FA, V)), b = unit(sub(FB, V));
      const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
      if (ang > Math.PI / 2 || ang < 1e-3) return null;
    } else if (Math.max(gap0, gap1) > 2 * seamMm) {
      return null;
    }
    const region = [A.p0, A.p1, B.p0, B.p1].filter((p, i, all) => len(sub(p, all[(i + 1) % 4])) > 1e-4);
    if (!isConvex(region) || !free(net, region)) return null;
    // In A's frame: along the edge from v0 (A runs v1 → v0), and outward.
    const at = (p) => [dot2(sub(p, A.p1), mul(A.u, -1)), dot2(sub(p, A.p1), mul(A.m, -1))];
    const mid = (p, q) => mul(add(p, q), 0.5);
    const L = j.lengthMm;
    const profile = [[0, 0], [L, 0], at(mid(A.p0, B.p1)), at(mid(A.p1, B.p0))].filter((p, i, all) => Math.hypot(p[0] - all[(i + 1) % all.length][0], p[1] - all[(i + 1) % all.length][1]) > 1e-4);
    const far = [gap1 > 1e-4 && [A.p0, B.p1], gap0 > 1e-4 && [A.p1, B.p0]].filter(Boolean);
    return { region, far, profile };
  };

  for (const j of joints) {
    const A = placedSide(j.a, j.ea), B = placedSide(j.b, j.eb);
    // Felt: where a net closes round a nearly flat corner, the edge's two
    // sides lie within a millimetre or so; the felt takes that up, so the
    // edge stays whole as a fold.
    const closes = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= Math.max(0.3, 0.02 * j.lengthMm);
    if (opts.join === "sew" && netOf[j.a] === netOf[j.b] && closes(A.p0, B.p1) && closes(A.p1, B.p0)) folded.add(j.id);
    if (folded.has(j.id)) {
      emitFold(netOf[j.a], A.p0, A.p1, j);
      continue;
    }
    // Open edge: decide what each side gets.
    let flapOn = null;
    if (opts.join === "flaps") {
      // Full-height flap with 45° ends on either side first; then steeper
      // ends (for narrow notches between petals), then half height.
      for (const [scale, endDeg] of [[1, 45], [1, 30], [1, 18], [0.5, 30], [0.5, 15]]) {
        for (const [pid, s] of [[j.a, A], [j.b, B]]) {
          const flap = flapPoly(s, flapMm * scale, endDeg);
          const net = netOf[pid];
          if (nets[net].polys.some((q) => convexOverlap(flap, q, 1e-3))) continue;
          if (flapPolys[net].some((q) => convexOverlap(flap, q, 1e-3))) continue;
          if (!fits([...nets[net].pts, ...flap], fitW, fitH)) continue;
          flapOn = { pid, s, flap };
          break;
        }
        if (flapOn) break;
      }
      if (!flapOn) flapFallbacks++;
    }
    let seam = null, dart = null;
    if (opts.join === "sew") {
      seam = seamFor(j, A, B, SEAM_FULL);
      if (!seam) dart = dartFor(j, A, B);
      if (!seam && !dart) seam = seamFor(j, A, B, SEAM_REST);
      if (!seam && !dart) seamFallbacks++;
      if (seam?.narrowed) seamsNarrowed++;
    }
    if (dart) {
      // The gap stays: only the lines across its open ends are cut.
      const net = netOf[j.a];
      flapPolys[net].push(dart.region);
      for (const pts of dart.far) netPaths[net].push({ layer: "cut", closed: false, pts });
    }
    const sewn = seam ?? dart;
    open.push({ joint: j, flapPanel: flapOn ? flapOn.pid : null, seam: sewn && { profile: sewn.profile, dart: !!dart } });
    for (const [pid, s, orig, side] of [[j.a, A, j.ea, 0], [j.b, B, j.eb, 1]]) {
      const net = netOf[pid];
      if (sewn) {
        if (seam) {
          const f = seam.polys[side];
          flapPolys[net].push(f);
          nets[net].pts.push(...f);
          netPaths[net].push({ layer: "cut", closed: false, pts: [f[0], f[3], f[2], f[1]] });
        }
        if (sewHoles) {
          // Holes on the stitch line, through both layers; symmetric about
          // the edge's midpoint, so the two sides line up.
          const n = Math.max(1, Math.floor((s.L - 4) / pitch) + 1), start = (s.L - (n - 1) * pitch) / 2;
          for (let i = 0; i < n; i++) netPaths[net].push({ layer: "cut", closed: true, pts: circle(add(s.p0, mul(s.u, start + i * pitch)), sewD / 2) });
        } else {
          for (const seg of dashes(s.p0, s.p1, 2, 1.5)) netPaths[net].push({ layer: "mark", closed: false, pts: seg });
        }
        // Mirrored side, so "into the panel" points into the allowance. A
        // dart's number stays on the face.
        const cots = seam && (side === 0 ? [seam.cotV1, seam.cotV0] : [seam.cotV0, seam.cotV1]);
        labelDepth.set(`${pid}:${orig}`, { s, depth: sewHoles ? sewD / 2 : 0, j, seam: seam && { w: seam.w, cotStart: cots[1], cotEnd: cots[0] } });
        continue;
      }
      if (flapOn && flapOn.pid === pid) {
        emitFold(net, s.p0, s.p1, j);
        flapPolys[net].push(flapOn.flap);
        // Later flaps must fit the board together with this one.
        nets[net].pts.push(...flapOn.flap);
        const f = flapOn.flap;
        netPaths[net].push({ layer: "cut", closed: false, pts: [f[0], f[3], f[2], f[1]] });
      } else {
        netPaths[net].push({ layer: "cut", closed: false, pts: [s.p0, s.p1] });
      }
      // Labels sit 0.8 mm inside a plain edge (placeLabel adds the gap).
      let depth = 0;
      if (opts.join === "sew") {
        // No room for a seam allowance: whip-stitch holes beside the edge.
        const n = Math.max(1, Math.floor((s.L - 2 * sewDepth) / pitch) + 1);
        const start = (s.L - (n - 1) * pitch) / 2;
        for (let i = 0; i < n; i++) {
          const cen = add(add(s.p0, mul(s.u, start + i * pitch)), mul(s.m, sewDepth));
          netPaths[net].push({ layer: "cut", closed: true, pts: circle(cen, sewD / 2) });
        }
        depth = sewDepth + sewD;
      }
      labelDepth.set(`${pid}:${orig}`, { s, depth, j });
    }
  }

  // Openings and labels, per panel in placed coordinates.
  for (const panel of panels) {
    const net = netOf[panel.id], tf = placedTf[panel.id];
    let openings = [];
    if (opts.openings) {
      openings = panelOpenings(panel, opts.openings.generator, opts.openings.borderFraction, opts.openings.filletMm)
        .map((o) => views[panel.id].flipPoly(o).map((p) => apply(tf, p)));
      for (const o of openings) netPaths[net].push({ layer: "cut", closed: true, pts: o });
    }
    if (!labels) continue;
    panel.ring.forEach((_, orig) => {
      const rec = labelDepth.get(`${panel.id}:${orig}`);
      if (!rec) return;
      // A seam's number goes on its allowance, hidden once sewn; the face
      // keeps it when the allowance is too small.
      const strokes =
        (rec.seam && placeLabel(flipSide(rec.s), String(rec.j.id), 0, [], { cot0: rec.seam.cotStart, cot1: rec.seam.cotEnd, maxDepth: rec.seam.w - 0.5 })) ||
        placeLabel(rec.s, String(rec.j.id), rec.depth, openings);
      if (strokes) for (const pts of strokes) netPaths[net].push({ layer: "mark", closed: false, pts });
      else labelsSkipped++;
    });
  }

  if (flapFallbacks) warnings.push(`${flapFallbacks} open edges had no room for a flap: tape them`);
  if (seamFallbacks) warnings.push(`${seamFallbacks === 1 ? "1 seam has" : `${seamFallbacks} seams have`} no room for an allowance and get${seamFallbacks === 1 ? "s" : ""} whip-stitch holes instead`);
  if (seamsNarrowed) warnings.push(`${seamsNarrowed === 1 ? "1 seam allowance was" : `${seamsNarrowed} seam allowances were`} narrowed to fit beside the next face`);
  if (labelsSkipped) {
    warnings.push(`${labelsSkipped} edge labels didn't fit${opts.openings ? " beside the openings: raise Border or turn Labels off" : " on their faces"}`);
  }
  const oversize = panels.filter((p) => !fits(views[p.id].outline, fitW, fitH)).length;
  if (oversize) warnings.push(`${oversize} faces are larger than the board`);

  const parts = nets.map((net, i) => ({ name: `net ${i + 1}`, kind: "net", panels: net.members, faces: [...net.polys, ...flapPolys[i]], paths: netPaths[i] }));
  const foldCount = joints.filter((j) => folded.has(j.id)).length;
  return {
    parts,
    warnings,
    // Fold and open edges, for the 3D assembly view.
    joins: joints.map((j) => {
      const o = open.find((x) => x.joint === j);
      return { joint: j, folded: folded.has(j.id), flapPanel: o?.flapPanel ?? null, seam: o?.seam ?? null };
    }),
    dims: { flapMm, seamMm, sewHoles, sewD, pitch, sewDepth, join: opts.join },
    stats: {
      panels: panels.length,
      joints: joints.length,
      nets: nets.length,
      folds: foldCount,
      openEdges: joints.length - foldCount,
      ...(opts.join === "sew"
        ? { seams: open.filter((o) => o.seam && !o.seam.dart).length, darts: open.filter((o) => o.seam?.dart).length, whipStitched: seamFallbacks }
        : {}),
      largestNet: Math.max(...nets.map((n) => n.members.length)),
    },
  };
}

/**
 * A strip to tune scoring before the real sheet: a valley line, a mountain
 * line and a perforated line, each with its letter, on their own layers.
 */
export function foldTestStrip() {
  const W = 90, H = 26, paths = [];
  paths.push({ layer: "cut", closed: true, pts: [[0, 0], [W, 0], [W, H], [0, H]] });
  const xs = [15, 45, 75];
  paths.push({ layer: "valley", closed: false, pts: [[xs[0], 0], [xs[0], H - 8]] });
  paths.push({ layer: "mountain", closed: false, pts: [[xs[1], 0], [xs[1], H - 8]] });
  for (const seg of dashes([xs[2], 0], [xs[2], H - 8], 3, 1.5)) paths.push({ layer: "cut", closed: false, pts: seg });
  ["V", "M", "P"].forEach((ch, i) => {
    for (const pts of strokeText(ch, 4, [xs[i], H - 4], [1, 0], [0, 1])) paths.push({ layer: "mark", closed: false, pts });
  });
  return { name: "fold test", kind: "coupon", paths };
}

function polyCentre(poly) {
  const c = [0, 0];
  for (const p of poly) { c[0] += p[0] / poly.length; c[1] += p[1] / poly.length; }
  return c;
}

const side = (outline, k) => [outline[k], outline[(k + 1) % outline.length]];

function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Does the point set fit a w × h board in its best orientation? */
function fits(pts, w, h) {
  const a = minAreaAngle(pts);
  const b = bbox(pts.map((p) => rotate(p, a)));
  const x = b.maxX - b.minX, y = b.maxY - b.minY;
  const [lo, hi] = x < y ? [x, y] : [y, x];
  return hi <= Math.max(w, h) + 1e-6 && lo <= Math.min(w, h) + 1e-6;
}

/** Glue flap outside side s: a trapezoid whose ends lean at endDeg. Returns [p0, p1, top1, top0]. */
function flapPoly(s, flapMm, endDeg = 45) {
  const h = Math.min(flapMm, 0.35 * s.L), o = mul(s.m, -h);
  const e = Math.min(h / Math.tan((endDeg * Math.PI) / 180), 0.45 * s.L);
  return [s.p0, s.p1, add(add(s.p1, mul(s.u, -e)), o), add(add(s.p0, mul(s.u, e)), o)];
}

/** Seam allowance outside side s, w wide, ends leaning in by cot0 at p0 and cot1 at p1. Returns [p0, p1, top1, top0]. */
function trapezoid(s, w, cot0, cot1) {
  const o = mul(s.m, -w);
  return [s.p0, s.p1, add(add(s.p1, mul(s.u, -w * cot1)), o), add(add(s.p0, mul(s.u, w * cot0)), o)];
}

const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];

/** Is the polygon convex (either winding)? */
function isConvex(poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return sign !== 0;
}

/** The same side run the other way: its inward normal points outside the panel. */
const flipSide = (s) => ({ p0: s.p1, p1: s.p0, u: mul(s.u, -1), m: mul(s.m, -1), L: s.L });

function dashes(a, b, on, off) {
  const L = len(sub(b, a)), u = unit(sub(b, a)), out = [];
  for (let s = 0; s < L; s += on + off) out.push([add(a, mul(u, s)), add(a, mul(u, Math.min(L, s + on)))]);
  return out;
}

function circle(cen, r, n = 16) {
  return Array.from({ length: n }, (_, i) => {
    const g = (2 * Math.PI * i) / n;
    return [cen[0] + r * Math.cos(g), cen[1] + r * Math.sin(g)];
  });
}

/**
 * Number strokes beside side s, or null. On a seam allowance (seam given),
 * the space's ends lean in by cot0 and cot1 and it is maxDepth deep.
 */
function placeLabel(s, text, depth0, openings, seam = null) {
  // Down to 2 mm: thin stock is read up close, and the border band beside
  // an opening is often only 3 mm deep.
  for (const h of [4, 3, 2.5, 2]) {
    const wd = textWidth(text, h), depth = depth0 + 0.8 + h / 2;
    if (seam && depth + h / 2 > seam.maxDepth) continue;
    // On a face the label keeps its depth from the corners; on an
    // allowance its far corners stay inside the leaning ends.
    const in0 = seam ? (depth + h / 2) * seam.cot0 : depth, in1 = seam ? (depth + h / 2) * seam.cot1 : depth;
    for (const f of [0.5, 0.35, 0.65]) {
      const a = f * s.L;
      if (a - wd / 2 < in0 || a + wd / 2 > s.L - in1) continue;
      const box = [[a - wd / 2, depth - h / 2], [a + wd / 2, depth - h / 2], [a + wd / 2, depth + h / 2], [a - wd / 2, depth + h / 2]]
        .map(([x, y]) => add(add(s.p0, mul(s.u, x)), mul(s.m, y)));
      if (openings.some((o) => box.some((q) => pointInPoly(q, o)) || o.some((q) => pointInPoly(q, box)))) continue;
      return strokeText(text, h, add(add(s.p0, mul(s.u, a)), mul(s.m, depth)), s.u, s.m);
    }
  }
  return null;
}
