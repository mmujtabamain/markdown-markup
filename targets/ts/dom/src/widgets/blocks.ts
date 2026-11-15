// Markdown's own blocks, drawn as the HTML elements they are: p, h1–h6, ul/ol/li with task boxes,
// blockquote, pre>code, table, footnotes and hr. Props are read as markdown.ts reads them, so the
// page's words and its Markdown agree.

import type { Drawn } from "@mkp/runtime";
import type { Widget, WidgetContext, WidgetView } from "../api.js";
import { attr, css, h, kit, text } from "../kit.js";
import { drawRich, noteId, texOf } from "../rich.js";
import { drawTex } from "../tex.js";
import { flag, inner, kase, list, num, sig, str } from "../values.js";

const ALIGN: Record<string, string> = { START: "start", CENTER: "center", END: "end", STRETCH: "justify", BASELINE: "start" };

/** Rich text kept in an element: redrawn only when the value changes, so a selection survives. */
function richKeeper(el: Element, ctx: WidgetContext) {
  let was = "\u0000";
  return (d: Drawn, input = "value") => {
    const v = d.props.get(input);
    const now = sig(v);
    if (now === was) return;
    was = now;
    drawRich(el, v, ctx, d);
  };
}

export const paragraph: Widget = (d, ctx) => {
  const el = h("p", "paragraph");
  const rich = richKeeper(el, ctx);
  const view: WidgetView = {
    el,
    update(d) {
      rich(d);
      css(el, "color", kit(ctx).tokens.color(d.props.get("tone")));
      const a = kase(d.props.get("align")) ?? "START";
      css(el, "text-align", a === "START" ? undefined : ALIGN[a]);
    },
  };
  view.update(d);
  return view;
};

export const heading: Widget = (d, ctx) => {
  const level = () => Math.min(6, Math.max(1, Math.round(num(d.props.get("level")) ?? 1)));
  let at = level();
  let el: HTMLElement = h(`h${at}` as "h1", "heading");
  let rich = richKeeper(el, ctx);
  const view = {
    get el() {
      return el;
    },
    update(next: Drawn) {
      d = next;
      const l = level();
      if (l !== at) {
        // another level is another element: the mount puts the new one in the old one's place
        kit(ctx).release(el);
        el = h(`h${l}` as "h1", "heading");
        at = l;
        rich = richKeeper(el, ctx);
      }
      rich(d);
    },
  };
  view.update(d);
  return view;
};

export const bullets: Widget = (d, ctx) => {
  const ordered = () => flag(d.props.get("ordered"));
  let isOl = ordered();
  let el: HTMLElement = h(isOl ? "ol" : "ul", "bullets");
  const view = {
    get el() {
      return el;
    },
    update(next: Drawn) {
      d = next;
      if (ordered() !== isOl) {
        // ul and ol are different elements: the items are drawn again into the new one
        isOl = ordered();
        kit(ctx).release(el);
        el = h(isOl ? "ol" : "ul", "bullets");
      }
      const start = num(d.props.get("start")) ?? 1;
      attr(el, "start", isOl && start !== 1 ? String(start) : undefined);
      const items = d.slots.get("items") ?? [];
      el.classList.toggle("mkp-tasks", items.some((i) => i.widget === "core/item" && inner(i.props.get("done")) !== undefined));
      ctx.children(el, items);
    },
  };
  view.update(d);
  return view;
};

export const item: Widget = (d, ctx) => {
  const el = h("li", "item");
  const body = h("div", "item.body");
  let box: HTMLInputElement | undefined;
  el.append(body);
  const view: WidgetView = {
    el,
    update(d) {
      const done = inner(d.props.get("done"));
      if (done && done.kind === "bool") {
        if (!box) {
          // a task box shows the item's state; ticking it is for a press, so it can't be changed here
          box = h("input", "item.check", { type: "checkbox", disabled: "" });
          box.setAttribute("aria-label", done.b ? "Done" : "Not done");
          el.prepend(box);
        }
        box.checked = done.b;
        attr(box, "aria-label", done.b ? "Done" : "Not done");
        el.classList.add("mkp-task");
      } else if (box) {
        box.remove();
        box = undefined;
        el.classList.remove("mkp-task");
      }
      ctx.children(body, d.slots.get("body") ?? []);
    },
  };
  view.update(d);
  return view;
};

