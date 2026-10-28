import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compile.js";
import { DEFAULT_STATE } from "../src/schema.js";
import { OPENING_GENERATORS } from "../src/solid/shell.js";
import { extractPanels } from "../src/sheet/panels.js";
import { buildSheet, boardSvg, BOARD_PROFILES } from "../src/sheet/index.js";
import { area, apply, convexHull, convexOverlap } from "../src/sheet/geom2.js";
import { pointInPoly } from "../src/sheet/cut.js";
import { plateMesh } from "../src/sheet/printclips.js";

const skeletonOf = (state) =>
  compile({ ...DEFAULT_STATE, roundingMm: 0, openings: false, ...state }).skeleton;
const falcon = BOARD_PROFILES["falcon-a1"];

describe("sheet panels", () => {
  it("makes one panel per face and one joint per edge", () => {
    const { panels, joints } = extractPanels(skeletonOf({ base: "icosidodeca", circumdiameterMm: 150 }));
    assert.equal(panels.length, 32);
    assert.equal(joints.length, 60);
    for (const p of panels) assert.ok(area(p.outline) > 0, "outlines are CCW");
  });

  it("merges coplanar sub-faces back into one panel", () => {
    const { panels, joints } = extractPanels(skeletonOf({ base: "cube", subdiv: 1, subdivStyle: "grid" }));
    assert.equal(panels.length, 6);
    assert.equal(joints.length, 12);
    assert.ok(joints.every((j) => Math.abs(j.dihedralDeg - 90) < 1e-6));
  });

  it("marks valley edges between spikes as reflex", () => {
    const { joints } = extractPanels(skeletonOf({ base: "icosahedron", spike: 1.5, circumdiameterMm: 200 }));
    const reflex = joints.filter((j) => j.reflex);
    assert.equal(reflex.length, 30);
    assert.ok(reflex.every((j) => j.dihedralDeg > 180));
  });
});

describe("sheet cut mode", () => {
  const cut = (state, opts) =>
    buildSheet(skeletonOf(state), { mode: "cut", sheetMm: 3, board: falcon, ...opts });

  it("puts every clip slot inside its panel and clear of the openings", () => {
    const state = { base: "icosidodeca", circumdiameterMm: 200, openings: true, borderFraction: 0.6 };
    const res = cut(state, {
      join: "clips",
      openings: { generator: OPENING_GENERATORS.polygon, borderFraction: 0.6, filletMm: 4.5 },
    });
    assert.deepEqual(res.warnings, []);
    assert.equal(res.stats.clips.A, 60);
    for (const part of res.parts.filter((p) => p.kind === "panel")) {
      const [outline, ...holes] = part.paths.filter((p) => p.layer === "cut").map((p) => p.pts);
      const slots = holes.filter((h) => h.length === 4);
      const openings = holes.filter((h) => h.length > 4);
      assert.ok(slots.length >= 3, `${part.name} has a slot per side`);
      for (const s of slots) {
        for (const q of s) assert.ok(pointInPoly(q, outline), `${part.name} slot inside the panel`);
        for (const o of openings) assert.ok(!convexOverlap(s, convexHull(o), 0), `${part.name} slot clear of opening`);
      }
    }
  });

  it("recommends the border the joints need", () => {
    const res = cut(
      { base: "icosidodeca", circumdiameterMm: 200 },
      { join: "clips", openings: { generator: OPENING_GENERATORS.polygon, borderFraction: 0.36, filletMm: 4.5 } },
    );
    assert.ok(res.stats.minBorderFraction > 0.36);
    assert.match(res.warnings.join(" "), /raise Border/);
  });

  it("uses tabs near 90° and falls back to clips elsewhere", () => {
    const cube = cut({ base: "cube", circumdiameterMm: 140 }, { join: "tabs" });
    assert.equal(cube.stats.tabs, 24);
    assert.deepEqual(cube.stats.clips, {});
    const ico = cut({ base: "icosahedron", circumdiameterMm: 160 }, { join: "tabs" });
    assert.equal(ico.stats.tabs, 0);
    assert.match(ico.warnings.join(" "), /too far from 90° for tabs/);
  });

  it("gives valley edges their own clip class", () => {
    const res = cut({ base: "icosahedron", spike: 1.5, circumdiameterMm: 220 }, { join: "clips" });
    assert.deepEqual(Object.keys(res.stats.clips).sort(), ["A", "B"]);
  });

  it("rounds the clip corners that show through an opening", () => {
    const res = cut({ base: "icosidodeca", circumdiameterMm: 200 }, { join: "clips" });
    const outline = res.parts.find((p) => p.kind === "clip").paths[0].pts;
    // 14 corners before rounding; the arm ends and heel become arcs.
    assert.ok(outline.length > 20, `${outline.length} points`);
    for (let i = 0; i < outline.length; i++) {
      const [a, b] = [outline[i], outline[(i + 1) % outline.length]];
      assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6, "no repeated points");
    }
  });

  it("prints clips on their own plates as closed, chamfered solids", () => {
    const res = cut({ base: "icosahedron", spike: 1.5, circumdiameterMm: 220 }, { join: "clips", clipsBy: "print" });
    const onBoards = res.boards.flatMap((b) => b.items).filter((it) => it.part.kind === "clip");
    assert.equal(onBoards.length, 0);
    assert.deepEqual([...new Set(res.plates.map((p) => p.letter))], ["A", "B"]);
    assert.equal(res.plates.reduce((n, p) => n + p.items.length, 0), 120);
    for (const plate of res.plates) {
      const { positions: P, indices } = plateMesh(plate, 3);
      const key = (k) => `${P[3 * k]},${P[3 * k + 1]},${P[3 * k + 2]}`;
      const edges = new Set();
      for (let t = 0; t < indices.length; t += 3) {
        for (let j = 0; j < 3; j++) edges.add(`${key(indices[t + j])}|${key(indices[t + ((j + 1) % 3)])}`);
      }
      for (const e of edges) {
        const [a, b] = e.split("|");
        assert.ok(edges.has(`${b}|${a}`), `plate ${plate.letter}: open edge`);
      }
      let minZ = Infinity, maxZ = -Infinity;
      for (let k = 2; k < P.length; k += 3) [minZ, maxZ] = [Math.min(minZ, P[k]), Math.max(maxZ, P[k])];
      assert.ok(Math.abs(minZ) < 1e-6 && Math.abs(maxZ - 3) < 1e-5);
    }
  });

  it("glues edges too short for a joint", () => {
    // 3 mm sheet: joints need 2·6 + 2·3 = 18 mm of edge.
    const small = cut({ base: "cube", circumdiameterMm: 25 }, { join: "clips" });
    assert.equal(small.stats.glued, 12);
    assert.deepEqual(small.stats.clips, {});
    assert.equal(small.parts.filter((p) => p.kind === "clip").length, 0);
    assert.match(small.warnings.join(" "), /too short for a joint: glue them/);
    const big = cut({ base: "cube", circumdiameterMm: 140 }, { join: "clips" });
    assert.equal(big.stats.glued, 0);
  });

  it("says so when no Border clears the joints", () => {
    const res = cut(
      { base: "icosidodeca", circumdiameterMm: 100 },
      { join: "clips", openings: { generator: OPENING_GENERATORS.polygon, borderFraction: 0.36, filletMm: 4.5 } },
    );
    assert.ok(res.stats.minBorderFraction > 0.9);
    assert.match(res.warnings[0], /no Border clears them: close the faces/);
  });
});

