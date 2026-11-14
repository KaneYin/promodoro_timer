// Minimal deterministic DOM surface for component/controller tests, not a browser.
export function createDOM() {
  const nodes = new Map();
  class Element {
    constructor(tagName = "div") {
      this.tagName = tagName;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.events = {};
      this.attributes = {};
      this.textContent = "";
      this.value = "";
    }
    setAttribute(key, value) { this.attributes[key] = value; this[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, callback) { this.events[name] = callback; }
    querySelector(selector) { return node(selector.slice(1)); }
    querySelectorAll(selector) {
      const values = {"[data-metric]": ["focus", "screen"], "[data-period]": ["day", "week", "month"], "[data-order]": ["asc", "desc"]}[selector] ?? [];
      return values.map(value => Object.assign(new Element("button"), { dataset: { [selector.slice(6, -1)]: value } }));
    }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const document = {
    getElementById: node,
    createElement: tag => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
    createTextNode: text => Object.assign(new Element("#text"), { textContent: text }),
    body: new Element("body"),
    events: {},
    addEventListener(name, callback) { this.events[name] = callback; },
  };
  return { node, Element, document };
}

export const contents = node => node.textContent + node.children.map(contents).join(" ");
export const descendants = node => [node, ...node.children.flatMap(descendants)];
