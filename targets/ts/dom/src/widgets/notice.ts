// Notices: a widget that failed (the runtime's `#notice`), one nobody supplies, and one whose
// own drawing threw. Each says so where the widget would be, as an alert.

import type { Drawn } from "@extended-mark/runtime";
import type { Widget, WidgetView } from "../api.js";
import { h, text } from "../kit.js";
import { str } from "../values.js";

function noticeView(message: string): WidgetView & { el: HTMLElement } {
  const el = h("div", "notice", { role: "alert" });
  el.textContent = message;
  return { el, update() {} };
}

/** The runtime's notice for a widget that failed: its message, kept current. */
export const notice: Widget = (d) => {
  const v = noticeView(str(d.props.get("message")));
  return {
    el: v.el,
    update(d: Drawn) {
      text(v.el, str(d.props.get("message")));
    },
  };
};

/** An extern widget nobody supplied, such as a pack's without its web widgets. */
export const unknownWidget: Widget = (d) => noticeView(`Nothing draws ${d.widget} here: its widget isn't supplied.`);

/** Views that stand for a widget whose drawing threw: the next redraw tries the widget again. */
export const broken = new WeakSet<WidgetView>();

/** A widget whose drawing threw: a notice in its place, so the rest of the page still draws. */
export function failedView(d: Drawn, f: unknown): WidgetView {
  const v = noticeView(`${d.widget.split("/").pop()} couldn't be drawn: ${f instanceof Error ? f.message : String(f)}`);
  broken.add(v);
  return v;
}