describe("sheet fold mode", () => {
  it("folds a spanning forest: folds = panels − nets", () => {
    for (const base of ["icosahedron", "dodecahedron", "icosidodeca"]) {
      const res = buildSheet(skeletonOf({ base, circumdiameterMm: 180 }), { mode: "fold", join: "flaps", board: falcon });
      assert.equal(res.stats.folds, res.stats.panels - res.stats.nets, base);
    }
  });

  it("fits flaps on the board together, not one at a time", () => {
    const res = buildSheet(skeletonOf({ base: "icosidodeca", circumdiameterMm: 100 }), {
      mode: "fold",
      join: "flaps",
      board: BOARD_PROFILES.a4,
    });
    assert.ok(!res.warnings.some((w) => /larger than the board/.test(w)), res.warnings.join(" | "));
  });

  it("centres the first net on the chosen face", () => {
    const sk = skeletonOf({ base: "icosidodeca", circumdiameterMm: 120 });
    for (const rootFace of [0, 7, 20]) {
      const res = buildSheet(sk, { mode: "fold", join: "tape", board: falcon, rootFace });
      const net = res.parts.find((p) => p.kind === "net" && p.name === "net 1");
      assert.ok(res.extracted.panels[net.panels[0]].faces.includes(rootFace), `face ${rootFace}`);
    }
  });
});

describe("sheet layout", () => {
  it("keeps parts on the board and apart", () => {
    const res = buildSheet(skeletonOf({ base: "octahedron", circumdiameterMm: 160 }), {
      mode: "cut", join: "tabs", sheetMm: 3, board: falcon, coupon: true,
    });
    for (const b of res.boards) {
      const hulls = b.items.map(({ part, tf }) => convexHull(part.paths.flatMap((p) => p.pts).map((q) => apply(tf, q))));
      for (const h of hulls) for (const [x, y] of h) assert.ok(x >= 0 && y >= 0 && x <= falcon.w && y <= falcon.h);
      for (let i = 0; i < hulls.length; i++)
        for (let j = i + 1; j < hulls.length; j++) assert.ok(!convexOverlap(hulls[i], hulls[j], 0), "parts overlap");
    }
  });

  it("writes a layered SVG in millimetres", () => {
    const res = buildSheet(skeletonOf({ base: "cube", circumdiameterMm: 100 }), {
      mode: "cut", join: "clips", sheetMm: 3, board: falcon,
    });
    const svg = boardSvg(res.boards[0], falcon);
    assert.match(svg, /width="381mm" height="305mm"/);
    assert.match(svg, /id="cut"[^>]*stroke="#FF0000"/);
    assert.match(svg, /id="mark"/);
  });
});
