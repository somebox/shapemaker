/**
 * Skeleton → flat panels and the edge table between them.
 *
 * A panel is one face, or several faces that lie in one plane (subdivision
 * leaves 180° seams; those are not edges anyone joins). Each panel keeps
 * its outline in its own face frame, counter-clockwise seen from outside,
 * and every skeleton edge between two panels becomes one joint record with
 * its dihedral, so the joining strategies never touch 3D again.
 */

import { toFaceFrame, projectToFrame } from "../faceframe.js";
import { sub, dot, cross, area, centroid } from "./geom2.js";

/** Seams flatter than this are merged into one panel. */
const COPLANAR_DEG = 0.05;

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * @param {{ positions: Float64Array, faces: number[][] }} skeleton  in mm
 * @returns {{
 *   panels: { id: number, faces: number[], frame: object, ring: number[], outline: number[][], faceRings2d: number[][][] }[],
 *   joints: { id: number, a: number, b: number, ea: number, eb: number, v0: number, v1: number, lengthMm: number, dihedralDeg: number, reflex: boolean }[],
 * }}
 */
export function extractPanels(skeleton) {
  const { positions, faces } = skeleton;
  const P = (i) => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  const frames = faces.map((_, i) => toFaceFrame(skeleton, i));

  // Directed edge → face, to find the face across each edge.
  const across = new Map();
  faces.forEach((ring, fi) =>
    ring.forEach((v, k) => across.set(`${v},${ring[(k + 1) % ring.length]}`, fi)),
  );
  const dihedral = (fa, fb, v0) => {
    const na = frames[fa].normal, nb = frames[fb].normal;
    const theta = Math.PI - Math.acos(Math.max(-1, Math.min(1, dot3(na, nb))));
    // Reflex when the other face's centre sits above this face's plane.
    const reflex = dot3(sub3(frames[fb].origin, P(v0)), na) > 1e-9 * frames[fa].inradius;
    return { deg: ((reflex ? 2 * Math.PI - theta : theta) * 180) / Math.PI, reflex };
  };

  // Union coplanar neighbours.
  const parent = faces.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  faces.forEach((ring, fa) =>
    ring.forEach((v0, k) => {
      const v1 = ring[(k + 1) % ring.length], fb = across.get(`${v1},${v0}`);
      if (fb === undefined) return;
      if (Math.abs(dihedral(fa, fb, v0).deg - 180) < COPLANAR_DEG) parent[find(fa)] = find(fb);
    }),
  );
  const groups = new Map();
  faces.forEach((_, fi) => {
    const r = find(fi);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(fi);
  });

  const panelOf = new Array(faces.length);
  const panels = [];
  for (const members of groups.values()) {
    const id = panels.length;
    members.forEach((fi) => (panelOf[fi] = id));
    // Boundary = directed edges whose reverse is not inside the group.
    const inGroup = new Set(members);
    const next = new Map();
    for (const fi of members) {
      const ring = faces[fi];
      ring.forEach((v0, k) => {
        const v1 = ring[(k + 1) % ring.length];
        if (!inGroup.has(across.get(`${v1},${v0}`))) next.set(v0, v1);
      });
    }
    const start = next.keys().next().value;
    const ring = [start];
    for (let v = next.get(start); v !== start; v = next.get(v)) ring.push(v);
    const frame = frames[members[0]];
    const to2 = (v) => projectToFrame(frame, ...P(v));
    // Drop straight-through vertices left by the merge.
    const kept = ring.filter((v, k) => {
      const a = to2(ring[(k - 1 + ring.length) % ring.length]), b = to2(v), c = to2(ring[(k + 1) % ring.length]);
      const e0 = sub(b, a), e1 = sub(c, b);
      return Math.abs(cross(e0, e1)) > 1e-7 * Math.sqrt(dot(e0, e0) * dot(e1, e1));
    });
    panels.push({
      id,
      faces: members,
      frame,
      ring: kept,
      outline: kept.map(to2),
      faceRings2d: members.map((fi) => faces[fi].map(to2)),
    });
  }

  // One joint per undirected boundary edge between two panels. A merged
  // panel edge may span several skeleton edges; join them by panel corner.
  const joints = [];
  const seen = new Set();
  for (const pa of panels) {
    pa.ring.forEach((v0, ea) => {
      const v1 = pa.ring[(ea + 1) % pa.ring.length];
      const key = v0 < v1 ? `${v0},${v1}` : `${v1},${v0}`;
      if (seen.has(key)) return;
      // The first skeleton edge out of v0 along this side: the one whose
      // far face belongs to another panel.
      let fa = -1, fb = -1;
      for (const fi of pa.faces) {
        const r = faces[fi], k = r.indexOf(v0);
        if (k < 0) continue;
        const other = across.get(`${r[(k + 1) % r.length]},${v0}`);
        if (other !== undefined && panelOf[other] !== pa.id) { fa = fi; fb = other; break; }
      }
      if (fa < 0) return;
      const pb = panels[panelOf[fb]];
      const eb = pb.ring.findIndex((u, i) => u === v1 && pb.ring[(i + 1) % pb.ring.length] === v0);
      if (eb < 0) return;
      seen.add(key);
      const { deg, reflex } = dihedral(fa, fb, v0);
      const d = sub3(P(v1), P(v0));
      joints.push({
        id: joints.length + 1,
        a: pa.id, ea, b: pb.id, eb, v0, v1,
        lengthMm: Math.sqrt(dot3(d, d)),
        dihedralDeg: deg,
        reflex,
      });
    });
  }
  return { panels, joints };
}

/**
 * Openings for every face of a panel, in the panel's frame, CCW. Each face
 * gets the same generator the shell uses, about its own area centroid.
 * @param {{ faceRings2d: number[][][] }} panel
 * @param {{ generate: Function }} generator
 */
export function panelOpenings(panel, generator, borderFraction, filletMm, segments = 48) {
  return panel.faceRings2d.map((ring) => {
    const c = centroid(ring);
    const flat = new Float64Array(ring.flatMap((p) => [p[0] - c[0], p[1] - c[1]]));
    const { opening } = generator.generate(flat, borderFraction, filletMm, segments);
    const hole = [];
    for (let i = 0; i < opening.length; i += 2) hole.push([opening[i] + c[0], opening[i + 1] + c[1]]);
    return area(hole) < 0 ? hole.reverse() : hole;
  });
}

/**
 * The panel seen from inside, so labels engraved on the sheet's top face
 * end up inside the model. Mirrors x and reverses the ring to stay CCW.
 * `sideOf(k)` maps a mirrored side back to the panel's own side index.
 */
export function insideView(panel) {
  const n = panel.outline.length;
  const flip = (p) => [-p[0], p[1]];
  const outline = panel.outline.map(flip).reverse();
  return {
    outline,
    flipPoly: (poly) => poly.map(flip).reverse(),
    sideOf: (k) => (2 * n - 2 - k) % n,
  };
}
