/**
 * Just enough DOM to run the real panel under node, without a dependency:
 * elements, attributes, the selectors the app uses, and events. No layout or
 * CSS, so `visible()` reads `hidden` up the tree and nothing more.
 */

const REFLECTED = new Set(["id", "type", "title", "min", "max", "step", "value", "role"]);

class El {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.parentElement = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.ownText = "";
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
    this.selected = false;
    this.scrollTop = 0;
    this.style = { setProperty() {} };
    this.classList = {
      add: (...c) => this.className = [...new Set([...this.classes(), ...c])].join(" "),
      remove: (...c) => this.className = this.classes().filter((x) => !c.includes(x)).join(" "),
      contains: (c) => this.classes().includes(c),
      toggle: (c, on) => {
        if (on ?? !this.classList.contains(c)) this.classList.add(c);
        else this.classList.remove(c);
      },
    };
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === "string" ? this.attrs.get(`data-${dash(k)}`) : undefined),
      set: (_, k, v) => {
        this.attrs.set(`data-${dash(k)}`, String(v));
        return true;
      },
    });
  }

  classes() {
    return (this.attrs.get("class") ?? "").split(/\s+/).filter(Boolean);
  }
  get className() {
    return this.attrs.get("class") ?? "";
  }
  set className(v) {
    this.attrs.set("class", v);
  }
  get isConnected() {
    let n = this;
    while (n.parentElement) n = n.parentElement;
    return n === this.ownerDocument.root;
  }
  get textContent() {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this.ownText = String(v);
    this.detachAll();
  }
  set innerHTML(v) {
    this.ownText = "";
    this.markup = String(v);
    this.detachAll();
  }
  get innerHTML() {
    return this.markup ?? "";
  }
  get selectedOptions() {
    const options = this.children.filter((c) => c.tagName === "OPTION");
    return [options.find((o) => o.selected) ?? options[0]].filter(Boolean);
  }

  setAttribute(k, v) {
    this.attrs.set(k, String(v));
    if (REFLECTED.has(k)) this[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k) {
    return this.attrs.has(k);
  }
  removeAttribute(k) {
    this.attrs.delete(k);
  }

  detachAll() {
    for (const c of this.children) c.parentElement = null;
    this.children = [];
  }
  adopt(node) {
    if (typeof node === "string") {
      this.ownText += node;
      return null;
    }
    node.remove();
    node.parentElement = this;
    return node;
  }
  append(...nodes) {
    for (const n of nodes) {
      const c = this.adopt(n);
      if (c) this.children.push(c);
    }
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  prepend(...nodes) {
    this.children.unshift(...nodes.map((n) => this.adopt(n)).filter(Boolean));
  }
  insertBefore(node, ref) {
    ref.before(node);
    return node;
  }
  before(...nodes) {
    const parent = this.parentElement;
    for (const n of nodes) {
      const c = parent.adopt(n);
      if (c) parent.children.splice(parent.children.indexOf(this), 0, c);
    }
  }
  after(...nodes) {
    const parent = this.parentElement;
    let at = parent.children.indexOf(this) + 1;
    for (const n of nodes) {
      const c = parent.adopt(n);
      if (c) parent.children.splice(at++, 0, c);
    }
  }
  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...nodes) {
    this.ownText = "";
    this.detachAll();
    this.append(...nodes);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  /** Bubbles, like the real thing. */
  dispatch(type, props = {}) {
    const event = { type, target: this, preventDefault() {}, ...props };
    for (let n = this; n; n = n.parentElement) {
      for (const fn of n.listeners.get(type) ?? []) fn(event);
    }
    return event;
  }
  click() {
    if (!this.disabled) this.dispatch("click");
  }
  focus() {
    this.ownerDocument.activeElement = this;
    this.dispatch("focus");
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
    this.dispatch("blur");
  }
  select() {}
  setPointerCapture() {}
  releasePointerCapture() {}

  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  querySelectorAll(selector) {
    const alternatives = selector.split(",").map((s) => s.trim().split(/\s+/).map(parseCompound));
    return this.descendants().filter((n) => alternatives.some((steps) => matchesPath(n, steps)));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

const dash = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function parseCompound(text) {
  const tag = /^[a-zA-Z][\w-]*/.exec(text)?.[0].toUpperCase() ?? null;
  const id = /#([\w-]+)/.exec(text)?.[1] ?? null;
  const classes = [...text.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrs = [...text.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => [m[1], m[2]]);
  return { tag, id, classes, attrs };
}

function matches(n, { tag, id, classes, attrs }) {
  return (
    (!tag || n.tagName === tag) &&
    (!id || n.id === id) &&
    classes.every((c) => n.classes().includes(c)) &&
    attrs.every(([k, v]) => n.hasAttribute(k) && (v === undefined || n.getAttribute(k) === v))
  );
}

function matchesPath(node, steps) {
  if (!matches(node, steps.at(-1))) return false;
  let i = steps.length - 2;
  for (let n = node.parentElement; n && i >= 0; n = n.parentElement) {
    if (matches(n, steps[i])) i -= 1;
  }
  return i < 0;
}

/** Whether nothing up the tree hides this node. */
export function visible(node) {
  for (let n = node; n; n = n.parentElement) if (n.hidden) return false;
  return true;
}

/**
 * Install a fresh document and the globals the panel reads, built with the
 * page's own skeleton. Returns the document.
 */
export function installDom({ store = memoryStore(), href = "http://test/#x" } = {}) {
  const doc = {
    activeElement: null,
    createElement: (tag) => new El(tag, doc),
    createTextNode: (t) => String(t),
    getElementById: (id) => doc.root.querySelector(`#${id}`),
  };
  doc.root = new El("html", doc);
  doc.head = doc.createElement("head");
  doc.body = doc.createElement("body");
  doc.root.append(doc.head, doc.body);
  const add = (parent, tag, id) => {
    const n = doc.createElement(tag);
    n.id = id;
    n.attrs.set("id", id);
    parent.append(n);
    return n;
  };
  const app = add(doc.body, "div", "app");
  const header = add(app, "header", "app-header");
  const actions = doc.createElement("div");
  actions.className = "app-header-actions";
  header.append(actions);
  add(app, "div", "canvas-host");
  add(app, "aside", "panel");
  const bar = add(app, "footer", "bottombar");
  add(bar, "div", "dimension-strip");
  add(bar, "div", "busy");
  Object.assign(globalThis, {
    document: doc,
    localStorage: store,
    location: { href },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
  });
  return doc;
}

export function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (Object.hasOwn(data, k) ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    data,
  };
}
