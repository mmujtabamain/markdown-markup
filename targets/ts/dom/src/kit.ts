// What our own widgets need besides the WidgetContext: the page's tokens as CSS, ids unique on
// the document, and the plane's layout. mount gives each context one; a binding that calls our
// widgets with a context of its own gets one made from the page, so they still draw.

import type { Page } from "@mkp/runtime";
import type { WidgetContext, WidgetView } from "./api.js";
import { Tokens } from "./tokens.js";

export interface Kit {
  readonly tokens: Tokens;
  /** A prefix unique to this mounted page, for element ids (`mkp3-`). */
  readonly uid: string;
  /** Runs the plane's layout now: after a ResizeObserver says a spot changed size. */
  layout(): void;
  /** The view drawn at a path, for the layout's measure. */
  view(path: string): WidgetView | undefined;
  /** Forgets the views drawn into containers inside an element, before it is emptied by hand. */
  release(el: Element): void;
}

const kits = new WeakMap<object, Kit>();
const pageTokens = new WeakMap<Page, Tokens>();
let mounts = 0;

export function newUid(): string {
  return `mkp${++mounts}-`;
}

export function tokensOf(page: Page): Tokens {
  let t = pageTokens.get(page);
  if (!t) pageTokens.set(page, (t = new Tokens(page)));
  return t;
}

export function giveKit(ctx: WidgetContext, kit: Kit): void {
  kits.set(ctx, kit);
}

export function kit(ctx: WidgetContext): Kit {
  let k = kits.get(ctx);
  if (!k) {
    k = { tokens: tokensOf(ctx.page), uid: newUid(), layout() {}, view: () => undefined, release() {} };
    kits.set(ctx, k);
  }
  return k;
}

/** Builds an element with a class, a data-part and attributes, as every widget does. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, part?: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (part) {
    el.setAttribute("data-part", part);
    el.className = `mkp-${part.replace(/\./g, "-")}`;
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export const SVG = "http://www.w3.org/2000/svg";

export function s<K extends keyof SVGElementTagNameMap>(tag: K, part?: string, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  if (part) {
    el.setAttribute("data-part", part);
    el.setAttribute("class", `mkp-${part.replace(/\./g, "-")}`);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Sets an attribute only when it changes, or removes it for undefined: a redraw that changes
 * nothing touches nothing. */
export function attr(el: Element, name: string, value: string | undefined | null | false): void {
  if (value === undefined || value === null || value === false) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function text(el: Node, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function css(el: HTMLElement | SVGElement, prop: string, value: string | undefined): void {
  if (value === undefined || value === "") {
    if (el.style.getPropertyValue(prop)) el.style.removeProperty(prop);
  } else if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

/** Marks a DOM event as done by a control inside, so a clickable flex around it lets it be. */
const claimed = new WeakSet<Event>();

export function claim(e: Event): void {
  claimed.add(e);
}

export function isClaimed(e: Event): boolean {
  return claimed.has(e);
}
