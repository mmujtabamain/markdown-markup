// The vscode target's widgets: core's 30 extern widgets, drawn as VS Code draws its own UI. The
// controls are VS Code's components: its buttons, checkboxes, switches, toggles, tabs and radio
// lists, its input boxes, a slider drawn from its switch, and its hover and dialog widgets, in the
// editor's theme colours and with its focus ring, and `icon` is a codicon. They keep the web
// target's behaviour (its events, keyboard, roles and the checks' `act`), since that is what core's
// contracts hold every target to; the look is VS Code's. Markdown's blocks are drawn as VS Code's
// Markdown preview draws them, and the plane, the layout and the graphics in the editor's colours.

import { widgets as web, type Widget, type WidgetView } from "@extended-mark/dom";
import { kase, str, Tokens } from "@extended-mark/dom/shared";
import type { Drawn } from "@extended-mark/runtime";
import { CODICONS } from "./codicons.js";

/** A web widget, with VS Code's look: its element gets the target's classes, and `decorate` adds
 * what VS Code's component has that the web one doesn't, each redraw. */
function look(name: string, classes: string[], decorate?: (el: HTMLElement, d: Drawn) => void): Widget {
  const base = web[`core/${name}`];
  return (d, ctx) => {
    const view = base(d, ctx);
    const el = view.el as HTMLElement;
    el.classList.add("vsc", ...classes);
    decorate?.(el, d);
    return {
      ...view,
      el,
      update(next: Drawn) {
        view.update(next);
        decorate?.(el, next);
      },
    } satisfies WidgetView;
  };
}

/** A press's kind, as VS Code's component for it: a button (primary or secondary), a checkbox, a
 * radio, a toggle switch, a tab or a list option. */
function pressLook(el: HTMLElement, d: Drawn): void {
  const kind = (kase(d.props.get("kind")) ?? "BUTTON").toLowerCase();
  el.classList.toggle("vsc-button", kind === "button" || kind === "toggle");
  // a plain press is VS Code's secondary button; a button, its primary one
  el.classList.toggle("vsc-secondary", kind === "plain");
  el.classList.toggle("vsc-check", kind === "check");
  el.classList.toggle("vsc-radio", kind === "radio");
  el.classList.toggle("vsc-switch", kind === "switch");
  el.classList.toggle("vsc-tab", kind === "tab");
  el.classList.toggle("vsc-option", kind === "option");
}

/** The slider's track is filled up to its value, which the track's own colours can't say: the share
 * goes to the stylesheet as --vsc-fill, at each redraw and as it is dragged. */
function sliderLook(el: HTMLElement): void {
  const input = el.querySelector<HTMLInputElement>("input[type=range]");
  if (!input) return;
  const fill = () => {
    const lo = Number(input.min || 0);
    const hi = Number(input.max || 100);
    const share = hi > lo ? ((Number(input.value) - lo) / (hi - lo)) * 100 : 0;
    input.style.setProperty("--vsc-fill", `${Math.min(100, Math.max(0, share))}%`);
  };
  if (!input.dataset.vscFill) {
    input.dataset.vscFill = "1";
    input.addEventListener("input", fill);
  }
  fill();
}

/** `icon`: a codicon, VS Code's own glyph for the idea. The web's drawing of the glyph is inside it
 * too, hidden by the preview's stylesheet once the codicon font is there, so a page without that
 * stylesheet (the checks' own) still shows the icon. Its role and name are this element's. */
const icon: Widget = (d, ctx) => {
  const tokens = new Tokens(ctx.page);
  const el = document.createElement("span");
  const drawn = web["core/icon"](d, ctx);
  el.append(drawn.el);
  const view: WidgetView = {
    el,
    update(next) {
      drawn.update(next);
      // the drawing is decoration inside this element, which has the name
      for (const a of ["role", "aria-label"]) drawn.el.removeAttribute(a);
      drawn.el.setAttribute("aria-hidden", "true");
      const glyph = kase(next.props.get("name")) ?? "";
      const codicon = CODICONS[glyph];
      el.className = codicon ? `vsc vsc-icon codicon codicon-${codicon}` : "vsc vsc-icon";
      el.dataset.glyph = glyph;
      el.dataset.size = (kase(next.props.get("size")) ?? "NORMAL").toLowerCase();
      const label = str(next.props.get("label"));
      if (label) {
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", label);
        el.removeAttribute("aria-hidden");
      } else {
        el.removeAttribute("role");
        el.removeAttribute("aria-label");
        el.setAttribute("aria-hidden", "true");
      }
      const tone = tokens.color(next.props.get("tone"));
      if (tone) el.style.color = tone;
      else el.style.removeProperty("color");
    },
  };
  view.update(d);
  return view;
};

/** Every widget the vscode target supplies, by full name. */
export const widgets: Record<string, Widget> = {
  ...web,
  "core/press": look("press", ["vsc-press"], pressLook),
  "core/field": look("field", ["vsc-field"]),
  "core/slider": look("slider", ["vsc-slider"], sliderLook),
  "core/label": look("label", ["vsc-label"]),
  "core/image": look("image", ["vsc-image"]),
  "core/icon": icon,
  "core/overlay": look("overlay", ["vsc-overlay"]),
  "core/paragraph": look("paragraph", ["vsc-md"]),
  "core/heading": look("heading", ["vsc-md"]),
  "core/bullets": look("bullets", ["vsc-md"]),
  "core/item": look("item", ["vsc-md"]),
  "core/quote": look("quote", ["vsc-md"]),
  "core/code": look("code", ["vsc-md", "vsc-code"]),
  "core/math": look("math", ["vsc-md"]),
  "core/table": look("table", ["vsc-md", "vsc-table"]),
  "core/footnote": look("footnote", ["vsc-md"]),
  "core/divider": look("divider", ["vsc-md"]),
};
// the notice is the runtime's, not core's: named without core/
widgets["#notice"] = ((): Widget => {
  const base = web["#notice"];
  return (d, ctx) => {
    const v = base(d, ctx);
    (v.el as HTMLElement).classList.add("vsc", "vsc-notice");
    return v;
  };
})();
