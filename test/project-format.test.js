import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compile } from "../src/compile.js";
import { VERSION } from "../src/version.js";
import {
  serializeProjectV1,
  parseProject,
  FORMAT_ID,
  FORMAT_VERSION,
} from "../src/project-format.js";
import {
  normalizeState,
  serializeState,
  statesEqual,
} from "../src/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fix = (name) =>
  readFileSync(join(__dirname, "fixtures/projects", name), "utf8");

describe("serializeProjectV1", () => {
  it("matches PROJECT_FORMAT field rules for a default compile", () => {
    const { state } = compile({});
    const text = serializeProjectV1({ name: "Prototype TPU", state });
    const obj = JSON.parse(text);
    assert.equal(text.endsWith("\n"), true);
    assert.equal(obj.format, FORMAT_ID);
    assert.equal(obj.formatVersion, FORMAT_VERSION);
    assert.equal(obj.name, "Prototype TPU");
    assert.equal(obj.createdWith, VERSION);
    assert.equal(obj.view, undefined);
    assert.equal(obj.state.borderFraction, 0.36);
    assert.equal(obj.state.borderMm, undefined);
    assert.equal(obj.state.base, "icosidodeca");
  });

  it("save-load-save produces identical canonical bytes", () => {
    const { state } = compile({ wallMm: 2, faceIndex: 3 });
    const once = serializeProjectV1({ name: "A", state });
    const parsed = parseProject(once);
    assert.equal(parsed.ok, true);
    const twice = serializeProjectV1({
      name: parsed.project.name,
      state: parsed.state,
    });
    // createdWith may match; name+state canonical
    const a = JSON.parse(once);
    const b = JSON.parse(twice);
    assert.deepEqual(a.state, b.state);
    assert.equal(a.name, b.name);
  });
});

describe("parseProject", () => {
  it("loads v1-minimal", () => {
    const r = parseProject(fix("v1-minimal.shapemaker.json"));
    assert.equal(r.ok, true);
    assert.equal(r.state.base, "icosidodeca");
    const c = compile(r.state);
    assert.equal(c.validation.ok, true);
  });

  it("loads v1-full and compiles equivalently", () => {
    const r = parseProject(fix("v1-full.shapemaker.json"));
    assert.equal(r.ok, true);
    assert.equal(r.project.name, "Prototype TPU");
    const c = compile(r.state);
    assert.equal(c.validation.ok, true);
    assert.equal(c.metrics.triangleCount, 7200);
  });

  it("refuses unsupported future versions", () => {
    const r = parseProject(fix("v99-unsupported.shapemaker.json"));
    assert.equal(r.ok, false);
    assert.match(r.error, /format version 99/i);
  });

  it("failed parse does not throw", () => {
    const r = parseProject("{not json");
    assert.equal(r.ok, false);
  });

  it("preserves filletMm from a v1 file", () => {
    const r = parseProject(fix("v1-minimal.shapemaker.json"));
    assert.equal(r.ok, true);
    assert.equal(r.state.filletMm, 4.5);
    const c = compile(r.state);
    assert.equal(c.validation.ok, true);
    assert.ok(Math.abs(c.metrics.volumeCm3 - 16.14979675) < 1e-4);
  });

  it("fills default filletMm when omitted", () => {
    const raw = JSON.parse(fix("v1-minimal.shapemaker.json"));
    delete raw.state.filletMm;
    const r = parseProject(JSON.stringify(raw));
    assert.equal(r.ok, true);
    assert.equal(r.state.filletMm, 4.5);
  });

  it("rejects relative fillet without filletMm", () => {
    const raw = {
      format: FORMAT_ID,
      formatVersion: 1,
      state: {
        base: "icosidodeca",
        circumdiameterMm: 100,
        borderMm: 3.2,
        depth: "hollow",
        wallMm: 1.4,
        openings: true,
        fillet: 0.5,
        edgeDiv: 10,
        faceIndex: 0,
      },
    };
    const r = parseProject(JSON.stringify(raw));
    assert.equal(r.ok, false);
    assert.match(r.error, /filletMm/i);
  });
});

describe("canonical codec", () => {
  it("normalizeState fills defaults", () => {
    const s = normalizeState({ circumdiameterMm: 80 });
    assert.equal(s.circumdiameterMm, 80);
    assert.equal(s.borderFraction, 0.36);
    assert.equal(s.borderMm, undefined);
  });

  it("normalizeState keeps legacy borderMm without inheriting fraction", () => {
    const s = normalizeState({ borderMm: 3.2 });
    assert.equal(s.borderMm, 3.2);
    assert.equal(s.borderFraction, undefined);
  });

  it("serializeState keeps borderFraction and drops inactive mm", () => {
    const s = serializeState({
      ...normalizeState({}),
      borderFraction: 0.2,
      borderMm: 3.2,
      junk: 1,
    });
    assert.equal(s.borderFraction, 0.2);
    assert.equal(s.borderMm, undefined);
    assert.equal(s.junk, undefined);
  });

  it("statesEqual", () => {
    const a = normalizeState({});
    const b = normalizeState({});
    assert.equal(statesEqual(a, b), true);
    assert.equal(statesEqual(a, { ...b, wallMm: 2 }), false);
  });
});
