// rich_text as inline elements, as @extended-mark/dom's drawRich draws it: its segments with their marks,
// read as markdown.ts reads them, so what is drawn and what is written as Markdown say the same
// words. Links and pictures are checked before use, and nothing in a value is ever read as HTML.
// TeX is given as its text, and drawn as MathML by a hook once the element is live.

import { inlineSlot, type Drawn, type Value } from "@extended-mark/runtime";
import { field, inner, list, noteId, safeHref, safeSrc, str, texOf, texToMathML } from "@extended-mark/dom/shared";
import type { ViewContext } from "../render.js";
import { cls, h, type Child, type Hook, type VNode } from "../vnode.js";

/** What a TeX element shows now: the TeX it was drawn for, and its MathML (none: TeX this reader
 * doesn't know, shown as it is written). */
const drawn = new WeakMap<Element, { tex: string; math: Element | undefined }>();

/** Draws an element's `data-tex` as MathML, as @extended-mark/dom's drawTex does: read again only when the
 * TeX changed, and put back when a redraw put the render's text in its place. */
function texHook(display: boolean): Hook {
  const draw = (el: Element) => {
    const tex = el.getAttribute("data-tex") ?? "";
    let was = drawn.get(el);
    if (!was || was.tex !== tex) {
      const math = texToMathML(tex, display);
      math?.setAttribute("aria-hidden", "true");
      drawn.set(el, (was = { tex, math }));
    }
    if (was.math) {
      el.classList.remove("xtmd-math-tex");
      if (el.childNodes.length !== 1 || el.firstChild !== was.math) el.replaceChildren(was.math);
    } else {
      el.classList.add("xtmd-math-tex");
      if (el.childElementCount || el.textContent !== tex) el.textContent = tex;
    }
  };
  return { mount: draw, update: draw, unmount: (el) => drawn.delete(el) };
}

/** Makes an element a TeX one: the TeX as its accessible text and, until its hook draws the
 * MathML (and on a server, which never does), as what it shows. */
export function withTex(v: VNode, tex: string, display: boolean): VNode {
  v.attrs["data-tex"] = tex;
  v.attrs.role = "math";
  v.attrs["aria-label"] = tex;
  cls(v, "xtmd-math-tex");
  v.children = [tex];
  v.hook = texHook(display);
  return v;
}

/** A rich_text's inline elements. `d` is the widget it belongs to: a view in a sentence is drawn
 * as its child. */
export function richChildren(v: Value | undefined, ctx: ViewContext, d: Drawn): Child[] {
  const uid = ctx.uid;
  const out: Child[] = [];
  let link: { href: string; el: VNode } | undefined;
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
    let node: Child;
    switch (part.name) {
      case "TEXT":
        node = str(field(part, "value"));
        break;
      case "CODE":
        node = h("code", undefined, {}, [str(field(part, "value"))]);
        break;
      case "MATH":
        node = withTex(h("span", undefined, { class: "xtmd-math" }), texOf(field(part, "tex")), false);
        break;
      case "IMAGE":
        node = h("img", undefined, { alt: str(field(part, "alt")), src: safeSrc(str(field(part, "src"))) });
        break;
      case "NOTE": {
        const mark = str(field(part, "mark"));
        node = h("sup", undefined, { class: "xtmd-note-ref" }, [
          h("a", undefined, { href: `#${noteId(uid, mark)}`, id: `${uid}fnref-${encodeURIComponent(mark)}`, "aria-label": `Footnote ${mark}` }, [mark]),
        ]);
        break;
      }
      case "BREAK":
        node = h("br");
        break;
      case "VIEW": {
        // the runtime drew the view as this widget's slot, which is drawn here
        const slot = inlineSlot(field(part, "child"));
        node = h("span", undefined, { class: "xtmd-inline" }, ctx.children((slot && d.slots.get(slot)) || []));
        break;
      }
      default:
        return;
    }
    // marks, innermost first: strike, italic, bold, then the link around runs that share it
    if (on("strike")) node = h("s", undefined, {}, [node]);
    if (on("italic")) node = h("em", undefined, {}, [node]);
    if (on("bold")) node = h("strong", undefined, {}, [node]);
    if (href !== undefined) {
      if (!link || link.href !== href) {
        const safe = safeHref(href);
        const a = safe
          ? h("a", undefined, { href: safe, rel: /^https?:/i.test(safe) ? "noopener noreferrer" : undefined })
          : h("span", undefined, { "data-unsafe-link": "" });
        out.push(a);
        link = { href, el: a };
      }
      link.el.children.push(node);
    } else {
      link = undefined;
      out.push(node);
    }
  });
  return out;
}