export const quote: Widget = (d, ctx) => {
  const el = h("blockquote", "quote");
  const view: WidgetView = {
    el,
    update(d) {
      ctx.children(el, d.slots.get("body") ?? []);
    },
  };
  view.update(d);
  return view;
};

export const code: Widget = (d) => {
  const el = h("pre", "code", { tabindex: "0" });
  const c = h("code", "code.text");
  el.append(c);
  const view: WidgetView = {
    el,
    update(d) {
      const lang = str(d.props.get("lang")).trim().split(/\s+/)[0] ?? "";
      const cls = lang ? `mkp-code-text language-${lang.replace(/[^\w+#.-]/g, "")}` : "mkp-code-text";
      if (c.className !== cls) c.className = cls;
      attr(el, "data-lang", lang || undefined);
      text(c, str(d.props.get("src")));
    },
  };
  view.update(d);
  return view;
};

export const math: Widget = (d) => {
  const el = h("div", "math");
  el.classList.add("mkp-math");
  const view: WidgetView = {
    el,
    update(d) {
      drawTex(el, texOf(d.props.get("tex")), true);
    },
  };
  view.update(d);
  return view;
};

export const table: Widget = (d, ctx) => {
  // the wrapper scrolls a wide table on a narrow screen, the page itself never does
  const el = h("div", "table", { tabindex: "0" });
  const t = h("table", "table.grid");
  el.append(t);
  let was = "";
  const view: WidgetView = {
    el,
    update(d) {
      const now = [sig(d.props.get("head")), sig(d.props.get("rows")), sig(d.props.get("align"))].join("|");
      if (now === was) return;
      was = now;
      kit(ctx).release(t);
      const align = list(d.props.get("align")).map((a) => kase(a));
      const place = (cell: HTMLElement, k: number) => {
        const a = align[k];
        if (a === "CENTER" || a === "END") cell.style.textAlign = a === "CENTER" ? "center" : "end";
      };
      const head = h("thead");
      const hr = h("tr");
      list(d.props.get("head")).forEach((c, k) => {
        const th = h("th", "table.header", { scope: "col" });
        drawRich(th, c, ctx, d);
        place(th, k);
        hr.append(th);
      });
      head.append(hr);
      const tbody = h("tbody");
      for (const r of list(d.props.get("rows"))) {
        const tr = h("tr");
        list(r).forEach((c, k) => {
          const td = h("td", "table.cell");
          drawRich(td, c, ctx, d);
          place(td, k);
          tr.append(td);
        });
        tbody.append(tr);
      }
      t.replaceChildren(head, tbody);
    },
  };
  view.update(d);
  return view;
};

export const footnote: Widget = (d, ctx) => {
  const el = h("div", "footnote", { role: "note" });
  const mark = h("a", "footnote.mark");
  const body = h("div", "footnote.body");
  el.append(mark, body);
  const view: WidgetView = {
    el,
    update(d) {
      const m = str(d.props.get("mark"));
      const uid = kit(ctx).uid;
      attr(el, "id", noteId(uid, m));
      attr(el, "aria-label", `Footnote ${m}`);
      // back to where the note is marked
      attr(mark, "href", `#${uid}fnref-${encodeURIComponent(m)}`);
      text(mark, m);
      ctx.children(body, d.slots.get("body") ?? []);
    },
  };
  view.update(d);
  return view;
};

export const divider: Widget = () => ({ el: h("hr", "divider"), update() {} });
