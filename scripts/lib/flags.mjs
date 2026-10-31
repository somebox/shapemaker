/**
 * Command-line flags from the schemas, so a new state key or job setting is
 * a flag without touching the scripts.
 *
 * Every DEFAULT_STATE key is a flag in kebab case (--circumdiameter-mm=120),
 * with shorter names for the common ones. So is every setting of the chosen
 * process (--sheet-mm=3, --join=sew).
 */
import { DEFAULT_STATE } from "../../src/schema.js";
import { JOB_DEFS, PROCESSES, settingsOf } from "../../src/production/index.js";
import { validSetting } from "../../src/production/job.js";
import { BOARD_PROFILES } from "../../src/sheet/layout.js";

export const kebab = (k) => k.replace(/([A-Z])/g, "-$1").toLowerCase();

const castFor = (dflt) =>
  typeof dflt === "boolean"
    ? (v) => v !== "0" && v !== "false"
    : typeof dflt === "number"
    ? Number
    : String;

/** flag → [state key, cast] */
export const STATE_FLAGS = (() => {
  const flags = {};
  for (const [key, dflt] of Object.entries(DEFAULT_STATE)) {
    if (dflt === null || dflt === undefined) continue;
    flags[kebab(key)] = [key, castFor(dflt)];
  }
  // Constant-mm border is optional (legacy / acceptance fits) — not in defaults.
  flags["border-mm"] = ["borderMm", Number];
  flags["border-fraction"] = ["borderFraction", Number];
  return Object.assign(flags, {
    wall: flags["wall-mm"],
    // `--border=N` keeps meaning millimetres for acceptance / scripts.
    border: flags["border-mm"],
    fillet: flags["fillet-mm"],
    diameter: flags["circumdiameter-mm"],
    face: flags["face-index"],
  });
})();

/** `--name=value` and bare `--name` into { positional, flags }. */
export function parseArgs(argv) {
  const positional = [], flags = {};
  for (const a of argv) {
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq < 0) flags[a.slice(2)] = "true";
    else flags[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return { positional, flags };
}

/** A flag's text as a job setting's value; validated by normalizeJob. */
function settingValue(def, text) {
  if (def.kind === "range") return Number(text);
  if (def.kind === "choice") {
    const hit = def.options.find(([value]) => String(value) === text);
    return hit ? hit[0] : text;
  }
  return text;
}

/**
 * Apply flags to a job's settings in place. --board takes a profile id, or
 * WxH for a custom board.
 * @returns {{ unknown: string[], invalid: string[] }} flags that meant nothing
 *   for this process, and flags with a value the setting can't take
 */
export function applyJobFlags(job, flags) {
  const m = settingsOf(job);
  const defs = JOB_DEFS[job.process];
  const unknown = [], invalid = [];
  for (const [flag, text] of Object.entries(flags)) {
    const size = flag === "board" && /^(\d+(\.\d+)?)x(\d+(\.\d+)?)$/.exec(text);
    if (size && m) {
      m.board = "custom";
      m.boardSize = { w: Number(size[1]), h: Number(size[3]) };
      continue;
    }
    const def = defs.find((d) => kebab(d.key) === flag && d.kind !== "size");
    if (!def) {
      unknown.push(flag);
      continue;
    }
    const value = settingValue(def, text);
    if (validSetting(def, value)) m[def.key] = value;
    else invalid.push(flag);
  }
  return { unknown, invalid };
}

/** The settings of a process, for --help. */
export function describeSettings(process) {
  const lines = [];
  for (const def of JOB_DEFS[process]) {
    if (def.kind === "size") continue;
    const values =
      def.kind === "range" ? `${def.min}–${def.max} ${def.unit}`
      : def.kind === "choice" ? def.options.map(([v]) => v).join(" | ")
      : def.kind === "board" ? `${Object.keys(BOARD_PROFILES).join(" | ")} | WxH`
      : "a print bed id";
    lines.push(`  --${kebab(def.key)}=  ${values}  (default ${def.default})`);
  }
  return lines;
}

export const USAGE_PROCESSES = PROCESSES.join(" | ");
