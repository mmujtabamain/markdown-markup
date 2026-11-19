// rich_text drawn as inline elements: its segments with their marks, read as markdown.ts reads
// them, so what is drawn and what is written as Markdown say the same words. Links and pictures
// are checked before use, and nothing in a value is ever read as HTML.

import { inlineSlot, type Drawn, type Value } from "@extended-mark/runtime";
import type { WidgetContext } from "./api.js";
import { kit } from "./kit.js";
import { drawTex } from "./tex.js";
import { field, inner, list, str } from "./values.js";

/** Whether a link may be followed: http, https and mailto, or a relative one. Whitespace and
 * control characters are dropped first, as browsers do, so `java\tscript:` is caught. */
export function safeHref(url: string): string | undefined {
  const plain = url.replace(/[\u0000- \u007f]/g, "");
  if (!plain) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(plain);
  if (!scheme) return url.trim();
  return ["http", "https", "mailto"].includes(scheme[1].toLowerCase()) ? url.trim() : undefined;
}

/** Whether a picture may be shown: http, https, relative, or a data: image. */
export function safeSrc(url: string): string | undefined {
  const plain = url.replace(/[\u0000- \u007f]/g, "");
  if (/^data:image\//i.test(plain)) return url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(plain);
  if (!scheme) return plain ? url.trim() : undefined;
  return ["http", "https"].includes(scheme[1].toLowerCase()) ? url.trim() : undefined;
}

/** A template's text: its pieces with each hole's shown text between them. */
export function templateText(v: Value | undefined): string {
  const pieces = list(field(v, "pieces"));
  const holes = list(field(v, "holes"));
  return pieces.map((p, k) => str(p) + (holes[k] ? str(field(holes[k], "value")) : "")).join("");
}

/** A latex value's TeX: the text markdown.ts writes between dollars. */
export function texOf(latex: Value | undefined): string {
  return templateText(field(latex, "tex"));
}

/** The id a footnote's mark is reached by. */
export function noteId(uid: string, mark: string): string {
  return `${uid}fn-${encodeURIComponent(mark)}`;
}

/** Draws a rich_text into an element, replacing what it held. `d` is the widget it belongs to: a
 * view in a sentence is drawn from its slot. */
export function drawRich(into: Element, v: Value | undefined, ctx: WidgetContext, d: Drawn): void {
  const k = kit(ctx);
  const uid = k.uid;
  k.release(into);
  into.replaceChildren();
  let link: { href: string | undefined; el: Element } | undefined;
  const views: { span: HTMLElement; nodes: Drawn[] }[] = [];
  list(field(v, "segments")).forEach((seg) => {
    const part = inner(field(seg, "part"));
    if (!part || part.kind !== "case") return;
    const marks = field(seg, "marks");
    const on = (n: string) => {
      const x = inner(field(marks, n));
      return !!x && x.kind === "bool" && x.b;
    };
    const l = inner(field(marks, "link"));
    const href = l ? str(l) : undefined;
    let node: Node;
    switch (part.name) {
      case "TEXT":
        node = document.createTextNode(str(field(part, "value")));
        break;
      case "CODE": {
        const c = document.createElement("code");
        c.textContent = str(field(part, "value"));
        node = c;
        break;
      }
      case "MATH": {
        const m = document.createElement("span");
        m.className = "xtmd-math";
        drawTex(m, texOf(field(part, "tex")), false);
        node = m;
        break;
      }
      case "IMAGE": {
        const src = safeSrc(str(field(part, "src")));
        const img = document.createElement("img");
        img.alt = str(field(part, "alt"));
        if (src) img.src = src;
        node = img;
        break;
      }
      case "NOTE": {
        const mark = str(field(part, "mark"));
        const sup = document.createElement("sup");
        sup.className = "xtmd-note-ref";
        const a = document.createElement("a");
        a.href = `#${noteId(uid, mark)}`;
        a.id = `${uid}fnref-${encodeURIComponent(mark)}`;
        a.setAttribute("aria-label", `Footnote ${mark}`);
        a.textContent = mark;
        sup.append(a);
        node = sup;
        break;
      }
      case "BREAK":
        node = document.createElement("br");
        break;
      case "VIEW": {
        // the runtime drew the view as this widget's slot, which is drawn here
        const span = document.createElement("span");
        span.className = "xtmd-inline";
        const slot = inlineSlot(field(part, "child"));
        views.push({ span, nodes: (slot && d.slots.get(slot)) || [] });
        node = span;
        break;
      }
      default:
        return;
    }
    // marks, innermost first: strike, italic, bold, then the link around runs that share it
    if (on("strike")) node = wrap("s", node);
    if (on("italic")) node = wrap("em", node);
    if (on("bold")) node = wrap("strong", node);
    if (href !== undefined) {
      if (!link || link.href !== href) {
        const safe = safeHref(href);
        const a = document.createElement(safe ? "a" : "span");
        if (safe) {
          a.setAttribute("href", safe);
          if (/^https?:/i.test(safe)) a.setAttribute("rel", "noopener noreferrer");
        } else a.setAttribute("data-unsafe-link", "");
        into.append(a);
        link = { href, el: a };
      }
      link.el.append(node);
    } else {
      link = undefined;
      into.append(node);
    }
  });
  for (const { span, nodes } of views) ctx.children(span, nodes);
}

function wrap(tag: string, child: Node): Node {
  const el = document.createElement(tag);
  el.append(child);
  return el;
}
