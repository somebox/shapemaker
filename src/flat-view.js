/**
 * The Flat view: a production's boards and print plates laid out, in the
 * cut file's colours, one tab each. Hovering a part names it and clicking
 * one hands it back to the caller.
 */

import { LAYERS, LAYER_NAMES, PLATE_CLIP, SHEET_FILL, fmt, placePoint, plural, sheetViews } from "./production/index.js";
import { el } from "./controls.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function partLabel(part) {
  const see = "click to see it on the model";
  if (part.kind === "panel") return `Panel ${part.panel + 1} · ${see}`;
  if (part.kind === "clip") return `Clip ${part.name.replace(/^clip /, "")} · edge ${part.joint}${part.print ? " · printed" : ""} · ${see}`;
  if (part.kind === "net") return `Net ${part.name.replace(/^net /, "")} · ${plural(part.panels.length, "face")} · ${see}`;
  if (part.kind === "weld") return `Corner piece · ${part.clips.length} clips welded · ${see}`;
  if (part.kind === "coupon") return `${part.name[0].toUpperCase()}${part.name.slice(1)} · cut this first to check the slot fit`;
  return part.name;
}

/**
 * @param {HTMLElement} host
 * @param {{ onPick: (part: object) => void }} opts
 */
export function createFlatView(host, { onPick }) {
  const root = el("div", { className: "sheet-flat", hidden: true });
  const bar = el("div", { className: "sheet-flat-bar" });
  const tabs = el("div", { className: "sheet-flat-tabs" });
  const legend = el("div", { className: "sheet-flat-legend" });
  bar.append(tabs, legend);
  const stage = el("div", { className: "sheet-flat-stage" });
  const tip = el("div", { className: "sheet-flat-tip", hidden: true });
  root.append(bar, stage, tip);
  host.append(root);

  /** Which tab: boards first, then print plates. */
  let index = 0;

  function paint(prod) {
    const views = sheetViews(prod);
    index = Math.min(index, Math.max(0, views.length - 1));
    const view = views[index];
    const plate = view.kind === "plate";
    const size = view.size;
    tip.hidden = true;
    tabs.replaceChildren(
      ...views.map((v, i) =>
        Object.assign(el("button", { type: "button", className: `sheet-tab${v.kind === "plate" ? " sheet-tab--plate" : ""}`, textContent: v.label, "aria-pressed": String(v === view) }), {
          onclick: () => {
            index = i;
            paint(prod);
          },
        }),
      ),
    );
    const used = new Set(view.items.flatMap((it) => it.part.paths.map((p) => p.layer)));
    legend.replaceChildren(
      ...(plate
        ? [el("span", { className: "sheet-legend-item", style: `--c:${PLATE_CLIP}`, textContent: `printed clips · ${size.label}` })]
        : Object.entries(LAYERS)
            .filter(([k]) => used.has(k))
            .map(([k, { color }]) => el("span", { className: "sheet-legend-item", style: `--c:${color}`, textContent: LAYER_NAMES[k] }))),
    );

    const svg = svgEl("svg", { viewBox: `-4 -4 ${size.w + 8} ${size.h + 8}`, class: "sheet-board" });
    svg.append(svgEl("rect", { x: 0, y: 0, width: size.w, height: size.h, rx: 1.5, fill: plate ? SHEET_FILL.plate : SHEET_FILL[prod.process], class: "sheet-board-bg" }));
    const P = (tf, q) => {
      const [x, y] = placePoint(tf, q);
      return `${fmt(x, 2)},${fmt(size.h - y, 2)}`;
    };
    for (const { part, tf } of view.items) {
      const g = svgEl("g", { class: `sheet-part sheet-part--${part.kind}${plate ? " sheet-part--printed" : ""}` });
      // The piece's area takes the hover fill (evenodd leaves its holes
      // open). A net's outline is open cut runs, so its faces and flaps
      // stand in for it.
      const closed = part.faces ? part.faces.map((pts) => ({ pts })) : part.paths.filter((p) => p.closed && p.layer === "cut");
      const ring = (pts) => `M${pts.map((q) => P(tf, q)).join("L")}Z`;
      const body = closed.map((p) => ring(p.pts)).join("");
      // The outline alone takes the pointer, so holes still pick the part.
      if (closed.length) g.append(svgEl("path", { d: part.faces ? body : ring(closed[0].pts), class: "sheet-part-hit" }));
      if (body) g.append(svgEl("path", { d: body, class: "sheet-part-fill", "fill-rule": part.faces ? "nonzero" : "evenodd" }));
      for (const [layer, { color }] of Object.entries(LAYERS)) {
        const d = part.paths.filter((p) => p.layer === layer).map((p) => `M${p.pts.map((q) => P(tf, q)).join("L")}${p.closed ? "Z" : ""}`).join("");
        if (d) g.append(svgEl("path", { d, stroke: color, class: `sheet-line sheet-line--${layer}` }));
      }
      const showTip = () => {
        tip.hidden = false;
        tip.textContent = partLabel(part);
      };
      const hideTip = () => {
        tip.hidden = true;
      };
      g.addEventListener("pointerenter", showTip);
      g.addEventListener("pointerleave", hideTip);
      g.addEventListener("click", () => onPick(part));
      // The fit strip has nothing to find on the model.
      if (part.kind !== "coupon") {
        g.setAttribute("tabindex", "0");
        g.setAttribute("role", "button");
        g.setAttribute("aria-label", partLabel(part));
        g.addEventListener("focus", showTip);
        g.addEventListener("blur", hideTip);
        g.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onPick(part);
        });
      }
      svg.append(g);
    }
    stage.replaceChildren(svg);
  }

  return {
    /** @param {ReturnType<import('./production/index.js').produce> | null} prod  null hides it */
    show(prod) {
      root.hidden = !prod;
      if (prod) paint(prod);
    },
  };
}
