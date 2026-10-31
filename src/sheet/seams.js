/**
 * Seams for sewn stock, as in clothing: both pieces get an allowance past
 * the edge, the edge itself is the stitch line, and the two allowances are
 * stitched face to face from the inside, where they stay as a fin. The
 * allowance ends are cut back at half the corner's angle, so allowances of
 * seams that meet at a corner don't pile up (and in a notch between two
 * petals of a net, they meet without overlapping when the shape allows).
 *
 * Where a notch or slit in a net is too narrow for two allowances (a nearly
 * flat corner, as on a geodesic; gores side by side, as on a globe), the
 * gap stays in the net as a dart: folded in half and stitched along both
 * edges, it is the allowance.
 */

import { add, sub, mul, dot, unit, len, convexOverlap, isConvex } from "./geom2.js";
import { fits } from "./unfold.js";

/** Tries as [end-angle scale, width scale]: a full seam, then, after darts, steeper and narrower ones. */
export const SEAM_FULL = [[1, 1], [1, 0.7]];
export const SEAM_REST = [[0.6, 1], [0.6, 0.7], [0.35, 1], [0.35, 0.7], [0.2, 0.7], [0.2, 0.5]];

/**
 * What seamFor and dartFor need to know about the nets so far.
 * @typedef {{
 *   views: object[], nets: object[], netOf: number[], seamMm: number,
 *   fitW: number, fitH: number,
 *   free: (net: number, poly: number[][]) => boolean,
 * }} SeamContext
 */

/**
 * Seam allowances for an open edge, the same on both sides so the two
 * layers match: full width with the ends at half the corner angle (at
 * most 45°) first, then steeper ends and narrower strips where a
 * neighbour is in the way. A's p0 is B's p1 (the edge's v1).
 * @param {SeamContext} ctx
 */
export function seamFor({ views, nets, netOf, seamMm, fitW, fitH, free }, j, A, B, tries) {
  const kA = views[j.a].sideOf(j.ea), kB = views[j.b].sideOf(j.eb), nA = views[j.a].outline.length, nB = views[j.b].outline.length;
  const half = (x, y) => Math.min(Math.PI / 4, Math.min(x, y) / 2);
  const atV1 = half(cornerAngle(views[j.a], kA), cornerAngle(views[j.b], (kB + 1) % nB));
  const atV0 = half(cornerAngle(views[j.a], (kA + 1) % nA), cornerAngle(views[j.b], kB));
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
}

/**
 * A dart: the open edge's two sides face each other across a gap in the
 * same net, either meeting at one corner (a wedge of at most 90°) or
 * running side by side a slit apart (no wider than two allowances). The
 * gap stays as material, folded in half and stitched along both edges.
 * Its profile is one half of it, in the edge's coordinates from v0.
 * @param {SeamContext} ctx
 */
export function dartFor({ netOf, seamMm, free }, j, A, B) {
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
  const at = (p) => [dot(sub(p, A.p1), mul(A.u, -1)), dot(sub(p, A.p1), mul(A.m, -1))];
  const mid = (p, q) => mul(add(p, q), 0.5);
  const L = j.lengthMm;
  const profile = [[0, 0], [L, 0], at(mid(A.p0, B.p1)), at(mid(A.p1, B.p0))].filter((p, i, all) => Math.hypot(p[0] - all[(i + 1) % all.length][0], p[1] - all[(i + 1) % all.length][1]) > 1e-4);
  const far = [gap1 > 1e-4 && [A.p0, B.p1], gap0 > 1e-4 && [A.p1, B.p0]].filter(Boolean);
  return { region, far, profile };
}

/** Interior angle of an inside-view outline at corner k. */
function cornerAngle(view, k) {
  const o = view.outline, n = o.length, p = o[k];
  const a = unit(sub(o[(k + 1) % n], p)), b = unit(sub(o[(k - 1 + n) % n], p));
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
}

/** Seam allowance outside side s, w wide, ends leaning in by cot0 at p0 and cot1 at p1. Returns [p0, p1, top1, top0]. */
function trapezoid(s, w, cot0, cot1) {
  const o = mul(s.m, -w);
  return [s.p0, s.p1, add(add(s.p1, mul(s.u, -w * cot1)), o), add(add(s.p0, mul(s.u, w * cot0)), o)];
}
