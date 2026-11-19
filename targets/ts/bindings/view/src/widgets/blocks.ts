// Markdown's own blocks, as the HTML elements they are: p, h1–h6, ul/ol/li with task boxes,
// blockquote, pre>code, table, footnotes and hr, as @extended-mark/dom draws them (the same parts and
// classes, so the same stylesheet). Props are read as markdown.ts reads them, so the page's words
// and its Markdown agree.

import { flag, inner, kase, list, noteId, num, str, texOf } from "@extended-mark/dom/shared";
import type { ViewWidget } from "../render.js";
import type { Act } from "../act.js";
import { cls, css, h, prop, type VNode } from "../vnode.js";
import { richChildren, withTex } from "./rich.js";

const ALIGN: Record<string, string> = { START: "start", CENTER: "center", END: "end", STRETCH: "justify", BASELINE: "start" };

export const paragraph: ViewWidget = (d, ctx) => {
  const el = h("p", "paragraph", {}, richChildren(d.props.get("value"), ctx, d));
  css(el, "color", ctx.tokens.color(d.props.get("tone")));
  const a = kase(d.props.get("align")) ?? "START";
  css(el, "text-align", a === "START" ? undefined : ALIGN[a]);
  return el;
};

export const heading: ViewWidget = (d, ctx) => {
  // another level is another element: the renderer puts the new one in the old one's place
  const level = Math.min(6, Math.max(1, Math.round(num(d.props.get("level")) ?? 1)));
  return h(`h${level}`, "heading", {}, richChildren(d.props.get("value"), ctx, d));
};

export const bullets: ViewWidget = (d, ctx) => {
  // ul and ol are different elements: the items are drawn again into the new one
  const ordered = flag(d.props.get("ordered"));
  const start = num(d.props.get("start")) ?? 1;
  const items = d.slots.get("items") ?? [];
  const el = h(ordered ? "ol" : "ul", "bullets", { start: ordered && start !== 1 ? String(start) : undefined }, ctx.children(items));
  return cls(el, "xtmd-tasks", items.some((i) => i.widget === "core/item" && inner(i.props.get("done")) !== undefined));
};

export const item: ViewWidget = (d, ctx) => {
  const done = inner(d.props.get("done"));
  const body = h("div", "item.body", {}, ctx.children(d.slots.get("body") ?? []));
  // keyed, so the body is kept as the task box comes and goes before it
  body.key = "body";
  const el = h("li", "item", {}, [body]);
  if (done && done.kind === "bool") {
    // a task box shows the item's state; ticking it is for a press, so it can't be changed here
    const box = h("input", "item.check", { type: "checkbox", "aria-label": done.b ? "Done" : "Not done" });
    box.key = "check";
    prop(box, "disabled", true);
    prop(box, "checked", done.b);
    el.children.unshift(box);
    cls(el, "xtmd-task");
  }
  return el;
};

export const quote: ViewWidget = (d, ctx) => h("blockquote", "quote", {}, ctx.children(d.slots.get("body") ?? []));

export const code: ViewWidget = (d) => {
  const lang = str(d.props.get("lang")).trim().split(/\s+/)[0] ?? "";
  const c = h("code", "code.text", {}, [str(d.props.get("src"))]);
  cls(c, `language-${lang.replace(/[^\w+#.-]/g, "")}`, !!lang);
  return h("pre", "code", { tabindex: "0", "data-lang": lang || undefined }, [c]);
};

export const math: ViewWidget = (d) => withTex(h("div", "math"), texOf(d.props.get("tex")), true);

export const table: ViewWidget = (d, ctx) => {
  const align = list(d.props.get("align")).map((a) => kase(a));
  const place = (cell: VNode, k: number): VNode => {
    const a = align[k];
    return css(cell, "text-align", a === "CENTER" ? "center" : a === "END" ? "end" : undefined);
  };
  const head = h("thead", undefined, {}, [
    h("tr", undefined, {}, list(d.props.get("head")).map((c, k) => place(h("th", "table.header", { scope: "col" }, richChildren(c, ctx, d)), k))),
  ]);
  const body = h(
    "tbody",
    undefined,
    {},
    list(d.props.get("rows")).map((r) => h("tr", undefined, {}, list(r).map((c, k) => place(h("td", "table.cell", {}, richChildren(c, ctx, d)), k)))),
  );
  // the wrapper scrolls a wide table on a narrow screen, the page itself never does
  return h("div", "table", { tabindex: "0" }, [h("table", "table.grid", {}, [head, body])]);
};

export const footnote: ViewWidget = (d, ctx) => {
  const m = str(d.props.get("mark"));
  const uid = ctx.uid;
  return h("div", "footnote", { role: "note", id: noteId(uid, m), "aria-label": `Footnote ${m}` }, [
    // back to where the note is marked
    h("a", "footnote.mark", { href: `#${uid}fnref-${encodeURIComponent(m)}` }, [m]),
    h("div", "footnote.body", {}, ctx.children(d.slots.get("body") ?? [])),
  ]);
};

export const divider: ViewWidget = () => h("hr", "divider");

// ---- acting through the element, for the checks

/** Markdown's blocks take no reader actions of their own: what is in them acts for itself. */
export const acts: Record<string, Act> = {};
