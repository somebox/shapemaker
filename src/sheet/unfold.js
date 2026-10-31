/**
 * Unfolding: faces into flat nets.
 *
 * A net grows breadth-first from its largest panel (or the chosen root),
 * hinging each neighbour about their shared edge, and refuses a neighbour
 * that would overlap the net or push it past the board; whatever is left
 * starts the next net.
 */

import { sub, unit, leftNormal, len, convexOverlap, alignSegment, apply, area, minAreaAngle, rotate, bbox } from "./geom2.js";

/**
 * @param {{ panels: object[], joints: object[] }} extracted
 * @param {object[]} views  insideView() of each panel
 * @param {{
 *   fitW: number, fitH: number,  usable board
 *   grow: number,  room to keep round each net (seam allowances)
 *   rootFace?: number,  face that centres the first net
 *   hingeValleys: boolean,  false splits a star into one cone per point
 * }} opts
 * @returns {{ nets: { id: number, members: number[], polys: number[][][], pts: number[][] }[], netOf: number[], placedTf: object[], folded: Set<number> }}
 */
export function growNets({ panels, joints }, views, { fitW, fitH, grow, rootFace, hingeValleys }) {
  const jointsOf = panels.map(() => []);
  for (const j of joints) {
    jointsOf[j.a].push({ j, other: j.b });
    jointsOf[j.b].push({ j, other: j.a });
  }

  const placedTf = new Array(panels.length).fill(null);
  const netOf = new Array(panels.length).fill(-1);
  const nets = [];
  const folded = new Set();
  const order = panels.map((p) => p.id).sort((a, b) => area(views[b].outline) - area(views[a].outline));
  // A chosen face centres the first net; otherwise the largest panel does.
  const rootPanel = Number.isInteger(rootFace) ? panels.findIndex((p) => p.faces.includes(rootFace)) : -1;
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
        if (!hingeValleys && j.reflex) continue;
        // Hinge `other` onto pid's placed copy of the shared edge.
        const sp = sideAt(views[pid].outline, views[pid].sideOf(pid === j.a ? j.ea : j.eb));
        const so = sideAt(views[other].outline, views[other].sideOf(other === j.a ? j.ea : j.eb));
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
  return { nets, netOf, placedTf, folded };
}

/** Placed geometry of a panel's original side: ends, unit direction, inward normal, length. */
export function placedSide(view, tf, origSide) {
  const [p0, p1] = sideAt(view.outline, view.sideOf(origSide));
  const q0 = apply(tf, p0), q1 = apply(tf, p1), u = unit(sub(q1, q0));
  return { p0: q0, p1: q1, u, m: leftNormal(u), L: len(sub(q1, q0)) };
}

/** Does the point set fit a w × h board in its best orientation? */
export function fits(pts, w, h) {
  const a = minAreaAngle(pts);
  const b = bbox(pts.map((p) => rotate(p, a)));
  const x = b.maxX - b.minX, y = b.maxY - b.minY;
  const [lo, hi] = x < y ? [x, y] : [y, x];
  return hi <= Math.max(w, h) + 1e-6 && lo <= Math.min(w, h) + 1e-6;
}

const sideAt = (outline, k) => [outline[k], outline[(k + 1) % outline.length]];

function polyCentre(poly) {
  const c = [0, 0];
  for (const p of poly) { c[0] += p[0] / poly.length; c[1] += p[1] / poly.length; }
  return c;
}
