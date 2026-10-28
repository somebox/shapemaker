/**
 * Pictures of a sheet design put together: the whole model, a cutaway that
 * shows the joints inside, and close-ups of one joint of each kind from the
 * inside and the outside.
 */
import { buildAssembly } from "../../src/sheet/assembly.js";
import { renderPng, fitCamera, boundingSphere } from "./render3d.mjs";

const COLORS = {
  panel: [224, 194, 146],
  panelB: [190, 152, 104],
  clip: [86, 176, 148],
  pclip: [232, 128, 64],
  tie: [60, 60, 66],
  paper: [247, 244, 236],
  flap: [238, 214, 150],
  tape: [236, 196, 70],
  thread: [196, 62, 52],
};
const LINE = { panel: [92, 72, 50], panelB: [80, 60, 40], clip: [22, 92, 72], pclip: [120, 60, 24], paper: [120, 116, 108], flap: [140, 110, 50], tape: [150, 120, 30], mark: [30, 30, 30] };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => mul(a, 1 / Math.hypot(...a));

const VIEW = unit([1, -1.7, 0.95]);

function scene(solids) {
  const tris = [], lines = [];
  for (const s of solids) {
    for (const pts of s.tris) tris.push({ pts, color: COLORS[s.tag] ?? [200, 200, 200] });
    for (const [a, b, kind] of s.lines) lines.push({ a, b, color: LINE[kind ?? s.tag] ?? [60, 60, 60] });
  }
  return { tris, lines };
}

/**
 * @returns {{ label: string, png: Buffer }[]}
 */
export function sheetPictures(skeleton, sheet, opts = {}) {
  const { solids } = buildAssembly(skeleton, sheet, opts);
  const plates = solids.filter((s) => s.panel != null);
  const fasteners = solids.filter((s) => s.panel == null);
  const all = boundingSphere(plates.flatMap((s) => s.tris.flat()));
  const pics = [];

  pics.push({ label: "Assembled", png: renderPng(scene(solids), fitCamera(all.center, all.radius, VIEW), { width: 760, height: 570 }) });

  // Cutaway: drop the near half of the plates, keep what holds the far half.
  const ahead = (p) => dot(sub(p, all.center), VIEW) / all.radius;
  const kept = plates.filter((s) => ahead(s.anchor) < 0.08);
  const keptIds = new Set(kept.map((s) => s.panel));
  const jointsById = new Map(sheet.extracted.joints.map((j) => [j.id, j]));
  const keptFast = fasteners.filter((s) => {
    const j = jointsById.get(s.joint);
    return j && (keptIds.has(j.a) || keptIds.has(j.b)) && ahead(s.anchor) < 0.3;
  });
  pics.push({
    label: "Cutaway: the joints inside",
    png: renderPng(scene([...kept, ...keptFast]), fitCamera(all.center, all.radius, VIEW), { width: 760, height: 570 }),
  });

  // One close-up per kind of joint (clip class, ties, tabs, flap, tape, sewing).
  for (const jn of pickJoints(sheet)) {
    const j = jn.joint;
    const pa = plates.find((s) => s.panel === j.a), pb = plates.find((s) => s.panel === j.b);
    const mine = fasteners.filter((s) => s.joint === j.id);
    const target = mine[0]?.anchor ?? midpoint(skeleton, j, jn.at?.[0]);
    const nA = sheet.extracted.panels[j.a].frame.normal, nB = sheet.extracted.panels[j.b].frame.normal;
    const inward = unit(mul(add(nA, nB), -1));
    const along = unit(sub(vert(skeleton, j.v1), vert(skeleton, j.v0)));
    const r = Math.max(14, Math.min(45, 0.35 * j.lengthMm));
    const b2 = { ...pb, tag: pb.tag === "panel" ? "panelB" : pb.tag };
    const sc = scene([pa, b2, ...mine]);
    const title = jn.title, size = { width: 520, height: 390 }, up = inwardUp(inward, along);
    const inside = add(mul(inward, 0.55), along), outside = add(mul(inward, -1), mul(along, 0.7));
    pics.push({ label: `${title}, inside`, png: renderPng(sc, fitCamera(target, r, inside, { up }), size) });
    pics.push({ label: `${title}, outside`, png: renderPng(sc, fitCamera(target, r, outside, { up }), size) });
    // Exploded: clips pulled inward out of their slots; a tab panel drawn
    // back along its own plane so the tabs show.
    const t = sheet.dims?.t ?? 1;
    if (jn.kind === "clips") {
      const moved = mine.map((m) => shift(m, mul(inward, 2.5 * t)));
      pics.push({ label: `${title}, pulled apart`, png: renderPng(scene([pa, b2, ...moved]), fitCamera(add(target, mul(inward, 1.2 * t)), r, inside, { up }), size) });
    } else if (jn.kind === "tabs") {
      const intoB = intoPanel(sheet, j.b, along, vert(skeleton, j.v0));
      pics.push({ label: `${title}, pulled apart`, png: renderPng(scene([pa, shift(b2, mul(intoB, 3 * t))]), fitCamera(target, r * 1.2, add(outside, mul(inward, 0.6)), { up }), size) });
    }
  }
  return pics;
}

