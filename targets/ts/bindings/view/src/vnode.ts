// A page as plain elements: what every framework target renders, each with its own renderer, so
// core's widgets are written once and drawn by React, Vue, Svelte, Solid and Angular alike. An
// element is its tag, its attributes, its DOM properties, its style, its listeners and its
// children; what can't be said that way (a canvas drawn on, a plane measured) is a hook the
// renderer calls with the real element once it is in the document.

/** One element. `svg` puts it in SVG's namespace; `key` keeps it across redraws among its siblings. */
export interface VNode {
  tag: string;
  svg?: boolean;
  key?: string;
  /** Attributes as written in HTML: `class`, `data-part`, `aria-*`, `role`… */
  attrs: Record<string, string>;
  /** DOM properties that aren't attributes once the element is live: `value`, `checked`, `disabled`, `hidden`. */
  props?: Record<string, unknown>;
  /** CSS properties, in their CSS spelling (`text-align`, `--xtmd-tone`). */
  style?: Record<string, string>;
  /** DOM events by their DOM name (`click`, `input`, `keydown`). */
  on?: Record<string, (e: Event) => void>;
  children: Child[];
  hook?: Hook;
}

export type Child = VNode | string;

/** What only the real element can do: called when it enters the document, after each render it
 * stays through, and as it leaves. */
export interface Hook {
  mount?(el: Element): void;
  update?(el: Element): void;
  unmount?(el: Element): void;
}

/** An element with its part: `data-part="press.label"` and the class `xtmd-press-label`, as
 * @extended-mark/dom's widgets mark theirs, so @extended-mark/dom's stylesheet styles both. */
export function h(tag: string, part?: string, attrs: Record<string, string | undefined | false | null> = {}, children: Child[] = []): VNode {
  const a: Record<string, string> = {};
  if (part) {
    a["data-part"] = part;
    a.class = `xtmd-${part.replace(/\./g, "-")}`;
  }
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) a[k] = v;
  return { tag, attrs: a, children };
}

/** An SVG element, marked as `h` marks one. */
export function s(tag: string, part?: string, attrs: Record<string, string | undefined | false | null> = {}, children: Child[] = []): VNode {
  return { ...h(tag, part, attrs, children), svg: true };
}

/** Sets an attribute, or leaves it off for undefined, null or false. */
export function attr(v: VNode, name: string, value: string | undefined | null | false): VNode {
  if (value === undefined || value === null || value === false) delete v.attrs[name];
  else v.attrs[name] = value;
  return v;
}

/** Adds a class when `on` holds. */
export function cls(v: VNode, name: string, on = true): VNode {
  if (!on) return v;
  v.attrs.class = v.attrs.class ? `${v.attrs.class} ${name}` : name;
  return v;
}

/** Sets a CSS property, or leaves it off for undefined or "". */
export function css(v: VNode, prop: string, value: string | undefined): VNode {
  if (value === undefined || value === "") return v;
  (v.style ??= {})[prop] = value;
  return v;
}

/** Sets a DOM property. */
export function prop(v: VNode, name: string, value: unknown): VNode {
  (v.props ??= {})[name] = value;
  return v;
}

/** Listens for a DOM event. */
export function on(v: VNode, event: string, f: (e: Event) => void): VNode {
  (v.on ??= {})[event] = f;
  return v;
}

/** The text a node holds, its children's included: for a label's accessible name, and the tests. */
export function textOf(c: Child): string {
  return typeof c === "string" ? c : c.children.map(textOf).join("");
}