/** A copy of a solid moved by d. */
function shift(solid, d) {
  return {
    ...solid,
    tris: solid.tris.map((t) => t.map((p) => add(p, d))),
    lines: solid.lines.map(([a, b, k]) => [add(a, d), add(b, d), k]),
  };
}
/** Unit direction in panel pid's plane, square to the edge, pointing into it. */
function intoPanel(sheet, pid, along, p0) {
  const f = sheet.extracted.panels[pid].frame, n = f.normal;
  let d = unit([n[1] * along[2] - n[2] * along[1], n[2] * along[0] - n[0] * along[2], n[0] * along[1] - n[1] * along[0]]);
  if (dot(d, sub(f.origin, p0)) < 0) d = mul(d, -1);
  return d;
}
const vert = (sk, i) => [sk.positions[3 * i], sk.positions[3 * i + 1], sk.positions[3 * i + 2]];
function midpoint(sk, j, at) {
  const p0 = vert(sk, j.v0), e = unit(sub(vert(sk, j.v1), p0));
  return add(p0, mul(e, at ?? j.lengthMm / 2));
}
/** An up vector that keeps the edge roughly horizontal in close-ups. */
function inwardUp(inward, along) {
  const c = [inward[1] * along[2] - inward[2] * along[1], inward[2] * along[0] - inward[0] * along[2], inward[0] * along[1] - inward[1] * along[0]];
  return Math.hypot(...c) > 1e-6 ? c : [0, 0, 1];
}

/** One representative joint per joint kind, preferring mid-sized edges. */
function pickJoints(sheet) {
  const groups = new Map();
  for (const jn of sheet.joins) {
    let key, title;
    if (sheet.mode === "cut") {
      key = jn.kind === "clips" ? `clip ${Math.round(jn.joint.dihedralDeg * 2) / 2}` : jn.kind;
      title = jn.kind === "clips" ? `Clip at ${jn.joint.dihedralDeg.toFixed(1)}°` : jn.kind === "ties" ? "Zip tie" : "Tab and slot";
    } else {
      if (jn.folded) continue;
      const join = sheet.dims.join;
      if (join === "flaps" && jn.flapPanel == null) continue;
      key = join;
      title = join === "flaps" ? "Glue flap" : join === "tape" ? "Tape" : "Whip stitch";
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...jn, title });
  }
  return [...groups.values()].slice(0, 2).map((list) => {
    const mean = list.reduce((s, x) => s + x.joint.lengthMm, 0) / list.length;
    return list.reduce((best, x) => (Math.abs(x.joint.lengthMm - mean) < Math.abs(best.joint.lengthMm - mean) ? x : best));
  });
}
